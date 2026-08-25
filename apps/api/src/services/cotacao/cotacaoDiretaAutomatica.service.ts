import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { enviarEmail } from '../email.service.js';
import { selecionarFornecedoresParaItem } from './fornecedorMatch.service.js';

/**
 * Fallback automático de cotação direta: quando as fontes automáticas não
 * atingem o mínimo de preços exigido para um item, o sistema seleciona
 * fornecedores, cria as solicitações e dispara o e-mail sozinho — o agente
 * não precisa procurar fornecedor nem digitar nada, só aguardar (ou revisar
 * as respostas depois). É esse fluxo que libera o tempo do agente: a
 * pesquisa manual vira exceção tratada pelo sistema, não trabalho extra.
 */

const MIN_FORNECEDORES = 3; // art. 23, Lei 14.133/2021 — mínimo de 3 cotações
const PRAZO_RESPOSTA_DIAS = 5;
const TOKEN_VALIDADE_DIAS = 10;

export interface ItemParaCotacaoDireta {
  id: string;
  nome: string;
  descricao: string;
  quantidade: number;
  unidadeMedida: string | null;
}

function htmlSolicitacao(params: {
  fornecedorNome: string;
  item: ItemParaCotacaoDireta;
  pesquisaTitulo: string;
  prazo: Date;
  link: string;
}): string {
  const { fornecedorNome, item, pesquisaTitulo, prazo, link } = params;
  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#1F3864;max-width:560px;">
      <h2>Solicitação de cotação de preço</h2>
      <p>Prezado(a) <strong>${fornecedorNome}</strong>,</p>
      <p>Solicitamos cotação de preço para o item abaixo, no âmbito da pesquisa de preços
      <strong>${pesquisaTitulo}</strong>, conforme a Lei Federal nº 14.133/2021 e a
      IN SEGES/ME nº 65/2021.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#666;">Item</td><td style="padding:6px 0;"><strong>${item.nome}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#666;">Especificação</td><td style="padding:6px 0;">${item.descricao}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Quantidade</td><td style="padding:6px 0;">${item.quantidade} ${item.unidadeMedida ?? ''}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Prazo para resposta</td><td style="padding:6px 0;">${prazo.toLocaleDateString('pt-BR')}</td></tr>
      </table>
      <p style="margin:24px 0;">
        <a href="${link}" style="background:#2E75B6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">
          Informar preço
        </a>
      </p>
      <p style="font-size:12px;color:#666;">O link acima leva a um formulário simples, sem necessidade de login, para informar o preço unitário praticado.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0;"/>
      <small style="color:#999;">LicitaPreço — Pesquisa de Preços para Licitações</small>
    </div>`;
}

/**
 * Dispara a solicitação para até `MIN_FORNECEDORES` fornecedores pré-
 * selecionados. Idempotente: se já existe solicitação pendente (ENVIADA)
 * para o item, não duplica — evita spam em reprocessamentos.
 * Devolve o número de solicitações criadas (0 = não havia fornecedor
 * disponível ou já havia solicitação em aberto).
 */
export async function dispararCotacaoDiretaAutomatica(
  item: ItemParaCotacaoDireta,
  pesquisaTitulo: string,
): Promise<number> {
  const jaPendente = await prisma.cotacaoDireta.count({
    where: { itemPesquisaId: item.id, status: 'ENVIADA' },
  });
  if (jaPendente > 0) return 0;

  const fornecedores = await selecionarFornecedoresParaItem(item.descricao || item.nome, MIN_FORNECEDORES);
  if (fornecedores.length === 0) {
    logger.warn('Cotação direta automática: nenhum fornecedor ativo com e-mail cadastrado', { itemId: item.id });
    return 0;
  }

  const prazo = new Date(Date.now() + PRAZO_RESPOSTA_DIAS * 24 * 60 * 60 * 1000);
  let criadas = 0;

  for (const f of fornecedores) {
    const token = randomUUID();
    const cotacaoDireta = await prisma.cotacaoDireta.create({
      data: {
        itemPesquisaId: item.id,
        fornecedorId: f.id,
        justificativa:
          'Solicitação automática: as fontes de preço automáticas não atingiram o mínimo de cotações exigido (IN SEGES/ME 65/2021, art. 5º, incisos II e III).',
        origemAutomatica: true,
        respostaToken: token,
        respostaTokenExpiraEm: new Date(Date.now() + TOKEN_VALIDADE_DIAS * 24 * 60 * 60 * 1000),
      },
    });
    criadas++;

    await enviarEmail({
      para: f.email!,
      assunto: `Solicitação de cotação de preço — ${pesquisaTitulo}`,
      html: htmlSolicitacao({
        fornecedorNome: f.nomeFantasia || f.razaoSocial,
        item,
        pesquisaTitulo,
        prazo,
        link: `${env.FRONTEND_URL}/cotar/${token}`,
      }),
    }).catch((e) => logger.warn('Falha ao enviar e-mail de cotação direta automática', { cotacaoDiretaId: cotacaoDireta.id, erro: e }));
  }

  logger.info(`Cotação direta automática disparada para ${criadas} fornecedor(es)`, { itemId: item.id });
  return criadas;
}
