import { prisma } from '../../config/prisma.js';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';

/**
 * Sincronização do catálogo oficial CATMAT/CATSER (SIASG/Compras.gov.br).
 *
 * Baixa o CSV público em lote (não item a item) e grava localmente — a
 * resolução de código por descrição roda inteiramente contra o banco local
 * depois disso, sem nenhuma chamada externa por cotação. O catálogo muda
 * pouco (o governo publica atualizações periódicas, não em tempo real), por
 * isso uma sincronização mensal é suficiente.
 *
 * IMPORTANTE — validar antes de confiar no resultado: os nomes de campo
 * exatos do JSON de resposta foram implementados com base na documentação
 * pública da API (Manual do Usuário — API do Compras.gov.br), mas não
 * puderam ser confirmados contra a resposta real neste ambiente de
 * desenvolvimento (sem acesso à internet). `sincronizarCatalogo` registra
 * quantos itens foram importados — se vier zero com HTTP 200, o formato
 * mudou; ajuste apenas `extrairLinha`/`extrairArray` abaixo.
 *
 * Histórico: a primeira versão baixava um CSV em lote de
 * compras.dados.gov.br (portal de dados abertos legado) — esse domínio
 * respondeu HTTP 404 em produção (path descontinuado). Trocado para as
 * mesmas rotas paginadas da API de consulta usadas pelos outros adapters
 * (dadosabertos.compras.gov.br), que já sabemos ser alcançáveis.
 */

const URL_MATERIAIS = 'https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial';
const URL_SERVICOS = 'https://dadosabertos.compras.gov.br/modulo-servico/6_consultarItemServico';
const TAMANHO_PAGINA_API = 500;
const MAX_PAGINAS = 3000; // teto de segurança: 3000×500 = 1,5 milhão de itens — CATMAT sozinho já passa de 200 mil

interface LinhaCatalogo {
  codigo: number;
  descricao: string;
  grupo: string | null;
  classe: string | null;
  pdm: string | null;
  ativo: boolean;
}

type ObjetoBruto = Record<string, unknown>;

function primeiroValor(obj: ObjetoBruto, chaves: string[]): unknown {
  for (const chave of chaves) {
    if (obj[chave] !== undefined && obj[chave] !== null) return obj[chave];
  }
  return undefined;
}

/** A API embrulha a lista de formas diferentes conforme o endpoint. */
function extrairArray(corpo: unknown): ObjetoBruto[] {
  if (Array.isArray(corpo)) return corpo as ObjetoBruto[];
  const obj = corpo as ObjetoBruto | null;
  if (!obj) return [];
  if (Array.isArray(obj.resultado)) return obj.resultado as ObjetoBruto[];
  if (Array.isArray(obj.content)) return obj.content as ObjetoBruto[];
  if (Array.isArray(obj._embedded)) return obj._embedded as ObjetoBruto[];
  if (Array.isArray(obj.data)) return obj.data as ObjetoBruto[];
  return [];
}

