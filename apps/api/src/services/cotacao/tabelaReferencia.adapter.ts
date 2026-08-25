import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoConsultaFonte, TesteResultado } from '@licitapreco/shared';
import { prisma } from '../../config/prisma.js';
import { normalizarChave } from '../../utils/texto.js';
import { melhorCorrespondencia } from '../../utils/matching.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Adapter para fontes do tipo TABELA_REFERENCIA: consulta linhas importadas
 * (TabelaReferenciaItem, ex.: planilha SINAPI/SICRO ou tabela de órgão
 * estadual) por correspondência de descrição. Só devolve um ponto (a linha
 * mais próxima) porque uma tabela de referência representa um único preço
 * oficial por item, não várias fontes independentes.
 */

async function melhorLinha(
  fonteId: string,
  item: ItemNormalizado,
): Promise<{ preco: number; referencia: string } | null> {
  const linhas = await prisma.tabelaReferenciaItem.findMany({ where: { fonteId } });
  if (linhas.length === 0) return null;

  for (const termo of item.cascata) {
    const buscaNorm = normalizarChave(termo);
    const melhor = melhorCorrespondencia(buscaNorm, linhas, (l) => l.descricaoNorm);
    if (melhor) {
      return { preco: Number(melhor.item.preco), referencia: melhor.item.referencia ?? melhor.item.descricao };
    }
  }
  return null;
}

export const tabelaReferenciaAdapter: FonteAdapter = {
  slug: 'tabela-referencia',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoConsultaFonte> {
    try {
      const achado = await melhorLinha(config.id, item);
      if (!achado || achado.preco <= 0) return { pontos: [] };
      return {
        pontos: [{
          preco: achado.preco,
          referencia: `${config.nome} — ${achado.referencia}`,
          fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        }],
      };
    } catch (e) {
      return { pontos: [], erro: e instanceof Error ? e.message : 'Erro ao consultar a tabela de referência.' };
    }
  },

  async testar(config: FonteCotacao, itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      const total = await prisma.tabelaReferenciaItem.count({ where: { fonteId: config.id } });
      if (total === 0) {
        return {
          ok: false,
          latenciaMs: Date.now() - inicio,
          amostraPreco: null,
          amostraReferencia: null,
          mensagem: 'A tabela de referência está vazia. Importe a planilha de preços antes de ativar.',
          dadosBrutos: { total },
        };
      }
      const itemAmostraNormalizado: ItemNormalizado = {
        nome: itemAmostra,
        descricao: itemAmostra,
        descricaoNormalizada: normalizarChave(itemAmostra),
        cascata: [normalizarChave(itemAmostra)],
        quantidade: 1,
        unidadeMedida: '',
      };
      const achado = await melhorLinha(config.id, itemAmostraNormalizado);
      const latenciaMs = Date.now() - inicio;
      if (!achado) {
        return {
          ok: true,
          latenciaMs,
          amostraPreco: null,
          amostraReferencia: null,
          mensagem: `Tabela com ${total} item(ns). O item de amostra não casou, mas a fonte está apta a consultar.`,
          dadosBrutos: { total },
        };
      }
      return {
        ok: true,
        latenciaMs,
        amostraPreco: achado.preco,
        amostraReferencia: achado.referencia,
        mensagem: `Fonte válida: ${total} item(ns) na tabela; amostra correspondida.`,
        dadosBrutos: { total, achado },
      };
    } catch (e) {
      return {
        ok: false,
        latenciaMs: Date.now() - inicio,
        amostraPreco: null,
        amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha: ${e.message}` : 'Falha ao testar a tabela.',
        dadosBrutos: null,
      };
    }
  },
};
