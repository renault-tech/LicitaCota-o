import { prisma } from '../../config/prisma.js';
import { normalizarChave } from '../../utils/texto.js';
import { pontuarCorrespondencia } from '../../utils/matching.js';
import { buscarCandidatoExterno } from './catmatFallback.service.js';

/**
 * Resolve a descrição de um item para um código de catálogo (CATMAT/CATSER)
 * — busca inteiramente local: pg_trgm traz os candidatos mais próximos por
 * similaridade (indexado, rápido), e o mesmo comparador ponderado usado
 * pelos demais adapters decide o vencedor entre eles. Nenhuma chamada
 * externa nem de IA em `resolverCandidatosCatalogo`/`resolverCodigoCatalogo`
 * — quem precisar do fallback de terceiro usa `resolverCandidatosCatalogoComFallback`
 * explicitamente (ver catmatFallback.service.ts).
 */

// 0.6 rejeitava correspondências corretas na prática — descrições de
// compra ("removedor de esmaltes") e do catálogo oficial ("remoção de
// esmalte") divergem em forma de palavra (sem stemming no comparador),
// então mesmo o par certo raramente ultrapassava ~0.25-0.35 de score.
// Confirmado com dado real: "acetona removedor de esmaltes 500ml" vs a
// entrada oficial de ACETONA pontuou 0.224 — abaixo do limiar antigo,
// mesmo sendo o candidato certo (1º lugar por similaridade de trigrama).
const LIMIAR_FINAL = 0.35;
// Mais candidatos = mais chance do comparador ponderado (mais estrito que
// o trigram bruto do SQL) achar algo acima do limiar; barato agora que a
// ordenação usa o índice GiST (ver garantirIndiceTrigram) em vez de Seq
// Scan.
const CANDIDATOS_TRIGRAM = 20;

export interface CodigoCatalogoResolvido {
  codigo: number;
  tipo: 'MATERIAL' | 'SERVICO';
  descricaoCatalogo: string;
  score: number;
  origem: 'LOCAL' | 'CATMAT_COM_BR';
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

  // `<->` (distância de trigrama) em vez de `ORDER BY similarity(...) DESC`
  // — só o operador `<->` contra um índice GiST (gist_trgm_ops) permite
  // que o Postgres use o índice para essa ordenação (KNN); a função
  // similarity() direta força Seq Scan na tabela inteira a cada chamada.
  const candidatos = await prisma.$queryRawUnsafe<Array<{ codigo: number; descricao: string }>>(
    `SELECT codigo, descricao FROM "CatalogoOficialItem"
     WHERE tipo = $1::"TipoCatalogoOficial" AND ativo = true
     ORDER BY descricao <-> $2
     LIMIT $3`,
    tipo,
    busca,
    CANDIDATOS_TRIGRAM,
  );

  return candidatos
    .map((c) => ({
      codigo: c.codigo,
      tipo,
      descricaoCatalogo: c.descricao,
      score: pontuarCorrespondencia(busca, c.descricao),
      origem: 'LOCAL' as const,
    }))
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

/**
 * Igual a `resolverCandidatosCatalogo`, mas com uma última tentativa via
 * catmat.com.br (terceiro, desligado por padrão — ver catmatFallback.service.ts)
 * quando a busca local não acha nenhum candidato. O código sugerido pelo
 * fallback ainda precisa ser confirmado contra a API oficial de preço antes
 * de virar um resultado de verdade — esta função só resolve o código, nunca
 * o preço.
 */
export async function resolverCandidatosCatalogoComFallback(
  descricaoItem: string,
  tipo: 'MATERIAL' | 'SERVICO' = 'MATERIAL',
): Promise<CodigoCatalogoResolvido[]> {
  const locais = await resolverCandidatosCatalogo(descricaoItem, tipo);
  if (locais.length > 0 || tipo !== 'MATERIAL') return locais;

  const externo = await buscarCandidatoExterno(descricaoItem);
  if (!externo) return [];

  return [{
    codigo: externo.codigo,
    tipo,
    descricaoCatalogo: externo.descricaoCatalogo,
    // -1 é proposital: fora da faixa 0-1 dos scores locais, para nunca ser
    // confundido com uma confiança real de correspondência textual.
    score: -1,
    origem: 'CATMAT_COM_BR',
  }];
}
