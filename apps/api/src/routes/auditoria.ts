import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { autenticar, exigirRole } from '../middleware/auth.js';

const router: Router = Router();

// GET /api/auditoria — somente ADMIN, paginado
router.get('/', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const { pagina, limite, acao, entidade, userId } = z.object({
      pagina: z.coerce.number().int().min(1).default(1),
      limite: z.coerce.number().int().min(1).max(100).default(50),
      acao: z.string().optional(),
      entidade: z.string().optional(),
      userId: z.string().optional(),
    }).parse(req.query);

    const where = {
      ...(acao ? { acao: { contains: acao, mode: 'insensitive' as const } } : {}),
      ...(entidade ? { entidade } : {}),
      ...(userId ? { userId } : {}),
    };

    const [total, logs] = await Promise.all([
      prisma.logAuditoria.count({ where }),
      prisma.logAuditoria.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pagina - 1) * limite,
        take: limite,
        include: { user: { select: { id: true, nome: true, email: true } } },
      }),
    ]);

    res.json({ total, pagina, limite, logs });
  } catch (e) { next(e); }
});

export default router;
