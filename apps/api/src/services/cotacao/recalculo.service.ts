import type { ParametrosCalculo } from '@licitapreco/shared';
import { MENSAGENS_STATUS } from '@licitapreco/shared';
import { prisma } from '../../config/prisma.js';
import { calcularPrecoReferencia } from './calculo.js';

/**
 * Recalcula o preço de referência de um item a partir de TODAS as cotações
 * persistidas (fontes automáticas, cotação manual do servidor e cotações
 * diretas respondidas) e propaga o efeito para os totais da pesquisa.
 *
 * Necessário sempre que uma cotação é criada ou alterada fora do fluxo de
 * processamento — caso contrário o item mantém o preço antigo e a planilha
 * gerada fica inconsistente com as cotações que ela própria exibe.
 */
export async function recalcularItem(itemId: string): Promise<void> {
  const item = await prisma.itemPesquisa.findUnique({
    where: { id: itemId },
    include: { cotacoes: true, cotacoesDiretas: true },
  });
  if (!item) return;

  const parametros = await carregarParametros();

  const precos: Array<number | null> = item.cotacoes.map((c) =>
    c.preco != null ? Number(c.preco) : null,
  );
  for (const d of item.cotacoesDiretas) {
    if (d.status === 'RESPONDIDA' && !d.outlier && d.preco != null) precos.push(Number(d.preco));
  }

  const calc = calcularPrecoReferencia(precos, {
    metodo: parametros.metodoCalculo,
    limiteOutlierPercentual: parametros.limiteOutlierPercentual,
    minFontes: parametros.minFontesCompleta,
  });

  const houveErroFonte = item.cotacoes.some((c) => c.erro != null);
  let statusItem: 'COTADO' | 'SEM_RESULTADO' | 'ERRO';
  let precoTotal: number | null = null;
  let observacao: string | null = null;

  if (calc.precoReferencia === null) {
    statusItem = houveErroFonte && calc.fontesComPreco === 0 ? 'ERRO' : 'SEM_RESULTADO';
    if (statusItem === 'SEM_RESULTADO') observacao = MENSAGENS_STATUS.pesquisaManualNecessaria;
  } else {
    statusItem = 'COTADO';
    precoTotal = Math.round(calc.precoReferencia * Number(item.quantidade) * 100) / 100;
    if (!calc.completa) observacao = MENSAGENS_STATUS.pesquisaIncompleta;
  }

  await prisma.itemPesquisa.update({
    where: { id: itemId },
    data: { statusItem, precoReferencia: calc.precoReferencia, precoTotal, observacao },
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
  const itensSemCotacao = itens.filter((i) => i.statusItem === 'SEM_RESULTADO').length;
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
