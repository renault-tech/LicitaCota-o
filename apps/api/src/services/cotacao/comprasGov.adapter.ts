import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, PontoPreco, ResultadoConsultaFonte, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { melhorCorrespondencia } from '../../utils/matching.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Adapter do Compras.gov.br — "Módulo Pesquisa de Preço" do Portal de Dados
 * Abertos (base do Painel de Preços), a fonte que a IN SEGES/ME 65/2021 cita
 * em primeiro lugar (art. 5º, I). Diferente do PNCP, este módulo foi
 * desenhado especificamente para pesquisa de preço por descrição de item —
 * é uma busca textual de verdade, não uma varredura de contratos recentes.
 *
 * IMPORTANTE — validar antes de ativar em produção: o contrato exato deste
 * endpoint (parâmetros, formato de paginação, nome dos campos) foi
 * implementado com base na documentação pública do Portal de Dados Abertos
 * de Compras Governamentais, mas não pôde ser testado contra a API real
 * neste ambiente de desenvolvimento (sem acesso à internet). Antes de
 * ativar esta fonte:
 *   1. Confira o contrato atual no Swagger: dadosabertos.compras.gov.br
 *   2. Use "Testar fonte" na tela de Fontes — só ativa se o teste passar.
 * Se o formato tiver mudado, ajuste apenas `extrairResultados` abaixo; o
 * resto do adapter (busca, pontuação, multi-ponto) não depende do detalhe
 * exato do payload.
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

/** Isola a leitura do payload — único ponto a ajustar se o formato mudar. */
function extrairResultados(corpo: unknown): ResultadoBruto[] {
  if (Array.isArray(corpo)) return corpo as ResultadoBruto[];
  const obj = corpo as Record<string, unknown> | null;
  if (!obj) return [];
  if (Array.isArray(obj.resultado)) return obj.resultado as ResultadoBruto[];
  if (Array.isArray(obj.content)) return obj.content as ResultadoBruto[];
  if (Array.isArray(obj._embedded)) return obj._embedded as ResultadoBruto[];
  return [];
}

async function buscarMateriais(descricao: string, uf: string | undefined, tamanhoPagina: number): Promise<ResultadoBruto[]> {
  const params = new URLSearchParams({
    pagina: '1',
    tamanhoPagina: String(tamanhoPagina),
    descricao,
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

async function buscarPrecos(item: ItemNormalizado, limite: number): Promise<PontoPreco[]> {
  const pontosPorFonte = new Map<string, PontoPreco>();

  // Cascata: tenta a descrição mais completa primeiro, cai para termos mais
  // curtos se não encontrar nada — mesma lógica de item.cascata usada pelos
  // demais adapters, aqui aplicada diretamente como termo de busca textual.
  for (const termo of item.cascata) {
    if (pontosPorFonte.size >= limite) break;

    const resultados = await buscarMateriais(termo, item.uf, 50);
    const candidatos = resultados
      .map((r) => ({ r, desc: descricaoDe(r), preco: precoDe(r) }))
      .filter((c) => c.desc && c.preco && c.preco > 0);

    if (candidatos.length === 0) continue;

    // Vários resultados podem vir do mesmo pregão/registro — agrupa por
    // órgão+data para preservar "1 preço por fonte distinta" (art. 23).
    for (const c of candidatos) {
      if (pontosPorFonte.size >= limite) break;
      const score = melhorCorrespondencia(item.descricaoNormalizada, [c], (x) => x.desc);
      if (!score) continue;

      const data = (c.r.dataResultado ?? c.r.dataCompra ?? '').slice(0, 10);
      const orgao = c.r.nomeOrgao ?? 'órgão não identificado';
      const key = `${orgao}/${data}/${c.r.siglaUf ?? ''}`;
      if (pontosPorFonte.has(key)) continue;

      pontosPorFonte.set(key, {
        preco: c.preco!,
        referencia: `Compras.gov.br — ${orgao}${data ? ` (${data})` : ''}, consultado em ${new Date().toLocaleDateString('pt-BR')}`,
        fundamentacaoArtigo: '',
        dadosBrutos: { score: score.score, descricaoCandidata: c.desc },
      });
    }

    if (pontosPorFonte.size > 0) break; // achou na variação mais completa possível
  }

  return [...pontosPorFonte.values()];
}

export const comprasGovAdapter: FonteAdapter = {
  slug: 'compras-gov',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoConsultaFonte> {
    const limite = Math.max(config.limiteResultados > 0 ? config.limiteResultados : 3, 3);
    try {
      const pontos = await buscarPrecos(item, limite);
      logger.info(`Compras.gov.br: ${pontos.length} preço(s) de fontes distintas`);
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
      const resultados = await buscarMateriais(itemAmostra, undefined, 10);
      const latenciaMs = Date.now() - inicio;
      const amostra = resultados.find((r) => precoDe(r) && precoDe(r)! > 0);
      return {
        ok: true,
        latenciaMs,
        amostraPreco: amostra ? precoDe(amostra)! : null,
        amostraReferencia: amostra ? descricaoDe(amostra) : null,
        mensagem: resultados.length > 0
          ? `Compras.gov.br acessível — ${resultados.length} resultado(s) para "${itemAmostra}" em ${latenciaMs}ms.`
          : `Compras.gov.br respondeu, mas sem resultados para "${itemAmostra}". Confira se o formato do payload mudou (ver comentário no topo do arquivo).`,
        dadosBrutos: { totalResultados: resultados.length },
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
