import { Router } from 'express';
import { autenticar, exigirRole } from '../middleware/auth.js';
import {
  obterStatusSincronizacao,
  obterEstatisticasCatalogo,
  dispararSincronizacaoEmBackground,
} from '../services/catalogo/catalogoSync.service.js';

const router: Router = Router();

// GET /api/catalogo/status — estatísticas do catálogo oficial CATMAT/CATSER
// local e o andamento da sincronização (usado pela tela de Fontes).
router.get('/status', autenticar, async (_req, res, next) => {
  try {
    const [estatisticas, sincronizacao] = await Promise.all([
      obterEstatisticasCatalogo(),
      Promise.resolve(obterStatusSincronizacao()),
    ]);
    res.json({ ...estatisticas, sincronizacao });
  } catch (e) { next(e); }
});

// POST /api/catalogo/sincronizar — dispara a sincronização manualmente,
// somente ADMIN. Não faz nada se já houver uma em andamento.
router.post('/sincronizar', autenticar, exigirRole('ADMIN'), (_req, res) => {
  const disparou = dispararSincronizacaoEmBackground();
  res.json({ ok: true, disparou });
});

export default router;
