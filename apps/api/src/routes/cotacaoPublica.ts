import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { NaoEncontradoError, ConflitoError, ValidacaoError } from '../utils/errors.js';
import { registrarAuditoria } from '../services/auditoria.service.js';
import { recalcularItem } from '../services/cotacao/recalculo.service.js';

/**
 * Rotas PÚBLICAS (sem autenticação) para o fornecedor responder a uma
 * cotação direta pelo link enviado por e-mail — o único jeito de fechar o
 * fallback automático sem o agente precisar ligar ou digitar a resposta a
 * mão. Acesso é controlado pelo token opaco da URL, não por sessão.
 */

const router: Router = Router();

async function buscarCotacaoPorToken(token: string) {
  const cd = await prisma.cotacaoDireta.findUnique({
    where: { respostaToken: token },
    include: {
      fornecedor: { select: { razaoSocial: true, nomeFantasia: true } },
      item: {
        select: {
          nome: true,
          descricao: true,
          quantidade: true,
          unidadeMedida: true,
          pesquisa: { select: { titulo: true, municipio: true, uf: true } },
        },
      },
    },
  });
  if (!cd) throw new NaoEncontradoError('Link inválido.');
  if (!cd.respostaTokenExpiraEm || new Date() > cd.respostaTokenExpiraEm) {
    throw new ConflitoError('Este link de cotação expirou. Solicite um novo contato.');
  }
  return cd;
}

// GET /api/cotar/:token — dados do item para o fornecedor visualizar
router.get('/:token', async (req, res, next) => {
  try {
    const cd = await buscarCotacaoPorToken(req.params.token);
    res.json({
      fornecedor: cd.fornecedor.nomeFantasia || cd.fornecedor.razaoSocial,
      item: {
        nome: cd.item.nome,
        descricao: cd.item.descricao,
        quantidade: Number(cd.item.quantidade),
        unidadeMedida: cd.item.unidadeMedida,
      },
      pesquisaTitulo: cd.item.pesquisa.titulo,
      municipio: cd.item.pesquisa.municipio,
      uf: cd.item.pesquisa.uf,
      status: cd.status,
      jaRespondida: cd.status !== 'ENVIADA',
      precoEnviado: cd.status === 'RESPONDIDA' ? cd.preco : null,
    });
  } catch (e) { next(e); }
});

// POST /api/cotar/:token — fornecedor informa o preço (ou recusa)
router.post('/:token', async (req, res, next) => {
  try {
    const cd = await buscarCotacaoPorToken(req.params.token);
    if (cd.status !== 'ENVIADA') {
      throw new ConflitoError('Esta cotação já foi respondida.');
    }

    const data = z.object({
      preco: z.number().positive().optional(),
      recusar: z.boolean().optional(),
    }).parse(req.body);

    if (!data.recusar && data.preco === undefined) {
      throw new ValidacaoError('Informe o preço ou marque que não deseja cotar este item.');
    }

    // Não invalida o token na resposta: o fornecedor pode reabrir o link
    // para ver a confirmação do que enviou. O reenvio já é bloqueado acima
    // pela checagem de status !== 'ENVIADA' — a expiração do token continua
    // servindo apenas para limitar por quanto tempo a solicitação original
    // fica em aberto.
    await prisma.cotacaoDireta.update({
      where: { id: cd.id },
      data: {
        status: data.recusar ? 'RECUSADA' : 'RESPONDIDA',
        preco: data.recusar ? undefined : data.preco,
        dataResposta: new Date(),
      },
    });

    await registrarAuditoria({
      acao: 'COTACAO_DIRETA_RESPONDIDA_PUBLICO',
      entidade: 'CotacaoDireta',
      entidadeId: cd.id,
      detalhe: { recusada: Boolean(data.recusar), preco: data.preco },
      ip: req.ip,
    });

    if (!data.recusar) await recalcularItem(cd.itemPesquisaId);

    res.json({ ok: true, mensagem: 'Obrigado! Sua resposta foi registrada.' });
  } catch (e) { next(e); }
});

export default router;
