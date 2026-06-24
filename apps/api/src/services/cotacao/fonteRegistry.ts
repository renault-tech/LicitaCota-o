import type { FonteCotacao } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { apiRestAdapter } from './apiRest.adapter.js';
import { comprasGovAdapter } from './comprasGov.adapter.js';
import { pncpAdapter } from './pncp.adapter.js';
import { pncpAtasAdapter } from './pncpAtas.adapter.js';
import { scrapingAdapter } from './scraping.adapter.js';
import { tabelaReferenciaAdapter } from './tabelaReferencia.adapter.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Registry de adapters por slug.
 * Todas as variantes PNCP por modalidade usam pncpAdapter —
 * a modalidade é lida do campo parametrosTemplate.modalidade da fonte.
 */
const ADAPTERS_POR_SLUG: Record<string, FonteAdapter> = {
  'compras-gov': comprasGovAdapter,
  'pncp': pncpAdapter,
  'pncp-atas': pncpAtasAdapter,
  'pncp-dispensa': pncpAdapter,
  'pncp-concorrencia': pncpAdapter,
  'pncp-leilao': pncpAdapter,
  'pncp-pregao-internacional': pncpAdapter,
  'pncp-tomada-precos': pncpAdapter,
  'pncp-convite': pncpAdapter,
  'pncp-dialogo-competitivo': pncpAdapter,
  'pncp-credenciamento': pncpAdapter,
  'pncp-prequalificacao': pncpAdapter,
};

export function adapterPara(tipo: FonteCotacao['tipo'], slug?: string): FonteAdapter {
  if (slug && ADAPTERS_POR_SLUG[slug]) return ADAPTERS_POR_SLUG[slug];
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