/** Best-effort: nem toda resposta paginada informa o total — se não vier, seguimos sem estimativa de ETA. */
function extrairTotalRegistros(corpo: unknown): number | null {
  const obj = corpo as ObjetoBruto | null;
  if (!obj || Array.isArray(obj)) return null;
  const total = primeiroValor(obj, ['totalRegistros', 'totalElements', 'total', 'totalItens']);
  const n = Number(total);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extrairLinha(obj: ObjetoBruto): LinhaCatalogo | null {
  const codigoRaw = primeiroValor(obj, ['codigoItem', 'codigo', 'id']);
  const codigo = Number.parseInt(String(codigoRaw ?? ''), 10);
  const descricao = String(primeiroValor(obj, ['descricaoItem', 'descricao', 'nomeItem', 'nome']) ?? '').trim();
  if (!Number.isFinite(codigo) || !descricao) return null;

  const statusTexto = String(primeiroValor(obj, ['situacao', 'status', 'situacaoItem']) ?? '').toLowerCase();
  const grupoRaw = primeiroValor(obj, ['codigoGrupo', 'grupo']);
  const classeRaw = primeiroValor(obj, ['codigoClasse', 'classe']);
  const pdmRaw = primeiroValor(obj, ['codigoPdm', 'pdm']);

  return {
    codigo,
    descricao,
    grupo: grupoRaw !== undefined ? String(grupoRaw) : null,
    classe: classeRaw !== undefined ? String(classeRaw) : null,
    pdm: pdmRaw !== undefined ? String(pdmRaw) : null,
    // "inativo".includes('ativ') também é true — não dá pra testar
    // presença de "ativ", tem que ser ausência de "inativ".
    ativo: statusTexto === '' || !statusTexto.includes('inativ'),
  };
}

async function gravarPagina(tipo: 'MATERIAL' | 'SERVICO', itens: LinhaCatalogo[]): Promise<void> {
  if (itens.length === 0) return;
  await prisma.$transaction(
    itens.map((item) =>
      prisma.catalogoOficialItem.upsert({
        where: { tipo_codigo: { tipo, codigo: item.codigo } },
        update: {
          descricao: item.descricao,
          grupo: item.grupo,
          classe: item.classe,
          pdm: item.pdm,
          ativo: item.ativo,
        },
        create: { tipo, ...item },
      }),
    ),
  );
}

const CONCORRENCIA_PAGINAS = 6;

async function buscarPagina(urlBase: string, pagina: number): Promise<{ brutos: ObjetoBruto[]; totalRegistros: number | null }> {
  const url = `${urlBase}?pagina=${pagina}&tamanhoPagina=${TAMANHO_PAGINA_API}`;
  const resp = await requisitar(url, { timeoutMs: 20000, retries: 1, pausaMs: 1000 });
  if (!resp.ok) throw new Error(`Catálogo oficial respondeu HTTP ${resp.status} (página ${pagina}).`);
  return { brutos: extrairArray(resp.corpoJson), totalRegistros: extrairTotalRegistros(resp.corpoJson) };
}

async function gravarEContar(tipo: 'MATERIAL' | 'SERVICO', brutos: ObjetoBruto[]): Promise<number> {
  const linhas = brutos.map(extrairLinha).filter((l): l is LinhaCatalogo => l !== null);
  await gravarPagina(tipo, linhas);
  return linhas.length;
}

/**
 * Pagina até a API devolver uma página vazia/menor que o pedido, ou até o
 * teto de segurança — grava cada página assim que chega (não acumula tudo
 * em memória para gravar no final), para que o progresso visível na tela de
 * Fontes avance em tempo real e uma interrupção no meio não perca o que já
 * foi baixado.
 *
 * Busca a página 1 sozinha primeiro (para descobrir o total, se a API
 * informar). Com o total em mãos, busca o resto em paralelo (algumas
 * páginas por vez) — é isso que reduz o tempo total de forma relevante,
 * já que o gargalo é esperar cada requisição de rede, não o processamento
 * local. Sem total conhecido, cai para busca sequencial (mais segura,
 * porque não dá pra saber de antemão quantas páginas existem).
 */
async function sincronizarUm(tipo: 'MATERIAL' | 'SERVICO', urlBase: string): Promise<number> {
  let processados = 0;

  const primeira = await buscarPagina(urlBase, 1);
  const totalEstimado = primeira.totalRegistros;
  if (primeira.brutos.length > 0) {
    const contagem = await gravarEContar(tipo, primeira.brutos);
    processados += contagem;
    atualizarProgresso({ tipo, pagina: 1, processados, totalEstimado });
  }

  const paraQuePagina1JaBaste = primeira.brutos.length === 0 || primeira.brutos.length < TAMANHO_PAGINA_API;

  if (!paraQuePagina1JaBaste && totalEstimado) {
    // Total conhecido: dispara o resto das páginas em paralelo, respeitando ordem só para o contador de "página atual" exibido.
    const totalPaginas = Math.min(MAX_PAGINAS, Math.ceil(totalEstimado / TAMANHO_PAGINA_API));
    let proximaPagina = 2;
    let maiorPaginaConcluida = 1;

    async function worker(): Promise<void> {
      while (true) {
        const pagina = proximaPagina++;
        if (pagina > totalPaginas) return;
        const { brutos } = await buscarPagina(urlBase, pagina);
        if (brutos.length > 0) {
          // Nunca `processados += await ...` aqui: isso lê o valor de
          // processados ANTES do await suspender — com workers concorrentes,
          // o valor lido fica desatualizado e um worker sobrescreve o
          // incremento do outro ao retomar. Precisa ler processados só
          // depois que o await já terminou.
          const contagem = await gravarEContar(tipo, brutos);
          processados += contagem;
        }
        maiorPaginaConcluida = Math.max(maiorPaginaConcluida, pagina);
        atualizarProgresso({ tipo, pagina: maiorPaginaConcluida, processados, totalEstimado });
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCORRENCIA_PAGINAS, totalPaginas - 1) }, worker));
  } else if (!paraQuePagina1JaBaste) {
    // Total desconhecido: sequencial, para poder parar exatamente na primeira página vazia/parcial.
    for (let pagina = 2; pagina <= MAX_PAGINAS; pagina++) {
      const { brutos } = await buscarPagina(urlBase, pagina);
      if (brutos.length === 0) break;
      const contagem = await gravarEContar(tipo, brutos);
      processados += contagem;
      atualizarProgresso({ tipo, pagina, processados, totalEstimado: null });
      if (brutos.length < TAMANHO_PAGINA_API) break;
    }
  }

  if (processados === 0) {
    logger.warn(`Catálogo oficial (${tipo}): resposta recebida mas nenhum item reconhecido — confira o formato do JSON.`);
  }
  return processados;
}

async function garantirIndiceTrigram(): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS catalogo_oficial_item_descricao_trgm_idx ' +
    'ON "CatalogoOficialItem" USING gin (descricao gin_trgm_ops)',
  );
}

export interface ResultadoSincronizacao {
  materiais: number;
  servicos: number;
  erro: string | null;
}

