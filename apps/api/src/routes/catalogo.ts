import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { autenticar, exigirRole } from '../middleware/auth.js';
import { ValidacaoError } from '../utils/errors.js';
import {
  obterStatusSincronizacao,
  obterEstatisticasCatalogo,
  dispararSincronizacaoEmBackground,
  dispararImportacaoAutomaticaEmBackground,
} from '../services/catalogo/catalogoSync.service.js';
import { importarWorkbook } from '../services/catalogo/catalogoImport.service.js';

const router: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // CATMAT.xlsx tem ~11,6MB
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel') || file.originalname.endsWith('.xlsx');
    if (!ok) { cb(new ValidacaoError('Apenas arquivos .xlsx são aceitos.')); return; }
    cb(null, true);
  },
});

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

// POST /api/catalogo/sincronizar — dispara a sincronização automática
// (baixa CATMAT.xlsx/CATSER.xlsx do governo) em segundo plano, somente
// ADMIN. Não faz nada se já houver uma em andamento.
router.post('/sincronizar', autenticar, exigirRole('ADMIN'), (_req, res) => {
  const disparou = dispararSincronizacaoEmBackground();
  res.json({ ok: true, disparou });
});

// POST /api/catalogo/importar — upload manual de CATMAT.xlsx/CATSER.xlsx,
// somente ADMIN. Alternativa à sincronização automática quando o download
// direto do governo falhar (histórico: já mudou de endpoint duas vezes) —
// o operador baixa o arquivo pelo navegador e sobe aqui.
router.post('/importar', autenticar, exigirRole('ADMIN'), upload.single('arquivo'), async (req, res, next) => {
  try {
    if (!req.file) throw new ValidacaoError('Envie o arquivo .xlsx no campo "arquivo".');
    const { tipo } = z.object({ tipo: z.enum(['MATERIAL', 'SERVICO']) }).parse(req.body);

    const processados = await importarWorkbook(tipo, req.file.buffer);
    res.json({ ok: true, tipo, processados });
  } catch (e) { next(e); }
});

// POST /api/catalogo/importar-automatico — dispara em segundo plano o
// download+importação do CSV oficial direto de repositorio.dados.gov.br,
// somente ADMIN. Diferente da página www.gov.br/compras/.../
// planilha-catmat-catser (exige login), este endpoint é público — não cai
// em tela de "Conteúdo Restrito". Roda em background (mesmo padrão de
// /sincronizar) porque o CATMAT tem ~340 mil linhas — síncrono numa única
// requisição HTTP estoura o timeout do proxy do Render antes de terminar.
router.post('/importar-automatico', autenticar, exigirRole('ADMIN'), (req, res, next) => {
  try {
    const { tipo } = z.object({ tipo: z.enum(['MATERIAL', 'SERVICO']) }).parse(req.body);
    const disparou = dispararImportacaoAutomaticaEmBackground(tipo);
    res.json({ ok: true, disparou });
  } catch (e) { next(e); }
});

export default router;
