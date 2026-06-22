'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, ChevronDown, ChevronRight, Search, Filter } from 'lucide-react';
import { useAuditoria } from '@/lib/queries';
import EmptyState from '@/components/common/EmptyState';
import { formatDate, cn } from '@/lib/utils';
import type { LogAuditoria } from '@/types/api';

const ACAO_COLORS: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  UPDATE: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  DELETE: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  LOGIN: 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400',
  LOGOUT: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  PROCESS: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  DOWNLOAD: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400',
};

function acaoColor(acao: string) {
  const key = Object.keys(ACAO_COLORS).find((k) => acao.toUpperCase().startsWith(k));
  return key ? ACAO_COLORS[key] : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
}

function LogRow({ log }: { log: LogAuditoria }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = log.detalhe != null;

  return (
    <div>
      <button
        onClick={() => hasDetail && setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors',
          !hasDetail && 'cursor-default',
        )}
      >
        <div className="flex-shrink-0 w-4">
          {hasDetail ? (
            expanded
              ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
          ) : null}
        </div>

        <div className="flex-1 grid grid-cols-12 gap-3 items-center text-xs">
          <div className="col-span-2">
            <span className={cn('px-2 py-0.5 rounded-full font-medium', acaoColor(log.acao))}>
              {log.acao}
            </span>
          </div>
          <div className="col-span-3 text-zinc-700 dark:text-zinc-300 truncate">
            {log.entidade ?? '—'}
            {log.entidadeId && <span className="text-zinc-400 ml-1">#{log.entidadeId.slice(0, 8)}</span>}
          </div>
          <div className="col-span-3 text-zinc-500 truncate">
            {log.user?.nome ?? log.userId ?? 'Sistema'}
          </div>
          <div className="col-span-2 text-zinc-400 hidden sm:block truncate">
            {log.ip ?? '—'}
          </div>
          <div className="col-span-2 text-zinc-400 text-right whitespace-nowrap">
            {formatDate(log.createdAt)}
          </div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mx-5 mb-3 rounded-xl bg-zinc-950 dark:bg-black p-4 overflow-x-auto">
              <pre className="text-[11px] text-emerald-400 leading-relaxed whitespace-pre-wrap">
                {JSON.stringify(log.detalhe, null, 2)}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AuditoriaPage() {
  const [pagina, setPagina] = useState(1);
  const [busca, setBusca] = useState('');
  const [filtroAcao, setFiltroAcao] = useState('');
  const [filtroEntidade, setFiltroEntidade] = useState('');

  const { data, isLoading } = useAuditoria(pagina);

  const logs = data?.logs ?? [];

  const filtered = logs.filter((l) => {
    if (filtroAcao && !l.acao.toLowerCase().includes(filtroAcao.toLowerCase())) return false;
    if (filtroEntidade && !l.entidade?.toLowerCase().includes(filtroEntidade.toLowerCase())) return false;
    if (busca) {
      const q = busca.toLowerCase();
      return (
        l.acao.toLowerCase().includes(q) ||
        l.entidade?.toLowerCase().includes(q) ||
        l.user?.nome?.toLowerCase().includes(q) ||
        l.ip?.includes(q) ||
        false
      );
    }
    return true;
  });

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Auditoria</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Registro de todas as ações no sistema</p>
        </div>
        {data && (
          <span className="text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-3 py-1 rounded-full">
            {data.total} registros
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Buscar nos logs…"
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
            className="input pl-9"
          />
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
            <input
              placeholder="Ação"
              value={filtroAcao}
              onChange={(e) => { setFiltroAcao(e.target.value); setPagina(1); }}
              className="input pl-8 w-28 text-sm"
            />
          </div>
          <input
            placeholder="Entidade"
            value={filtroEntidade}
            onChange={(e) => { setFiltroEntidade(e.target.value); setPagina(1); }}
            className="input w-32 text-sm"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="card animate-pulse h-12" />)}</div>
      ) : !filtered.length ? (
        <EmptyState icon={Shield} title="Nenhum log encontrado" description="Os eventos do sistema aparecerão aqui." />
      ) : (
        <>
          <div className="card p-0 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-12 gap-3 px-8 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              <div className="col-span-2">Ação</div>
              <div className="col-span-3">Entidade</div>
              <div className="col-span-3">Usuário</div>
              <div className="col-span-2 hidden sm:block">IP</div>
              <div className="col-span-2 text-right">Data</div>
            </div>

            {filtered.map((log, i) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                className={i > 0 ? 'border-t border-zinc-100 dark:border-zinc-800' : ''}
              >
                <LogRow log={log} />
              </motion.div>
            ))}
          </div>

          {/* Pagination */}
          {data && data.total > 25 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-zinc-400">
                Mostrando {(pagina - 1) * 25 + 1}–{Math.min(pagina * 25, data.total)} de {data.total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={pagina === 1}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPagina((p) => p + 1)}
                  disabled={pagina * 25 >= data.total}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
