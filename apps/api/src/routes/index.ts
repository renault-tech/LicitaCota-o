import type { Express } from 'express';
import authRouter from './auth.js';
import pesquisasRouter from './pesquisas.js';
import fontesRouter from './fontes.js';
import usuariosRouter from './usuarios.js';
import configRouter from './config.js';
import notificacoesRouter from './notificacoes.js';
import fornecedoresRouter from './fornecedores.js';
import auditoriaRouter from './auditoria.js';
import debugRouter from './debug.js';

export function registrarRotas(app: Express): void {
  app.use('/api/auth', authRouter);
  app.use('/api/pesquisas', pesquisasRouter);
  app.use('/api/fontes', fontesRouter);
  app.use('/api/usuarios', usuariosRouter);
  app.use('/api/config', configRouter);
  app.use('/api/notificacoes', notificacoesRouter);
  app.use('/api/fornecedores', fornecedoresRouter);
  app.use('/api/auditoria', auditoriaRouter);
  app.use('/api/debug', debugRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });
}
