import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, PontoPreco, ResultadoConsultaFonte, TesteResultado } from '@licitapreco/shared';
import { logger } from '../../utils/logger.js';
import type { FonteAdapter } from './adapter.js';
import { requisitarComprasGov } from './comprasGovHttp.js';
import { resolverItemNoCatalogo } from './resolucaoCatalogo.js';

/**
 * Atas de Registro de Preço publicadas no PNCP (art. 82 da Lei 14.133/2021),
 * consultadas POR CÓDIGO CATMAT/CATSER via Portal de Dados Abertos do
 * Compras.gov.br (`modulo-arp/2_consultarARPItem`).
 *
 * A versão anterior varria `pncp.gov.br/api/consulta/v1/atas` (até 500 atas
 * por página, sem filtro de item) e procurava o item por texto — lenta, dava
 * timeout e quase nunca achava o item. Contrato desta rota confirmado ao
 * vivo (out/2026): `codigoItem` + janela obrigatória
 * `dataVigenciaInicialMin/Max` (yyyy-MM-dd); cada linha traz valorUnitario
 * homologado, descricaoItem, nomeUnidadeGerenciadora, fornecedor e
 * numeroControlePncpAta. Filtrar por `codigoPdm` nessa rota dá timeout —
 * por isso só códigos exatos.
 */

const URL_ARP_ITEM = 'https://dadosabertos.compras.gov.br/modulo-arp/2_consultarARPItem';
const MAX_CANDIDATOS = 6;
const JANELA_DIAS = 365;
const OPCOES_REQUISICAO = { timeoutMs: 15000, retries: 1 };

interface ItemAta {
  numeroAtaRegistroPreco?: string;
  numeroControlePncpAta?: string;
  codigoItem?: number;
  descricaoItem?: string;
  tipoItem?: string;
  valorUnitario?: number;
  nomeUnidadeGerenciadora?: string;
  nomeRazaoSocialFornecedor?: string;
  dataAssinatura?: string;
  dataVigenciaInicial?: string;
  dataVigenciaFinal?: string;
  itemExcluido?: boolean;
  dataHoraExclusao?: string | null;
}

