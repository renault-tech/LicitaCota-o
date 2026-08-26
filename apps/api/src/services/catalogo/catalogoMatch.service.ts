import { prisma } from '../../config/prisma.js';
import { normalizarChave } from '../../utils/texto.js';
import { pontuarCorrespondencia } from '../../utils/matching.js';

/**
 * Resolve a descrição de um item para um código de catálogo (CATMAT/CATSER)
 * — busca inteiramente local: pg_trgm traz os candidatos mais próximos por
 * similaridade (indexado, rápido), e o mesmo comparador ponderado usado
 * pelos demais adapters decide o vencedor entre eles. Nenhuma chamada
 * externa nem de IA nesta função.
 */

const LIMIAR_FINAL = 0.6;
const CANDIDATOS_TRIGRAM = 8;

export interface CodigoCatalogoResolvido {
  codigo: number;
  tipo: 'MATERIAL' | 'SERVICO';
  descricaoCatalogo: string;
  score: number;
}

/**
 * Devolve todos os candidatos acima do limiar, do mais provável ao menos —
 * não só o primeiro. O catálogo tem centenas de milhares de códigos, muitos
 * quase idênticos entre si (variações de cor/material/ponta de uma mesma
 * "caneta esferográfica", por exemplo); o Painel de Preços só tem histórico
 * para os códigos que já foram efetivamente comprados, então o candidato
 * com melhor score textual pode não ter nenhum preço registrado enquanto
 * um candidato levemente pior tem. O chamador tenta a lista em ordem até
 * achar um com preço de verdade, em vez de desistir no primeiro.
 */
export async function resolverCandidatosCatalogo(
  descricaoItem: string,
  tipo: 'MATERIAL' | 'SERVICO' = 'MATERIAL',
): Promise<CodigoCatalogoResolvido[]> {
  const busca = normalizarChave(descricaoItem);
  if (!busca) return [];

  const candidatos = await prisma.$queryRawUnsafe<Array<{ codigo: number; descricao: string }>>(
    `SELECT codigo, descricao FROM "CatalogoOficialItem"
     WHERE tipo = $1::"TipoCatalogoOficial" AND ativo = true
     ORDER BY similarity(descricao, $2) DESC
     LIMIT $3`,
    tipo,
    busca,
    CANDIDATOS_TRIGRAM,
  );

  return candidatos
    .map((c) => ({ codigo: c.codigo, tipo, descricaoCatalogo: c.descricao, score: pontuarCorrespondencia(busca, c.descricao) }))
    .filter((c) => c.score >= LIMIAR_FINAL)
    .sort((a, b) => b.score - a.score);
}

export async function resolverCodigoCatalogo(
  descricaoItem: string,
  tipo: 'MATERIAL' | 'SERVICO' = 'MATERIAL',
): Promise<CodigoCatalogoResolvido | null> {
  const candidatos = await resolverCandidatosCatalogo(descricaoItem, tipo);
  return candidatos[0] ?? null;
}
