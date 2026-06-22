import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, MapeamentoCampos, ResultadoCotacao, TesteResultado } from '@licitapreco/shared';
import { requisitar, aplicarPlaceholders, montarQueryString } from '../../utils/http.js';
import { media } from './calculo.js';
import { extrairPreco, extrairReferencia, resolverLista } from './extrator.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Adapter genérico para fontes do tipo API_REST. Monta a requisição a partir
 * da configuração, extrai preços e referências via mapeamentoCampos (caminhos
 * tipo JSONPath) e calcula a média dos até `limiteResultados` primeiros.
 */

function lerMapeamento(config: FonteCotacao): MapeamentoCampos {
  const m = (config.mapeamentoCampos ?? {}) as Partial<MapeamentoCampos>;
  return {
    listaResultados: m.listaResultados,
    preco: Array.isArray(m.preco) ? m.preco : [],
    referencia: Array.isArray(m.referencia) ? m.referencia : [],
  };
}

function montarUrl(config: FonteCotacao, termo: string): string {
  const base = config.endpointBase ?? '';
  const template = (config.parametrosTemplate ?? {}) as Record<string, string>;
  const params: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(template)) {
    params[chave] = aplicarPlaceholders(valor, { descricaoItem: termo });
  }
  // Se a base já contém placeholders na própria URL, resolve-os também.
  const baseResolvida = aplicarPlaceholders(base, { descricaoItem: encodeURIComponent(termo) });
  const qs = Object.keys(params).length > 0 ? montarQueryString(params) : '';
  return baseResolvida.includes('?') ? `${baseResolvida}&${qs.slice(1)}` : `${baseResolvida}${qs}`;
}

async function consultarTermo(
  config: FonteCotacao,
  termo: string,
): Promise<{ precos: number[]; referencia: string | null; bruto: unknown; status: number }> {
  const url = montarUrl(config, termo);
  const headers = (config.headers ?? {}) as Record<string, string>;
  const resp = await requisitar(url, {
    metodo: config.metodoHttp || 'GET',
    headers,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    pausaMs: config.pausaMs,
  });

  const mapeamento = lerMapeamento(config);
  const lista = resolverLista(resp.corpoJson, mapeamento.listaResultados);
  const limite = config.limiteResultados > 0 ? config.limiteResultados : 5;

  const precos: number[] = [];
  let referencia: string | null = null;
  for (const item of lista.slice(0, limite)) {
    const preco = extrairPreco(item, mapeamento.preco);
    if (preco !== null) {
      precos.push(preco);
      if (!referencia) referencia = extrairReferencia(item, mapeamento.referencia);
    }
  }

  return { precos, referencia, bruto: resp.corpoJson, status: resp.status };
}

export const apiRestAdapter: FonteAdapter = {
  slug: 'api-rest',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoCotacao> {
    try {
      // Busca em cascata: tenta termos do mais completo ao núcleo.
      for (const termo of item.cascata) {
        const { precos, referencia, bruto } = await consultarTermo(config, termo);
        if (precos.length > 0) {
          return {
            preco: Math.round(media(precos) * 10000) / 10000,
            referencia: referencia ?? `${config.nome} - ${new Date().toLocaleDateString('pt-BR')}`,
            fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
            dadosBrutos: { termoUsado: termo, precos, resposta: bruto },
          };
        }
      }
      return {
        preco: null,
        referencia: '',
        fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: { cascataTentada: item.cascata },
      };
    } catch (e) {
      return {
        preco: null,
        referencia: '',
        fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: null,
        erro: e instanceof Error ? e.message : 'Erro ao consultar a fonte.',
      };
    }
  },

  async testar(config: FonteCotacao, itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      const { precos, referencia, bruto, status } = await consultarTermo(config, itemAmostra);
      const latenciaMs = Date.now() - inicio;
      if (status < 200 || status >= 300) {
        return {
          ok: false,
          latenciaMs,
          amostraPreco: null,
          amostraReferencia: null,
          mensagem: `A fonte respondeu com status HTTP ${status}.`,
          dadosBrutos: bruto,
        };
      }
      if (precos.length === 0) {
        return {
          ok: false,
          latenciaMs,
          amostraPreco: null,
          amostraReferencia: null,
          mensagem:
            'Conexão OK, mas o mapeamento não extraiu nenhum preço válido (> 0). Verifique os caminhos de preço/lista.',
          dadosBrutos: bruto,
        };
      }
      return {
        ok: true,
        latenciaMs,
        amostraPreco: Math.round(media(precos) * 10000) / 10000,
        amostraReferencia: referencia,
        mensagem: `Fonte válida: ${precos.length} preço(s) extraído(s) em ${latenciaMs}ms.`,
        dadosBrutos: bruto,
      };
    } catch (e) {
      return {
        ok: false,
        latenciaMs: Date.now() - inicio,
        amostraPreco: null,
        amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha de conexão: ${e.message}` : 'Falha de conexão.',
        dadosBrutos: null,
      };
    }
  },
};
