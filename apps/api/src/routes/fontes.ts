import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { autenticar, exigirRole } from '../middleware/auth.js';
import { NaoEncontradoError } from '../utils/errors.js';
import { registrarAuditoria } from '../services/auditoria.service.js';
import { testarFonte, ativarFonte } from '../services/cotacao/fonte.service.js';

const router: Router = Router();

const schemaFonte = z.object({
  nome: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  tipo: z.enum(['API_REST', 'SCRAPING', 'TABELA_REFERENCIA']),
  endpointBase: z.string().url().optional().or(z.literal('')),
  metodoHttp: z.enum(['GET', 'POST']).default('GET'),
  parametrosTemplate: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  mapeamentoCampos: z.record(z.string()).optional(),
  regexValor: z.string().optional(),
  fundamentacaoArtigo: z.string().optional(),
  limiteResultados: z.number().int().min(1).max(50).default(5),
  timeoutMs: z.number().int().min(1000).max(60000).default(15000),
  pausaMs: z.number().int().min(0).max(10000).default(1200),
  retries: z.number().int().min(0).max(5).default(2),
  ordem: z.number().int().min(0).default(0),
});

function jsonField(v: Record<string, string> | undefined): Prisma.InputJsonValue | undefined {
  return v !== undefined ? (v as Prisma.InputJsonValue) : undefined;
}

// GET /api/fontes
router.get('/', autenticar, async (_req, res, next) => {
  try {
    const fontes = await prisma.fonteCotacao.findMany({
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
    res.json(fontes);
  } catch (e) { next(e); }
});

// GET /api/fontes/:id
router.get('/:id', autenticar, async (req, res, next) => {
  try {
    const fonte = await prisma.fonteCotacao.findUnique({
      where: { id: req.params.id },
      include: { criadoPor: { select: { id: true, nome: true } }, tabelaReferencia: { take: 10 } },
    });
    if (!fonte) throw new NaoEncontradoError('Fonte não encontrada.');
    res.json(fonte);
  } catch (e) { next(e); }
});

// POST /api/fontes — somente ADMIN
router.post('/', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const data = schemaFonte.parse(req.body);
    const fonte = await prisma.fonteCotacao.create({
      data: {
        nome: data.nome,
        slug: data.slug,
        tipo: data.tipo,
        endpointBase: data.endpointBase || null,
        metodoHttp: data.metodoHttp,
        parametrosTemplate: jsonField(data.parametrosTemplate),
        headers: jsonField(data.headers),
        mapeamentoCampos: jsonField(data.mapeamentoCampos),
        regexValor: data.regexValor,
        fundamentacaoArtigo: data.fundamentacaoArtigo,
        limiteResultados: data.limiteResultados,
        timeoutMs: data.timeoutMs,
        pausaMs: data.pausaMs,
        retries: data.retries,
        ordem: data.ordem,
        criadoPorId: req.usuario.id,
      },
    });
    await registrarAuditoria({ userId: req.usuario.id, acao: 'FONTE_CRIADA', entidade: 'FonteCotacao', entidadeId: fonte.id, ip: req.ip });
    res.status(201).json(fonte);
  } catch (e) { next(e); }
});

// PUT /api/fontes/:id — somente ADMIN
router.put('/:id', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const existente = await prisma.fonteCotacao.findUnique({ where: { id: req.params.id } });
    if (!existente) throw new NaoEncontradoError('Fonte não encontrada.');

    const data = schemaFonte.partial().parse(req.body);
    const fonte = await prisma.fonteCotacao.update({
      where: { id: req.params.id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.tipo !== undefined && { tipo: data.tipo }),
        ...(data.endpointBase !== undefined && { endpointBase: data.endpointBase || null }),
        ...(data.metodoHttp !== undefined && { metodoHttp: data.metodoHttp }),
        ...(data.parametrosTemplate !== undefined && { parametrosTemplate: jsonField(data.parametrosTemplate) }),
        ...(data.headers !== undefined && { headers: jsonField(data.headers) }),
        ...(data.mapeamentoCampos !== undefined && { mapeamentoCampos: jsonField(data.mapeamentoCampos) }),
        ...(data.regexValor !== undefined && { regexValor: data.regexValor }),
        ...(data.fundamentacaoArtigo !== undefined && { fundamentacaoArtigo: data.fundamentacaoArtigo }),
        ...(data.limiteResultados !== undefined && { limiteResultados: data.limiteResultados }),
        ...(data.timeoutMs !== undefined && { timeoutMs: data.timeoutMs }),
        ...(data.pausaMs !== undefined && { pausaMs: data.pausaMs }),
        ...(data.retries !== undefined && { retries: data.retries }),
        ...(data.ordem !== undefined && { ordem: data.ordem }),
        statusValidacao: 'NAO_TESTADA',
      },
    });
    await registrarAuditoria({ userId: req.usuario.id, acao: 'FONTE_ATUALIZADA', entidade: 'FonteCotacao', entidadeId: fonte.id, ip: req.ip });
    res.json(fonte);
  } catch (e) { next(e); }
});

// DELETE /api/fontes/:id — somente ADMIN
router.delete('/:id', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const fonte = await prisma.fonteCotacao.findUnique({ where: { id: req.params.id } });
    if (!fonte) throw new NaoEncontradoError('Fonte não encontrada.');
    await prisma.fonteCotacao.delete({ where: { id: req.params.id } });
    await registrarAuditoria({ userId: req.usuario.id, acao: 'FONTE_EXCLUIDA', entidade: 'FonteCotacao', entidadeId: req.params.id, detalhe: { nome: fonte.nome }, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/fontes/:id/testar
router.post('/:id/testar', autenticar, async (req, res, next) => {
  try {
    const { fonte, resultado } = await testarFonte(req.params.id, req.usuario.id, req.ip);
    res.json({ fonte, resultado });
  } catch (e) { next(e); }
});

// PUT /api/fontes/:id/ativar
router.put('/:id/ativar', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const { ativo } = z.object({ ativo: z.boolean() }).parse(req.body);
    const fonte = await ativarFonte(req.params.id, ativo, req.usuario.id, req.ip);
    res.json(fonte);
  } catch (e) { next(e); }
});

export default router;
