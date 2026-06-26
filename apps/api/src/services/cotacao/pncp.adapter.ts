import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoCotacao, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { media } from './calculo.js';
import type { FonteAdapter } from './adapter.js';

const BASE = 'https://pncp.gov.br/api';
const CACHE_TTL_MS = 10 * 60 * 1000;
const BATCH_SIZE = 15; // requests de item em paralelo por vez

interface ContratacaoItem {
  descricaoItem?: string;
  descricao?: string;
  valorUnitarioEstimado?: number;
  valorUnitario?: number;
}

interface Contratacao {
  orgaoEntidade?: { cnpj?: string };
  anoCompra?: number;
  sequencialCompra?: number;
}

type ItemComRef = ContratacaoItem & { _ref: string };

let _cache: { itens: ItemComRef[]; expiresAt: number } | null = null;
let _fetchPromise: Promise<ItemComRef[]> | null = null;

function dataFormatada(diasAtras: number): string {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').trim();
}

const MODALIDADES = [6, 8];

async function buscarUmaModalidade(modalidade: number, pagina: number): Promise<Contratacao[]> {
  const url =
    `${BASE}/consulta/v1/contratacoes/publicacao` +
    `?dataInicial=${dataFormatada(91)}&dataFinal=${dataFormatada(1)}` +
    `&codigoModalidadeContratacao=${modalidade}&pagina=${pagina}&tamanhoPagina=50`;
  const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
  if (!resp.ok) {
    logger.warn(`PNCP contratações HTTP ${resp.status}`, { modalidade, pagina, url });
    return [];
  }
  const body = resp.corpoJson as { data?: Contratacao[] } | null;
  const itens = body?.data ?? [];
  logger.info(`PNCP modalidade=${modalidade} pág=${pagina}: ${itens.length} contratações`);
  return itens;
}

async function buscarItensContrato(cnpj: string, ano: number, seq: number): Promise<ContratacaoItem[]> {
  const url = `${BASE}/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens?pagina=1&tamanhoPagina=50`;
  const resp = await requisitar(url, { timeoutMs: 10000, retries: 0 });
  if (!resp.ok) return [];
  const body = resp.corpoJson;
  if (Array.isArray(body)) return body as ContratacaoItem[];
  return (body as { data?: ContratacaoItem[] })?.data ?? [];
}

async function carregarTodosItens(): Promise<ItemComRef[]> {
  logger.info('PNCP: iniciando carga do cache...');

  // Busca 2 modalidades × 3 páginas → até 300 contratações
  const lotes = await Promise.allSettled(
    MODALIDADES.flatMap((m) => [1, 2, 3].map((p) => buscarUmaModalidade(m, p))),
  );
  const contratacoes = lotes
    .filter((r): r is PromiseFulfilledResult<Contratacao[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  logger.info(`PNCP: ${contratacoes.length} contratações a processar`);

  const validas = contratacoes.filter((ct) => ct.orgaoEntidade?.cnpj && ct.anoCompra && ct.sequencialCompra);
  logger.info(`PNCP: ${validas.length} contratações com CNPJ/ano/seq válidos`);

  // Busca itens em lotes para não sobrecarregar PNCP
  const todosItens: ItemComRef[] = [];
  for (let i = 0; i < validas.length; i += BATCH_SIZE) {
    const lote = validas.slice(i, i + BATCH_SIZE);
    const resultados = await Promise.allSettled(
      lote.map((ct) => {
        const cnpj = ct.orgaoEntidade!.cnpj!;
        const ano = ct.anoCompra!;
        const seq = ct.sequencialCompra!;
        return buscarItensContrato(cnpj, ano, seq).then((itens) =>
          itens.map((it) => ({ ...it, _ref: `PNCP — ${cnpj} ${ano}/${seq}` })),
        );
      }),
    );
    for (const r of resultados) {
      if (r.status === 'fulfilled') todosItens.push(...r.value);
    }
    if (i + BATCH_SIZE < validas.length) {
      await new Promise((res) => setTimeout(res, 300));
    }
  }

  logger.info(`PNCP cache carregado: ${todosItens.length} itens de ${validas.length} contratações`);
  return todosItens;
}

async function obterItensCache(): Promise<ItemComRef[]> {
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
      logger.error('PNCP: falha ao carregar cache', err);
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
  logger.info(`PNCP busca: ${todosItens.length} itens no cache, termos=${JSON.stringify(termos).slice(0, 120)}`);

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

  logger.info(`PNCP busca resultado: ${precos.length} preços encontrados`);
  return { precos, referencia };
}

export const pncpAdapter: FonteAdapter = {
  slug: 'pncp',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoCotacao> {
    const limite = Math.max(config.limiteResultados > 0 ? config.limiteResultados : 5, 3);
    try {
      const { precos, referencia } = await buscarPrecos(item.cascata, limite);
      if (precos.length === 0) {
        return { preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '', dadosBrutos: null };
      }
      return {
        preco: Math.round(media(precos) * 10000) / 10000,
        referencia: referencia ?? `PNCP — ${new Date().toLocaleDateString('pt-BR')}`,
        fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: { precos },
      };
    } catch (e) {
      logger.error('PNCP consultar erro', e);
      return {
        preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: null, erro: e instanceof Error ? e.message : 'Erro',
      };
    }
  },

  async testar(_config: FonteCotacao, _itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      const url =
        `${BASE}/consulta/v1/contratacoes/publicacao` +
        `?dataInicial=${dataFormatada(31)}&dataFinal=${dataFormatada(1)}` +
        `&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=10`;
      const resp = await requisitar(url, { timeoutMs: 12000, retries: 1 });
      const latenciaMs = Date.now() - inicio;
      if (!resp.ok) {
        return { ok: false, latenciaMs, amostraPreco: null, amostraReferencia: null, mensagem: `PNCP respondeu HTTP ${resp.status}.`, dadosBrutos: null };
      }
      const body = resp.corpoJson as { data?: unknown[] } | null;
      const count = body?.data?.length ?? 0;
      return {
        ok: count > 0, latenciaMs, amostraPreco: null, amostraReferencia: null,
        mensagem: count > 0
          ? `PNCP acessível — ${count} contratações recentes em ${latenciaMs}ms.`
          : 'PNCP sem contratações recentes no período.',
        dadosBrutos: { contratacoes: count },
      };
    } catch (e) {
      return {
        ok: false, latenciaMs: Date.now() - inicio, amostraPreco: null, amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha: ${e.message}` : 'Falha de conexão.', dadosBrutos: null,
      };
    }
  },
};

/** Expõe status do cache para diagnóstico. */
export function pncpCacheStatus(): { itens: number; expiresAt: number | null; carregando: boolean } {
  return {
    itens: _cache?.itens.length ?? 0,
    expiresAt: _cache?.expiresAt ?? null,
    carregando: _fetchPromise !== null,
  };
}
