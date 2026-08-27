import { prisma } from '../../config/prisma.js';
import { logger } from '../../utils/logger.js';
import { importarCatalogoAutomatico, type ProgressoImportacao } from './catalogoImport.service.js';

/**
 * Sincronização do catálogo oficial CATMAT/CATSER (SIASG/Compras.gov.br).
 *
 * Baixa as planilhas oficiais publicadas pelo governo (CATMAT.xlsx ~11,6MB,
 * CATSER.xlsx ~166KB — um único arquivo cada, não centenas de chamadas
 * paginadas) e importa localmente — a resolução de código por descrição
 * roda inteiramente contra o banco local depois disso, sem nenhuma chamada
 * externa por cotação. O catálogo muda pouco (o governo publica
 * atualizações periódicas, não em tempo real), por isso uma sincronização
 * mensal é suficiente.
 *
 * Histórico: a primeira versão baixava um CSV em lote de
 * compras.dados.gov.br (portal de dados abertos legado, descontinuado —
 * HTTP 404 em produção). A segunda paginava a API de consulta
 * (dadosabertos.compras.gov.br) — funcionava, mas exigia centenas de
 * requisições sequenciais/paralelas, sujeitas a interrupção pela instância
 * grátis do Render reciclando o processo no meio. Trocado para baixar as
 * planilhas oficiais diretamente: um download rápido em vez de uma
 * varredura paginada longa. Ver catalogoImport.service.ts para o parser.
 */

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

let inicioTipoAtualMs: number | null = null;

function atualizarProgresso(tipo: 'MATERIAL' | 'SERVICO', p: ProgressoImportacao): void {
  if (inicioTipoAtualMs === null) inicioTipoAtualMs = Date.now();
  const decorridoS = (Date.now() - inicioTipoAtualMs) / 1000;
  const itensPorSegundo = decorridoS > 0 ? p.processados / decorridoS : 0;
  const segundosRestantesEstimados =
    itensPorSegundo > 0 ? Math.max(0, Math.round((p.totalEstimado - p.processados) / itensPorSegundo)) : null;
  statusAtual.progresso = {
    tipo,
    processados: p.processados,
    totalEstimado: p.totalEstimado,
    itensPorSegundo: Math.round(itensPorSegundo * 10) / 10,
    segundosRestantesEstimados,
  };
}

export function obterStatusSincronizacao(): StatusSincronizacao {
  return { ...statusAtual };
}

async function garantirIndiceTrigram(): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS catalogo_oficial_item_descricao_trgm_idx ' +
    'ON "CatalogoOficialItem" USING gin (descricao gin_trgm_ops)',
  );
}

/** Sincroniza CATMAT e CATSER. Falha em um não impede o outro. */
export async function sincronizarCatalogo(): Promise<ResultadoSincronizacao> {
  statusAtual.emAndamento = true;
  statusAtual.iniciadoEm = new Date().toISOString();

  await garantirIndiceTrigram();

  const erros: string[] = [];

  // CATSER primeiro: bem menor, termina rápido — se algo interromper a
  // execução no meio, pelo menos os serviços já estarão completos.
  try {
    inicioTipoAtualMs = null;
    await importarCatalogoAutomatico('SERVICO', (p) => atualizarProgresso('SERVICO', p));
  } catch (e) {
    erros.push(e instanceof Error ? e.message : String(e));
    logger.error('Falha ao sincronizar CATSER', e);
  }

  try {
    inicioTipoAtualMs = null;
    await importarCatalogoAutomatico('MATERIAL', (p) => atualizarProgresso('MATERIAL', p));
  } catch (e) {
    erros.push(e instanceof Error ? e.message : String(e));
    logger.error('Falha ao sincronizar CATMAT', e);
  }

  const estatisticas = await obterEstatisticasCatalogo();
  const { materiais, servicos } = estatisticas;

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
