import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { autenticar, exigirRole } from '../middleware/auth.js';
import { NaoEncontradoError, ProibidoError, ValidacaoError } from '../utils/errors.js';
import { registrarAuditoria } from '../services/auditoria.service.js';
import { lerPlanilha, lerListaColada } from '../services/planilha/leitura.service.js';
import { gerarPlanilha } from '../services/planilha/geracao.service.js';
import { salvarArquivo } from '../services/storage.service.js';
import { enfileirarPesquisa, buscarJobPorId } from '../services/queue/pesquisa.queue.js';

const router: Router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel') || file.originalname.endsWith('.xlsx');
    if (!ok) { cb(new ValidacaoError('Apenas arquivos .xlsx são aceitos.')); return; }
    cb(null, true);
  },
});

function checarAcesso(pesquisaUserId: string, usuarioId: string, role: string): void {
  if (role !== 'ADMIN' && pesquisaUserId !== usuarioId) throw new ProibidoError();
}

// GET /api/pesquisas
router.get('/', autenticar, async (req, res, next) => {
  try {
    const { pagina, limite, status } = z.object({
      pagina: z.coerce.number().int().min(1).default(1),
      limite: z.coerce.number().int().min(1).max(50).default(10),
      status: z.enum(['AGUARDANDO', 'PROCESSANDO', 'CONCLUIDA', 'ERRO']).optional(),
    }).parse(req.query);

    const where = {
      ...(req.usuario.role !== 'ADMIN' ? { userId: req.usuario.id } : {}),
      ...(status ? { status } : {}),
    };

    const [total, pesquisas] = await Promise.all([
      prisma.pesquisa.count({ where }),
      prisma.pesquisa.findMany({
        where,
        select: {
          id: true, titulo: true, status: true, totalItens: true,
          itensComCotacao: true, itensSemCotacao: true, itensComErro: true,
          resumoCobertura: true, valorTotalEstimado: true, createdAt: true, concluidaEm: true,
          user: { select: { id: true, nome: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pagina - 1) * limite,
        take: limite,
      }),
    ]);

    res.json({ total, pagina, limite, pesquisas });
  } catch (e) { next(e); }
});

// POST /api/pesquisas
router.post('/', autenticar, async (req, res, next) => {
  try {
    const data = z.object({
      titulo: z.string().min(3).max(200),
      descricao: z.string().max(500).optional(),
      municipio: z.string().optional(),
      uf: z.string().length(2).optional(),
    }).parse(req.body);

    const pesquisa = await prisma.pesquisa.create({
      data: { ...data, userId: req.usuario.id },
    });

    await registrarAuditoria({ userId: req.usuario.id, acao: 'PESQUISA_CRIADA', entidade: 'Pesquisa', entidadeId: pesquisa.id, ip: req.ip });
    res.status(201).json(pesquisa);
  } catch (e) { next(e); }
});

// GET /api/pesquisas/compartilhada/:link — acesso público
router.get('/compartilhada/:link', async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({
      where: { linkCompartilhamento: req.params.link },
      include: {
        itens: {
          orderBy: { sequencia: 'asc' },
          include: { cotacoes: true },
        },
      },
    });
    if (!pesquisa || !pesquisa.compartilhada) throw new NaoEncontradoError('Pesquisa não encontrada ou não compartilhada.');
    res.json(pesquisa);
  } catch (e) { next(e); }
});

// GET /api/pesquisas/:id
router.get('/:id', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, nome: true } },
        itens: {
          orderBy: { sequencia: 'asc' },
          include: { cotacoes: true, cotacoesDiretas: { include: { fornecedor: { select: { id: true, razaoSocial: true, cnpj: true } } } } },
        },
      },
    });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);
    res.json(pesquisa);
  } catch (e) { next(e); }
});

// PUT /api/pesquisas/:id
router.put('/:id', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);

    const data = z.object({
      titulo: z.string().min(3).max(200).optional(),
      descricao: z.string().max(500).optional(),
      municipio: z.string().optional(),
      uf: z.string().length(2).optional(),
      compartilhada: z.boolean().optional(),
      fundamentacaoLegal: z.string().optional(),
    }).parse(req.body);

    const atualizada = await prisma.pesquisa.update({ where: { id: req.params.id }, data });
    res.json(atualizada);
  } catch (e) { next(e); }
});

