import type { FonteCotacao } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { apiRestAdapter } from './apiRest.adapter.js';
import { scrapingAdapter } from './scraping.adapter.js';
import { tabelaReferenciaAdapter } from './tabelaReferencia.adapter.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Registry de adapters por tipo de fonte e carregamento dinâmico das fontes
 * ativas e válidas do banco. O worker itera sobre estas fontes — nunca sobre
 * uma lista fixa de código.
 */

export function adapterPara(tipo: FonteCotacao['tipo']): FonteAdapter {
  switch (tipo) {
    case 'API_REST':
      return apiRestAdapter;
    case 'SCRAPING':
      return scrapingAdapter;
    case 'TABELA_REFERENCIA':
      return tabelaReferenciaAdapter;
    default:
      throw new Error(`Tipo de fonte não suportado: ${String(tipo)}`);
  }
}

/** Fontes que participam de uma pesquisa: ativas E válidas, ordenadas. */
export async function fontesAtivasValidas(): Promise<FonteCotacao[]> {
  return prisma.fonteCotacao.findMany({
    where: { ativo: true, statusValidacao: 'VALIDA' },
    orderBy: { ordem: 'asc' },
  });
}