function isoDiasAtras(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatarData(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

async function consultarAtas(codigoItem: number, tamanhoPagina = 50): Promise<ItemAta[]> {
  const params = new URLSearchParams({
    pagina: '1',
    tamanhoPagina: String(tamanhoPagina),
    codigoItem: String(codigoItem),
    dataVigenciaInicialMin: isoDiasAtras(JANELA_DIAS),
    dataVigenciaInicialMax: isoDiasAtras(0),
  });
  const resp = await requisitarComprasGov(`${URL_ARP_ITEM}?${params.toString()}`, OPCOES_REQUISICAO);
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Compras.gov.br (Atas) respondeu HTTP ${resp.status}.`);
  const corpo = resp.corpoJson as { resultado?: ItemAta[] } | null;
  return corpo?.resultado ?? [];
}

function tipoCompativel(linha: ItemAta, rota: 'MATERIAL' | 'SERVICO'): boolean {
  if (!linha.tipoItem) return true;
  const t = linha.tipoItem.toLowerCase();
  return rota === 'MATERIAL' ? t.startsWith('mat') : t.startsWith('serv');
}

async function buscarPrecos(item: ItemNormalizado, limite: number): Promise<{ pontos: PontoPreco[]; candidatos: number[]; passos: string[] }> {
  const { rota, candidatos } = await resolverItemNoCatalogo(item);
  const pontos = new Map<string, PontoPreco>();
  const passos: string[] = [];

  const consultas = await Promise.all(
    candidatos.slice(0, MAX_CANDIDATOS).map(async (c) => {
      try {
        return { c, linhas: await consultarAtas(c.codigo), erro: null };
      } catch (e) {
        return { c, linhas: [] as ItemAta[], erro: e instanceof Error ? e : new Error(String(e)) };
      }
    }),
  );
  const falhas = consultas.filter((x) => x.erro);
  if (falhas.length > 0 && falhas.length === consultas.length) throw falhas[0].erro;
  for (const { c, linhas, erro } of consultas) {
    if (erro) { passos.push(`código ${c.codigo}: falhou (${erro.message})`); continue; }
    let aproveitadas = 0;
    // Mais recentes primeiro.
    linhas.sort((a, b) => (b.dataAssinatura ?? '').localeCompare(a.dataAssinatura ?? ''));
    for (const l of linhas) {
      if (pontos.size >= limite) break;
      const preco = Number(l.valorUnitario);
      if (!Number.isFinite(preco) || preco <= 0 || l.itemExcluido || l.dataHoraExclusao || !tipoCompativel(l, rota)) continue;
      const orgao = l.nomeUnidadeGerenciadora ?? 'órgão não identificado';
      const chave = l.numeroControlePncpAta ?? `${orgao}|${l.numeroAtaRegistroPreco}|${preco}`;
      if (pontos.has(chave)) continue;
      const assinatura = l.dataAssinatura ? formatarData(l.dataAssinatura) : 's/ data';
      pontos.set(chave, {
        preco,
        referencia:
          `Ata de Registro de Preço ${l.numeroAtaRegistroPreco ?? ''} — ${orgao}, assinada em ${assinatura}` +
          `${l.numeroControlePncpAta ? `, PNCP ${l.numeroControlePncpAta}` : ''}, CATMAT/CATSER ${l.codigoItem ?? c.codigo}; ` +
          `consultado em ${new Date().toLocaleDateString('pt-BR')}`,
        fundamentacaoArtigo: '',
        dadosBrutos: {
          codigoItem: l.codigoItem,
          descricaoItem: l.descricaoItem,
          fornecedor: l.nomeRazaoSocialFornecedor,
          numeroControlePncpAta: l.numeroControlePncpAta,
          vigencia: [l.dataVigenciaInicial, l.dataVigenciaFinal],
          scoreResolucaoCodigo: c.score,
        },
      });
      aproveitadas++;
    }
    passos.push(`código ${c.codigo}: ${linhas.length} itens de ata, ${aproveitadas} aproveitados`);
  }

  return { pontos: [...pontos.values()], candidatos: candidatos.map((c) => c.codigo), passos };
}

export const pncpAtasAdapter: FonteAdapter = {
  slug: 'pncp-atas',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoConsultaFonte> {
    const limite = Math.max(config.limiteResultados > 0 ? config.limiteResultados : 3, 3);
    try {
      const { pontos, candidatos, passos } = await buscarPrecos(item, limite);
      if (candidatos.length === 0) {
        return { pontos: [], diagnostico: 'Atas (PNCP): descrição não corresponde a nenhum código do catálogo oficial.' };
      }
      logger.info(`Atas PNCP: ${pontos.length} preço(s) — ${passos.join('; ')}`);
      if (pontos.length === 0) {
        return { pontos: [], diagnostico: `Atas (PNCP): nenhuma ata vigente nos últimos 12 meses — ${passos.join('; ')}.` };
      }
      const fundamentacaoArtigo = config.fundamentacaoArtigo ?? '';
      return { pontos: pontos.map((p) => ({ ...p, fundamentacaoArtigo })) };
    } catch (e) {
      logger.error('Atas PNCP: fonte indisponível', e);
      return { pontos: [], erro: e instanceof Error ? e.message : 'Falha ao consultar as Atas de Registro de Preço.' };
    }
  },

  async testar(_config: FonteCotacao, itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      const item: ItemNormalizado = {
        nome: itemAmostra, descricao: itemAmostra, descricaoNormalizada: itemAmostra,
        cascata: [itemAmostra], quantidade: 1, unidadeMedida: 'UN',
      };
      const { candidatos } = await resolverItemNoCatalogo(item);
      // Conectividade testada com um código que sabidamente tem atas
      // (443990), independente do catálogo local já ter sido importado.
      const codigo = candidatos[0]?.codigo ?? 443990;
      const linhas = await consultarAtas(codigo, 10);
      const latenciaMs = Date.now() - inicio;
      const amostra = linhas.find((l) => Number(l.valorUnitario) > 0);
      return {
        ok: true,
        latenciaMs,
        amostraPreco: amostra ? Number(amostra.valorUnitario) : null,
        amostraReferencia: amostra ? `${amostra.descricaoItem ?? ''} — ${amostra.nomeUnidadeGerenciadora ?? ''}` : null,
        mensagem: `Atas de Registro de Preço acessíveis — ${linhas.length} item(ns) de ata para o código ${codigo} em ${latenciaMs}ms.`,
        dadosBrutos: { codigo, total: linhas.length },
      };
    } catch (e) {
      return {
        ok: false, latenciaMs: Date.now() - inicio, amostraPreco: null, amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha: ${e.message}` : 'Falha de conexão.', dadosBrutos: null,
      };
    }
  },
};

export function pncpAtasCacheStatus(): { itens: number; expiresAt: number | null; carregando: boolean } {
  return { itens: 0, expiresAt: null, carregando: false };
}
