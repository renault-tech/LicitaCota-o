import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoCotacao, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { media } from './calculo.js';
import type { FonteAdapter } from './adapter.js';

const BASE = 'https://pncp.gov.br/api';
const CACHE_TTL_MS = 10 * 60 * 1000;

// Campos reais retornados por /consulta/v1/atas
interface Ata {
  cnpjOrgao?: string;
  numeroControlePNCPAta?: string;
  cancelado?: boolean;
}

interface AtaItem {
  descricaoItem?: string;
  descricao?: string;
  valorUnitario?: number;
  valorUnitarioEstimado?: number;
}

type AtaItemComRef = AtaItem & { _ref: string };

let _cache: { itens: AtaItemComRef[]; expiresAt: number } | null = null;
let _fetchPromise: Promise<AtaItemComRef[]> | null = null;

function dataFormatada(diasAtras: number): string {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').trim();
}

// Formato: {cnpj}-{modalidade}-{seq}/{ano}-{nata}
// Ex: "18457226000181-1-000015/2023-000001"
function parsearAta(ata: Ata): { cnpj: string; anoCompra: number; sequencialCompra: number; sequencialAta: number } | null {
  if (!ata.cnpjOrgao || !ata.numeroControlePNCPAta || ata.cancelado) return null;
  const match = ata.numeroControlePNCPAta.match(/-(\d+)\/(\d{4})-(\d+)$/);
  if (!match) return null;
  return {
    cnpj: ata.cnpjOrgao,
    sequencialCompra: parseInt(match[1], 10),
    anoCompra: parseInt(match[2], 10),
    sequencialAta: parseInt(match[3], 10),
  };
}

async function buscarAtas(): Promise<Ata[]> {
  const url =
    `${BASE}/consulta/v1/atas` +
    `?dataInicial=${dataFormatada(61)}&dataFinal=${dataFormatada(1)}&pagina=1&tamanhoPagina=500`;
  const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
  if (!resp.ok) return [];
  const body = resp.corpoJson as { data?: Ata[] } | null;
  return body?.data ?? [];
}

async function buscarItensAta(cnpj: string, ano: number, seq: number, nata: number): Promise<AtaItem[]> {
  const url = `${BASE}/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/atas/${nata}/itens?pagina=1&tamanhoPagina=50`;
  const resp = await requisitar(url, { timeoutMs: 12000, retries: 0 });
  if (!resp.ok) return [];
  const body = resp.corpoJson;
  if (Array.isArray(body)) return body as AtaItem[];
  return (body as { data?: AtaItem[] })?.data ?? [];
}

async function carregarTodosItens(): Promise<AtaItemComRef[]> {
  logger.info('PNCP Atas: iniciando carga do cache...');
  let atas: Ata[];
  try {
    atas = await buscarAtas();
  } catch (e) {
    logger.error('PNCP Atas: falha ao buscar atas', e);
    return [];
  }

  const candidatas = atas
    .map(parsearAta)
    .filter((a): a is NonNullable<ReturnType<typeof parsearAta>> => a !== null);

  logger.info(`PNCP Atas: ${atas.length} atas recebidas, ${candidatas.length} válidas`);

  const resultados = await Promise.allSettled(
    candidatas.map(({ cnpj, anoCompra, sequencialCompra, sequencialAta }) =>
      buscarItensAta(cnpj, anoCompra, sequencialCompra, sequencialAta).then((itens) =>
        itens.map((i) => ({
          ...i,
          _ref: `PNCP Ata — ${cnpj} ${anoCompra}/${sequencialCompra}/ata${sequencialAta}`,
        })),
      ),
    ),
  );

  const todos = resultados
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => (r as PromiseFulfilledResult<AtaItemComRef[]>).value);

  logger.info(`PNCP Atas cache carregado: ${todos.length} itens de ${candidatas.length} atas`);
  return todos;
}

