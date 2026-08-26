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

export async function resolverCodigoCatalogo(
  descricaoItem: string,
  tipo: 'MATERIAL' | 'SERVICO' = 'MATERIAL',
): Promise<CodigoCatalogoResolvido | null> {
  const busca = normalizarChave(descricaoItem);
  if (!busca) return null;

  const candidatos = await prisma.$queryRawUnsafe<Array<{ codigo: number; descricao: string }>>(
    `SELECT codigo, descricao FROM "CatalogoOficialItem"
     WHERE tipo = $1::"TipoCatalogoOficial" AND ativo = true
     ORDER BY similarity(descricao, $2) DESC
     LIMIT $3`,
    tipo,
    busca,
    CANDIDATOS_TRIGRAM,
  );
  if (candidatos.length === 0) return null;

  let melhor: CodigoCatalogoResolvido | null = null;
  for (const c of candidatos) {
    const score = pontuarCorrespondencia(busca, c.descricao);
    if (score >= LIMIAR_FINAL && (!melhor || score > melhor.score)) {
      melhor = { codigo: c.codigo, tipo, descricaoCatalogo: c.descricao, score };
    }
  }
  return melhor;
}
