'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Calendar, FileSpreadsheet, MapPin, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PesquisaBadge } from '@/components/common/StatusBadge';
import { useDeletePesquisa } from '@/lib/queries';
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
  const deletar = useDeletePesquisa();

  const pct = pesquisa.totalItens > 0
    ? Math.round((pesquisa.itensComCotacao / pesquisa.totalItens) * 100)
    : 0;
  const mostrarProgresso = pesquisa.status === 'PROCESSANDO' || pesquisa.status === 'CONCLUIDA';

  async function handleExcluir(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Excluir "${pesquisa.titulo}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await deletar.mutateAsync(pesquisa.id);
      toast.success('Pesquisa excluída.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir');
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3, delay: index * 0.03, ease: 'easeOut' }}
      whileHover={{ y: -2 }}
      onClick={() => router.push(`/pesquisas/${pesquisa.id}`)}
      className={cn(
        'card p-3.5 cursor-pointer group transition-shadow duration-200',
        'hover:shadow-lg hover:shadow-zinc-200/60 dark:hover:shadow-black/40',
        STATUS_RING[pesquisa.status],
      )}
    >
      {/* Título + badge + excluir */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-sm text-zinc-900 dark:text-white truncate min-w-0 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {pesquisa.titulo}
        </h3>
        <div className="flex items-center gap-1 flex-shrink-0">
          <PesquisaBadge status={pesquisa.status} />
          <button
            onClick={handleExcluir}
            disabled={deletar.isPending}
            title="Excluir pesquisa"
            className="w-6 h-6 flex items-center justify-center rounded-full text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-100"
          >
            {deletar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Stats compactas em linha */}
      <div className="flex items-center gap-2.5 text-xs text-zinc-500 mb-2">
        <span>{pesquisa.totalItens} {pesquisa.totalItens === 1 ? 'item' : 'itens'}</span>
        <span className="text-zinc-200 dark:text-zinc-700">•</span>
        <span className="text-emerald-600 dark:text-emerald-400">{pesquisa.itensComCotacao} cotados</span>
        {pesquisa.itensSemCotacao > 0 && (
          <>
            <span className="text-zinc-200 dark:text-zinc-700">•</span>
            <span className="text-amber-600 dark:text-amber-400">{pesquisa.itensSemCotacao} pendentes</span>
          </>
        )}
      </div>

      {/* Barra de progresso fina */}
      {mostrarProgresso && (
        <div className="h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden mb-2">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: index * 0.03 + 0.15 }}
            className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600"
          />
        </div>
      )}

      {/* Rodapé: local, data, valor */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          {(pesquisa.municipio || pesquisa.uf) && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <MapPin className="w-3 h-3" />
              {[pesquisa.municipio, pesquisa.uf].filter(Boolean).join('/')}
            </span>
          )}
          <span className="flex items-center gap-1 flex-shrink-0">
            <Calendar className="w-3 h-3" />
            {formatDateShort(pesquisa.createdAt)}
          </span>
          {pesquisa.valorTotalEstimado && (
            <span className="flex items-center gap-1 truncate">
              <FileSpreadsheet className="w-3 h-3 flex-shrink-0" />
              {formatCurrency(pesquisa.valorTotalEstimado)}
            </span>
          )}
        </div>
        <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
      </div>
    </motion.div>
  );
}
