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

/**
 * Singularização leve (sem dicionário/stemmer completo) — cobre os padrões
 * de plural mais comuns em descrições de item, o suficiente para que
 * "esmaltes"/"esmalte", "materiais"/"material", "papeis"/"papel" contem
 * como o mesmo token. Sem isso, qualquer diferença singular/plural entre a
 * descrição de compra e a descrição oficial do catálogo derruba o score,
 * mesmo quando é claramente o mesmo item (confirmado com dado real).
 */
function singularizar(t: string): string {
  if (t.length <= 4) return t;
  if (t.endsWith('oes') || t.endsWith('aes')) return t.slice(0, -3) + 'ao';
  if (t.endsWith('ais')) return t.slice(0, -3) + 'al';
  if (t.endsWith('eis')) return t.slice(0, -3) + 'el';
  if (t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

function tokenizar(texto: string): string[] {
  return normalizarChave(texto)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t))
    .map(singularizar);
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
 * Encontra o melhor candidato acima do limiar mínimo. `limiar` default 0.45
 * (era 0.65 — reduzido depois de confirmar com dado real que mesmo um par
 * correto de descrições, com uma única palavra central em comum e o resto
 * divergindo por forma de palavra sem stemming — ex.: "removedor" vs.
 * "remoção" —, pontua por volta de 0.22-0.28; 0.65 rejeitava
 * sistematicamente correspondências válidas). Mantido mais conservador que
 * o limiar de resolução de catálogo (0.35, ver catalogoMatch.service.ts):
 * aqui o candidato vira preço final sem uma segunda checagem contra API
 * oficial, então o risco de falso positivo (item errado) pesa mais.
 */
export function melhorCorrespondencia<T>(
  busca: string,
  candidatos: T[],
  extrairDescricao: (c: T) => string,
  limiar = 0.45,
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
