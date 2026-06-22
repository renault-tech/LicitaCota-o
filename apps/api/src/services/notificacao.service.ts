import type { TipoNotificacao } from '@licitapreco/shared';
import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';
import { enviarEmail } from './email.service.js';

/**
 * Cria notificações in-app e, conforme preferência do usuário, dispara e-mail.
 */

export interface NovaNotificacao {
  userId: string;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  link?: string;
  enviarEmail?: boolean;
}

export async function notificar(dados: NovaNotificacao): Promise<void> {
  try {
    const usuario = await prisma.user.findUnique({ where: { id: dados.userId } });
    if (!usuario) return;

    if (usuario.prefNotifInApp) {
      await prisma.notificacao.create({
        data: {
          userId: dados.userId,
          tipo: dados.tipo,
          titulo: dados.titulo,
          mensagem: dados.mensagem,
          link: dados.link,
        },
      });
    }

    if (dados.enviarEmail && usuario.prefNotifEmail && usuario.email) {
      await enviarEmail({
        para: usuario.email,
        assunto: dados.titulo,
        html: `<p>${dados.mensagem}</p>${dados.link ? `<p><a href="${dados.link}">Acessar</a></p>` : ''}`,
      }).catch((e) => logger.warn('Falha ao enviar e-mail de notificação', e));
    }
  } catch (e) {
    logger.error('Falha ao notificar usuário', { userId: dados.userId, erro: e });
  }
}

/** Notifica todos os administradores (ex.: fonte que caiu). */
export async function notificarAdmins(
  dados: Omit<NovaNotificacao, 'userId'>,
): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', ativo: true } });
  await Promise.all(admins.map((a) => notificar({ ...dados, userId: a.id })));
}
