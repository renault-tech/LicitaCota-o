/**
 * Utilitários de normalização de texto, reusados pela leitura de planilha,
 * pelo motor de normalização e pelo catálogo de itens.
 */

/** Remove acentos/diacríticos. */
export function removerAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normaliza para comparação/chave: minúsculas, sem acento, sem pontuação
 * excessiva, espaços colapsados.
 */
export function normalizarChave(texto: string): string {
  return removerAcentos(texto)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compara dois títulos de coluna de forma tolerante (acento/caixa/espaço). */
export function tituloEquivalente(a: string, b: string): boolean {
  return normalizarChave(a) === normalizarChave(b);
}