// DELETE /api/pesquisas/:id — somente ADMIN
router.delete('/:id', autenticar, exigirRole('ADMIN'), async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    await prisma.pesquisa.delete({ where: { id: req.params.id } });
    await registrarAuditoria({ userId: req.usuario.id, acao: 'PESQUISA_EXCLUIDA', entidade: 'Pesquisa', entidadeId: req.params.id, detalhe: { titulo: pesquisa.titulo }, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/pesquisas/:id/planilha — upload xlsx → preview (não salva itens ainda)
router.post('/:id/planilha', autenticar, upload.single('arquivo'), async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);
    if (!req.file) throw new ValidacaoError('Nenhum arquivo enviado.');

    const preview = await lerPlanilha(req.file.buffer);

    const { url } = await salvarArquivo(req.file.buffer, req.file.originalname, req.file.mimetype);
    await prisma.pesquisa.update({ where: { id: req.params.id }, data: { arquivoEntradaUrl: url } });

    res.json({ preview, arquivoUrl: url });
  } catch (e) { next(e); }
});

// POST /api/pesquisas/:id/texto — colar TSV → preview
router.post('/:id/texto', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);

    const { texto } = z.object({ texto: z.string().min(10) }).parse(req.body);
    const preview = lerListaColada(texto);
    res.json({ preview });
  } catch (e) { next(e); }
});

// POST /api/pesquisas/:id/confirmar — salva itens do preview no banco
router.post('/:id/confirmar', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);
    if (pesquisa.status === 'PROCESSANDO') throw new ValidacaoError('Pesquisa em andamento. Aguarde a conclusão.');

    const { itens } = z.object({
      itens: z.array(z.object({
        sequencia: z.number().int().min(1),
        nome: z.string().min(1),
        descricao: z.string(),
        quantidade: z.number().positive(),
        unidadeMedida: z.string().default(''),
        cidade: z.string().optional(),
        uf: z.string().optional(),
        camposExtras: z.record(z.union([z.string(), z.number(), z.null()])).default({}),
      })).min(1),
    }).parse(req.body);

    await prisma.$transaction([
      prisma.itemPesquisa.deleteMany({ where: { pesquisaId: req.params.id } }),
      prisma.itemPesquisa.createMany({
        data: itens.map((i) => ({
          pesquisaId: req.params.id,
          sequencia: i.sequencia,
          nome: i.nome,
          descricao: i.descricao,
          quantidade: i.quantidade,
          unidadeMedida: i.unidadeMedida || null,
          cidade: i.cidade || null,
          uf: i.uf || null,
          camposExtras: i.camposExtras,
          statusItem: 'PENDENTE',
        })),
      }),
      prisma.pesquisa.update({
        where: { id: req.params.id },
        data: { totalItens: itens.length, status: 'AGUARDANDO', erroProcessamento: null },
      }),
    ]);

    res.json({ ok: true, totalItens: itens.length });
  } catch (e) { next(e); }
});

// POST /api/pesquisas/:id/processar — enfileira o processamento
router.post('/:id/processar', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { itens: true } } },
    });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);
    if (pesquisa.status === 'PROCESSANDO') throw new ValidacaoError('Pesquisa já está sendo processada.');
    if (pesquisa._count.itens === 0) throw new ValidacaoError('A pesquisa não tem itens. Confirme a planilha primeiro.');

    const jobId = await enfileirarPesquisa(req.params.id, req.usuario.id);
    await prisma.pesquisa.update({
      where: { id: req.params.id },
      data: { status: 'PROCESSANDO', erroProcessamento: null, jobId },
    });
    await registrarAuditoria({ userId: req.usuario.id, acao: 'PESQUISA_ENFILEIRADA', entidade: 'Pesquisa', entidadeId: req.params.id, detalhe: { jobId }, ip: req.ip });

    res.json({ ok: true, jobId });
  } catch (e) { next(e); }
});

