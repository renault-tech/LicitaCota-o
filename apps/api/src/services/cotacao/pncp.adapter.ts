import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, PontoPreco, ResultadoConsultaFonte, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { melhorCorrespondencia } from '../../utils/matching.js';
import type { FonteAdapter } from './adapter.js';

const BASE_CONSULTA = 'https://pncp.gov.br/api/consulta';
const BASE_PNCP = 'https://pncp.gov.br/api/pncp';

/**
 * Adapter do PNCP (Portal Nacional de Contratações Públicas).
 *
 * O PNCP não expõe busca textual por item nas contratações publicadas — o
 * endpoint de consulta documentado (`/contratacoes/publicacao`) só filtra
 * por data, modalidade, UF e órgão. Para encontrar preços comparáveis é
 * necessário varrer contratações e checar os itens de cada uma.
 *
 * Estratégia (nesta ordem, parando assim que atingir `limite` pontos):
 *  1. Contratações do mesmo estado (UF) do item, se informado — preços
 *     regionais são o comparativo de mercado mais defensável.
 *  2. Contratações nacionais dos últimos 90 dias.
 *  3. Contratações nacionais de 91 a 365 dias atrás.
 * Nenhum filtro de modalidade é aplicado: restringir a um código específico
 * (ex.: só Pregão) descartaria contratações comparáveis via outras
 * modalidades e não há garantia de quais códigos estão em uso no momento —
 * a precisão fica a cargo do casamento de descrição, não do filtro.
 *
 * Cada contrato com item correspondente vira um PontoPreco independente
 * (não uma média): três contratos de três órgãos distintos devem entrar no
 * cálculo como três preços, para que o descarte de outliers e o mínimo de
 * fontes do art. 23 da Lei 14.133/2021 operem sobre dados reais.
 */

interface ContratacaoItem {
  descricao?: string;
  descricaoItem?: string;
  valorUnitarioEstimado?: number;
  valorUnitario?: number;
}

