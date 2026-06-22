import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoCotacao, TesteResultado } from '@licitapreco/shared';
import { prisma } from '../../config/prisma.js';
import { normalizarChave } from '../../utils/texto.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Adapter para fontes do tipo TABELA_REFERENCIA: consulta as linhas importadas
 * (TabelaReferenciaItem) por correspondência de descrição normalizada.
 * Útil para tabelas oficiais de órgãos estaduais/municipais.
 */

function pontuarCorrespondencia(busca: string, candidato: string): number {
  const tokensBusca = new Set(busca.split(' ').filter(Boolean));
  const tokensCand = new Set(candidato.split(' ').filter(Boolean));
  if (tokensBusca.size === 0) return 0;
  let comuns = 0;
  for (const t of tokensBusca) if (tokensCand.has(t)) comuns++;
  return comuns / tokensBusca.size;
}

async function melhorLinha(
  fonteId: string,
  termos: string[],
): Promise<{ preco: number; referencia: string } | null> {
  const linhas = await prisma.tabelaReferenciaItem.findMany({ where: { fonteId } });
  if (linhas.length === 0) return null;

  let melhor: { preco: number; referencia: string; score: number } | null = null;
  for (const termo of termos) {
    const buscaNorm = normalizarChave(termo);
    for (const l of linhas) {
      const score = pontuarCorrespondencia(buscaNorm, l.descricaoNorm);
      if (score >= 0.6 && (!melhor || score > melhor.score)) {
        melhor = {
          preco: Number(l.preco),
          referencia: l.referencia ?? l.descricao,
          score,
        };
      }
    }
    if (melhor) break; // achou na variação mais completa
  }
  return melhor ? { preco: melhor.preco, referencia: melhor.referencia } : null;
}

export const tabelaReferenciaAdapter: FonteAdapter = {
  slug: 'tabela-referencia',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoCotacao> {
    try {
      const achado = await melhorLinha(config.id, item.cascata);
      if (achado && achado.preco > 0) {
        return {
          preco: achado.preco,
          referencia: `${config.nome} - ${achado.referencia}`,
          fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
          dadosBrutos: achado,
        };
      }
      return {
        preco: null,
        referencia: '',
        fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: { cascataTentada: item.cascata },
      };
    } catch (e) {
      return {
        preco: null,
        referencia: '',
        fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: null,
        erro: e instanceof Error ? e.message : 'Erro ao consultar a tabela de referência.',
      };
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
      const achado = await melhorLinha(config.id, [itemAmostra]);
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
