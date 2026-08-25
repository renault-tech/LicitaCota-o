import { Queue } from 'bullmq';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../utils/logger.js';
import { processarPesquisaDiretamente } from './worker.runner.js';

export interface PesquisaJobData {
  pesquisaId: string;
  autorId: string;
}

function parseRedisConnection(url: string) {
  try {
    const u = new URL(url);
    const isTls = u.protocol === 'rediss:';
    return {
      host: u.hostname || 'localhost',
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      username: u.username || undefined,
      db: Number(u.pathname.slice(1)) || 0,
      maxRetriesPerRequest: null as null,
      enableReadyCheck: false,
      lazyConnect: true,
      ...(isTls ? { tls: {} } : {}),
    };
  } catch {
    logger.warn('REDIS_URL inválida, usando localhost:6379');
    return { host: 'localhost', port: 6379, maxRetriesPerRequest: null as null, enableReadyCheck: false, lazyConnect: true };
  }
}

let _queue: Queue | undefined;

export function getPesquisaQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('pesquisa', { connection: parseRedisConnection(env.REDIS_URL) });
  }
  return _queue;
}

export async function buscarJobPorId(jobId: string) {
  return getPesquisaQueue().getJob(jobId);
}

export async function enfileirarPesquisa(pesquisaId: string, autorId: string): Promise<string> {
  try {
    // O jobId inclui um sufixo único (não é só pesquisaId): o BullMQ trata
    // add() com um jobId já usado como no-op — mesmo que o job anterior já
    // tenha concluído — então reaproveitar o pesquisaId puro faria
    // "reprocessar" silenciosamente não fazer nada na segunda vez (o job
    // "concluído" anterior permanece, um novo nunca é criado). A rota que
    // chama esta função já impede reprocessamento concorrente checando
    // status === 'PROCESSANDO' antes de enfileirar.
    const jobId = `${pesquisaId}:${Date.now()}`;
    const job = await getPesquisaQueue().add(
      'processar',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { pesquisaId, autorId } as any,
      { attempts: 1, jobId, removeOnComplete: 50, removeOnFail: 100 },
    );
    return job.id ?? '';
  } catch (err) {
    // Redis indisponível — processa diretamente em background (sem fila)
    logger.warn('Redis indisponível, processando pesquisa diretamente.', { pesquisaId, erro: String(err) });
    const jobId = `local-${pesquisaId}-${Date.now()}`;
    setImmediate(() => {
      processarPesquisaDiretamente(pesquisaId, autorId).catch(async (e: unknown) => {
        const mensagem = e instanceof Error ? e.message : String(e);
        logger.error('Erro no processamento direto', { pesquisaId, erro: mensagem });
        // Sem BullMQ não há handler de 'failed': marca o erro aqui, senão a
        // pesquisa fica presa em PROCESSANDO e o SSE nunca encerra.
        await prisma.pesquisa
          .update({ where: { id: pesquisaId }, data: { status: 'ERRO', erroProcessamento: mensagem } })
          .catch((err: unknown) => logger.error('Falha ao marcar pesquisa como ERRO', err));
      });
    });
    return jobId;
  }
}
