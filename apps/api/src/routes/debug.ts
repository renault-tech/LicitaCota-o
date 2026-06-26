import { Router, type Request, type Response } from 'express';
import { prisma } from '../config/prisma.js';
import { requisitar } from '../utils/http.js';
import { pncpCacheStatus } from '../services/cotacao/pncp.adapter.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /api/debug/status
 * Endpoint temporário de diagnóstico — mostra o estado real do sistema:
 * fontes no banco, conectividade PNCP e status dos caches.
 */
router.get('/status', async (_req: Request, res: Response) => {
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

  // 2. Teste direto PNCP contratações
  let pncpContratacoes: unknown = null;
  let pncpContratStatus = 0;
  try {
    const hoje = new Date();
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=${fmt(ini)}&dataFinal=${fmt(hoje)}&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=3`;
    const resp = await requisitar(url, { timeoutMs: 15000, retries: 0 });
    pncpContratStatus = resp.status;
    pncpContratacoes = resp.corpoJson;
  } catch (e) {
    erros.push(`PNCP contratações: ${String(e)}`);
  }

  // 3. Teste direto PNCP atas
  let pncpAtas: unknown = null;
  let pncpAtasStatus = 0;
  try {
    const hoje = new Date();
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://pncp.gov.br/api/consulta/v1/atas?dataInicial=${fmt(ini)}&dataFinal=${fmt(hoje)}&pagina=1&tamanhoPagina=3`;
    const resp = await requisitar(url, { timeoutMs: 15000, retries: 0 });
    pncpAtasStatus = resp.status;
    pncpAtas = resp.corpoJson;
  } catch (e) {
    erros.push(`PNCP atas: ${String(e)}`);
  }

  // 4. Cache status
  const cacheContratacoes = pncpCacheStatus();

  res.json({
    timestamp: new Date().toISOString(),
    banco: {
      totalFontes: fontes.length,
      fontesAtivas: fontesAtivas.length,
      fontes,
    },
    pncp: {
      contratacoes: { status: pncpContratStatus, dados: pncpContratacoes },
      atas: { status: pncpAtasStatus, dados: pncpAtas },
    },
    cache: {
      contratacoes: cacheContratacoes,
    },
    erros,
  });
});

export default router;
