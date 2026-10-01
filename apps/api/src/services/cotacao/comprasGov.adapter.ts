import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, PontoPreco, ResultadoConsultaFonte, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { pontuarCorrespondencia } from '../../utils/matching.js';
import { melhorCandidatoBruto, type CodigoCatalogoResolvido } from '../catalogo/catalogoMatch.service.js';
import type { FonteAdapter } from './adapter.js';
import { textosParaCatalogo } from './normalizacao.service.js';
import { resolverItemNoCatalogo } from './resolucaoCatalogo.js';

/**
 * Adapter do Compras.gov.br — "Módulo Pesquisa de Preço" (Painel de Preços)
 * do Portal de Dados Abertos, fonte citada em primeiro lugar pela IN
 * SEGES/ME 65/2021 (art. 5º, I).
 *
 * Contrato da API confirmado ao vivo contra dadosabertos.compras.gov.br
 * (Swagger em /v3/api-docs + respostas reais, out/2026):
 * - Materiais: `1_consultarMaterial?tipo=codigoItemCatalogo|codigoPdm&codigo=N`.
 *   O parâmetro antigo `codigoItemCatalogo=N` hoje responde 404 — era o
 *   motivo de nenhuma pesquisa encontrar preço.
 * - Serviços: `3_consultarServico?codigoItemCatalogo=N`.
 * - Filtro por UF chama-se `estado` (não `uf`; `uf` é ignorado em silêncio).
 * - Resposta: `{ resultado: [...], totalRegistros, totalPaginas }`, mais
 *   recentes primeiro; cada linha traz precoUnitario, descricaoItem,
 *   nomeOrgao, estado, dataResultado/dataCompra, unidade de fornecimento.
 *
 * Estratégia (para ao atingir `limite` preços de fontes distintas):
 *  1. Códigos exatos do catálogo que correspondem ao item (até 3): primeiro
 *     no estado do item, depois nacional.
 *  2. Se ainda faltar preço e for material: a família do produto (PDM) do
 *     melhor candidato — cobre o caso comum de o código exato nunca ter sido
 *     comprado enquanto variantes quase idênticas foram. Cada linha da
 *     família só entra se a descrição dela também corresponder ao item.
 * Só entram compras dos últimos 12 meses (IN 65/2021, art. 5º, I).
 */

const BASE = 'https://dadosabertos.compras.gov.br/modulo-pesquisa-preco';
const MAX_CANDIDATOS = 3;
const JANELA_DIAS = 365;
/** Linhas de PDM são de itens parecidos, não idênticos — exige que a própria
 * descrição da linha corresponda ao item pesquisado. */
const LIMIAR_LINHA_PDM = 0.35;
const OPCOES_REQUISICAO = { timeoutMs: 12000, retries: 1 };

interface ResultadoBruto {
  idCompra?: string | number;
  codigoItemCatalogo?: number;
  descricaoItem?: string;
  precoUnitario?: number;
  siglaUnidadeFornecimento?: string | null;
  nomeUnidadeFornecimento?: string | null;
  siglaUnidadeMedida?: string | null;
  dataCompra?: string;
  dataResultado?: string;
  nomeOrgao?: string;
  nomeUasg?: string;
  estado?: string;
  municipio?: string;
  nomeFornecedor?: string;
}

type Rota = 'MATERIAL' | 'SERVICO';

