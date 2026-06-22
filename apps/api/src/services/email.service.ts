import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Envio de e-mail via Nodemailer. Se SMTP não estiver configurado, registra a
 * mensagem em log (modo desenvolvimento) em vez de falhar.
 */

let transporter: Transporter | null = null;

function obterTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface EmailParams {
  para: string;
  assunto: string;
  html: string;
  texto?: string;
}

export async function enviarEmail(params: EmailParams): Promise<void> {
  const t = obterTransporter();
  if (!t) {
    logger.warn(`[E-mail não enviado: SMTP não configurado] Para: ${params.para} | ${params.assunto}`);
    return;
  }
  await t.sendMail({
    from: env.SMTP_FROM,
    to: params.para,
    subject: params.assunto,
    html: params.html,
    text: params.texto,
  });
}

export function htmlPesquisaConcluida(titulo: string, link: string, resumo: string): string {
  return `
    <div style="font-family: Inter, Arial, sans-serif; color: #1F3864;">
      <h2 style="color:#1F3864;">Pesquisa de preços concluída</h2>
      <p>Sua pesquisa <strong>${titulo}</strong> foi concluída.</p>
      <p style="background:#FCE4C8;padding:8px;border-radius:4px;">${resumo}</p>
      <p><a href="${link}" style="background:#2E75B6;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;">Ver resultado</a></p>
      <hr/>
      <small>LicitaPreço — Pesquisa de Preços para Licitações</small>
    </div>`;
}
