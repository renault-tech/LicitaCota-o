'use client';
import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react';
import { apiUrl } from '@/lib/api';
import { getAccessToken } from '@/lib/api';
import type { ProgressoPesquisa } from '@/types/api';
import { cn } from '@/lib/utils';

interface Props {
  pesquisaId: string;
}

function AnimatedNumber({ value }: { value: number }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {value}
    </motion.span>
  );
}

export default function ProgressoSSE({ pesquisaId }: Props) {
  const router = useRouter();
  const [progresso, setProgresso] = useState<ProgressoPesquisa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);
  const confettiDone = useRef(false);

  useEffect(() => {
    const token = getAccessToken();
    const url = `${apiUrl(`/api/pesquisas/${pesquisaId}/progresso`)}`;

    // SSE com token no header não é suportado nativamente; usamos EventSource com URL + polling
    // Alternativa: fetch com ReadableStream
    const ctrl = new AbortController();

    async function connectSSE() {
      try {
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) { setErro('Falha ao conectar ao servidor.'); return; }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as ProgressoPesquisa;
                setProgresso(data);
                if (data.status === 'CONCLUIDA' || data.status === 'ERRO') {
                  if (data.status === 'CONCLUIDA' && !confettiDone.current) {
                    confettiDone.current = true;
                    const { default: confetti } = await import('canvas-confetti');
                    confetti({ particleCount: 80, spread: 60, origin: { y: 0.5 } });
                  }
                  setConcluido(true);
                  setTimeout(() => router.push(`/pesquisas/${pesquisaId}/resultado`), 1800);
                  return;
                }
              } catch { /* skip malformed */ }
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErro('Conexão perdida.');
      }
    }

    connectSSE();
    return () => ctrl.abort();
  }, [pesquisaId, router]);

  const total = progresso?.totalItens ?? 0;
  const processados = (progresso as unknown as { processados?: number })?.processados ?? 0;
  const pct = total > 0 ? Math.round((processados / total) * 100) : 0;

  return (
    <div className="max-w-lg mx-auto space-y-8">
      {/* Main status */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card text-center space-y-6"
      >
        {concluido && progresso?.status === 'CONCLUIDA' ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="flex flex-col items-center gap-3"
          >
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-zinc-900 dark:text-white">Pesquisa concluída!</p>
              <p className="text-sm text-zinc-500 mt-1">Redirecionando para o resultado…</p>
            </div>
          </motion.div>
        ) : progresso?.status === 'ERRO' ? (
          <div className="flex flex-col items-center gap-3">
            <XCircle className="w-12 h-12 text-red-500" />
            <p className="text-base font-medium text-red-600 dark:text-red-400">Erro no processamento</p>
          </div>
        ) : (
          <>
            <div className="flex justify-center">
              <div className="relative w-20 h-20">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-100 dark:text-zinc-800" />
                  <motion.circle
                    cx="40" cy="40" r="32" fill="none" strokeWidth="6"
                    stroke="url(#grad)"
                    strokeLinecap="round"
                    strokeDasharray={201}
                    initial={{ strokeDashoffset: 201 }}
                    animate={{ strokeDashoffset: 201 - (201 * pct) / 100 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                  <defs>
                    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#60a5fa" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold text-zinc-900 dark:text-white">{pct}%</span>
                </div>
              </div>
            </div>

            <div>
              <p className="text-base font-semibold text-zinc-900 dark:text-white flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                Processando pesquisa…
              </p>
              {(progresso as unknown as { itemAtual?: { nome: string } })?.itemAtual && (
                <motion.p
                  key={(progresso as unknown as { itemAtual?: { nome: string } })?.itemAtual?.nome}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-xs text-zinc-400 mt-1 truncate"
                >
                  Cotando: {(progresso as unknown as { itemAtual?: { nome: string } })?.itemAtual?.nome}
                </motion.p>
              )}
            </div>
          </>
        )}
      </motion.div>

      {/* Stats */}
      {progresso && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Cotados', value: progresso.itensComCotacao, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
            { label: 'Sem resultado', value: progresso.itensSemCotacao, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
            { label: 'Erros', value: progresso.itensComErro, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
          ].map((s) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn('rounded-2xl p-4 text-center', s.bg)}
            >
              <p className={cn('text-2xl font-bold', s.color)}>
                <AnimatedNumber value={s.value} />
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
            </motion.div>
          ))}
        </div>
      )}

      {erro && <p className="text-sm text-red-500 text-center">{erro}</p>}

      {!progresso && !erro && (
        <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
          <Zap className="w-4 h-4" />
          Aguardando início do processamento…
        </div>
      )}
    </div>
  );
}
