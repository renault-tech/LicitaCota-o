import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { autenticar } from '../middleware/auth.js';
import { NaoEncontradoError } from '../utils/errors.js';
import { registrarAuditoria } from '../services/auditoria.service.js';

const router: Router = Router();

const schemaFornecedor = z.object({
  razaoSocial: z.string().min(2),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve conter 14 dígitos sem formatação'),
  contatoNome: z.string().optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  endereco: z.string().optional(),
});

// GET /api/fornecedores
router.get('/', autenticar, async (req, res, next) => {
  try {
    const { busca, pagina, limite } = z.object({
      busca: z.string().optional(),
      pagina: z.coerce.number().int().min(1).default(1),
      limite: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(req.query);

    const where = {
      ativo: true,
      ...(busca ? {
        OR: [
          { razaoSocial: { contains: busca, mode: 'insensitive' as const } },
          { cnpj: { contains: busca } },
        ],
      } : {}),
    };

    const [total, fornecedores] = await Promise.all([
      prisma.fornecedor.count({ where }),
      prisma.fornecedor.findMany({
        where,
        orderBy: { razaoSocial: 'asc' },
        skip: (pagina - 1) * limite,
        take: limite,
      }),
    ]);

    res.json({ total, pagina, limite, fornecedores });
  } catch (e) { next(e); }
});

// GET /api/fornecedores/:id
router.get('/:id', autenticar, async (req, res, next) => {
  try {
    const f = await prisma.fornecedor.findUnique({ where: { id: req.params.id } });
    if (!f) throw new NaoEncontradoError('Fornecedor não encontrado.');
    res.json(f);
  } catch (e) { next(e); }
});

// POST /api/fornecedores
router.post('/', autenticar, async (req, res, next) => {
  try {
    const data = schemaFornecedor.parse(req.body);
    const f = await prisma.fornecedor.create({ data });
    await registrarAuditoria({ userId: req.usuario.id, acao: 'FORNECEDOR_CRIADO', entidade: 'Fornecedor', entidadeId: f.id, ip: req.ip });
    res.status(201).json(f);
  } catch (e) { next(e); }
});

// PUT /api/fornecedores/:id
router.put('/:id', autenticar, async (req, res, next) => {
  try {
    const existente = await prisma.fornecedor.findUnique({ where: { id: req.params.id } });
    if (!existente) throw new NaoEncontradoError('Fornecedor não encontrado.');
    const data = schemaFornecedor.partial().parse(req.body);
    const f = await prisma.fornecedor.update({ where: { id: req.params.id }, data });
    res.json(f);
  } catch (e) { next(e); }
});

// DELETE /api/fornecedores/:id — desativa
router.delete('/:id', autenticar, async (req, res, next) => {
  try {
    const existente = await prisma.fornecedor.findUnique({ where: { id: req.params.id } });
    if (!existente) throw new NaoEncontradoError('Fornecedor não encontrado.');
    await prisma.fornecedor.update({ where: { id: req.params.id }, data: { ativo: false } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
