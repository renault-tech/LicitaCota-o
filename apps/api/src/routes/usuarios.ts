import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { autenticar, exigirRole } from '../middleware/auth.js';
import { NaoEncontradoError, ConflitoError } from '../utils/errors.js';
import { registrarAuditoria } from '../services/auditoria.service.js';
import { enviarEmail } from '../services/email.service.js';

const router: Router = Router();

const selectUsuario = {
  id: true, email: true, nome: true, cargo: true, setor: true,
  municipio: true, uf: true, role: true, ativo: true,
  prefNotifEmail: true, prefNotifInApp: true, createdAt: true,
} as const;

// GET /api/usuarios — somente ADMIN
router.get('/', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const { pagina, limite, ativo } = z.object({
      pagina: z.coerce.number().int().min(1).default(1),
      limite: z.coerce.number().int().min(1).max(100).default(20),
      ativo: z.coerce.boolean().optional(),
    }).parse(req.query);

    const where = { ...(ativo !== undefined ? { ativo } : {}) };
    const [total, usuarios] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: selectUsuario,
        orderBy: { nome: 'asc' },
        skip: (pagina - 1) * limite,
        take: limite,
      }),
    ]);
    res.json({ total, pagina, limite, usuarios });
  } catch (e) { next(e); }
});

// GET /api/usuarios/:id — somente ADMIN
router.get('/:id', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: selectUsuario });
    if (!user) throw new NaoEncontradoError('Usuário não encontrado.');
    res.json(user);
  } catch (e) { next(e); }
});

// POST /api/usuarios — convidar novo usuário (ADMIN)
router.post('/', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const { email, nome, role, cargo, setor, municipio, uf } = z.object({
      email: z.string().email(),
      nome: z.string().min(2),
      role: z.enum(['ADMIN', 'OPERADOR', 'VISUALIZADOR']).default('OPERADOR'),
      cargo: z.string().optional(),
      setor: z.string().optional(),
      municipio: z.string().optional(),
      uf: z.string().length(2).optional(),
    }).parse(req.body);

    const existente = await prisma.user.findUnique({ where: { email } });
    if (existente) throw new ConflitoError('Já existe um usuário com esse e-mail.');

    const conviteToken = randomUUID();
    const conviteExpiraEm = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: { email, nome, role, cargo, setor, municipio, uf, conviteToken, conviteExpiraEm },
      select: selectUsuario,
    });

    const link = `${env.FRONTEND_URL}/definir-senha?token=${conviteToken}`;
    await enviarEmail({
      para: email,
      assunto: 'Convite para o LicitaPreço',
      html: `<p>Olá, <strong>${nome}</strong>!</p>
             <p>Você foi convidado para acessar o <strong>LicitaPreço</strong>.</p>
             <p>Clique no link abaixo para definir sua senha (válido por 72h):</p>
             <p><a href="${link}">${link}</a></p>`,
    }).catch(() => undefined);

    await registrarAuditoria({
      userId: req.usuario.id,
      acao: 'USUARIO_CONVIDADO',
      entidade: 'User',
      entidadeId: user.id,
      detalhe: { email, role },
      ip: req.ip,
    });

    res.status(201).json(user);
  } catch (e) { next(e); }
});

// PUT /api/usuarios/:id — somente ADMIN
router.put('/:id', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const existente = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existente) throw new NaoEncontradoError('Usuário não encontrado.');

    const data = z.object({
      nome: z.string().min(2).optional(),
      cargo: z.string().optional(),
      setor: z.string().optional(),
      municipio: z.string().optional(),
      uf: z.string().length(2).optional(),
      role: z.enum(['ADMIN', 'OPERADOR', 'VISUALIZADOR']).optional(),
      ativo: z.boolean().optional(),
      prefNotifEmail: z.boolean().optional(),
      prefNotifInApp: z.boolean().optional(),
    }).parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: selectUsuario,
    });

    await registrarAuditoria({
      userId: req.usuario.id,
      acao: 'USUARIO_ATUALIZADO',
      entidade: 'User',
      entidadeId: user.id,
      detalhe: data,
      ip: req.ip,
    });

    res.json(user);
  } catch (e) { next(e); }
});

// DELETE /api/usuarios/:id — desativa (não exclui)
router.delete('/:id', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    if (req.params.id === req.usuario.id) {
      throw new ConflitoError('Você não pode desativar sua própria conta.');
    }
    const existente = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existente) throw new NaoEncontradoError('Usuário não encontrado.');

    await prisma.user.update({
      where: { id: req.params.id },
      data: { ativo: false, refreshToken: null },
    });

    await registrarAuditoria({
      userId: req.usuario.id,
      acao: 'USUARIO_DESATIVADO',
      entidade: 'User',
      entidadeId: req.params.id,
      ip: req.ip,
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/usuarios/:id/reenviar-convite — ADMIN
router.post('/:id/reenviar-convite', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new NaoEncontradoError('Usuário não encontrado.');
    if (user.passwordHash) throw new ConflitoError('Este usuário já definiu sua senha.');

    const conviteToken = randomUUID();
    const conviteExpiraEm = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { conviteToken, conviteExpiraEm },
    });

    const link = `${env.FRONTEND_URL}/definir-senha?token=${conviteToken}`;
    await enviarEmail({
      para: user.email,
      assunto: 'Convite LicitaPreço — novo link',
      html: `<p>Olá, <strong>${user.nome}</strong>!</p>
             <p>Seu link de acesso foi renovado (válido por 72h):</p>
             <p><a href="${link}">${link}</a></p>`,
    }).catch(() => undefined);

    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
