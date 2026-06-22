import type { ItemNormalizado } from '@licitapreco/shared';
import { prisma } from '../../config/prisma.js';
import { normalizarChave, removerAcentos } from '../../utils/texto.js';

/**
 * Normalização de descrições — a maior alavanca de taxa de acerto.
 * Pipeline: limpeza → expansão de abreviações → dicionário de sinônimos →
 * geração da estratégia de busca em cascata (do mais completo ao núcleo).
 */

export interface EntradaDicionario {
  termo: string;
  sinonimos: string[];
  expansoes: string[];
}

/** Abreviações comuns de compras públicas → forma expandida. */
const ABREVIACOES: Record<string, string> = {
  un: 'unidade',
  und: 'unidade',
  unid: 'unidade',
  cx: 'caixa',
  emb: 'embalagem',
  pct: 'pacote',
  pc: 'peca',
  pcs: 'pecas',
  ml: 'mililitros',
  l: 'litros',
  lt: 'litros',
  kg: 'quilograma',
  g: 'gramas',
  mt: 'metro',
  m: 'metro',
  cm: 'centimetro',
  mm: 'milimetro',
  resm: 'resma',
  fl: 'folhas',
  cj: 'conjunto',
  par: 'par',
  dz: 'duzia',
};

const STOPWORDS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'com',
  'sem',
  'para',
  'por',
  'e',
  'ou',
  'a',
  'o',
  'as',
  'os',
  'em',
  'no',
  'na',
  'tipo',
  'cor',
]);

/** Limpa ruído, padroniza caixa/espaços e remove pontuação excessiva. */
export function limpar(texto: string): string {
  return removerAcentos(texto)
    .toLowerCase()
    .replace(/[/\\|;:]+/g, ' ')
    .replace(/[^a-z0-9\s.,-]/g, ' ')
    .replace(/[.,-]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Expande abreviações token a token. */
export function expandirAbreviacoes(texto: string): string {
  return texto
    .split(' ')
    .map((tok) => {
      const limpo = tok.replace(/[.,]/g, '');
      return ABREVIACOES[limpo] ?? tok.replace(/[.,]/g, '');
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Aplica o dicionário: se algum termo do dicionário aparece na descrição,
 * anexa suas expansões (sem duplicar) ao final, melhorando a recuperação.
 */
export function aplicarDicionario(texto: string, dicionario: EntradaDicionario[]): string {
  let resultado = texto;
  const presentes = new Set(resultado.split(' '));
  for (const entrada of dicionario) {
    const termoNorm = normalizarChave(entrada.termo);
    const sinonimosNorm = entrada.sinonimos.map((s) => normalizarChave(s));
    const casa =
      resultado.includes(termoNorm) || sinonimosNorm.some((s) => s && resultado.includes(s));
    if (casa) {
      for (const exp of entrada.expansoes) {
        const expNorm = normalizarChave(exp);
        if (expNorm && !presentes.has(expNorm) && !resultado.includes(expNorm)) {
          resultado += ` ${expNorm}`;
          expNorm.split(' ').forEach((t) => presentes.add(t));
        }
      }
    }
  }
  return resultado.replace(/\s+/g, ' ').trim();
}

/**
 * Gera a cascata de buscas: completa → progressivamente mais curtas (núcleo).
 * Remove stopwords nas versões reduzidas, preservando a ordem dos termos.
 */
export function gerarCascata(textoCompleto: string): string[] {
  const cascata: string[] = [];
  const completo = textoCompleto.trim();
  if (completo) cascata.push(completo);

  const tokens = completo.split(' ').filter((t) => t && !STOPWORDS.has(t));
  if (tokens.length > 0) {
    const semStop = tokens.join(' ');
    if (semStop && !cascata.includes(semStop)) cascata.push(semStop);
  }

  // Núcleo: os 3 primeiros tokens significativos.
  if (tokens.length > 3) {
    const nucleo = tokens.slice(0, 3).join(' ');
    if (!cascata.includes(nucleo)) cascata.push(nucleo);
  }
  // Núcleo mínimo: 2 tokens.
  if (tokens.length > 2) {
    const min = tokens.slice(0, 2).join(' ');
    if (!cascata.includes(min)) cascata.push(min);
  }

  return cascata.length > 0 ? cascata : [completo];
}

/** Normalização pura (descrição + dicionário) → ItemNormalizado parcial. */
export function normalizarDescricao(
  descricao: string,
  dicionario: EntradaDicionario[],
): { descricaoNormalizada: string; cascata: string[] } {
  const limpo = limpar(descricao);
  const expandido = expandirAbreviacoes(limpo);
  const comDicionario = aplicarDicionario(expandido, dicionario);
  const cascata = gerarCascata(comDicionario);
  return { descricaoNormalizada: comDicionario, cascata };
}

/** Carrega o dicionário ativo do banco. */
export async function carregarDicionario(): Promise<EntradaDicionario[]> {
  const entradas = await prisma.dicionarioSinonimo.findMany({ where: { ativo: true } });
  return entradas.map((e) => ({
    termo: e.termo,
    sinonimos: Array.isArray(e.sinonimos) ? (e.sinonimos as string[]) : [],
    expansoes: Array.isArray(e.expansoes) ? (e.expansoes as string[]) : [],
  }));
}

/** Monta o ItemNormalizado completo a partir de um item de pesquisa cru. */
export function montarItemNormalizado(
  item: {
    nome: string;
    descricao: string;
    quantidade: number;
    unidadeMedida?: string | null;
    cidade?: string | null;
    uf?: string | null;
  },
  dicionario: EntradaDicionario[],
): ItemNormalizado {
  const base = `${item.nome} ${item.descricao}`.trim();
  const { descricaoNormalizada, cascata } = normalizarDescricao(base, dicionario);
  return {
    nome: item.nome,
    descricao: item.descricao,
    descricaoNormalizada,
    cascata,
    quantidade: item.quantidade,
    unidadeMedida: item.unidadeMedida ?? '',
    cidade: item.cidade ?? undefined,
    uf: item.uf ?? undefined,
  };
}
