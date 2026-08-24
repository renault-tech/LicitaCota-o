import { Router, type Request, type Response } from 'express';
import { prisma } from '../config/prisma.js';
import { autenticar, exigirRole } from '../middleware/auth.js';
import { requisitar } from '../utils/http.js';
import { pncpCacheStatus } from '../services/cotacao/pncp.adapter.js';
import { pncpAtasCacheStatus } from '../services/cotacao/pncpAtas.adapter.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /api/debug/status — restrito a ADMIN.
 * Diagnóstico: fontes ativas, conectividade PNCP e status dos caches em memória.
 */
router.get('/status', autenticar, exigirRole('ADMIN'), async (_req: Request, res: Response) => {
  const erros: string[] = [];

  // 1. FonteCotacao no banco
  let fontes: Array<{ slug: string; ativo: boolean; statusValidacao: string }> = [];
  try {
    fontes = await prisma.fonteCotacao.findMany({
      select: { slug: true, ativo: true, statusValidacao: true },
      orderBy: { ordem: 'asc' },
    });
  } catch (e) {
    erros.push(`DB FonteCotacao: ${String(e)}`);
  }

  const fontesAtivas = fontes.filter((f) => f.ativo && f.statusValidacao === 'VALIDA');

  // 2. Teste direto PNCP contratações (tamanhoPagina=10 é o mínimo válido)
  let pncpContratacoes: unknown = null;
  let pncpContratStatus = 0;
  try {
    const hoje = new Date();
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=${fmt(ini)}&dataFinal=${fmt(hoje)}&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=10`;
    const resp = await requisitar(url, { timeoutMs: 15000, retries: 0 });
    pncpContratStatus = resp.status;
    const body = resp.corpoJson as { data?: unknown[]; totalRegistros?: number } | null;
    pncpContratacoes = { total: body?.totalRegistros, pagina: body?.data?.length };
  } catch (e) {
    erros.push(`PNCP contratações: ${String(e)}`);
  }

  // 3. Teste direto PNCP atas
  let pncpAtasResp: unknown = null;
  let pncpAtasStatus = 0;
  try {
    const hoje = new Date();
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://pncp.gov.br/api/consulta/v1/atas?dataInicial=${fmt(ini)}&dataFinal=${fmt(hoje)}&pagina=1&tamanhoPagina=10`;
    const resp = await requisitar(url, { timeoutMs: 15000, retries: 0 });
    pncpAtasStatus = resp.status;
    const body = resp.corpoJson as { data?: unknown[]; totalRegistros?: number } | null;
    pncpAtasResp = { total: body?.totalRegistros, pagina: body?.data?.length };
  } catch (e) {
    erros.push(`PNCP atas: ${String(e)}`);
  }

  // 4. Cache status (ambos os módulos)
  const cacheContratacoes = pncpCacheStatus();
  const cacheAtas = pncpAtasCacheStatus();

  res.json({
    timestamp: new Date().toISOString(),
    banco: {
      totalFontes: fontes.length,
      fontesAtivas: fontesAtivas.length,
      fontes,
    },
    pncp: {
      contratacoes: { httpStatus: pncpContratStatus, dados: pncpContratacoes },
      atas: { httpStatus: pncpAtasStatus, dados: pncpAtasResp },
    },
    cache: {
      contratacoes: cacheContratacoes,
      atas: cacheAtas,
    },
    erros,
  });
});

/**
 * POST /api/debug/reset-fontes — restrito a ADMIN.
 * Força ambas as fontes PNCP para ativo=true, statusValidacao=VALIDA.
 * Usar quando o auto-teste desativou uma fonte por falha transiente.
 */
router.post('/reset-fontes', autenticar, exigirRole('ADMIN'), async (_req: Request, res: Response) => {
  try {
    const result = await prisma.fonteCotacao.updateMany({
      where: { slug: { in: ['pncp', 'pncp-atas'] } },
      data: { ativo: true, statusValidacao: 'VALIDA' },
    });
    res.json({ ok: true, atualizadas: result.count });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e) });
  }
});

export default router;
