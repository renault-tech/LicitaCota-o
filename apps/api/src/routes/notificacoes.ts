import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { autenticar } from '../middleware/auth.js';
import { NaoEncontradoError, ProibidoError } from '../utils/errors.js';

const router: Router = Router();

// GET /api/notificacoes — lista as do usuário autenticado
router.get('/', autenticar, async (req, res, next) => {
  try {
    const { somentaNaoLidas, limite } = z.object({
      somentaNaoLidas: z.coerce.boolean().default(false),
      limite: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(req.query);

    const notificacoes = await prisma.notificacao.findMany({
      where: {
        userId: req.usuario.id,
        ...(somentaNaoLidas ? { lida: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limite,
    });

    const totalNaoLidas = await prisma.notificacao.count({
      where: { userId: req.usuario.id, lida: false },
    });

    res.json({ notificacoes, totalNaoLidas });
  } catch (e) { next(e); }
});

// PUT /api/notificacoes/ler-todas
router.put('/ler-todas', autenticar, async (req, res, next) => {
  try {
    await prisma.notificacao.updateMany({
      where: { userId: req.usuario.id, lida: false },
      data: { lida: true },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /api/notificacoes/:id/ler
router.put('/:id/ler', autenticar, async (req, res, next) => {
  try {
    const notif = await prisma.notificacao.findUnique({ where: { id: req.params.id } });
    if (!notif) throw new NaoEncontradoError('Notificação não encontrada.');
    if (notif.userId !== req.usuario.id) throw new ProibidoError();
    await prisma.notificacao.update({ where: { id: req.params.id }, data: { lida: true } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/notificacoes/:id
router.delete('/:id', autenticar, async (req, res, next) => {
  try {
    const notif = await prisma.notificacao.findUnique({ where: { id: req.params.id } });
    if (!notif) throw new NaoEncontradoError('Notificação não encontrada.');
    if (notif.userId !== req.usuario.id) throw new ProibidoError();
    await prisma.notificacao.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
