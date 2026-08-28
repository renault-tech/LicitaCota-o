import { Prisma, type FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ParametrosCalculo, PrecoDescartado } from '@licitapreco/shared';
import { MENSAGENS_STATUS } from '@licitapreco/shared';
import { prisma } from '../../config/prisma.js';
import { normalizarChave } from '../../utils/texto.js';
import { logger } from '../../utils/logger.js';
import { notificar } from '../notificacao.service.js';
import { calcularPrecoReferencia, variacaoPercentual } from './calculo.js';
import { adapterPara } from './fonteRegistry.js';
import { dispararCotacaoDiretaAutomatica } from './cotacaoDiretaAutomatica.service.js';

/**
 * Orquestra a cotação de UM item em TODAS as fontes informadas, calcula o
 * preço de referência, persiste as cotações, atualiza histórico/catálogo e
 * dispara alerta de variação de preço quando aplicável.
 *
 * Cada fonte pode devolver VÁRIOS pontos de preço distintos (ver
 * FonteAdapter em adapter.ts) — cada ponto vira sua própria linha de
 * Cotacao e entra individualmente no cálculo, em vez de ser pré-agregado
 * pelo adapter. Quando as fontes automáticas não alcançam o mínimo exigido,
 * o item não fica num beco sem saída "pesquisa manual necessária": a
 * cotação direta com fornecedores é disparada automaticamente.
 */

