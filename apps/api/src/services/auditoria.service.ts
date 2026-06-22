import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Registro de auditoria: quem fez o quê, quando, com antes/depois quando aplicável.
 * Nunca lança erro para o fluxo principal — falha de auditoria é apenas logada.
 */

export interface DadosAuditoria {
  userId?: string | null;
  acao: string;
  entidade?: string;
  entidadeId?: string;
  detalhe?: unknown;
  ip?: string;
}

export async function registrarAuditoria(dados: DadosAuditoria): Promise<void> {
  try {
    await prisma.logAuditoria.create({
      data: {
        userId: dados.userId ?? null,
        acao: dados.acao,
        entidade: dados.entidade,
        entidadeId: dados.entidadeId,
        detalhe: dados.detalhe === undefined ? undefined : (dados.detalhe as object),
        ip: dados.ip,
      },
    });
  } catch (e) {
    logger.error('Falha ao registrar auditoria', { acao: dados.acao, erro: e });
  }
}
