const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

let _accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

// Chamadas concorrentes que recebem 401 ao mesmo tempo (ex.: a tela de
// Fontes busca fontes + notificações em paralelo) não podem cada uma
// disparar seu próprio /api/auth/refresh: o backend ROTACIONA o refresh
// token a cada troca bem-sucedida, então a segunda chamada — que ainda usa
// o token antigo lido do localStorage antes da primeira terminar — é
// rejeitada pelo servidor, e isso força um logout mesmo com sessão válida.
// Compartilhar uma única promise em andamento entre todas as chamadas
// concorrentes elimina essa corrida.
let refreshEmAndamento: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (refreshEmAndamento) return refreshEmAndamento;
  refreshEmAndamento = executarRefresh().finally(() => {
    refreshEmAndamento = null;
  });
  return refreshEmAndamento;
}

async function executarRefresh(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem('licitapreco-auth');
  if (!stored) return null;
  const { state } = JSON.parse(stored) as { state: { refreshToken?: string } };
  if (!state?.refreshToken) return null;

  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: state.refreshToken }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { accessToken: string; refreshToken: string };

  // Update stored tokens
  const { useAuthStore } = await import('./auth');
  useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
  setAccessToken(data.accessToken);
  return data.accessToken;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const { skipAuth, ...init } = options;

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };

  if (!skipAuth && _accessToken) {
    headers['Authorization'] = `Bearer ${_accessToken}`;
  }
  if (!(init.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  let res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 401 && !skipAuth) {
    const newToken = await tryRefresh();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(`${BASE}${path}`, { ...init, headers });
    } else {
      const { useAuthStore } = await import('./auth');
      useAuthStore.getState().logout();
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new Error('Sessão expirada. Por favor, faça login novamente.');
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ erro: res.statusText })) as { erro?: string; message?: string };
    throw new Error(body.erro ?? body.message ?? `Erro ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}
