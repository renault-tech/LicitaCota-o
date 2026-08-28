import { lookup } from 'node:dns/promises';
import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, PontoPreco, ResultadoConsultaFonte, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { melhorCorrespondencia, pontuarCorrespondencia } from '../../utils/matching.js';
import type { FonteAdapter } from './adapter.js';

const BASE_CONSULTA = 'https://pncp.gov.br/api/consulta';
const BASE_PNCP = 'https://pncp.gov.br/api/pncp';

/**
 * Adapter de Atas de Registro de Preço do PNCP. Mesma limitação de busca do
 * adapter de contratações (sem filtro textual na API) — ver comentário em
 * pncp.adapter.ts. Atas são especialmente valiosas: `valorUnitario` é o
 * preço homologado (vencedor do certame), não uma estimativa, e a vigência
 * longa (até 1 ano, prorrogável) mantém o preço válido por mais tempo.
 *
 * Diferente do endpoint de contratações, `/v1/atas` NÃO exige
 * codigoModalidadeContratacao (parâmetros obrigatórios documentados são só
 * dataInicial/dataFinal/pagina, que já eram enviados) — mas devolve até 500
 * registros por página (contra 50 do endpoint de contratações), então
 * timeouts consistentes aqui são mais prováveis de ser só "precisa de mais
 * tempo" do que um parâmetro faltando.
 */

interface Ata {
  numeroControlePNCPAta?: string;
  objetoContratacao?: string;
  cancelado?: boolean;
  dataPublicacaoPncp?: string;
  vigenciaFim?: string;
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string };
}

