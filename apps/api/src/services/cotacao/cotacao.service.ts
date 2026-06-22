import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ParametrosCalculo } from '@licitapreco/shared';
import { MENSAGENS_STATUS } from '@licitapreco/shared';
import { prisma } from '../../config/prisma.js';
import { normalizarChave } from '../../utils/texto.js';
import { logger } from '../../utils/logger.js';
import { notificar } from '../notificacao.service.js';
import { calcularPrecoReferencia, variacaoPercentual } from './calculo.js';
import { adapterPara } from './fonteRegistry.js';

/**
 * Orquestra a cotação de UM item em TODAS as fontes informadas, calcula o
 * preço de referência, persiste as cotações, atualiza histórico/catálogo e
 * dispara alerta de variação de preço quando aplicável.
 */

export interface ResultadoItem {
  statusItem: 'COTADO' | 'SEM_RESULTADO' | 'ERRO';
  precoReferencia: number | null;
  precoTotal: number | null;
  fontesComPreco: number;
  completa: boolean;
  observacao: string | null;
  houveErroFonte: boolean;
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function cotarItem(
  itemId: string,
  itemNormalizado: ItemNormalizado,
  fontes: FonteCotacao[],
  parametros: ParametrosCalculo,
  contexto: { municipio?: string | null; uf?: string | null; pesquisaId: string; autorId: string },
): Promise<ResultadoItem> {
  const precos: Array<number | null> = [];
  let houveErroFonte = false;

  // Remove cotações anteriores deste item (re-cotação) preservando histórico.
  await prisma.cotacao.deleteMany({ where: { itemPesquisaId: itemId, editadaManualmente: false } });

  for (const fonte of fontes) {
    const adapter = adapterPara(fonte.tipo);
    try {
      const resultado = await adapter.consultar(itemNormalizado, fonte);
      await prisma.cotacao.create({
        data: {
          itemPesquisaId: itemId,
          fonte: fonte.slug,
          preco: resultado.preco ?? null,
          referencia: resultado.referencia || null,
          fundamentacaoArtigo: resultado.fundamentacaoArtigo || fonte.fundamentacaoArtigo,
          erro: resultado.erro ?? null,
          dadosBrutos: (resultado.dadosBrutos ?? null) as object,
        },
      });
      if (resultado.erro) houveErroFonte = true;
      precos.push(resultado.preco);

      // Registra histórico por fonte que retornou preço.
      if (resultado.preco && resultado.preco > 0) {
        await prisma.historicoPreco.create({
          data: {
            itemNome: normalizarChave(itemNormalizado.nome),
            fonte: fonte.slug,
            preco: resultado.preco,
            pesquisaId: contexto.pesquisaId,
            municipio: contexto.municipio ?? null,
            uf: contexto.uf ?? null,
          },
        });
      }
    } catch (e) {
      houveErroFonte = true;
      logger.warn(`Erro ao cotar item ${itemId} na fonte ${fonte.slug}`, e);
      await prisma.cotacao.create({
        data: {
          itemPesquisaId: itemId,
          fonte: fonte.slug,
          preco: null,
          fundamentacaoArtigo: fonte.fundamentacaoArtigo,
          erro: e instanceof Error ? e.message : 'Erro desconhecido na fonte.',
          dadosBrutos: undefined,
        },
      });
    }
    if (fonte.pausaMs > 0) await dormir(fonte.pausaMs);
  }

  // Inclui cotações diretas respondidas (não outliers) no cálculo.
  const diretas = await prisma.cotacaoDireta.findMany({
    where: { itemPesquisaId: itemId, status: 'RESPONDIDA', outlier: false },
  });
  for (const d of diretas) if (d.preco) precos.push(Number(d.preco));

  const calc = calcularPrecoReferencia(precos, {
    metodo: parametros.metodoCalculo,
    limiteOutlierPercentual: parametros.limiteOutlierPercentual,
    minFontes: parametros.minFontesCompleta,
  });

  let statusItem: ResultadoItem['statusItem'];
  let observacao: string | null = null;
  let precoTotal: number | null = null;

  if (calc.precoReferencia === null) {
    statusItem = houveErroFonte && calc.fontesComPreco === 0 ? 'ERRO' : 'SEM_RESULTADO';
    if (statusItem === 'SEM_RESULTADO') observacao = MENSAGENS_STATUS.pesquisaManualNecessaria;
  } else {
    statusItem = 'COTADO';
    precoTotal = Math.round(calc.precoReferencia * itemNormalizado.quantidade * 100) / 100;
    if (!calc.completa) observacao = MENSAGENS_STATUS.pesquisaIncompleta;
  }

  await prisma.itemPesquisa.update({
    where: { id: itemId },
    data: {
      statusItem,
      precoReferencia: calc.precoReferencia ?? null,
      precoTotal,
      descricaoNormalizada: itemNormalizado.descricaoNormalizada,
      observacao,
    },
  });

  // Atualiza catálogo e dispara alerta de variação.
  if (calc.precoReferencia !== null) {
    await atualizarCatalogoEAlertar(itemNormalizado, calc.precoReferencia, parametros, contexto);
  }

  return {
    statusItem,
    precoReferencia: calc.precoReferencia,
    precoTotal,
    fontesComPreco: calc.fontesComPreco,
    completa: calc.completa,
    observacao,
    houveErroFonte,
  };
}

async function atualizarCatalogoEAlertar(
  item: ItemNormalizado,
  precoReferencia: number,
  parametros: ParametrosCalculo,
  contexto: { pesquisaId: string; autorId: string },
): Promise<void> {
  const nomeNorm = normalizarChave(item.nome);
  const existente = await prisma.itemCatalogo.findUnique({ where: { nomeNormalizado: nomeNorm } });

  if (existente?.ultimoPrecoReferencia) {
    const anterior = Number(existente.ultimoPrecoReferencia);
    const variacao = variacaoPercentual(anterior, precoReferencia);
    if (variacao > parametros.limiteOutlierPercentual) {
      await notificar({
        userId: contexto.autorId,
        tipo: 'VARIACAO_PRECO',
        titulo: 'Variação de preço detectada',
        mensagem: `O item "${item.nome}" variou ${variacao.toFixed(1)}% em relação à última referência (de R$ ${anterior.toFixed(2)} para R$ ${precoReferencia.toFixed(2)}). Verifique possível sobrepreço ou erro de descrição.`,
        link: `/pesquisas/${contexto.pesquisaId}/resultado`,
      });
    }
  }

  await prisma.itemCatalogo.upsert({
    where: { nomeNormalizado: nomeNorm },
    update: {
      vezesUsado: { increment: 1 },
      ultimoPrecoReferencia: precoReferencia,
      ultimaDataReferencia: new Date(),
      descricaoPadrao: item.descricao || item.nome,
      unidadeMedida: item.unidadeMedida || undefined,
    },
    create: {
      nomeNormalizado: nomeNorm,
      descricaoPadrao: item.descricao || item.nome,
      unidadeMedida: item.unidadeMedida || null,
      vezesUsado: 1,
      ultimoPrecoReferencia: precoReferencia,
      ultimaDataReferencia: new Date(),
    },
  });
}
