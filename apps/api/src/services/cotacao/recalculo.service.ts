import type { ParametrosCalculo, PrecoDescartado } from '@licitapreco/shared';
import { MENSAGENS_STATUS } from '@licitapreco/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { calcularPrecoReferencia } from './calculo.js';

/**
 * Recalcula o preço de referência de um item a partir de TODAS as cotações
 * persistidas (fontes automáticas, cotação manual do servidor e cotações
 * diretas respondidas) e propaga o efeito para os totais da pesquisa.
 *
 * Necessário sempre que uma cotação é criada ou alterada fora do fluxo de
 * processamento — caso contrário o item mantém o preço antigo e a planilha
 * gerada fica inconsistente com as cotações que ela própria exibe. É o que
 * roda, por exemplo, quando um fornecedor responde a uma cotação direta pelo
 * link público.
 */
export async function recalcularItem(itemId: string): Promise<void> {
  const item = await prisma.itemPesquisa.findUnique({
    where: { id: itemId },
    include: { cotacoes: true, cotacoesDiretas: { include: { fornecedor: { select: { razaoSocial: true } } } } },
  });
  if (!item) return;

  const parametros = await carregarParametros();

  const precos: number[] = [];
  const origemPorPreco: Array<{ preco: number; referencia: string; cotacaoDiretaId?: string }> = [];
  for (const c of item.cotacoes) {
    if (c.preco != null) {
      const v = Number(c.preco);
      precos.push(v);
      origemPorPreco.push({ preco: v, referencia: c.referencia ?? c.fonte });
    }
  }
  for (const d of item.cotacoesDiretas) {
    if (d.status === 'RESPONDIDA' && !d.outlier && d.preco != null) {
      const v = Number(d.preco);
      precos.push(v);
      origemPorPreco.push({ preco: v, referencia: `Cotação direta — ${d.fornecedor.razaoSocial}`, cotacaoDiretaId: d.id });
    }
  }

  const calc = calcularPrecoReferencia(precos, {
    metodo: parametros.metodoCalculo,
    limiteOutlierPercentual: parametros.limiteOutlierPercentual,
    minFontes: parametros.minFontesCompleta,
  });

  const restantes = [...origemPorPreco];
  const cotacoesDiretasDescartadas: string[] = [];
  const precosDescartados: PrecoDescartado[] = calc.precosDescartados.map((preco) => {
    const idx = restantes.findIndex((p) => p.preco === preco);
    const origem = idx >= 0 ? restantes.splice(idx, 1)[0] : undefined;
    if (origem?.cotacaoDiretaId) cotacoesDiretasDescartadas.push(origem.cotacaoDiretaId);
    return {
      preco,
      referencia: origem?.referencia ?? '',
      motivo: `Variação superior a ${parametros.limiteOutlierPercentual}% em relação à mediana dos preços coletados — excluído nos termos do art. 7º da IN SEGES/ME 65/2021.`,
    };
  });
  // Só liga a flag (nunca desliga automaticamente) — evita sobrescrever uma
  // decisão manual do agente numa recontagem futura.
  if (cotacoesDiretasDescartadas.length > 0) {
    await prisma.cotacaoDireta.updateMany({
      where: { id: { in: cotacoesDiretasDescartadas } },
      data: { outlier: true },
    });
  }

  const houveErroFonte = item.cotacoes.some((c) => c.erro != null);
  const aindaAguardandoFornecedor = item.cotacoesDiretas.some((d) => d.status === 'ENVIADA');

  let statusItem: 'COTADO' | 'AGUARDANDO_FORNECEDOR' | 'SEM_RESULTADO' | 'ERRO';
  let precoTotal: number | null = null;
  let observacao: string | null = null;

  if (calc.completa) {
    statusItem = 'COTADO';
    precoTotal = Math.round(calc.precoReferencia! * Number(item.quantidade) * 100) / 100;
  } else if (aindaAguardandoFornecedor) {
    // Ainda há fornecedor(es) sem responder — não é "sem resultado", é uma
    // solicitação em aberto. Mantém o melhor preço disponível enquanto isso.
    statusItem = 'AGUARDANDO_FORNECEDOR';
    observacao = MENSAGENS_STATUS.aguardandoFornecedor;
    if (calc.precoReferencia !== null) {
      precoTotal = Math.round(calc.precoReferencia * Number(item.quantidade) * 100) / 100;
    }
  } else if (calc.precoReferencia === null) {
    statusItem = houveErroFonte && calc.fontesComPreco === 0 ? 'ERRO' : 'SEM_RESULTADO';
    if (statusItem === 'SEM_RESULTADO') observacao = MENSAGENS_STATUS.pesquisaManualNecessaria;
  } else {
    statusItem = 'COTADO';
    precoTotal = Math.round(calc.precoReferencia * Number(item.quantidade) * 100) / 100;
    observacao = MENSAGENS_STATUS.pesquisaIncompleta;
  }

  await prisma.itemPesquisa.update({
    where: { id: itemId },
    data: {
      statusItem,
      precoReferencia: calc.precoReferencia,
      precoTotal,
      observacao,
      precosDescartados:
        precosDescartados.length > 0
          ? (precosDescartados as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });

  await recalcularTotaisPesquisa(item.pesquisaId);
}

/** Reconta status e valor total da pesquisa a partir dos itens persistidos. */
export async function recalcularTotaisPesquisa(pesquisaId: string): Promise<void> {
  const itens = await prisma.itemPesquisa.findMany({
    where: { pesquisaId },
    select: { statusItem: true, precoTotal: true },
  });

  const itensComCotacao = itens.filter((i) => i.statusItem === 'COTADO').length;
  // AGUARDANDO_FORNECEDOR conta como "sem cotação fechada ainda" no resumo
  // agregado da pesquisa; o status preciso por item fica em statusItem.
  const itensSemCotacao = itens.filter(
    (i) => i.statusItem === 'SEM_RESULTADO' || i.statusItem === 'AGUARDANDO_FORNECEDOR',
  ).length;
  const itensComErro = itens.filter((i) => i.statusItem === 'ERRO').length;
  const valorTotal = itens.reduce((s, i) => s + (i.precoTotal ? Number(i.precoTotal) : 0), 0);

  await prisma.pesquisa.update({
    where: { id: pesquisaId },
    data: {
      itensComCotacao,
      itensSemCotacao,
      itensComErro,
      resumoCobertura: `${itens.length} itens | ${itensComCotacao} cotados | ${itensSemCotacao} sem resultado | ${itensComErro} com erro`,
      valorTotalEstimado: valorTotal > 0 ? valorTotal : null,
    },
  });
}

async function carregarParametros(): Promise<ParametrosCalculo> {
  const config = await prisma.configuracaoSistema.findUnique({ where: { id: 'singleton' } });
  return {
    metodoCalculo: (config?.metodoCalculo ?? 'MEDIA') as ParametrosCalculo['metodoCalculo'],
    limiteOutlierPercentual: config?.limiteOutlierPercentual ?? 30,
    minFontesCompleta: config?.minFontesCompleta ?? 2,
  };
}