interface AtaItem {
  descricaoItem?: string;
  descricao?: string;
  valorUnitario?: number;
  valorUnitarioEstimado?: number;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function diasAtras(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function mapComConcorrencia<T, R>(
  itens: T[],
  concorrencia: number,
  tarefa: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let indice = 0;
  async function worker(): Promise<void> {
    while (indice < itens.length) {
      const i = indice++;
      resultados[i] = await tarefa(itens[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, itens.length) }, worker));
  return resultados;
}

// Formato: {cnpj14}-{modalidade}-{sequencial}/{ano}-{sequencialAta}
function parsearAta(ata: Ata): { cnpj: string; anoCompra: number; sequencialCompra: number; sequencialAta: number } | null {
  if (!ata.numeroControlePNCPAta || ata.cancelado) return null;
  const controle = ata.numeroControlePNCPAta;
  const cnpj = controle.replace(/\D/g, '').slice(0, 14);
  if (cnpj.length !== 14) return null;
  const match = controle.match(/-(\d+)\/(\d{4})-(\d+)$/);
  if (!match) return null;
  return {
    cnpj,
    sequencialCompra: parseInt(match[1], 10),
    anoCompra: parseInt(match[2], 10),
    sequencialAta: parseInt(match[3], 10),
  };
}

/** Lança erro em falha de rede/HTTP — ver buscarContratacoes em pncp.adapter.ts. */
async function buscarAtas(dataIni: Date, dataFim: Date, uf: string | undefined, maxAtas: number): Promise<Ata[]> {
  const ufParam = uf ? `&uf=${encodeURIComponent(uf)}` : '';
  const base = `${BASE_CONSULTA}/v1/atas?dataInicial=${fmt(dataIni)}&dataFinal=${fmt(dataFim)}${ufParam}&tamanhoPagina=50`;

  const primeira = await requisitar(`${base}&pagina=1`, { timeoutMs: 18000, retries: 1 });
  if (!primeira.ok) throw new Error(`PNCP Atas respondeu HTTP ${primeira.status}.`);
  const corpo1 = primeira.corpoJson as { totalPaginas?: number; data?: Ata[] } | null;
  const totalPaginas = corpo1?.totalPaginas ?? 1;

  if (totalPaginas <= 1) return (corpo1?.data ?? []).filter((a) => !a.cancelado && a.numeroControlePNCPAta);

  const ultima = await requisitar(`${base}&pagina=${totalPaginas}`, { timeoutMs: 18000, retries: 1 });
  if (!ultima.ok) throw new Error(`PNCP Atas respondeu HTTP ${ultima.status}.`);
  const corpo2 = ultima.corpoJson as { data?: Ata[] } | null;
  const atas = (corpo2?.data ?? []).filter((a) => !a.cancelado && a.numeroControlePNCPAta);
  return atas.slice(-maxAtas).reverse();
}

async function buscarItensAta(cnpj: string, ano: number, seq: number, nata: number): Promise<AtaItem[]> {
  const url = `${BASE_PNCP}/v1/orgaos/${cnpj}/compras/${ano}/${seq}/atas/${nata}/itens?pagina=1&tamanhoPagina=50`;
  try {
    const resp = await requisitar(url, { timeoutMs: 8000, retries: 0 });
    if (!resp.ok) return [];
    const body = resp.corpoJson;
    if (Array.isArray(body)) return body as AtaItem[];
    return (body as { data?: AtaItem[] })?.data ?? [];
  } catch {
    return [];
  }
}

interface Janela { ini: Date; fim: Date; uf?: string; rotulo: string; }

function montarJanelas(uf: string | undefined): Janela[] {
  const janelas: Janela[] = [];
  if (uf) janelas.push({ ini: diasAtras(1095), fim: new Date(), uf, rotulo: `regional (${uf}, 36 meses)` });
  janelas.push({ ini: diasAtras(365), fim: new Date(), rotulo: 'nacional (12 meses)' });
  janelas.push({ ini: diasAtras(1095), fim: diasAtras(366), rotulo: 'nacional (1-3 anos)' });
  return janelas;
}

async function buscarPrecos(
  item: ItemNormalizado,
  limite: number,
): Promise<{ pontos: PontoPreco[]; atasTentadas: number; itensAvaliados: number; melhorScoreVisto: number }> {
  const janelas = montarJanelas(item.uf);
  const pontosPorFonte = new Map<string, PontoPreco>();
  let atasTentadas = 0;
  let itensAvaliados = 0;
  let melhorScoreVisto = 0;
  let algumaJanelaFuncionou = false;
  let ultimoErro: unknown;

  for (const janela of janelas) {
    if (pontosPorFonte.size >= limite) break;

    let atas: Ata[];
    try {
      atas = await buscarAtas(janela.ini, janela.fim, janela.uf, 30);
      algumaJanelaFuncionou = true;
    } catch (e) {
      ultimoErro = e;
      logger.warn(`PNCP Atas: falha ao listar (${janela.rotulo})`, e);
      continue;
    }
    logger.info(`PNCP Atas: ${atas.length} atas candidatas (${janela.rotulo})`);
    atasTentadas += atas.length;

    const parseadas = atas
      .map((ata) => ({ ata, p: parsearAta(ata) }))
      .filter((x): x is { ata: Ata; p: NonNullable<ReturnType<typeof parsearAta>> } => x.p !== null)
      .filter((x) => !pontosPorFonte.has(`${x.p.cnpj}/${x.p.anoCompra}/${x.p.sequencialCompra}/ata${x.p.sequencialAta}`));

    const itensPorAta = await mapComConcorrencia(parseadas, 5, async ({ ata, p }) => {
      const itens = await buscarItensAta(p.cnpj, p.anoCompra, p.sequencialCompra, p.sequencialAta);
      return { ata, p, itens };
    });

    for (const { ata, p, itens } of itensPorAta) {
      if (pontosPorFonte.size >= limite) break;
      const candidatos = itens
        .map((it) => ({ it, desc: it.descricao ?? it.descricaoItem ?? '', preco: it.valorUnitario ?? it.valorUnitarioEstimado }))
        .filter((c) => c.desc && c.preco && c.preco > 0);
      itensAvaliados += candidatos.length;

      const melhor = melhorCorrespondencia(item.descricaoNormalizada, candidatos, (c) => c.desc);
      if (!melhor) {
        for (const c of candidatos) {
          const score = pontuarCorrespondencia(item.descricaoNormalizada, c.desc);
          if (score > melhorScoreVisto) melhorScoreVisto = score;
        }
        continue;
      }
      if (melhor.score > melhorScoreVisto) melhorScoreVisto = melhor.score;

      const key = `${p.cnpj}/${p.anoCompra}/${p.sequencialCompra}/ata${p.sequencialAta}`;
      const data = ata.dataPublicacaoPncp?.slice(0, 10) ?? `${p.anoCompra}`;
      pontosPorFonte.set(key, {
        preco: melhor.item.preco!,
        referencia: `PNCP Ata — ${ata.orgaoEntidade?.razaoSocial ?? p.cnpj} (${data}, consultado em ${new Date().toLocaleDateString('pt-BR')})`,
        fundamentacaoArtigo: '',
        dadosBrutos: { score: melhor.score, descricaoCandidata: melhor.item.desc },
      });
    }
  }

  if (!algumaJanelaFuncionou && ultimoErro) throw ultimoErro;

  return { pontos: [...pontosPorFonte.values()], atasTentadas, itensAvaliados, melhorScoreVisto };
}

export const pncpAtasAdapter: FonteAdapter = {
  slug: 'pncp-atas',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoConsultaFonte> {
    const limite = Math.max(config.limiteResultados > 0 ? config.limiteResultados : 3, 3);
    try {
      const { pontos, atasTentadas, itensAvaliados, melhorScoreVisto } = await buscarPrecos(item, limite);
      logger.info(`PNCP Atas: ${pontos.length} preço(s) de fontes distintas (${atasTentadas} atas avaliadas)`);
      const fundamentacaoArtigo = config.fundamentacaoArtigo ?? '';
      if (pontos.length === 0) {
        return {
          pontos: [],
          diagnostico: `PNCP Atas: ${atasTentadas} atas e ${itensAvaliados} itens avaliados, melhor score de correspondência ${melhorScoreVisto.toFixed(2)} (limiar 0.45).`,
        };
      }
      return { pontos: pontos.map((p) => ({ ...p, fundamentacaoArtigo })) };
    } catch (e) {
      logger.error('PNCP Atas: fonte indisponível', e);
      return { pontos: [], erro: e instanceof Error ? e.message : 'Falha ao consultar Atas do PNCP.' };
    }
  },

  async testar(_config: FonteCotacao, _itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    let dnsInfo = '';
    try {
      const dnsInicio = Date.now();
      const enderecos = await lookup('pncp.gov.br');
      dnsInfo = `DNS resolveu para ${enderecos.address} em ${Date.now() - dnsInicio}ms. `;
    } catch (e) {
      dnsInfo = `DNS FALHOU: ${e instanceof Error ? e.message : String(e)}. `;
    }
    try {
      const hoje = new Date();
      const ini = diasAtras(30);
      const url = `${BASE_CONSULTA}/v1/atas?dataInicial=${fmt(ini)}&dataFinal=${fmt(hoje)}&pagina=1&tamanhoPagina=10`;
      // Timeout generoso — ação isolada do admin, e o endpoint devolve até
      // 500 registros/página (vs. 50 do endpoint de contratações), então
      // legitimamente pode ser mais lento mesmo sem nenhum problema real.
      const resp = await requisitar(url, { timeoutMs: 25000, retries: 0 });
      const latenciaMs = Date.now() - inicio;
      if (!resp.ok) {
        return { ok: false, latenciaMs, amostraPreco: null, amostraReferencia: null, mensagem: `${dnsInfo}PNCP Atas respondeu HTTP ${resp.status}.`, dadosBrutos: null };
      }
      const body = resp.corpoJson as { totalRegistros?: number; totalPaginas?: number } | null;
      return {
        ok: true, latenciaMs, amostraPreco: null, amostraReferencia: null,
        mensagem: `${dnsInfo}PNCP Atas acessível — ${body?.totalRegistros?.toLocaleString('pt-BR')} atas disponíveis em ${latenciaMs}ms.`,
        dadosBrutos: { totalRegistros: body?.totalRegistros, totalPaginas: body?.totalPaginas },
      };
    } catch (e) {
      return {
        ok: false, latenciaMs: Date.now() - inicio, amostraPreco: null, amostraReferencia: null,
        mensagem: `${dnsInfo}Falha: ${e instanceof Error ? e.message : 'Falha de conexão.'}`, dadosBrutos: null,
      };
    }
  },
};

export function pncpAtasCacheStatus(): { itens: number; expiresAt: number | null; carregando: boolean } {
  return { itens: 0, expiresAt: null, carregando: false };
}
