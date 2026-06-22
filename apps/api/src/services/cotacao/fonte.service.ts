import type { FonteCotacao } from '@prisma/client';
import type { TesteResultado } from '@licitapreco/shared';
import { prisma } from '../../config/prisma.js';
import { ConflitoError, NaoEncontradoError } from '../../utils/errors.js';
import { registrarAuditoria } from '../auditoria.service.js';
import { adapterPara } from './fonteRegistry.js';

/**
 * Auto-teste de fontes. Nenhuma fonte pode ser ativada sem um teste VÁLIDA.
 * O teste roda o adapter correspondente com o item de amostra da configuração.
 */

async function itemAmostra(): Promise<string> {
  const config = await prisma.configuracaoSistema.findUnique({ where: { id: 'singleton' } });
  return config?.itemAmostraTeste ?? 'caneta esferográfica azul';
}

export async function testarFonte(
  fonteId: string,
  usuarioId: string | null,
  ip?: string,
): Promise<{ fonte: FonteCotacao; resultado: TesteResultado }> {
  const fonte = await prisma.fonteCotacao.findUnique({ where: { id: fonteId } });
  if (!fonte) throw new NaoEncontradoError('Fonte não encontrada.');

  const amostra = await itemAmostra();
  const adapter = adapterPara(fonte.tipo);
  const resultado = await adapter.testar(fonte, amostra);

  const atualizada = await prisma.fonteCotacao.update({
    where: { id: fonteId },
    data: {
      statusValidacao: resultado.ok ? 'VALIDA' : 'INVALIDA',
      ultimoTesteEm: new Date(),
      ultimoTesteResultado: {
        ok: resultado.ok,
        latenciaMs: resultado.latenciaMs,
        amostraPreco: resultado.amostraPreco,
        amostraReferencia: resultado.amostraReferencia,
        mensagem: resultado.mensagem,
      },
      // Se falhou, sai do fluxo de cotação.
      ativo: resultado.ok ? fonte.ativo : false,
    },
  });

  await registrarAuditoria({
    userId: usuarioId,
    acao: 'FONTE_TESTADA',
    entidade: 'FonteCotacao',
    entidadeId: fonteId,
    detalhe: { ok: resultado.ok, mensagem: resultado.mensagem, latenciaMs: resultado.latenciaMs },
    ip,
  });

  return { fonte: atualizada, resultado };
}

/**
 * Ativa uma fonte. Só é permitido se o último teste foi VÁLIDA.
 */
export async function ativarFonte(
  fonteId: string,
  ativo: boolean,
  usuarioId: string | null,
  ip?: string,
): Promise<FonteCotacao> {
  const fonte = await prisma.fonteCotacao.findUnique({ where: { id: fonteId } });
  if (!fonte) throw new NaoEncontradoError('Fonte não encontrada.');

  if (ativo && fonte.statusValidacao !== 'VALIDA') {
    throw new ConflitoError(
      'A fonte só pode ser ativada após passar no auto-teste (status VÁLIDA). Use "Testar fonte" primeiro.',
    );
  }

  const atualizada = await prisma.fonteCotacao.update({
    where: { id: fonteId },
    data: { ativo },
  });

  await registrarAuditoria({
    userId: usuarioId,
    acao: ativo ? 'FONTE_ATIVADA' : 'FONTE_DESATIVADA',
    entidade: 'FonteCotacao',
    entidadeId: fonteId,
    ip,
  });

  return atualizada;
}

/**
 * Revalida todas as fontes ativas (job diário). Marca como INVALIDA as que
 * falharem e desativa-as, devolvendo a lista das que caíram.
 */
export async function revalidarFontesAtivas(): Promise<
  Array<{ id: string; nome: string; ok: boolean; mensagem: string }>
> {
  const ativas = await prisma.fonteCotacao.findMany({ where: { ativo: true } });
  const amostra = await itemAmostra();
  const resultados: Array<{ id: string; nome: string; ok: boolean; mensagem: string }> = [];

  for (const fonte of ativas) {
    const adapter = adapterPara(fonte.tipo);
    const r = await adapter.testar(fonte, amostra);
    await prisma.fonteCotacao.update({
      where: { id: fonte.id },
      data: {
        statusValidacao: r.ok ? 'VALIDA' : 'INVALIDA',
        ativo: r.ok ? true : false,
        ultimoTesteEm: new Date(),
        ultimoTesteResultado: {
          ok: r.ok,
          latenciaMs: r.latenciaMs,
          mensagem: r.mensagem,
          amostraPreco: r.amostraPreco,
        },
      },
    });
    resultados.push({ id: fonte.id, nome: fonte.nome, ok: r.ok, mensagem: r.mensagem });
  }
  return resultados;
}