// GET /api/pesquisas/:id/progresso — SSE com progresso em tempo real do job BullMQ
router.get('/:id/progresso', autenticar, async (req, res) => {
  const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
  if (!pesquisa) { res.status(404).json({ erro: 'Pesquisa não encontrada.' }); return; }
  try { checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role); }
  catch { res.status(403).json({ erro: 'Acesso negado.' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const enviar = (dados: unknown) => res.write(`data: ${JSON.stringify(dados)}\n\n`);

  const verificar = async () => {
    const p = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!p) { res.end(); return; }

    let jp: Record<string, unknown> | null = null;
    if (p.jobId) {
      const job = await buscarJobPorId(p.jobId).catch(() => null);
      if (job?.progress && typeof job.progress === 'object') {
        jp = job.progress as Record<string, unknown>;
      }
    }

    enviar({
      pesquisaId: p.id,
      status: p.status,
      totalItens: p.totalItens,
      processados: jp?.processados ?? 0,
      itensComCotacao: jp?.itensComCotacao ?? p.itensComCotacao,
      itensSemCotacao: jp?.itensSemCotacao ?? p.itensSemCotacao,
      itensComErro: jp?.itensComErro ?? p.itensComErro,
      itemAtual: jp?.itemAtual ?? null,
      tempoEstimadoSegundos: jp?.tempoEstimadoSegundos ?? null,
      resumoCobertura: p.resumoCobertura,
    });

    if (p.status === 'CONCLUIDA' || p.status === 'ERRO') {
      clearInterval(intervalo);
      res.end();
    }
  };

  await verificar();
  const intervalo = setInterval(verificar, 2000);
  req.on('close', () => clearInterval(intervalo));
});

// GET /api/pesquisas/:id/resultado/planilha — download da planilha de saída
router.get('/:id/resultado/planilha', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);
    if (pesquisa.status !== 'CONCLUIDA') throw new ValidacaoError('A pesquisa ainda não foi concluída.');

    const buffer = await gerarPlanilha(req.params.id);
    const nomeArquivo = `cotacao-${pesquisa.titulo.replace(/[^a-z0-9]/gi, '-').slice(0, 40)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.send(buffer);
  } catch (e) { next(e); }
});

// PUT /api/pesquisas/:id/itens/:itemId — editar item manualmente
router.put('/:id/itens/:itemId', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);

    const item = await prisma.itemPesquisa.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.pesquisaId !== req.params.id) throw new NaoEncontradoError('Item não encontrado.');

    const data = z.object({
      observacao: z.string().optional(),
      precoManual: z.number().positive().optional(),
      referenciaManual: z.string().optional(),
    }).parse(req.body);

    if (data.precoManual !== undefined) {
      const cotacaoManual = await prisma.cotacao.findFirst({
        where: { itemPesquisaId: item.id, fonte: 'manual' },
      });
      if (cotacaoManual) {
        await prisma.cotacao.update({
          where: { id: cotacaoManual.id },
          data: { preco: data.precoManual, referencia: data.referenciaManual ?? 'Cotação manual', editadaManualmente: true },
        });
      } else {
        await prisma.cotacao.create({
          data: {
            itemPesquisaId: item.id,
            fonte: 'manual',
            preco: data.precoManual,
            referencia: data.referenciaManual ?? 'Cotação manual',
            editadaManualmente: true,
          },
        });
      }
    }

    const atualizado = await prisma.itemPesquisa.update({
      where: { id: item.id },
      data: { observacao: data.observacao },
      include: { cotacoes: true },
    });

    res.json(atualizado);
  } catch (e) { next(e); }
});

// GET /api/pesquisas/:id/itens/:itemId/cotacoes-diretas
router.get('/:id/itens/:itemId/cotacoes-diretas', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);

    const cotacoes = await prisma.cotacaoDireta.findMany({
      where: { itemPesquisaId: req.params.itemId },
      include: { fornecedor: true },
      orderBy: { dataSolicitacao: 'desc' },
    });
    res.json(cotacoes);
  } catch (e) { next(e); }
});

// POST /api/pesquisas/:id/itens/:itemId/cotacoes-diretas
router.post('/:id/itens/:itemId/cotacoes-diretas', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);

    const data = z.object({
      fornecedorId: z.string().uuid(),
      justificativa: z.string().min(5),
    }).parse(req.body);

    const item = await prisma.itemPesquisa.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.pesquisaId !== req.params.id) throw new NaoEncontradoError('Item não encontrado.');

    const cotacao = await prisma.cotacaoDireta.create({
      data: { itemPesquisaId: item.id, fornecedorId: data.fornecedorId, justificativa: data.justificativa },
      include: { fornecedor: true },
    });
    res.status(201).json(cotacao);
  } catch (e) { next(e); }
});

// PUT /api/pesquisas/:id/itens/:itemId/cotacoes-diretas/:cotacaoId
router.put('/:id/itens/:itemId/cotacoes-diretas/:cotacaoId', autenticar, async (req, res, next) => {
  try {
    const pesquisa = await prisma.pesquisa.findUnique({ where: { id: req.params.id } });
    if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');
    checarAcesso(pesquisa.userId, req.usuario.id, req.usuario.role);

    const data = z.object({
      preco: z.number().positive().optional(),
      status: z.enum(['RESPONDIDA', 'RECUSADA']).optional(),
      outlier: z.boolean().optional(),
    }).parse(req.body);

    const cotacao = await prisma.cotacaoDireta.update({
      where: { id: req.params.cotacaoId },
      data: { ...data, dataResposta: data.preco !== undefined || data.status === 'RECUSADA' ? new Date() : undefined },
      include: { fornecedor: true },
    });
    res.json(cotacao);
  } catch (e) { next(e); }
});

export default router;
