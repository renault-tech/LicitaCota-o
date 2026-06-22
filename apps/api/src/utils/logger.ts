/* Logger simples com timestamp ISO e nível. Evita dependência extra. */

type Nivel = 'info' | 'warn' | 'error' | 'debug';

function escrever(nivel: Nivel, mensagem: string, meta?: unknown): void {
  const linha = `[${new Date().toISOString()}] [${nivel.toUpperCase()}] ${mensagem}`;
  if (meta !== undefined) {
    // eslint-disable-next-line no-console
    console[nivel === 'debug' ? 'log' : nivel](linha, meta);
  } else {
    // eslint-disable-next-line no-console
    console[nivel === 'debug' ? 'log' : nivel](linha);
  }
}

export const logger = {
  info: (m: string, meta?: unknown) => escrever('info', m, meta),
  warn: (m: string, meta?: unknown) => escrever('warn', m, meta),
  error: (m: string, meta?: unknown) => escrever('error', m, meta),
  debug: (m: string, meta?: unknown) => {
    if (process.env.NODE_ENV === 'development') escrever('debug', m, meta);
  },
};
