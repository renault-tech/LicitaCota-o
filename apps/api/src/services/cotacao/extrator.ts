/**
 * Extração de valores de respostas de API (caminhos tipo JSONPath simples)
 * e parsing de preços em formato brasileiro. Funções puras e testáveis.
 */

/** Acessa um caminho "a.b.c" (com suporte a índices "a.0.b") em um objeto. */
export function acessarCaminho(obj: unknown, caminho: string): unknown {
  if (!caminho) return undefined;
  const partes = caminho.split('.').filter(Boolean);
  let atual: unknown = obj;
  for (const parte of partes) {
    if (atual == null) return undefined;
    if (Array.isArray(atual)) {
      const idx = Number(parte);
      atual = Number.isInteger(idx) ? atual[idx] : undefined;
    } else if (typeof atual === 'object') {
      atual = (atual as Record<string, unknown>)[parte];
    } else {
      return undefined;
    }
  }
  return atual;
}

/** Resolve a lista de resultados a partir da resposta e do caminho configurado. */
export function resolverLista(resposta: unknown, caminhoLista?: string): unknown[] {
  if (caminhoLista) {
    const valor = acessarCaminho(resposta, caminhoLista);
    if (Array.isArray(valor)) return valor;
  }
  if (Array.isArray(resposta)) return resposta;
  // Heurística: primeira propriedade array do objeto raiz.
  if (resposta && typeof resposta === 'object') {
    for (const v of Object.values(resposta as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/**
 * Converte um valor (number ou string em formato BR/US) para número.
 * Aceita "1.234,56", "1234.56", "R$ 99,90", 1234.56.
 */
export function parsearPreco(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) && valor > 0 ? valor : null;
  if (typeof valor !== 'string') return null;

  let s = valor.replace(/[^\d.,-]/g, '').trim();
  if (!s) return null;

  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');

  if (temVirgula && temPonto) {
    // Assume formato BR: ponto = milhar, vírgula = decimal.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    s = s.replace(',', '.');
  }
  // só ponto: mantém (formato US/decimal)

  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Extrai o primeiro preço válido testando uma lista de caminhos candidatos. */
export function extrairPreco(item: unknown, caminhos: string[]): number | null {
  for (const c of caminhos) {
    const v = acessarCaminho(item, c);
    const preco = parsearPreco(v);
    if (preco !== null) return preco;
  }
  return null;
}

/** Extrai a primeira referência textual válida dentre os caminhos candidatos. */
export function extrairReferencia(item: unknown, caminhos: string[]): string | null {
  for (const c of caminhos) {
    const v = acessarCaminho(item, c);
    if (v != null && (typeof v === 'string' || typeof v === 'number')) {
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return null;
}

/** Extrai todos os valores monetários de um texto via regex (SCRAPING). */
export function extrairValoresPorRegex(texto: string, regex: string): number[] {
  let re: RegExp;
  try {
    re = new RegExp(regex, 'gi');
  } catch {
    return [];
  }
  const valores: number[] = [];
  for (const match of texto.matchAll(re)) {
    const preco = parsearPreco(match[0]);
    if (preco !== null) valores.push(preco);
  }
  return valores;
}
