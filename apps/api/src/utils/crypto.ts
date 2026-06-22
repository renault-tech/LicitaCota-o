import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Cifra/decifra credenciais de fontes (ex.: API keys) com AES-256-GCM.
 * A chave deriva de CREDENCIAL_ENC_KEY via SHA-256 (garante 32 bytes).
 */

const ALGO = 'aes-256-gcm';

function chave(): Buffer {
  return crypto.createHash('sha256').update(env.CREDENCIAL_ENC_KEY).digest();
}

export function cifrar(textoPlano: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, chave(), iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), cifrado.toString('base64')].join(':');
}

export function decifrar(textoCifrado: string): string {
  const [ivB64, tagB64, dadosB64] = textoCifrado.split(':');
  if (!ivB64 || !tagB64 || !dadosB64) {
    throw new Error('Credencial cifrada em formato inválido.');
  }
  const decipher = crypto.createDecipheriv(ALGO, chave(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decifrado = Buffer.concat([
    decipher.update(Buffer.from(dadosB64, 'base64')),
    decipher.final(),
  ]);
  return decifrado.toString('utf8');
}
