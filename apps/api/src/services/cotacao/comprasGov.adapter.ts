import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, PontoPreco, ResultadoConsultaFonte, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { resolverCandidatosCatalogo, type CodigoCatalogoResolvido } from '../catalogo/catalogoMatch.service.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Adapter do Compras.gov.br — "Módulo Pesquisa de Preço" do Portal de Dados
 * Abertos, a fonte que a IN SEGES/ME 65/2021 cita em primeiro lugar
 * (art. 5º, I). Diferente do PNCP, este módulo busca por CÓDIGO de catálogo
 * (CATMAT/CATSER) — não aceita descrição livre (`descricao` não é um
 * parâmetro válido; confirmado contra a documentação pública, que só lista
 * `codigoItemCatalogo` como filtro de item).
 *
 * Por isso, antes de consultar preço, resolvemos a descrição do item para
 * uma lista de códigos candidatos via `resolverCandidatosCatalogo` — busca
 * 100% local contra o catálogo oficial sincronizado (ver
 * catalogoSync.service.ts), sem chamada externa nessa etapa. O catálogo tem
 * centenas de milhares de códigos, muitos quase idênticos (variações de
 * cor/material de um mesmo item); o Painel de Preços só tem histórico para
 * códigos já efetivamente comprados, então tentamos os candidatos em ordem
 * de score até um devolver preço real, em vez de parar no melhor match
 * textual isolado. Sem nenhum candidato com confiança suficiente, a fonte
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
  // 404 aqui não é "endpoint errado" (path e parâmetros batem com a
  // documentação oficial) — é como essa API sinaliza "nenhum preço
  // registrado para este código de catálogo". Um código sem histórico de
  // compra é normal (nem todo item do CATMAT já foi comprado recentemente),
  // não uma falha de conexão.
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Compras.gov.br respondeu HTTP ${resp.status}.`);
  return extrairResultados(resp.corpoJson);
}

function precoDe(r: ResultadoBruto): number | undefined {
  return r.precoUnitario ?? r.valorUnitario;
}

function descricaoDe(r: ResultadoBruto): string {
  return r.descricaoItem ?? r.descricao ?? '';
}

const MAX_CANDIDATOS_TENTADOS = 5;

/** Monta os PontoPreco a partir dos resultados brutos de um código específico. */
function montarPontos(resolvido: CodigoCatalogoResolvido, resultados: ResultadoBruto[], limite: number): PontoPreco[] {
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
  return [...pontosPorFonte.values()];
}

/**
 * Tenta os candidatos de código em ordem de score até um devolver preço de
 * verdade — o melhor match textual pode ser um código que nunca foi
 * comprado (sem histórico no Painel de Preços), enquanto um candidato
 * ligeiramente pior tem. Para no primeiro que retorna algo.
 */
async function buscarPrecos(item: ItemNormalizado, limite: number): Promise<{ pontos: PontoPreco[]; codigoResolvido: number | null }> {
  const candidatos = await resolverCandidatosCatalogo(item.descricaoNormalizada, 'MATERIAL');
  if (candidatos.length === 0) return { pontos: [], codigoResolvido: null };

  for (const candidato of candidatos.slice(0, MAX_CANDIDATOS_TENTADOS)) {
    const resultados = await buscarPorCodigo(candidato.codigo, item.uf, Math.max(limite * 10, 50));
    const pontos = montarPontos(candidato, resultados, limite);
    if (pontos.length > 0) return { pontos, codigoResolvido: candidato.codigo };
  }

  // Nenhum candidato teve preço registrado — reporta o melhor código
  // resolvido mesmo assim, para aparecer no log/diagnóstico.
  return { pontos: [], codigoResolvido: candidatos[0].codigo };
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
      const candidatos = await resolverCandidatosCatalogo(itemAmostra, 'MATERIAL');
      if (candidatos.length === 0) {
        return {
          ok: false,
          latenciaMs: Date.now() - inicio,
          amostraPreco: null,
          amostraReferencia: null,
          mensagem: `Não foi possível resolver "${itemAmostra}" para um código de catálogo. Confira se o catálogo oficial já foi sincronizado (ver Fontes).`,
          dadosBrutos: null,
        };
      }

      let resultados: ResultadoBruto[] = [];
      let usado = candidatos[0];
      let tentativas = 0;
      for (const candidato of candidatos.slice(0, MAX_CANDIDATOS_TENTADOS)) {
        tentativas++;
        resultados = await buscarPorCodigo(candidato.codigo, undefined, 10);
        usado = candidato;
        if (resultados.length > 0) break;
      }

      const latenciaMs = Date.now() - inicio;
      const amostra = resultados.find((r) => precoDe(r) && precoDe(r)! > 0);
      return {
        ok: true,
        latenciaMs,
        amostraPreco: amostra ? precoDe(amostra)! : null,
        amostraReferencia: amostra ? descricaoDe(amostra) : `código ${usado.codigo} — ${usado.descricaoCatalogo}`,
        mensagem: resultados.length > 0
          ? `Compras.gov.br acessível — ${resultados.length} resultado(s) para código ${usado.codigo} ("${usado.descricaoCatalogo}") em ${latenciaMs}ms (${tentativas} candidato(s) testado(s)).`
          : `Compras.gov.br acessível, mas nenhum dos ${tentativas} candidato(s) de código para "${itemAmostra}" tem preço registrado no Painel de Preços.`,
        dadosBrutos: { codigoItemCatalogo: usado.codigo, totalResultados: resultados.length, candidatosTentados: tentativas },
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