/**
 * Status em memória da sincronização — instância única (Render), mesmo
 * padrão do progressStore usado pelo processamento de pesquisas. Não
 * persiste em banco: reinicia ao reiniciar o servidor, mas isso é aceitável
 * porque o dado relevante para o usuário ("quando terminou", "quantos itens
 * tem hoje") continua vindo direto da tabela via `obterEstatisticasCatalogo`.
 */
interface ProgressoSincronizacao {
  tipo: 'MATERIAL' | 'SERVICO';
  pagina: number;
  processados: number;
  totalEstimado: number | null;
  itensPorSegundo: number;
  segundosRestantesEstimados: number | null;
}

interface StatusSincronizacao {
  emAndamento: boolean;
  iniciadoEm: string | null;
  concluidoEm: string | null;
  ultimoResultado: ResultadoSincronizacao | null;
  progresso: ProgressoSincronizacao | null;
}

const statusAtual: StatusSincronizacao = {
  emAndamento: false,
  iniciadoEm: null,
  concluidoEm: null,
  ultimoResultado: null,
  progresso: null,
};

/** Marca o início de cada tipo para calcular itens/segundo e ETA. */
let inicioTipoAtualMs: number | null = null;

function atualizarProgresso(p: { tipo: 'MATERIAL' | 'SERVICO'; pagina: number; processados: number; totalEstimado: number | null }): void {
  if (p.pagina === 1) inicioTipoAtualMs = Date.now();
  const decorridoS = inicioTipoAtualMs ? (Date.now() - inicioTipoAtualMs) / 1000 : 0;
  const itensPorSegundo = decorridoS > 0 ? p.processados / decorridoS : 0;
  const segundosRestantesEstimados =
    p.totalEstimado && itensPorSegundo > 0
      ? Math.max(0, Math.round((p.totalEstimado - p.processados) / itensPorSegundo))
      : null;

  statusAtual.progresso = {
    tipo: p.tipo,
    pagina: p.pagina,
    processados: p.processados,
    totalEstimado: p.totalEstimado,
    itensPorSegundo: Math.round(itensPorSegundo * 10) / 10,
    segundosRestantesEstimados,
  };
}

export function obterStatusSincronizacao(): StatusSincronizacao {
  return { ...statusAtual };
}

/** Sincroniza CATMAT e CATSER. Falha em um não impede o outro. */
export async function sincronizarCatalogo(): Promise<ResultadoSincronizacao> {
  statusAtual.emAndamento = true;
  statusAtual.iniciadoEm = new Date().toISOString();

  await garantirIndiceTrigram();

  let materiais = 0;
  let servicos = 0;
  const erros: string[] = [];

  // CATSER primeiro: bem menor que o CATMAT, termina rápido. Se a instância
  // for reciclada no meio da sincronização (grátis do Render dorme com
  // inatividade — o job roda em segundo plano, sem requisição HTTP entrando,
  // então nada garante que o processo sobrevive até o fim), pelo menos os
  // serviços já estarão completos em vez de ficarem em zero.
  try {
    servicos = await sincronizarUm('SERVICO', URL_SERVICOS);
  } catch (e) {
    erros.push(e instanceof Error ? e.message : String(e));
    logger.error('Falha ao sincronizar CATSER', e);
  }

  try {
    materiais = await sincronizarUm('MATERIAL', URL_MATERIAIS);
  } catch (e) {
    erros.push(e instanceof Error ? e.message : String(e));
    logger.error('Falha ao sincronizar CATMAT', e);
  }

  logger.info(`Catálogo oficial sincronizado: ${materiais} materiais, ${servicos} serviços.`);
  const resultado = { materiais, servicos, erro: erros.length > 0 ? erros.join(' | ') : null };

  statusAtual.emAndamento = false;
  statusAtual.concluidoEm = new Date().toISOString();
  statusAtual.ultimoResultado = resultado;
  statusAtual.progresso = null;

  return resultado;
}

/** Dispara a sincronização em segundo plano — não faz nada se já houver uma em andamento. */
export function dispararSincronizacaoEmBackground(): boolean {
  if (statusAtual.emAndamento) return false;
  sincronizarCatalogo().catch((e) => logger.error('Falha na sincronização do catálogo oficial', e));
  return true;
}

export async function catalogoEstaVazio(): Promise<boolean> {
  const total = await prisma.catalogoOficialItem.count();
  return total === 0;
}

export interface EstatisticasCatalogo {
  materiais: number;
  servicos: number;
  ultimaAtualizacao: string | null;
}

export async function obterEstatisticasCatalogo(): Promise<EstatisticasCatalogo> {
  const [materiais, servicos, ultimo] = await Promise.all([
    prisma.catalogoOficialItem.count({ where: { tipo: 'MATERIAL' } }),
    prisma.catalogoOficialItem.count({ where: { tipo: 'SERVICO' } }),
    prisma.catalogoOficialItem.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ]);
  return { materiais, servicos, ultimaAtualizacao: ultimo?.updatedAt.toISOString() ?? null };
}