async function obterItensCache(): Promise<AtaItemComRef[]> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.itens;
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = carregarTodosItens()
    .then((itens) => {
      _cache = { itens, expiresAt: now + CACHE_TTL_MS };
      _fetchPromise = null;
      return itens;
    })
    .catch((err: unknown) => {
      _fetchPromise = null;
      throw err;
    });

  return _fetchPromise;
}

function matcherTermos(termos: string[], descNorm: string): boolean {
  return termos.some((t) => {
    const palavras = normalizar(t).split(' ').filter((w) => w.length > 2);
    if (palavras.length === 0) return false;
    const acertos = palavras.filter((w) => descNorm.includes(w)).length;
    return acertos >= Math.max(1, Math.ceil(palavras.length * 0.5));
  });
}

async function buscarPrecos(
  termos: string[],
  limite: number,
): Promise<{ precos: number[]; referencia: string | null }> {
  const todosItens = await obterItensCache();
  logger.info(`PNCP Atas busca: ${todosItens.length} itens no cache, termos=${JSON.stringify(termos).slice(0, 80)}`);

  const precos: number[] = [];
  let referencia: string | null = null;

  for (const item of todosItens) {
    const desc = item.descricaoItem ?? item.descricao ?? '';
    const preco = item.valorUnitario ?? item.valorUnitarioEstimado;
    if (!desc || !preco || preco <= 0) continue;
    if (matcherTermos(termos, normalizar(desc))) {
      precos.push(preco);
      if (!referencia) referencia = item._ref;
      if (precos.length >= limite) break;
    }
  }

  logger.info(`PNCP Atas busca resultado: ${precos.length} preços encontrados`);
  return { precos, referencia };
}

export const pncpAtasAdapter: FonteAdapter = {
  slug: 'pncp-atas',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoCotacao> {
    const limite = Math.max(config.limiteResultados > 0 ? config.limiteResultados : 5, 3);
    try {
      const { precos, referencia } = await buscarPrecos(item.cascata, limite);
      if (precos.length === 0) {
        return { preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '', dadosBrutos: null };
      }
      return {
        preco: Math.round(media(precos) * 10000) / 10000,
        referencia: referencia ?? `PNCP Atas — ${new Date().toLocaleDateString('pt-BR')}`,
        fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: { precos, fonte: 'pncp-atas' },
      };
    } catch (e) {
      return {
        preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: null, erro: e instanceof Error ? e.message : 'Erro',
      };
    }
  },

  async testar(_config: FonteCotacao, _itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      const url = `${BASE}/consulta/v1/atas?dataInicial=${dataFormatada(31)}&dataFinal=${dataFormatada(1)}&pagina=1&tamanhoPagina=10`;
      const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
      const latenciaMs = Date.now() - inicio;
      if (!resp.ok) {
        return { ok: false, latenciaMs, amostraPreco: null, amostraReferencia: null, mensagem: `PNCP Atas respondeu HTTP ${resp.status}.`, dadosBrutos: null };
      }
      const body = resp.corpoJson as { data?: Ata[]; totalRegistros?: number } | null;
      const count = body?.data?.length ?? 0;
      const total = body?.totalRegistros ?? 0;
      const candidatas = (body?.data ?? []).map(parsearAta).filter(Boolean).length;
      return {
        ok: count > 0, latenciaMs, amostraPreco: null, amostraReferencia: null,
        mensagem: count > 0
          ? `PNCP Atas — ${count} atas (${candidatas} válidas, ${total.toLocaleString('pt-BR')} total) em ${latenciaMs}ms.`
          : 'PNCP Atas — nenhuma ata encontrada no período.',
        dadosBrutos: { atas: count, candidatas, totalRegistros: total },
      };
    } catch (e) {
      return {
        ok: false, latenciaMs: Date.now() - inicio, amostraPreco: null, amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha: ${e.message}` : 'Falha de conexão.', dadosBrutos: null,
      };
    }
  },
};
