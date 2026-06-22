import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Armazenamento de arquivos. Driver "local" grava em disco (uploads/) e serve
 * via rota estática; driver "supabase" envia ao Supabase Storage via REST.
 * A URL retornada é sempre relativa/absoluta utilizável pelo frontend.
 */

const DIR_LOCAL = path.resolve(process.cwd(), 'uploads');

async function garantirDir(): Promise<void> {
  await fs.mkdir(DIR_LOCAL, { recursive: true });
}

export interface ArquivoSalvo {
  url: string;
  chave: string;
}

export async function salvarArquivo(
  conteudo: Buffer,
  nomeOriginal: string,
  contentType = 'application/octet-stream',
): Promise<ArquivoSalvo> {
  const ext = path.extname(nomeOriginal) || '';
  const chave = `${Date.now()}-${randomUUID()}${ext}`;

  if (env.STORAGE_DRIVER === 'supabase' && env.STORAGE_URL && env.STORAGE_KEY) {
    const url = `${env.STORAGE_URL}/object/${env.STORAGE_BUCKET}/${chave}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STORAGE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: conteudo as unknown as Uint8Array,
    });
    if (!resp.ok) {
      throw new Error(`Falha ao enviar ao storage (${resp.status}).`);
    }
    return {
      url: `${env.STORAGE_URL}/object/public/${env.STORAGE_BUCKET}/${chave}`,
      chave,
    };
  }

  // Driver local (default).
  await garantirDir();
  await fs.writeFile(path.join(DIR_LOCAL, chave), conteudo);
  return { url: `/uploads/${chave}`, chave };
}

export async function lerArquivoLocal(chave: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(DIR_LOCAL, chave));
  } catch (e) {
    logger.warn(`Arquivo local não encontrado: ${chave}`, e);
    return null;
  }
}

export function caminhoLocal(chave: string): string {
  return path.join(DIR_LOCAL, chave);
}
