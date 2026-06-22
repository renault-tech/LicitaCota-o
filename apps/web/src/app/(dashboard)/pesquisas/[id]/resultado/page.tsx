'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { usePesquisa } from '@/lib/queries';
import { getAccessToken, apiUrl } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PesquisaBadge } from '@/components/common/StatusBadge';
import { cn } from '@/lib/utils';

export default function ResultadoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: pesquisa, isLoading } = usePesquisa(id);

  function handleDownload() {
    const token = getAccessToken();
    fetch(apiUrl(`/api/pesquisas/${id}/resultado/planilha`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cotacao-${pesquisa?.titulo?.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30) ?? 'resultado'}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => alert('Erro ao baixar planilha'));
  }

  if (isLoading) return <div className="animate-pulse space-y-4 max-w-2xl mx-auto"><div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded-full w-1/2" /><div className="card h-48" /></div>;
  if (!pesquisa) return null;

  const pct = pesquisa.totalItens > 0 ? Math.round((pesquisa.itensComCotacao / pesquisa.totalItens) * 100) : 0;

  const stats = [
    { icon: CheckCircle2, label: 'Cotados', value: pesquisa.itensComCotacao, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    { icon: AlertCircle, label: 'Sem resultado', value: pesquisa.itensSemCotacao, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
    { icon: XCircle, label: 'Com erro', value: pesquisa.itensComErro, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/pesquisas/${id}`)} className="btn-ghost w-8 h-8 p-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">{pesquisa.titulo}</h2>
            <PesquisaBadge status={pesquisa.status} />
          </div>
          <p className="text-xs text-zinc-400">Concluída em {formatDate(pesquisa.concluidaEm)}</p>
        </div>
      </div>

      {/* Download hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="card bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 ring-1 ring-blue-100 dark:ring-blue-800"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-white">Banco de Preços gerado</h3>
            <p className="text-sm text-zinc-500 mt-0.5">Planilha .xlsx com metodologia formal (Lei 14.133/2021)</p>
          </div>
          <button onClick={handleDownload} className="btn-primary gap-2 flex-shrink-0">
            <Download className="w-4 h-4" /> Baixar planilha
          </button>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(({ icon: Icon, label, value, color, bg }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn('rounded-2xl p-5 text-center', bg)}
          >
            <Icon className={cn('w-6 h-6 mx-auto mb-2', color)} />
            <p className={cn('text-3xl font-bold', color)}>{value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
          </motion.div>
        ))}
      </div>

      {/* Coverage bar */}
      <div className="card">
        <div className="flex justify-between text-sm mb-3">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Cobertura da pesquisa</span>
          <span className="font-bold text-zinc-900 dark:text-white">{pct}%</span>
        </div>
        <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
            className="h-full rounded-full bg-gradient-to-r from-blue-400 to-emerald-500"
          />
        </div>
        {pesquisa.resumoCobertura && (
          <p className="text-xs text-zinc-400 mt-2">{pesquisa.resumoCobertura}</p>
        )}
      </div>

      {/* Total value */}
      {pesquisa.valorTotalEstimado && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card flex items-center justify-between">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Valor total estimado</span>
          <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatCurrency(pesquisa.valorTotalEstimado)}</span>
        </motion.div>
      )}
    </div>
  );
}
