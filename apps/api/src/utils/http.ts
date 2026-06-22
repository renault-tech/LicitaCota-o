/**
 * Cliente HTTP com timeout e retries, usando o fetch nativo do Node 18+.
 */

export interface RespostaHttp {
  ok: boolean;
  status: number;
  corpoTexto: string;
  corpoJson: unknown;
  latenciaMs: number;
}

export interface OpcoesHttp {
  metodo?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  pausaMs?: number;
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function requisitar(url: string, opcoes: OpcoesHttp = {}): Promise<RespostaHttp> {
  const { metodo = 'GET', headers = {}, timeoutMs = 15000, retries = 2 } = opcoes;
  let ultimoErro: unknown;

  for (let tentativa = 0; tentativa <= retries; tentativa++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const inicio = Date.now();
    try {
      const resp = await fetch(url, {
        method: metodo,
        headers: { Accept: 'application/json, text/html', ...headers },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latenciaMs = Date.now() - inicio;
      const corpoTexto = await resp.text();
      let corpoJson: unknown = null;
      try {
        corpoJson = corpoTexto ? JSON.parse(corpoTexto) : null;
      } catch {
        corpoJson = null;
      }
      return { ok: resp.ok, status: resp.status, corpoTexto, corpoJson, latenciaMs };
    } catch (e) {
      clearTimeout(timer);
      ultimoErro = e;
      const ehTimeout = e instanceof Error && e.name === 'AbortError';
      // Só faz retry em timeout/erro de rede; respeita pausa configurada.
      if (tentativa < retries && (ehTimeout || true)) {
        await dormir(opcoes.pausaMs ?? 500);
        continue;
      }
    }
  }

  const msg =
    ultimoErro instanceof Error && ultimoErro.name === 'AbortError'
      ? `Tempo de resposta excedido (timeout de ${timeoutMs}ms)`
      : ultimoErro instanceof Error
        ? ultimoErro.message
        : 'Erro de rede desconhecido';
  throw new Error(msg);
}

/** Substitui placeholders {chave} em um template de string. */
export function aplicarPlaceholders(
  template: string,
  valores: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_m, chave: string) => valores[chave] ?? '');
}

export function montarQueryString(params: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.append(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}
