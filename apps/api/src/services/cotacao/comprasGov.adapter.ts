import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, PontoPreco, ResultadoConsultaFonte, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { resolverCodigoCatalogo } from '../catalogo/catalogoMatch.service.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Adapter do Compras.gov.br — "Módulo Pesquisa de Preço" do Portal de Dados
 * Abertos, a fonte que a IN SEGES/ME 65/2021 cita em primeiro lugar
 * (art. 5º, I). Diferente do PNCP, este módulo busca por CÓDIGO de catálogo
 * (CATMAT/CATSER) — não aceita descrição livre (`descricao` não é um
 * parâmetro válido; confirmado contra a documentação pública, que só lista
 * `codigoItemCatalogo` como filtro de item).
 *
 * Por isso, antes de consultar preço, resolvemos a descrição do item para um
 * código via `resolverCodigoCatalogo` — busca 100% local contra o catálogo
 * oficial sincronizado (ver catalogoSync.service.ts), sem chamada externa
 * nessa etapa. Sem um código resolvido com confiança suficiente, a fonte
 * não retorna preço para este item (evita citar preço de item errado).
 */

const BASE = 'https://dadosabertos.compras.gov.br/modulo-pesquisa-preco';

interface ResultadoBruto {
  descricaoItem?: string;
  descricao?: string;
  precoUnitario?: number;
  valorUnitario?: number;
  nomeUnidadeFornecimento?: string;
  dataCompra?: string;
  dataResultado?: string;
  nomeOrgao?: string;
  siglaUf?: string;
}

function extrairResultados(corpo: unknown): ResultadoBruto[] {
  if (Array.isArray(corpo)) return corpo as ResultadoBruto[];
  const obj = corpo as Record<string, unknown> | null;
  if (!obj) return [];
  if (Array.isArray(obj.resultado)) return obj.resultado as ResultadoBruto[];
  if (Array.isArray(obj.content)) return obj.content as ResultadoBruto[];
  if (Array.isArray(obj._embedded)) return obj._embedded as ResultadoBruto[];
  return [];
}

async function buscarPorCodigo(codigoItemCatalogo: number, uf: string | undefined, tamanhoPagina: number): Promise<ResultadoBruto[]> {
  const params = new URLSearchParams({
    pagina: '1',
    tamanhoPagina: String(tamanhoPagina),
    codigoItemCatalogo: String(codigoItemCatalogo),
  });
  if (uf) params.set('uf', uf);
  const url = `${BASE}/1_consultarMaterial?${params.toString()}`;
  const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
  if (!resp.ok) throw new Error(`Compras.gov.br respondeu HTTP ${resp.status}.`);
  return extrairResultados(resp.corpoJson);
}

function precoDe(r: ResultadoBruto): number | undefined {
  return r.precoUnitario ?? r.valorUnitario;
}

function descricaoDe(r: ResultadoBruto): string {
  return r.descricaoItem ?? r.descricao ?? '';
}

async function buscarPrecos(item: ItemNormalizado, limite: number): Promise<{ pontos: PontoPreco[]; codigoResolvido: number | null }> {
  const resolvido = await resolverCodigoCatalogo(item.descricaoNormalizada, 'MATERIAL');
  if (!resolvido) return { pontos: [], codigoResolvido: null };

  const resultados = await buscarPorCodigo(resolvido.codigo, item.uf, Math.max(limite * 10, 50));
  const pontosPorFonte = new Map<string, PontoPreco>();

  for (const r of resultados) {
    if (pontosPorFonte.size >= limite) break;
    const preco = precoDe(r);
    if (!preco || preco <= 0) continue;

    const data = (r.dataResultado ?? r.dataCompra ?? '').slice(0, 10);
    const orgao = r.nomeOrgao ?? 'órgão não identificado';
    const key = `${orgao}/${data}/${r.siglaUf ?? ''}`;
    if (pontosPorFonte.has(key)) continue;

    pontosPorFonte.set(key, {
      preco,
      referencia: `Compras.gov.br — ${orgao}${data ? ` (${data})` : ''}, código de catálogo ${resolvido.codigo}, consultado em ${new Date().toLocaleDateString('pt-BR')}`,
      fundamentacaoArtigo: '',
      dadosBrutos: { codigoItemCatalogo: resolvido.codigo, scoreResolucaoCodigo: resolvido.score, descricaoCandidata: descricaoDe(r) },
    });
  }

  return { pontos: [...pontosPorFonte.values()], codigoResolvido: resolvido.codigo };
}

export const comprasGovAdapter: FonteAdapter = {
  slug: 'compras-gov',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoConsultaFonte> {
    const limite = Math.max(config.limiteResultados > 0 ? config.limiteResultados : 3, 3);
    try {
      const { pontos, codigoResolvido } = await buscarPrecos(item, limite);
      if (codigoResolvido === null) {
        logger.info('Compras.gov.br: nenhum código de catálogo resolvido com confiança para o item — pulando fonte.');
        return { pontos: [] };
      }
      logger.info(`Compras.gov.br: ${pontos.length} preço(s) de fontes distintas (código ${codigoResolvido})`);
      const fundamentacaoArtigo = config.fundamentacaoArtigo ?? '';
      return { pontos: pontos.map((p) => ({ ...p, fundamentacaoArtigo })) };
    } catch (e) {
      logger.error('Compras.gov.br: fonte indisponível', e);
      return { pontos: [], erro: e instanceof Error ? e.message : 'Falha ao consultar o Compras.gov.br.' };
    }
  },

  async testar(_config: FonteCotacao, itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      const resolvido = await resolverCodigoCatalogo(itemAmostra, 'MATERIAL');
      if (!resolvido) {
        return {
          ok: false,
          latenciaMs: Date.now() - inicio,
          amostraPreco: null,
          amostraReferencia: null,
          mensagem: `Não foi possível resolver "${itemAmostra}" para um código de catálogo. Confira se o catálogo oficial já foi sincronizado (ver Configurações).`,
          dadosBrutos: null,
        };
      }
      const resultados = await buscarPorCodigo(resolvido.codigo, undefined, 10);
      const latenciaMs = Date.now() - inicio;
      const amostra = resultados.find((r) => precoDe(r) && precoDe(r)! > 0);
      return {
        ok: true,
        latenciaMs,
        amostraPreco: amostra ? precoDe(amostra)! : null,
        amostraReferencia: amostra ? descricaoDe(amostra) : `código ${resolvido.codigo} — ${resolvido.descricaoCatalogo}`,
        mensagem: resultados.length > 0
          ? `Compras.gov.br acessível — ${resultados.length} resultado(s) para código ${resolvido.codigo} ("${resolvido.descricaoCatalogo}") em ${latenciaMs}ms.`
          : `Compras.gov.br respondeu, mas sem preços para o código ${resolvido.codigo} ("${resolvido.descricaoCatalogo}").`,
        dadosBrutos: { codigoItemCatalogo: resolvido.codigo, totalResultados: resultados.length },
      };
    } catch (e) {
      return {
        ok: false,
        latenciaMs: Date.now() - inicio,
        amostraPreco: null,
        amostraReferencia: null,
        mensagem: e instanceof Error
          ? `Falha: ${e.message} — confira o endpoint atual em dadosabertos.compras.gov.br antes de tentar novamente.`
          : 'Falha de conexão.',
        dadosBrutos: null,
      };
    }
  },
};
