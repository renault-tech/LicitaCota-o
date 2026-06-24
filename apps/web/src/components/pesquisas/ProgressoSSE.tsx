'use client';
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2, Clock, Zap, TrendingUp, CheckCheck, AlertCircle } from 'lucide-react';
import { apiUrl, getAccessToken } from '@/lib/api';
import type { ProgressoPesquisa } from '@/types/api';
import { cn } from '@/lib/utils';

interface Props {
  pesquisaId: string;
}

interface ItemLog {
  nome: string;
  status: 'COTADO' | 'SEM_RESULTADO' | 'ERRO';
  ts: number;
}

function formatarTempo(segundos: number): string {
  if (segundos < 60) return `${segundos}s`;
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatarETA(segundos: number): string {
  const eta = new Date(Date.now() + segundos * 1000);
  return eta.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function StatusIcon({ status }: { status: ItemLog['status'] }) {
  if (status === 'COTADO') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (status === 'SEM_RESULTADO') return <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
}

export default function ProgressoSSE({ pesquisaId }: Props) {
  const router = useRouter();
  const [progresso, setProgresso] = useState<ProgressoPesquisa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);
  const [itemLog, setItemLog] = useState<ItemLog[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const inicioRef = useRef<number>(Date.now());
  const confettiDone = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer de elapsed
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - inicioRef.current) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    const url = apiUrl(`/api/pesquisas/${pesquisaId}/progresso`);
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
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6)) as ProgressoPesquisa;
              setProgresso(data);

              // Acumula log dos últimos 8 itens processados
              if (data.itemAtual) {
                setItemLog((prev) => {
                  const next = [
                    { nome: data.itemAtual!.nome, status: data.itemAtual!.statusItem as ItemLog['status'], ts: Date.now() },
                    ...prev,
                  ].slice(0, 8);
                  return next;
                });
              }

              if (data.status === 'CONCLUIDA' || data.status === 'ERRO') {
                if (timerRef.current) clearInterval(timerRef.current);
                if (data.status === 'CONCLUIDA' && !confettiDone.current) {
                  confettiDone.current = true;
                  const { default: confetti } = await import('canvas-confetti');
                  confetti({ particleCount: 100, spread: 70, origin: { y: 0.5 } });
                }
                setConcluido(true);
                setTimeout(() => router.push(`/pesquisas/${pesquisaId}/resultado`), 2000);
                return;
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErro('Conexão perdida. Recarregue a página.');
      }
    }

    connectSSE();
    return () => ctrl.abort();
  }, [pesquisaId, router]);

  const total = progresso?.totalItens ?? 0;
  const processados = progresso?.processados ?? 0;
  const pct = total > 0 ? Math.round((processados / total) * 100) : 0;
  const restante = progresso?.tempoEstimadoSegundos;
  const velocidade = elapsed > 0 ? Math.round((processados / elapsed) * 60 * 10) / 10 : 0;

  if (concluido && progresso?.status === 'CONCLUIDA') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-lg mx-auto card text-center space-y-4 py-12"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto"
        >
          <CheckCheck className="w-10 h-10 text-emerald-500" />
        </motion.div>
        <div>
          <p className="text-xl font-bold text-zinc-900 dark:text-white">Pesquisa concluída!</p>
          <p className="text-sm text-zinc-500 mt-1">
            {progresso.itensComCotacao} cotados · {progresso.itensSemCotacao} sem resultado · {progresso.itensComErro} erros
          </p>
          <p className="text-xs text-zinc-400 mt-1">Redirecionando…</p>
        </div>
      </motion.div>
    );
  }

  if (progresso?.status === 'ERRO') {
    return (
      <div className="max-w-lg mx-auto card text-center space-y-4 py-10">
        <XCircle className="w-14 h-14 text-red-500 mx-auto" />
        <p className="text-base font-semibold text-red-600 dark:text-red-400">Erro no processamento</p>
        <p className="text-sm text-zinc-500">Verifique os logs ou tente novamente.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Card principal */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card space-y-5"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Processando pesquisa</span>
          </div>
          <span className="text-xs text-zinc-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {formatarTempo(elapsed)} decorrido
          </span>
        </div>

        {/* Barra de progresso principal */}
        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <span className="text-3xl font-bold text-zinc-900 dark:text-white tabular-nums">
              {processados}
              <span className="text-base font-normal text-zinc-400">/{total}</span>
            </span>
            <span className="text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{pct}%</span>
          </div>

          <div className="w-full h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 to-indigo-500"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>

          <div className="flex justify-between text-xs text-zinc-400">
            <span>{total - processados} restantes</span>
            {restante !== undefined && restante > 0 ? (
              <span>≈ {formatarTempo(restante)} restante · conclui ~{formatarETA(restante)}</span>
            ) : processados > 0 ? (
              <span>calculando…</span>
            ) : null}
          </div>
        </div>

        {/* Métricas em linha */}
        <div className="grid grid-cols-4 gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
          {[
            { label: 'Cotados', value: progresso?.itensComCotacao ?? 0, color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Sem resultado', value: progresso?.itensSemCotacao ?? 0, color: 'text-amber-600 dark:text-amber-400' },
            { label: 'Erros', value: progresso?.itensComErro ?? 0, color: 'text-red-600 dark:text-red-400' },
            { label: 'Itens/min', value: velocidade, color: 'text-blue-600 dark:text-blue-400', icon: TrendingUp },
          ].map((s) => (
            <div key={s.label} className="text-center py-2">
              <div className={cn('text-xl font-bold tabular-nums', s.color)}>
                {'icon' in s && s.icon ? (
                  <span className="flex items-center justify-center gap-1">
                    <Zap className="w-3.5 h-3.5" />
                    {s.value}
                  </span>
                ) : (
                  <motion.span key={s.value} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                    {s.value}
                  </motion.span>
                )}
              </div>
              <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Log de itens recentes */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="card space-y-2"
      >
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Itens processados recentemente</p>

        {itemLog.length === 0 && !progresso && (
          <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
            <Zap className="w-4 h-4" />
            Aguardando início do processamento…
          </div>
        )}

        {itemLog.length === 0 && progresso && (
          <p className="text-xs text-zinc-400 py-2">Processando primeiro item…</p>
        )}

        <AnimatePresence initial={false}>
          {itemLog.map((it, i) => (
            <motion.div
              key={it.ts}
              initial={{ opacity: 0, x: -8, height: 0 }}
              animate={{ opacity: 1, x: 0, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                'flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg',
                i === 0
                  ? 'bg-zinc-50 dark:bg-zinc-800/60'
                  : 'text-zinc-400',
              )}
            >
              <StatusIcon status={it.status} />
              <span className={cn('flex-1 truncate', i === 0 ? 'text-zinc-700 dark:text-zinc-200 font-medium' : '')}>
                {it.nome}
              </span>
              <span className={cn(
                'shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                it.status === 'COTADO' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                it.status === 'SEM_RESULTADO' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              )}>
                {it.status === 'COTADO' ? 'cotado' : it.status === 'SEM_RESULTADO' ? 'sem dado' : 'erro'}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {erro && (
        <p className="text-sm text-red-500 text-center bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">{erro}</p>
      )}
    </div>
  );
}
