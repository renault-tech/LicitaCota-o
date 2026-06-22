import 'dotenv/config';

/**
 * Carrega e valida variáveis de ambiente.
 * Falha cedo (no boot) se algo essencial estiver ausente.
 */

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor || valor.trim() === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  }
  return valor;
}

function opcional(nome: string, padrao: string): string {
  const valor = process.env[nome];
  return valor && valor.trim() !== '' ? valor : padrao;
}

const isTest = process.env.NODE_ENV === 'test';

export const env = {
  NODE_ENV: opcional('NODE_ENV', 'development'),
  PORT: Number(opcional('PORT', '3001')),
  DATABASE_URL: isTest ? opcional('DATABASE_URL', '') : obrigatoria('DATABASE_URL'),
  REDIS_URL: opcional('REDIS_URL', 'redis://localhost:6379'),
  JWT_SECRET: isTest ? opcional('JWT_SECRET', 'test-secret') : obrigatoria('JWT_SECRET'),
  JWT_REFRESH_SECRET: isTest
    ? opcional('JWT_REFRESH_SECRET', 'test-refresh-secret')
    : obrigatoria('JWT_REFRESH_SECRET'),
  JWT_ACCESS_EXPIRES: opcional('JWT_ACCESS_EXPIRES', '15m'),
  JWT_REFRESH_EXPIRES: opcional('JWT_REFRESH_EXPIRES', '7d'),
  SMTP_HOST: opcional('SMTP_HOST', ''),
  SMTP_PORT: Number(opcional('SMTP_PORT', '587')),
  SMTP_USER: opcional('SMTP_USER', ''),
  SMTP_PASS: opcional('SMTP_PASS', ''),
  SMTP_FROM: opcional('SMTP_FROM', 'LicitaPreço <noreply@licitapreco.local>'),
  STORAGE_DRIVER: opcional('STORAGE_DRIVER', 'local'),
  STORAGE_BUCKET: opcional('STORAGE_BUCKET', 'licitapreco'),
  STORAGE_URL: opcional('STORAGE_URL', ''),
  STORAGE_KEY: opcional('STORAGE_KEY', ''),
  FRONTEND_URL: opcional('FRONTEND_URL', 'http://localhost:3000'),
  CREDENCIAL_ENC_KEY: opcional('CREDENCIAL_ENC_KEY', 'chave-padrao-dev-troque-em-prod-32b!!'),
} as const;

export const isProd = env.NODE_ENV === 'production';
