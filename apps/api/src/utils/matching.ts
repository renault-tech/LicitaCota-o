import { normalizarChave } from './texto.js';

/**
 * Pontuação de correspondência entre a descrição buscada e uma descrição
 * candidata (ex.: item de um contrato do PNCP, linha de tabela de referência).
 * Usado por todos os adapters de fonte automática para decidir se um item
 * externo é, de fato, o mesmo objeto pesquisado — evitando tanto falsos
 * positivos (preço de item errado inflando/distorcendo a referência) quanto
 * falsos negativos (item descartado por diferença de redação).
 *
 * Estratégia: Jaccard ponderado por raridade do token (tokens curtos/comuns
 * pesam menos que termos específicos), com bônus para correspondência exata
 * de sequência de tokens.
 */

const STOP_TOKENS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'por', 'e', 'ou',
  'a', 'o', 'as', 'os', 'em', 'no', 'na', 'tipo', 'cor', 'un', 'unidade',
]);

function tokenizar(texto: string): string[] {
  return normalizarChave(texto)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

/**
 * Score em [0, 1]: proporção dos tokens da busca presentes na descrição
 * candidata, com peso maior para tokens mais longos (mais específicos).
 * Tokens numéricos (medidas, códigos) pesam mais ainda — são os que mais
 * discriminam itens parecidos ("caneta azul 1.0mm" vs "caneta azul 0.5mm").
 */
export function pontuarCorrespondencia(busca: string, candidata: string): number {
  const tokensBusca = tokenizar(busca);
  if (tokensBusca.length === 0) return 0;
  const tokensCand = new Set(tokenizar(candidata));

  let pesoTotal = 0;
  let pesoAcertado = 0;
  for (const t of tokensBusca) {
    const peso = /\d/.test(t) ? 2.5 : Math.min(1 + t.length / 8, 2);
    pesoTotal += peso;
    if (tokensCand.has(t)) pesoAcertado += peso;
  }
  return pesoTotal > 0 ? pesoAcertado / pesoTotal : 0;
}

export interface CandidatoPontuado<T> {
  item: T;
  score: number;
}

/**
 * Encontra o melhor candidato acima do limiar mínimo. `limiar` default 0.65:
 * abaixo disso o risco de falso positivo (item errado） supera o ganho de
 * cobertura — é preferível marcar "sem resultado" e cair no fallback de
 * cotação direta do que citar preço de um item diferente numa peça oficial.
 */
export function melhorCorrespondencia<T>(
  busca: string,
  candidatos: T[],
  extrairDescricao: (c: T) => string,
  limiar = 0.65,
): CandidatoPontuado<T> | null {
  let melhor: CandidatoPontuado<T> | null = null;
  for (const c of candidatos) {
    const score = pontuarCorrespondencia(busca, extrairDescricao(c));
    if (score >= limiar && (!melhor || score > melhor.score)) {
      melhor = { item: c, score };
    }
  }
  return melhor;
}
