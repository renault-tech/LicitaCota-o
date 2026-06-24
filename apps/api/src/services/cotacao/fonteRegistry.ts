import type { FonteCotacao } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { pncpAdapter } from './pncp.adapter.js';
import { pncpAtasAdapter } from './pncpAtas.adapter.js';
import { tabelaReferenciaAdapter } from './tabelaReferencia.adapter.js';
import type { FonteAdapter } from './adapter.js';

const ADAPTERS_POR_SLUG: Record<string, FonteAdapter> = {
  'pncp': pncpAdapter,
  'pncp-atas': pncpAtasAdapter,
};

export function adapterPara(tipo: FonteCotacao['tipo'], slug?: string): FonteAdapter {
  if (slug && ADAPTERS_POR_SLUG[slug]) return ADAPTERS_POR_SLUG[slug];
  if (tipo === 'TABELA_REFERENCIA') return tabelaReferenciaAdapter;
  throw new Error(`Fonte sem adapter: slug=${String(slug)} tipo=${String(tipo)}`);
}

export async function fontesAtivasValidas(): Promise<FonteCotacao[]> {
  return prisma.fonteCotacao.findMany({
    where: { ativo: true, statusValidacao: 'VALIDA' },
    orderBy: { ordem: 'asc' },
  });
}
