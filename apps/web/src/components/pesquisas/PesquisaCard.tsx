'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Calendar, FileSpreadsheet, MapPin } from 'lucide-react';
import { PesquisaBadge } from '@/components/common/StatusBadge';
import { formatDateShort, formatCurrency, cn } from '@/lib/utils';
import type { Pesquisa } from '@/types/api';

const STATUS_RING: Record<string, string> = {
  AGUARDANDO:  '',
  PROCESSANDO: 'ring-1 ring-blue-300 dark:ring-blue-800',
  CONCLUIDA:   'ring-1 ring-emerald-300 dark:ring-emerald-800',
  ERRO:        'ring-1 ring-red-300 dark:ring-red-800',
};

interface Props {
  pesquisa: Pesquisa;
  index?: number;
}

export default function PesquisaCard({ pesquisa, index = 0 }: Props) {
  const router = useRouter();

  const pct = pesquisa.totalItens > 0
    ? Math.round((pesquisa.itensComCotacao / pesquisa.totalItens) * 100)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: 'easeOut' }}
      whileHover={{ y: -4, scale: 1.015, rotateX: -2, rotateY: 2 }}
      whileTap={{ scale: 0.98 }}
      style={{ transformStyle: 'preserve-3d', perspective: 1000 }}
      onClick={() => router.push(`/pesquisas/${pesquisa.id}`)}
      className={cn(
        'card cursor-pointer group transition-shadow duration-300',
        'hover:shadow-xl hover:shadow-zinc-200/60 dark:hover:shadow-black/40',
        STATUS_RING[pesquisa.status],
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-zinc-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {pesquisa.titulo}
          </h3>
          {pesquisa.descricao && (
            <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{pesquisa.descricao}</p>
          )}
        </div>
        <PesquisaBadge status={pesquisa.status} className="flex-shrink-0" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Total', value: pesquisa.totalItens, color: 'text-zinc-600 dark:text-zinc-400' },
          { label: 'Cotados', value: pesquisa.itensComCotacao, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Pendentes', value: pesquisa.itensSemCotacao, color: 'text-amber-600 dark:text-amber-400' },
        ].map((s) => (
          <div key={s.label} className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-2.5 text-center">
            <p className={cn('text-lg font-bold leading-none', s.color)}>{s.value}</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {pesquisa.status === 'PROCESSANDO' || pesquisa.status === 'CONCLUIDA' ? (
        <div className="mb-4">
          <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
            <span>Cobertura</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: index * 0.04 + 0.2 }}
              className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600"
            />
          </div>
        </div>
      ) : null}

      {/* Footer */}
      <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-3 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          {(pesquisa.municipio || pesquisa.uf) && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {[pesquisa.municipio, pesquisa.uf].filter(Boolean).join('/')}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {formatDateShort(pesquisa.createdAt)}
          </span>
          {pesquisa.valorTotalEstimado && (
            <span className="flex items-center gap-1">
              <FileSpreadsheet className="w-3 h-3" />
              {formatCurrency(pesquisa.valorTotalEstimado)}
            </span>
          )}
        </div>
        <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
      </div>
    </motion.div>
  );
}