async function consultarPrecos(
  rota: Rota,
  tipoCodigo: 'codigoItemCatalogo' | 'codigoPdm',
  codigo: string | number,
  estado: string | undefined,
  tamanhoPagina: number,
): Promise<ResultadoBruto[]> {
  const params = new URLSearchParams({ pagina: '1', tamanhoPagina: String(tamanhoPagina) });
  let caminho: string;
  if (rota === 'MATERIAL') {
    caminho = '1_consultarMaterial';
    params.set('tipo', tipoCodigo);
    params.set('codigo', String(codigo));
  } else {
    caminho = '3_consultarServico';
    params.set('codigoItemCatalogo', String(codigo));
  }
  if (estado) params.set('estado', estado);
  const resp = await requisitar(`${BASE}/${caminho}?${params.toString()}`, OPCOES_REQUISICAO);
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Compras.gov.br respondeu HTTP ${resp.status}.`);
  const corpo = resp.corpoJson as { resultado?: ResultadoBruto[] } | ResultadoBruto[] | null;
  if (Array.isArray(corpo)) return corpo;
  return corpo?.resultado ?? [];
}

function dataDe(r: ResultadoBruto): string {
  return (r.dataResultado ?? r.dataCompra ?? '').slice(0, 10);
}

function dentroDaJanela(r: ResultadoBruto): boolean {
  const data = dataDe(r);
  if (!data) return false;
  const limite = Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000;
  return new Date(data).getTime() >= limite;
}

function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

/** Acumula preços de fontes distintas entre várias consultas. */
class Coletor {
  private pontos = new Map<string, PontoPreco>();
  constructor(private readonly limite: number) {}

  get cheio(): boolean { return this.pontos.size >= this.limite; }
  get total(): number { return this.pontos.size; }
  lista(): PontoPreco[] { return [...this.pontos.values()]; }

  adicionar(rows: ResultadoBruto[], origem: string, filtro?: (r: ResultadoBruto) => number | null): number {
    let adicionados = 0;
    for (const r of rows) {
      if (this.cheio) break;
      const preco = Number(r.precoUnitario);
      if (!Number.isFinite(preco) || preco <= 0 || !dentroDaJanela(r)) continue;
      const scoreLinha = filtro ? filtro(r) : null;
      if (filtro && scoreLinha === null) continue;

      const data = dataDe(r);
      const orgao = r.nomeOrgao ?? r.nomeUasg ?? 'órgão não identificado';
      const chave = `${orgao}|${data}|${preco}`;
      if (this.pontos.has(chave)) continue;

      const unidade = r.siglaUnidadeFornecimento ?? r.nomeUnidadeFornecimento ?? r.siglaUnidadeMedida;
      const local = [r.municipio, r.estado].filter(Boolean).join('/');
      this.pontos.set(chave, {
        preco,
        referencia:
          `Painel de Preços/Compras.gov.br — ${orgao}${local ? ` (${local})` : ''}, compra de ${formatarData(data)}, ` +
          `CATMAT/CATSER ${r.codigoItemCatalogo ?? '?'}${unidade ? `, unidade ${unidade}` : ''}; ${origem}; ` +
          `consultado em ${new Date().toLocaleDateString('pt-BR')}`,
        fundamentacaoArtigo: '',
        dadosBrutos: {
          codigoItemCatalogo: r.codigoItemCatalogo,
          descricaoItem: r.descricaoItem,
          unidade,
          idCompra: r.idCompra,
          fornecedor: r.nomeFornecedor,
          estado: r.estado,
          dataCompra: data,
          origem,
          ...(scoreLinha !== null ? { scoreDescricao: scoreLinha } : {}),
        },
      });
      adicionados++;
    }
    return adicionados;
  }
}

interface Busca {
  pontos: PontoPreco[];
  rota: Rota;
  candidatos: CodigoCatalogoResolvido[];
  passos: string[];
}

async function buscarPrecos(item: ItemNormalizado, limite: number): Promise<Busca> {
  const { rota, candidatos, texto } = await resolverItemNoCatalogo(item);
  const passos: string[] = [];
  const coletor = new Coletor(limite);
  if (candidatos.length === 0) return { pontos: [], rota, candidatos, passos };

  const estados = item.uf ? [item.uf, undefined] : [undefined];

  for (const c of candidatos.slice(0, MAX_CANDIDATOS)) {
    for (const estado of estados) {
      if (coletor.cheio) break;
      const rows = await consultarPrecos(rota, 'codigoItemCatalogo', c.codigo, estado, 50);
      const n = coletor.adicionar(rows, `código exato${estado ? ` (${estado})` : ' (nacional)'}`);
      passos.push(`código ${c.codigo}${estado ? `/${estado}` : '/BR'}: ${rows.length} compras, ${n} aproveitadas`);
    }
    if (coletor.cheio) break;
  }

  const pdm = rota === 'MATERIAL' ? candidatos.find((c) => c.pdm)?.pdm : undefined;
  if (!coletor.cheio && pdm) {
    const filtro = (r: ResultadoBruto): number | null => {
      const s = pontuarCorrespondencia(texto, r.descricaoItem ?? '');
      return s >= LIMIAR_LINHA_PDM ? s : null;
    };
    for (const estado of estados) {
      if (coletor.cheio) break;
      const rows = await consultarPrecos('MATERIAL', 'codigoPdm', pdm, estado, 200);
      // Linhas mais parecidas com o item primeiro, depois as mais recentes.
      const ordenadas = rows
        .map((r) => ({ r, s: pontuarCorrespondencia(texto, r.descricaoItem ?? '') }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r);
      const n = coletor.adicionar(ordenadas, `família PDM ${pdm}${estado ? ` (${estado})` : ' (nacional)'}`, filtro);
      passos.push(`PDM ${pdm}${estado ? `/${estado}` : '/BR'}: ${rows.length} compras, ${n} aproveitadas`);
    }
  }

  return { pontos: coletor.lista(), rota, candidatos, passos };
}

export const comprasGovAdapter: FonteAdapter = {
  slug: 'compras-gov',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoConsultaFonte> {
    const limite = Math.max(config.limiteResultados > 0 ? config.limiteResultados : 3, 3);
    try {
      const { pontos, rota, candidatos, passos } = await buscarPrecos(item, limite);
      if (candidatos.length === 0) {
        const bruto = await melhorCandidatoBruto(textosParaCatalogo(item.nome, item.descricao)[0] ?? item.descricaoNormalizada, 'MATERIAL').catch(() => null);
        const detalhe = bruto
          ? ` Mais próximo: código ${bruto.codigo} (score ${bruto.score.toFixed(2)}: "${bruto.descricaoCatalogo.slice(0, 60)}").`
          : ' Catálogo local vazio ou sem nada parecido — confira a importação do CATMAT/CATSER em Fontes.';
        return { pontos: [], diagnostico: `Compras.gov.br: descrição não corresponde a nenhum item do catálogo oficial.${detalhe}` };
      }
      logger.info(`Compras.gov.br: ${pontos.length} preço(s) (${rota}) — ${passos.join('; ')}`);
      if (pontos.length === 0) {
        const lista = candidatos.slice(0, MAX_CANDIDATOS)
          .map((c) => `${c.codigo} "${c.descricaoCatalogo.slice(0, 50)}" (score ${c.score.toFixed(2)})`).join('; ');
        return {
          pontos: [],
          diagnostico: `Compras.gov.br (${rota === 'MATERIAL' ? 'CATMAT' : 'CATSER'}): candidatos [${lista}] sem compra nos últimos 12 meses — ${passos.join('; ')}.`,
        };
      }
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
      const item: ItemNormalizado = {
        nome: itemAmostra,
        descricao: itemAmostra,
        descricaoNormalizada: itemAmostra,
        cascata: [itemAmostra],
        quantidade: 1,
        unidadeMedida: 'UN',
      };
      const { pontos, candidatos, passos } = await buscarPrecos(item, 3);
      const latenciaMs = Date.now() - inicio;
      if (candidatos.length === 0) {
        // Testa a conectividade mesmo sem catálogo local (código que
        // sabidamente tem compras), para não desativar a fonte por um
        // problema que é da importação do catálogo, não da API.
        const linhas = await consultarPrecos('MATERIAL', 'codigoItemCatalogo', 443990, undefined, 5);
        return {
          ok: true, latenciaMs: Date.now() - inicio,
          amostraPreco: linhas[0]?.precoUnitario ?? null,
          amostraReferencia: linhas[0]?.descricaoItem ?? null,
          mensagem: `Compras.gov.br acessível (${linhas.length} compras de teste), mas "${itemAmostra}" não foi encontrado no catálogo local — importe o CATMAT/CATSER em Fontes.`,
          dadosBrutos: null,
        };
      }
      const amostra = pontos[0];
      return {
        ok: true,
        latenciaMs,
        amostraPreco: amostra?.preco ?? null,
        amostraReferencia: amostra?.referencia ?? `código ${candidatos[0].codigo} — ${candidatos[0].descricaoCatalogo}`,
        mensagem: pontos.length > 0
          ? `Compras.gov.br acessível — ${pontos.length} preço(s) para "${itemAmostra}" em ${latenciaMs}ms.`
          : `Compras.gov.br acessível, mas sem compras nos últimos 12 meses para "${itemAmostra}" (${passos.join('; ')}).`,
        dadosBrutos: { candidatos: candidatos.slice(0, MAX_CANDIDATOS).map((c) => c.codigo), passos },
      };
    } catch (e) {
      return {
        ok: false, latenciaMs: Date.now() - inicio, amostraPreco: null, amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha: ${e.message}` : 'Falha de conexão.',
        dadosBrutos: null,
      };
    }
  },
};
