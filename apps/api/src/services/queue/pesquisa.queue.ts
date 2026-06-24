import { Queue } from 'bullmq';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export interface PesquisaJobData {
  pesquisaId: string;
  autorId: string;
}

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
      lazyConnect: true,
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
  const job = await getPesquisaQueue().add(
    'processar',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { pesquisaId, autorId } as any,
    { attempts: 1, jobId: pesquisaId, timeout: 40 * 60 * 1000, removeOnComplete: 50, removeOnFail: 100 },
  );
  return job.id ?? '';
}
