import type { Fornecedor } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { normalizarChave } from '../../utils/texto.js';
import { pontuarCorrespondencia } from '../../utils/matching.js';

const LIMIAR_CATEGORIA = 0.5;

/**
 * Seleciona fornecedores para uma cotação direta automática, priorizando os
 * cujas categorias casam com a descrição do item e completando com os
 * demais fornecedores ativos até o mínimo — nunca deixa de selecionar por
 * falta de categorização (degrada para "todos ativos", não para zero).
 * Função pura: recebe a lista de candidatos, não consulta o banco — testável
 * sem fixture de dados.
 */
export function selecionarFornecedores(
  fornecedores: Fornecedor[],
  descricaoItem: string,
  minimo = 3,
): Fornecedor[] {
  const descNorm = normalizarChave(descricaoItem);

  const pontuados = fornecedores
    .map((f) => {
      const score = f.categorias.length
        ? Math.max(...f.categorias.map((c) => pontuarCorrespondencia(c, descNorm)))
        : 0;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score);

  const combinaram = pontuados.filter((p) => p.score >= LIMIAR_CATEGORIA);
  const selecionados =
    combinaram.length >= minimo
      ? combinaram.slice(0, minimo)
      : [...combinaram, ...pontuados.filter((p) => p.score < LIMIAR_CATEGORIA)].slice(0, minimo);

  return selecionados.map((p) => p.f);
}

/** Busca fornecedores ativos com e-mail e aplica a seleção acima. */
export async function selecionarFornecedoresParaItem(
  descricaoItem: string,
  minimo = 3,
): Promise<Fornecedor[]> {
  const ativos = await prisma.fornecedor.findMany({
    where: { ativo: true, email: { not: null } },
  });
  return selecionarFornecedores(ativos, descricaoItem, minimo);
}
