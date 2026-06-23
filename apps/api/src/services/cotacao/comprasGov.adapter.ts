import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoCotacao, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { media } from './calculo.js';
import type { FonteAdapter } from './adapter.js';

const BASE = 'https://dadosabertos.compras.gov.br';

interface CatmatItem {
  codigoItem?: number;
  descricaoItem?: string;
}

interface PrecoItem {
  precoUnitario?: number;
  idCompra?: string;
  descricao?: string;
}

async function buscarCodigosCatmat(termo: string): Promise<number[]> {
  // tamanhoPagina deve estar entre 10 e 500 nesta API
  const url = `${BASE}/modulo-material/4_consultarItemMaterial?descricaoItem=${encodeURIComponent(termo)}&pagina=1&tamanhoPagina=10`;
  const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
  if (!resp.ok) return [];
  const body = resp.corpoJson as { resultado?: CatmatItem[] } | null;
  const lista = body?.resultado ?? [];
  return lista
    .map((i) => i.codigoItem)
    .filter((c): c is number => typeof c === 'number');
}

async function buscarPrecosPorCodigo(
  codigo: number,
  limite: number,
): Promise<{ precos: number[]; referencia: string | null }> {
  const tamanho = Math.max(10, limite); // mínimo 10
  const url =
    `${BASE}/modulo-pesquisa-preco/1_consultarMaterial` +
    `?codigoItemCatalogo=${codigo}&pagina=1&tamanhoPagina=${tamanho}`;
  const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
  if (!resp.ok) return { precos: [], referencia: null };
  const body = resp.corpoJson as { resultado?: PrecoItem[] } | null;
  const lista = body?.resultado ?? [];
  const precos: number[] = [];
  let referencia: string | null = null;
  for (const item of lista) {
    const v = item.precoUnitario;
    if (typeof v === 'number' && v > 0) {
      precos.push(v);
      if (!referencia) referencia = item.idCompra ?? item.descricao ?? null;
    }
  }
  return { precos, referencia };
}

export const comprasGovAdapter: FonteAdapter = {
  slug: 'compras-gov',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoCotacao> {
    const limite = config.limiteResultados > 0 ? config.limiteResultados : 5;
    try {
      for (const termo of item.cascata) {
        const codigos = await buscarCodigosCatmat(termo);
        if (codigos.length === 0) continue;
        const { precos, referencia } = await buscarPrecosPorCodigo(codigos[0], limite);
        if (precos.length > 0) {
          return {
            preco: Math.round(media(precos) * 10000) / 10000,
            referencia: referencia ?? `Compras.gov — ${new Date().toLocaleDateString('pt-BR')}`,
            fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
            dadosBrutos: { codigoCatmat: codigos[0], precos },
          };
        }
      }
      return { preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '', dadosBrutos: null };
    } catch (e) {
      return {
        preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: null, erro: e instanceof Error ? e.message : 'Erro',
      };
    }
  },

  async testar(_config: FonteCotacao, itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      const codigos = await buscarCodigosCatmat(itemAmostra);
      if (codigos.length === 0) {
        return {
          ok: false, latenciaMs: Date.now() - inicio,
          amostraPreco: null, amostraReferencia: null,
          mensagem: 'Nenhum código CATMAT encontrado para o item de amostra.',
          dadosBrutos: null,
        };
      }
      const { precos, referencia } = await buscarPrecosPorCodigo(codigos[0], 5);
      const latenciaMs = Date.now() - inicio;
      if (precos.length === 0) {
        return {
          ok: false, latenciaMs, amostraPreco: null, amostraReferencia: null,
          mensagem: `Código CATMAT ${codigos[0]} encontrado, mas sem preços registrados.`,
          dadosBrutos: { codigoCatmat: codigos[0] },
        };
      }
      return {
        ok: true, latenciaMs,
        amostraPreco: Math.round(media(precos) * 10000) / 10000,
        amostraReferencia: referencia,
        mensagem: `${precos.length} preço(s) encontrado(s) via CATMAT ${codigos[0]} em ${latenciaMs}ms.`,
        dadosBrutos: { codigoCatmat: codigos[0], precos },
      };
    } catch (e) {
      return {
        ok: false, latenciaMs: Date.now() - inicio,
        amostraPreco: null, amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha: ${e.message}` : 'Falha de conexão.',
        dadosBrutos: null,
      };
    }
  },
};
