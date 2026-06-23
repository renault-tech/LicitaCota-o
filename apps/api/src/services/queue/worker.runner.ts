import { Worker, type Job } from 'bullmq';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { cotarItem } from '../cotacao/cotacao.service.js';
import { carregarDicionario, montarItemNormalizado } from '../cotacao/normalizacao.service.js';
import { gerarPlanilha } from '../planilha/geracao.service.js';
import { salvarArquivo } from '../storage.service.js';
import { notificar } from '../notificacao.service.js';
import { registrarAuditoria } from '../auditoria.service.js';
import type { PesquisaJobData } from './pesquisa.queue.js';

interface ParametrosCalculo {
  metodoCalculo: 'MEDIA' | 'MEDIANA' | 'MENOR_PRECO';
  limiteOutlierPercentual: number;
  minFontesCompleta: number;
}

const CONCORRENCIA_ITENS = 3;

function parseRedisConnection(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      db: Number(u.pathname.slice(1)) || 0,
      maxRetriesPerRequest: null as null,
      enableReadyCheck: false,
    };
  } catch {
    logger.warn('REDIS_URL inválida, usando localhost:6379');
    return { host: 'localhost', port: 6379, maxRetriesPerRequest: null as null, enableReadyCheck: false };
  }
}

async function processarPesquisa(job: Job<PesquisaJobData>): Promise<void> {
  const { pesquisaId, autorId } = job.data;
  const inicio = Date.now();
  logger.info('Processando pesquisa', { pesquisaId, jobId: job.id });

  // Marca como PROCESSANDO.
  await prisma.pesquisa.update({
    where: { id: pesquisaId },
    data: { status: 'PROCESSANDO', erroProcessamento: null },
  });

  const pesquisa = await prisma.pesquisa.findUnique({
    where: { id: pesquisaId },
    include: { itens: { orderBy: { sequencia: 'asc' } } },
  });
  if (!pesquisa) throw new Error(`Pesquisa ${pesquisaId} não encontrada.`);
  const pesquisaAtual = pesquisa;

  const fontes = await prisma.fonteCotacao.findMany({
    where: { ativo: true, statusValidacao: 'VALIDA' },
    orderBy: { ordem: 'asc' },
  });
  if (fontes.length === 0) {
    logger.warn('Nenhuma fonte ativa e válida disponível', { pesquisaId });
  }

  const configSistema = await prisma.configuracaoSistema.findUnique({ where: { id: 'singleton' } });
  const parametros: ParametrosCalculo = {
    metodoCalculo: (configSistema?.metodoCalculo ?? 'MEDIA') as ParametrosCalculo['metodoCalculo'],
    limiteOutlierPercentual: configSistema?.limiteOutlierPercentual ?? 30,
    minFontesCompleta: configSistema?.minFontesCompleta ?? 2,
  };

  const dicionario = await carregarDicionario();
  const itens = pesquisa.itens;
  const totalItens = itens.length;

  let processados = 0;
  let itensComCotacao = 0;
  let itensSemCotacao = 0;
  let itensComErro = 0;
  let valorTotal = 0;

  // Processa itens em paralelo com janela de concorrência controlada.
  const semaphore: Array<Promise<void>> = [];

  async function processarItem(item: (typeof itens)[number]): Promise<void> {
    const itemNormalizado = montarItemNormalizado(
      {
        nome: item.nome,
        descricao: item.descricao,
        quantidade: Number(item.quantidade),
        unidadeMedida: item.unidadeMedida,
        cidade: item.cidade,
        uf: item.uf,
      },
      dicionario,
    );

    const resultado = await cotarItem(item.id, itemNormalizado, fontes, parametros, {
      municipio: pesquisaAtual.municipio ?? item.cidade,
      uf: pesquisaAtual.uf ?? item.uf,
      pesquisaId,
      autorId,
    });

    processados++;
    if (resultado.statusItem === 'COTADO') {
      itensComCotacao++;
      valorTotal += resultado.precoTotal ?? 0;
    } else if (resultado.statusItem === 'SEM_RESULTADO') {
      itensSemCotacao++;
    } else {
      itensComErro++;
    }

    const progresso = {
      pesquisaId,
      status: 'PROCESSANDO',
      totalItens,
      processados,
      itensComCotacao,
      itensSemCotacao,
      itensComErro,
      itemAtual: { sequencia: item.sequencia, nome: item.nome, statusItem: resultado.statusItem },
      tempoEstimadoSegundos:
        processados > 0
          ? Math.round(((Date.now() - inicio) / processados) * (totalItens - processados) / 1000)
          : undefined,
    };
    await job.updateProgress(progresso as unknown as Record<string, unknown>);
  }

  for (const item of itens) {
    if (semaphore.length >= CONCORRENCIA_ITENS) {
      await Promise.race(semaphore);
    }
    const p: Promise<void> = processarItem(item).then(
      () => { semaphore.splice(semaphore.indexOf(p), 1); },
      () => { semaphore.splice(semaphore.indexOf(p), 1); },
    );
    semaphore.push(p);
  }
  await Promise.all(semaphore);

  // Estatísticas finais.
  const cobertura = `${totalItens} itens | ${itensComCotacao} cotados | ${itensSemCotacao} sem resultado | ${itensComErro} com erro`;
  const concluidaEm = new Date();

  // Gera planilha de saída.
  let arquivoSaidaUrl: string | null = null;
  try {
    const buffer = await gerarPlanilha(pesquisaId);
    const tituloSlug = pesquisa.titulo.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
    const { url } = await salvarArquivo(buffer, `resultado_${tituloSlug}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    arquivoSaidaUrl = url;
  } catch (e) {
    logger.warn('Falha ao gerar/salvar planilha de saída', { pesquisaId, erro: e });
  }

  await prisma.pesquisa.update({
    where: { id: pesquisaId },
    data: {
      status: 'CONCLUIDA',
      totalItens,
      itensComCotacao,
      itensSemCotacao,
      itensComErro,
      resumoCobertura: cobertura,
      valorTotalEstimado: valorTotal > 0 ? valorTotal : null,
      arquivoSaidaUrl,
      concluidaEm,
    },
  });

  await notificar({
    userId: autorId,
    tipo: 'PESQUISA_CONCLUIDA',
    titulo: 'Pesquisa concluída',
    mensagem: `A pesquisa "${pesquisa.titulo}" foi processada. ${cobertura}.`,
    link: `/pesquisas/${pesquisaId}/resultado`,
    enviarEmail: true,
  });

  await registrarAuditoria({
    userId: autorId,
    acao: 'PESQUISA_CONCLUIDA',
    entidade: 'Pesquisa',
    entidadeId: pesquisaId,
    detalhe: { totalItens, itensComCotacao, itensSemCotacao, itensComErro, duracaoMs: Date.now() - inicio },
  });

  logger.info('Pesquisa concluída', { pesquisaId, itensComCotacao, itensSemCotacao, itensComErro, duracaoMs: Date.now() - inicio });
}

async function tratarErro(job: Job<PesquisaJobData>, err: Error): Promise<void> {
  const { pesquisaId, autorId } = job.data;
  const esgotouTentativas = job.attemptsMade >= (job.opts.attempts ?? 1);

  logger.error('Erro ao processar pesquisa', { pesquisaId, tentativa: job.attemptsMade, erro: err.message });

  if (esgotouTentativas) {
    await prisma.pesquisa
      .update({
        where: { id: pesquisaId },
        data: { status: 'ERRO', erroProcessamento: err.message },
      })
      .catch((e: unknown) => logger.error('Falha ao atualizar status de erro', e));

    await notificar({
      userId: autorId,
      tipo: 'SISTEMA',
      titulo: 'Falha no processamento da pesquisa',
      mensagem: `Não foi possível processar a pesquisa. Erro: ${err.message}`,
      link: `/pesquisas/${pesquisaId}`,
      enviarEmail: true,
    }).catch((e: unknown) => logger.error('Falha ao notificar erro', e));

    await registrarAuditoria({
      userId: autorId,
      acao: 'PESQUISA_ERRO',
      entidade: 'Pesquisa',
      entidadeId: pesquisaId,
      detalhe: { erro: err.message, tentativas: job.attemptsMade },
    }).catch(() => {});
  }
}

const worker = new Worker<PesquisaJobData>(
  'pesquisa',
  async (job) => {
    await processarPesquisa(job);
  },
  {
    connection: parseRedisConnection(env.REDIS_URL),
    concurrency: 2,
  },
);

worker.on('failed', async (job, err) => {
  if (job) await tratarErro(job, err).catch(() => {});
});

worker.on('error', (err) => {
  logger.error('Erro interno do worker BullMQ', err);
});

logger.info('Worker de pesquisas iniciado (concorrência: 2 jobs × 3 itens simultâneos).');

export default worker;
