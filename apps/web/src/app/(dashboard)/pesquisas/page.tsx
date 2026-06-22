'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, FileSearch } from 'lucide-react';
import { usePesquisas } from '@/lib/queries';
import PesquisaCard from '@/components/pesquisas/PesquisaCard';
import NovaPesquisaModal from '@/components/pesquisas/NovaPesquisaModal';
import EmptyState from '@/components/common/EmptyState';
import { cn } from '@/lib/utils';
import type { StatusPesquisa } from '@/types/api';

const FILTROS: Array<{ label: string; value: StatusPesquisa | '' }> = [
  { label: 'Todas', value: '' },
  { label: 'Aguardando', value: 'AGUARDANDO' },
  { label: 'Processando', value: 'PROCESSANDO' },
  { label: 'Concluídas', value: 'CONCLUIDA' },
  { label: 'Com erro', value: 'ERRO' },
];

export default function PesquisasPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [filtro, setFiltro] = useState<StatusPesquisa | ''>('');
  const [pagina, setPagina] = useState(1);

  const { data, isLoading } = usePesquisas(pagina, filtro || undefined);

  return (
    <>
      {/* Filter pills */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {FILTROS.map((f) => (
          <motion.button
            key={f.value}
            whileTap={{ scale: 0.96 }}
            onClick={() => { setFiltro(f.value as StatusPesquisa | ''); setPagina(1); }}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
              filtro === f.value
                ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
            )}
          >
            {f.label}
          </motion.button>
        ))}

        <button
          onClick={() => setModalOpen(true)}
          className="btn-primary ml-auto"
        >
          <Plus className="w-4 h-4" /> Nova pesquisa
        </button>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-44">
              <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-full w-3/4 mb-3" />
              <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full w-1/2 mb-4" />
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((j) => <div key={j} className="h-14 bg-zinc-100 dark:bg-zinc-800 rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
      ) : !data?.pesquisas?.length ? (
        <EmptyState
          icon={FileSearch}
          title="Nenhuma pesquisa encontrada"
          description="Crie sua primeira pesquisa de preços para começar."
          action={
            <button onClick={() => setModalOpen(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> Nova pesquisa
            </button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.pesquisas.map((p, i) => (
              <PesquisaCard key={p.id} pesquisa={p} index={i} />
            ))}
          </div>

          {/* Pagination */}
          {data.total > data.limite && (
            <div className="flex justify-center gap-2 mt-8">
              <button
                disabled={pagina === 1}
                onClick={() => setPagina((p) => p - 1)}
                className="btn-secondary px-4"
              >
                Anterior
              </button>
              <span className="px-4 py-2 text-sm text-zinc-500">
                {pagina} / {Math.ceil(data.total / data.limite)}
              </span>
              <button
                disabled={pagina >= Math.ceil(data.total / data.limite)}
                onClick={() => setPagina((p) => p + 1)}
                className="btn-secondary px-4"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}

      <NovaPesquisaModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {/* FAB mobile */}
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => setModalOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-blue-500 text-white shadow-xl shadow-blue-500/40 flex items-center justify-center sm:hidden"
      >
        <Plus className="w-6 h-6" />
      </motion.button>
    </>
  );
}
