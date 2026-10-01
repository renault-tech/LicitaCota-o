import { requisitar, type RespostaHttp } from '../../utils/http.js';

/**
 * Todas as chamadas a dadosabertos.compras.gov.br (Painel de Preços e Atas)
 * passam por aqui. A API devolve HTTP 429 com poucas requisições
 * simultâneas — confirmado no teste ponta a ponta: com ~12 em paralelo,
 * itens inteiros passaram a falhar. Como o worker processa vários itens ao
 * mesmo tempo, o limite precisa ser global ao processo, não por item.
 */
const MAX_SIMULTANEAS = 4;
const TENTATIVAS_429 = 4;
const ESPERA_BASE_MS = 1500;

let ativas = 0;
const fila: Array<() => void> = [];

async function comVaga<T>(fn: () => Promise<T>): Promise<T> {
  if (ativas >= MAX_SIMULTANEAS) await new Promise<void>((r) => fila.push(r));
  ativas++;
  try {
    return await fn();
  } finally {
    ativas--;
    fila.shift()?.();
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function requisitarComprasGov(
  url: string,
  opcoes: { timeoutMs: number; retries: number },
): Promise<RespostaHttp> {
  for (let tentativa = 0; ; tentativa++) {
    const resp = await comVaga(() => requisitar(url, opcoes));
    if (resp.status !== 429 || tentativa >= TENTATIVAS_429) return resp;
    // Espera fora da vaga, para não bloquear as outras requisições da fila.
    await dormir(ESPERA_BASE_MS * 2 ** tentativa + Math.random() * 500);
  }
}
