import type { MetodoCalculo } from '@licitapreco/shared';

/**
 * Cálculo do preço de referência a partir dos preços coletados.
 * Funções puras (sem I/O) para facilitar testes.
 */

export interface ResultadoCalculo {
  precoReferencia: number | null;
  precosConsiderados: number[];
  precosDescartados: number[];
  fontesComPreco: number;
  completa: boolean;
}

/** Mediana de uma lista não vazia já ordenada ou não. */
export function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 !== 0
    ? ordenados[meio]
    : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

export function media(valores: number[]): number {
  if (valores.length === 0) return 0;
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

/**
 * Descarta outliers: valores cuja variação em relação à mediana ultrapassa
 * `limitePercentual`%. Com 2 ou menos valores, nada é descartado (amostra pequena).
 */
export function descartarOutliers(
  valores: number[],
  limitePercentual: number,
): { mantidos: number[]; descartados: number[] } {
  const positivos = valores.filter((v) => v > 0);
  if (positivos.length <= 2) return { mantidos: positivos, descartados: [] };

  const med = mediana(positivos);
  if (med <= 0) return { mantidos: positivos, descartados: [] };

  const mantidos: number[] = [];
  const descartados: number[] = [];
  for (const v of positivos) {
    const variacao = (Math.abs(v - med) / med) * 100;
    if (variacao > limitePercentual) descartados.push(v);
    else mantidos.push(v);
  }
  // Se tudo for descartado (dispersão extrema), mantém os originais para não zerar.
  return mantidos.length === 0 ? { mantidos: positivos, descartados: [] } : { mantidos, descartados };
}

/**
 * Calcula o preço de referência aplicando descarte de outliers e o método
 * configurado. `minFontes` define quando a pesquisa é considerada completa.
 */
export function calcularPrecoReferencia(
  precosBrutos: Array<number | null | undefined>,
  opcoes: { metodo: MetodoCalculo; limiteOutlierPercentual: number; minFontes: number },
): ResultadoCalculo {
  const validos = precosBrutos.filter(
    (p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0,
  );

  if (validos.length === 0) {
    return {
      precoReferencia: null,
      precosConsiderados: [],
      precosDescartados: [],
      fontesComPreco: 0,
      completa: false,
    };
  }

  const { mantidos, descartados } = descartarOutliers(validos, opcoes.limiteOutlierPercentual);

  let preco: number;
  switch (opcoes.metodo) {
    case 'MEDIANA':
      preco = mediana(mantidos);
      break;
    case 'MENOR_PRECO':
      preco = Math.min(...mantidos);
      break;
    case 'MEDIA':
    default:
      preco = media(mantidos);
      break;
  }

  // Arredonda para 4 casas (precisão de preço unitário).
  const precoReferencia = Math.round(preco * 10000) / 10000;

  return {
    precoReferencia,
    precosConsiderados: mantidos,
    precosDescartados: descartados,
    fontesComPreco: validos.length,
    completa: validos.length >= opcoes.minFontes,
  };
}

/** Variação percentual entre dois preços (para alerta de histórico). */
export function variacaoPercentual(precoAntigo: number, precoNovo: number): number {
  if (precoAntigo <= 0) return 0;
  return (Math.abs(precoNovo - precoAntigo) / precoAntigo) * 100;
}