export interface ResultadoItem {
  statusItem: 'COTADO' | 'AGUARDANDO_FORNECEDOR' | 'SEM_RESULTADO' | 'ERRO';
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
  contexto: {
    municipio?: string | null;
    uf?: string | null;
    pesquisaId: string;
    pesquisaTitulo: string;
    autorId: string;
  },
): Promise<ResultadoItem> {
  const precos: number[] = [];
  // Ponto de origem de cada preço em `precos` (mesmo índice), para recuperar
  // a referência de um preço descartado como outlier — rastro de auditoria —
  // e, quando vier de cotação direta, marcar outlier=true de volta no banco
  // (a flag também controla o que entra em recálculos futuros).
  const origemPorPreco: Array<{ preco: number; referencia: string; cotacaoDiretaId?: string }> = [];
  let houveErroFonte = false;
  // Distinto de "nenhuma fonte encontrou preço": conta fontes que de fato
  // responderam (com ou sem preço), para não confundir "uma fonte deu
  // timeout mas outra respondeu e simplesmente não achou preço" com
  // "nenhuma fonte pôde ser consultada". Só a segunda situação justifica
  // ERRO em vez do fallback de cotação direta automática.
  let fontesRespondidasComSucesso = 0;

  // Remove cotações anteriores deste item (re-cotação) preservando as
  // editadas manualmente pelo servidor responsável.
  await prisma.cotacao.deleteMany({ where: { itemPesquisaId: itemId, editadaManualmente: false } });

  // As cotações manuais preservadas continuam valendo e precisam entrar no
  // cálculo — do contrário a re-cotação descarta silenciosamente a correção
  // feita pelo servidor.
  const manuais = await prisma.cotacao.findMany({
    where: { itemPesquisaId: itemId, editadaManualmente: true },
  });
  for (const m of manuais) {
    if (m.preco != null) {
      const v = Number(m.preco);
      precos.push(v);
      origemPorPreco.push({ preco: v, referencia: m.referencia ?? 'Cotação manual' });
    }
  }

  for (const fonte of fontes) {
    const adapter = adapterPara(fonte.tipo, fonte.slug);
    try {
      const resultado = await adapter.consultar(itemNormalizado, fonte);

      if (resultado.erro) {
        // Fonte indisponível (rede/HTTP) — distinto de "consultou e não achou
        // preço": não deve ser confundido com ausência de preço no mercado.
        houveErroFonte = true;
        await prisma.cotacao.create({
          data: {
            itemPesquisaId: itemId,
            fonte: fonte.slug,
            preco: null,
            fundamentacaoArtigo: fonte.fundamentacaoArtigo,
            erro: resultado.erro,
            dadosBrutos: undefined,
          },
        });
      } else if (resultado.pontos.length === 0) {
        // A fonte respondeu normalmente e não encontrou preço para o item.
        fontesRespondidasComSucesso++;
        await prisma.cotacao.create({
          data: {
            itemPesquisaId: itemId,
            fonte: fonte.slug,
            preco: null,
            fundamentacaoArtigo: fonte.fundamentacaoArtigo,
            dadosBrutos: undefined,
          },
        });
      } else {
        fontesRespondidasComSucesso++;
        for (const ponto of resultado.pontos) {
          await prisma.cotacao.create({
            data: {
              itemPesquisaId: itemId,
              fonte: fonte.slug,
              preco: ponto.preco,
              referencia: ponto.referencia,
              fundamentacaoArtigo: ponto.fundamentacaoArtigo || fonte.fundamentacaoArtigo,
              dadosBrutos: (ponto.dadosBrutos ?? null) as object,
            },
          });
          precos.push(ponto.preco);
          origemPorPreco.push({ preco: ponto.preco, referencia: ponto.referencia });

          await prisma.historicoPreco.create({
            data: {
              itemNome: normalizarChave(itemNormalizado.nome),
              fonte: fonte.slug,
              preco: ponto.preco,
              pesquisaId: contexto.pesquisaId,
              municipio: contexto.municipio ?? null,
              uf: contexto.uf ?? null,
            },
          });
        }
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

  // Inclui cotações diretas já respondidas (não outliers) no cálculo.
  const diretas = await prisma.cotacaoDireta.findMany({
    where: { itemPesquisaId: itemId, status: 'RESPONDIDA', outlier: false },
    include: { fornecedor: { select: { razaoSocial: true } } },
  });
  for (const d of diretas) {
    if (d.preco) {
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

  // Recupera a referência de cada preço descartado, para justificar a
  // exclusão de forma auditável (não apenas o valor numérico).
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
  // Mantém a flag outlier da CotacaoDireta em sincronia com o que o cálculo
  // de fato excluiu — sem isso o agente vê a resposta do fornecedor como
  // "aceita" quando na prática o preço não entrou no resultado.
  if (cotacoesDiretasDescartadas.length > 0) {
    await prisma.cotacaoDireta.updateMany({
      where: { id: { in: cotacoesDiretasDescartadas } },
      data: { outlier: true },
    });
  }

  let precoTotal: number | null = null;
  if (calc.precoReferencia !== null) {
    precoTotal = Math.round(calc.precoReferencia * itemNormalizado.quantidade * 100) / 100;
  }

  let statusItem: ResultadoItem['statusItem'];
  let observacao: string | null = null;

  if (calc.completa) {
    statusItem = 'COTADO';
  } else if (calc.precoReferencia === null && houveErroFonte && fontesRespondidasComSucesso === 0) {
    // Nenhuma fonte automática respondeu por falha técnica — não é seguro
    // reportar "sem preço no mercado" quando na verdade nada foi consultado.
    // Importante: isso exige que TODAS as fontes tenham falhado tecnicamente
    // (nenhuma sequer respondeu) — uma fonte com timeout enquanto outra
    // responde normalmente (mesmo sem achar preço) não deve bloquear o
    // fallback de cotação direta automática abaixo.
    statusItem = 'ERRO';
    observacao = 'Todas as fontes automáticas falharam por erro de conexão. Reprocesse a pesquisa.';
  } else {
    const criadas = await dispararCotacaoDiretaAutomatica(
      {
        id: itemId,
        nome: itemNormalizado.nome,
        descricao: itemNormalizado.descricao,
        quantidade: itemNormalizado.quantidade,
        unidadeMedida: itemNormalizado.unidadeMedida,
      },
      contexto.pesquisaTitulo,
    );
    if (criadas > 0) {
      statusItem = 'AGUARDANDO_FORNECEDOR';
      observacao = MENSAGENS_STATUS.aguardandoFornecedor;
    } else if (calc.precoReferencia === null) {
      statusItem = 'SEM_RESULTADO';
      observacao = MENSAGENS_STATUS.pesquisaManualNecessaria;
    } else {
      statusItem = 'COTADO';
      observacao = MENSAGENS_STATUS.pesquisaIncompleta;
    }
  }

  await prisma.itemPesquisa.update({
    where: { id: itemId },
    data: {
      statusItem,
      precoReferencia: calc.precoReferencia ?? null,
      precoTotal,
      descricaoNormalizada: itemNormalizado.descricaoNormalizada,
      observacao,
      precosDescartados:
        precosDescartados.length > 0
          ? (precosDescartados as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
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
