import 'dotenv/config';
import express, { type Express } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { registrarRotas } from './routes/index.js';
import { AppError } from './utils/errors.js';

const app: Express = express();

// O Render fica atrás de um proxy reverso: sem isso o express-rate-limit
// não confia no cabeçalho X-Forwarded-For e não consegue identificar o IP
// real de quem faz a requisição (usaria o IP do proxy para todo mundo).
app.set('trust proxy', 1);

// Express calcula ETag por padrão para toda resposta. Numa API JSON
// autenticada isso é errado: o navegador revalida com If-None-Match e o
// servidor responde 304 (sem corpo) quando o conteúdo não mudou — mas
// fetch() nunca trata 304 como "ok" (só 200-299), então qualquer chamada
// que caia nesse caminho é tratada como erro no cliente mesmo tendo dado
// certo. É o que fazia as fontes "sumirem" logo após uma renovação de
// token: a nova requisição batia num ETag antigo e voltava 304.
app.set('etag', false);

const origensPermitidas = [
  env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean);

// Previews da Vercel só são liberadas fora de produção: em produção
// `*.vercel.app` liberaria qualquer site hospedado na Vercel.
const permitirPreviewsVercel = env.NODE_ENV !== 'production';

app.use(cors({
  origin: (origin, cb) => {
    // Permite requisições sem origin (Postman, mobile, SSR server-side)
    if (!origin) return cb(null, true);
    if (origensPermitidas.includes(origin)) return cb(null, true);
    if (permitirPreviewsVercel && origin.endsWith('.vercel.app')) return cb(null, true);
    // cb(null, false) — em vez de cb(new Error(...)) — porque um erro aqui
    // cai no error handler global, que responde sem cabeçalhos CORS: o
    // navegador então mostra um bloqueio CORS genérico em vez do 403 real,
    // escondendo a causa. Registra a origem rejeitada para diagnóstico.
    logger.warn(`CORS: origem não permitida — ${origin}`);
    cb(null, false);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.use(rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Tente novamente em breve.', codigo: 'RATE_LIMIT' },
}));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Limite estrito nas rotas de credencial — o limite global de 300/min é
// permissivo demais para tentativa de senha e disparo de e-mail de reset.
app.use(['/api/auth/login', '/api/auth/cadastro', '/api/auth/esqueci-senha', '/api/auth/redefinir-senha', '/api/auth/definir-senha'], rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', codigo: 'RATE_LIMIT' },
}));

// /api/cotar é pública (sem login) para o fornecedor responder pelo link do
// e-mail — precisa de limite próprio e mais apertado que o global.
app.use('/api/cotar', rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', codigo: 'RATE_LIMIT' },
}));

registrarRotas(app);

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ erro: 'Rota não encontrada.', codigo: 'NAO_ENCONTRADO' });
});

// Handler de erros global
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      erro: err.message,
      codigo: err.codigo,
      ...(err.detalhes !== undefined ? { detalhes: err.detalhes } : {}),
    });
    return;
  }
  logger.error('Erro não tratado', err);
  res.status(500).json({ erro: 'Erro interno do servidor.', codigo: 'ERRO_INTERNO' });
});

app.listen(env.PORT, () => {
  logger.info(`LicitaPreço API na porta ${env.PORT} [${env.NODE_ENV}]`);
});

export { app };