interface Contratacao {
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string };
  anoCompra?: number;
  sequencialCompra?: number;
  dataPublicacaoPncp?: string;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function diasAtras(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Executa `tarefa` sobre `itens` com no máximo `concorrencia` em paralelo. */
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

/**
 * Busca contratações recentes numa janela de data (e opcionalmente UF).
 * Usa totalPaginas para ir direto à última página (mais recentes primeiro).
 * Lança erro em falha de rede/HTTP — não engole silenciosamente, para que o
 * chamador distinga "fonte fora do ar" de "nenhum contrato correspondente".
 */
async function buscarContratacoes(
  dataIni: Date,
  dataFim: Date,
  uf: string | undefined,
  maxContratos: number,
): Promise<Contratacao[]> {
  const ufParam = uf ? `&uf=${encodeURIComponent(uf)}` : '';
  const base = `${BASE_CONSULTA}/v1/contratacoes/publicacao?dataInicial=${fmt(dataIni)}&dataFinal=${fmt(dataFim)}${ufParam}&tamanhoPagina=50`;

  const primeira = await requisitar(`${base}&pagina=1`, { timeoutMs: 12000, retries: 1 });
  if (!primeira.ok) throw new Error(`PNCP respondeu HTTP ${primeira.status} ao listar contratações.`);
  const corpo1 = primeira.corpoJson as { totalPaginas?: number; data?: Contratacao[] } | null;
  const totalPaginas = corpo1?.totalPaginas ?? 1;

  if (totalPaginas <= 1) {
    return (corpo1?.data ?? []).filter((c) => c.orgaoEntidade?.cnpj && c.anoCompra && c.sequencialCompra);
  }

  const ultima = await requisitar(`${base}&pagina=${totalPaginas}`, { timeoutMs: 12000, retries: 1 });
  if (!ultima.ok) throw new Error(`PNCP respondeu HTTP ${ultima.status} ao listar contratações.`);
  const corpo2 = ultima.corpoJson as { data?: Contratacao[] } | null;
  const contratos = (corpo2?.data ?? []).filter(
    (c) => c.orgaoEntidade?.cnpj && c.anoCompra && c.sequencialCompra,
  );
  return contratos.slice(-maxContratos).reverse();
}

/** Itens de uma contratação específica. Falha aqui é tolerada — só pula o contrato. */
async function buscarItensContrato(cnpj: string, ano: number, seq: number): Promise<ContratacaoItem[]> {
  const url = `${BASE_PNCP}/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens?pagina=1&tamanhoPagina=50`;
  try {
    const resp = await requisitar(url, { timeoutMs: 8000, retries: 0 });
    if (!resp.ok) return [];
    const body = resp.corpoJson;
    if (Array.isArray(body)) return body as ContratacaoItem[];
    return (body as { data?: ContratacaoItem[] })?.data ?? [];
  } catch {
    return [];
  }
}

interface Janela {
  ini: Date;
  fim: Date;
  uf?: string;
  rotulo: string;
}

function montarJanelas(uf: string | undefined): Janela[] {
  const janelas: Janela[] = [];
  if (uf) {
    janelas.push({ ini: diasAtras(730), fim: new Date(), uf, rotulo: `regional (${uf}, 24 meses)` });
  }
  janelas.push({ ini: diasAtras(90), fim: new Date(), rotulo: 'nacional (90 dias)' });
  janelas.push({ ini: diasAtras(365), fim: diasAtras(91), rotulo: 'nacional (91-365 dias)' });
  return janelas;
}

async function buscarPrecos(
  item: ItemNormalizado,
  limite: number,
): Promise<{ pontos: PontoPreco[]; contratacoesTentadas: number }> {
  const janelas = montarJanelas(item.uf);
  const pontosPorFonte = new Map<string, PontoPreco>();
  let contratacoesTentadas = 0;
  let algumaJanelaFuncionou = false;
  let ultimoErro: unknown;

  for (const janela of janelas) {
    if (pontosPorFonte.size >= limite) break;

    let contratos: Contratacao[];
    try {
      contratos = await buscarContratacoes(janela.ini, janela.fim, janela.uf, 40);
      algumaJanelaFuncionou = true;
    } catch (e) {
      ultimoErro = e;
      logger.warn(`PNCP: falha ao listar contratações (${janela.rotulo})`, e);
      continue;
    }
    logger.info(`PNCP: ${contratos.length} contratações candidatas (${janela.rotulo})`);
    contratacoesTentadas += contratos.length;

    const pendentes = contratos.filter((c) => {
      const key = `${c.orgaoEntidade!.cnpj}/${c.anoCompra}/${c.sequencialCompra}`;
      return !pontosPorFonte.has(key);
    });

    const itensPorContrato = await mapComConcorrencia(pendentes, 5, async (ct) => {
      const itens = await buscarItensContrato(ct.orgaoEntidade!.cnpj!, ct.anoCompra!, ct.sequencialCompra!);
      return { ct, itens };
    });

    for (const { ct, itens } of itensPorContrato) {
      if (pontosPorFonte.size >= limite) break;
      const candidatos = itens
        .map((it) => ({ it, desc: it.descricao ?? it.descricaoItem ?? '', preco: it.valorUnitario ?? it.valorUnitarioEstimado }))
        .filter((c) => c.desc && c.preco && c.preco > 0);

      const melhor = melhorCorrespondencia(item.descricaoNormalizada, candidatos, (c) => c.desc);
      if (!melhor) continue;

      const key = `${ct.orgaoEntidade!.cnpj}/${ct.anoCompra}/${ct.sequencialCompra}`;
      const orgao = ct.orgaoEntidade?.razaoSocial ?? ct.orgaoEntidade!.cnpj;
      const data = ct.dataPublicacaoPncp?.slice(0, 10) ?? `${ct.anoCompra}`;
      pontosPorFonte.set(key, {
        preco: melhor.item.preco!,
        referencia: `PNCP — ${orgao} (${data}, consultado em ${new Date().toLocaleDateString('pt-BR')})`,
        fundamentacaoArtigo: '',
        dadosBrutos: { score: melhor.score, descricaoCandidata: melhor.item.desc },
      });
    }
  }

  // Só propaga erro se NENHUMA janela conseguiu sequer listar contratações
  // (fonte de fato indisponível); falha parcial já é registrada via log.
  if (!algumaJanelaFuncionou && ultimoErro) throw ultimoErro;

  return { pontos: [...pontosPorFonte.values()], contratacoesTentadas };
}

export const pncpAdapter: FonteAdapter = {
  slug: 'pncp',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoConsultaFonte> {
    const limite = Math.max(config.limiteResultados > 0 ? config.limiteResultados : 3, 3);
    try {
      const { pontos, contratacoesTentadas } = await buscarPrecos(item, limite);
      logger.info(`PNCP: ${pontos.length} preço(s) de fontes distintas (${contratacoesTentadas} contratações avaliadas)`);
      const fundamentacaoArtigo = config.fundamentacaoArtigo ?? '';
      return { pontos: pontos.map((p) => ({ ...p, fundamentacaoArtigo })) };
    } catch (e) {
      logger.error('PNCP: fonte indisponível', e);
      return { pontos: [], erro: e instanceof Error ? e.message : 'Falha ao consultar o PNCP.' };
    }
  },

  async testar(_config: FonteCotacao, _itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      const hoje = new Date();
      const ini = diasAtras(30);
      const url = `${BASE_CONSULTA}/v1/contratacoes/publicacao?dataInicial=${fmt(ini)}&dataFinal=${fmt(hoje)}&pagina=1&tamanhoPagina=10`;
      // Timeout bem mais generoso que o usado durante o processamento real
      // (12s) — ação isolada do admin, não está no caminho de uma pesquisa
      // com vários itens. Serve de diagnóstico: se falhar mesmo com 30s, é
      // sinal de que o PNCP está de fato fora do ar, não só lento; se
      // funcionar, o endpoint só é mais lento que 12s (provavelmente por
      // não filtrarmos codigoModalidadeContratacao, que a documentação do
      // PNCP lista como parâmetro esperado — sem ele, a consulta parece
      // varrer todas as modalidades no período, mais cara que o normal).
      const resp = await requisitar(url, { timeoutMs: 30000, retries: 0 });
      const latenciaMs = Date.now() - inicio;
      if (!resp.ok) {
        return { ok: false, latenciaMs, amostraPreco: null, amostraReferencia: null, mensagem: `PNCP respondeu HTTP ${resp.status}.`, dadosBrutos: null };
      }
      const body = resp.corpoJson as { totalRegistros?: number; totalPaginas?: number } | null;
      return {
        ok: true, latenciaMs, amostraPreco: null, amostraReferencia: null,
        mensagem: `PNCP acessível — ${body?.totalRegistros?.toLocaleString('pt-BR')} contratações em ${latenciaMs}ms.`,
        dadosBrutos: { totalRegistros: body?.totalRegistros, totalPaginas: body?.totalPaginas },
      };
    } catch (e) {
      return {
        ok: false, latenciaMs: Date.now() - inicio, amostraPreco: null, amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha: ${e.message}` : 'Falha de conexão.', dadosBrutos: null,
      };
    }
  },
};

export function pncpCacheStatus(): { itens: number; expiresAt: number | null; carregando: boolean } {
  return { itens: 0, expiresAt: null, carregando: false };
}
