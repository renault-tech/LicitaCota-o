import { env } from '../../config/env.js';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { normalizarChave } from '../../utils/texto.js';

/**
 * Fallback opcional de resolução de código de catálogo via catmat.com.br —
 * um site de TERCEIRO (não é do governo, sem SLA), usado só quando o
 * catálogo oficial sincronizado localmente não acha nenhum candidato para
 * um item. Nunca substitui a consulta de preço: só sugere um código, que
 * ainda precisa ser confirmado contra a API oficial do Compras.gov.br antes
 * de virar um preço de verdade (ver comprasGov.adapter.ts).
 *
 * Desligado por padrão via CATMAT_FALLBACK_HABILITADO — os nomes de campo
 * da resposta não puderam ser confirmados contra a API real neste ambiente
 * de desenvolvimento (sem acesso à internet). Só ativar depois de validar
 * manualmente contra tráfego real de produção.
 */

const BASE = 'https://catmat.com.br/api/v1';

export interface CandidatoExterno {
  codigo: number;
  descricaoCatalogo: string;
}

interface RespostaItem {
  codigo_item?: unknown;
  codigo?: unknown;
  descricao_item?: unknown;
  descricao?: unknown;
}

function extrairPrimeiroItem(corpo: unknown): RespostaItem | null {
  if (Array.isArray(corpo)) return (corpo[0] as RespostaItem) ?? null;
  const obj = corpo as { resultado?: unknown; data?: unknown; itens?: unknown } | null;
  if (!obj) return null;
  for (const chave of ['resultado', 'data', 'itens'] as const) {
    const lista = obj[chave];
    if (Array.isArray(lista)) return (lista[0] as RespostaItem) ?? null;
  }
  return null;
}

/**
 * Busca um único candidato de código no catmat.com.br. Nunca lança — falha
 * de rede, timeout, HTTP não-2xx ou formato inesperado sempre viram `null`,
 * exatamente como "nenhum candidato encontrado" no caminho local.
 */
export async function buscarCandidatoExterno(descricaoItem: string): Promise<CandidatoExterno | null> {
  if (env.CATMAT_FALLBACK_HABILITADO !== 'true') return null;

  try {
    const termo = normalizarChave(descricaoItem);
    if (!termo) return null;

    const url = `${BASE}/search?q=${encodeURIComponent(termo)}`;
    const resp = await requisitar(url, { timeoutMs: 5000, retries: 0 });
    if (!resp.ok) return null;

    const item = extrairPrimeiroItem(resp.corpoJson);
    if (!item) return null;

    const codigoRaw = item.codigo_item ?? item.codigo;
    const codigo = Number.parseInt(String(codigoRaw ?? ''), 10);
    const descricao = String(item.descricao_item ?? item.descricao ?? '').trim();
    if (!Number.isFinite(codigo) || !descricao) return null;

    return { codigo, descricaoCatalogo: descricao };
  } catch (e) {
    logger.warn('catmat.com.br: fallback indisponível', e);
    return null;
  }
}
