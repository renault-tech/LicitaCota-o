import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoCotacao, TesteResultado } from '@licitapreco/shared';
import { requisitar, aplicarPlaceholders } from '../../utils/http.js';
import { mediana } from './calculo.js';
import { extrairValoresPorRegex } from './extrator.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Adapter genérico para fontes do tipo SCRAPING. Carrega a página e extrai os
 * valores monetários via regexValor. Filtra outliers grosseiros (> 5x a mediana)
 * antes de calcular o preço de referência (mediana, mais robusta para scraping).
 */

function montarUrl(config: FonteCotacao, termo: string): string {
  const base = config.endpointBase ?? '';
  return aplicarPlaceholders(base, { descricaoItem: encodeURIComponent(termo) });
}

function filtrarOutliersGrosseiros(valores: number[]): number[] {
  if (valores.length <= 2) return valores;
  const med = mediana(valores);
  if (med <= 0) return valores;
  return valores.filter((v) => v <= med * 5);
}

async function buscar(
  config: FonteCotacao,
  termo: string,
): Promise<{ valores: number[]; status: number; amostraTexto: string }> {
  const url = montarUrl(config, termo);
  const headers = (config.headers ?? {}) as Record<string, string>;
  const resp = await requisitar(url, {
    metodo: config.metodoHttp || 'GET',
    headers,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    pausaMs: config.pausaMs,
  });
  const regex = config.regexValor ?? 'R\\$\\s?\\d{1,3}(?:\\.\\d{3})*,\\d{2}';
  const brutos = extrairValoresPorRegex(resp.corpoTexto, regex);
  const valores = filtrarOutliersGrosseiros(brutos).slice(
    0,
    config.limiteResultados > 0 ? config.limiteResultados : 10,
  );
  return { valores, status: resp.status, amostraTexto: resp.corpoTexto.slice(0, 2000) };
}

export const scrapingAdapter: FonteAdapter = {
  slug: 'scraping',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoCotacao> {
    try {
      for (const termo of item.cascata) {
        const { valores } = await buscar(config, termo);
        if (valores.length > 0) {
          return {
            preco: Math.round(mediana(valores) * 10000) / 10000,
            referencia: `${config.nome} - ${new Date().toLocaleDateString('pt-BR')}`,
            fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
            dadosBrutos: { termoUsado: termo, valores },
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
      const { valores, status, amostraTexto } = await buscar(config, itemAmostra);
      const latenciaMs = Date.now() - inicio;
      if (status < 200 || status >= 300) {
        return {
          ok: false,
          latenciaMs,
          amostraPreco: null,
          amostraReferencia: null,
          mensagem: `A página respondeu com status HTTP ${status}.`,
          dadosBrutos: { amostraTexto },
        };
      }
      if (valores.length === 0) {
        return {
          ok: false,
          latenciaMs,
          amostraPreco: null,
          amostraReferencia: null,
          mensagem:
            'Página carregada, mas a expressão regular não capturou nenhum valor. Revise o regexValor.',
          dadosBrutos: { amostraTexto },
        };
      }
      return {
        ok: true,
        latenciaMs,
        amostraPreco: Math.round(mediana(valores) * 10000) / 10000,
        amostraReferencia: `${config.nome} - ${new Date().toLocaleDateString('pt-BR')}`,
        mensagem: `Fonte válida: ${valores.length} valor(es) capturado(s) em ${latenciaMs}ms.`,
        dadosBrutos: { valores },
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
