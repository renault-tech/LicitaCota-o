'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, ToggleLeft, ToggleRight, Database, Loader2, Globe, Table } from 'lucide-react';
import { toast } from 'sonner';
import { useFontes, useTestarFonte, useAtivarFonte } from '@/lib/queries';
import { FonteBadge } from '@/components/common/StatusBadge';
import EmptyState from '@/components/common/EmptyState';
import { formatDate, cn } from '@/lib/utils';
import type { TipoFonte } from '@/types/api';

const TIPO_ICON = { API_REST: Globe, SCRAPING: Zap, TABELA_REFERENCIA: Table };
const TIPO_LABEL: Record<TipoFonte, string> = { API_REST: 'API REST', SCRAPING: 'Scraping', TABELA_REFERENCIA: 'Tabela' };

export default function FontesPage() {
  const { data: fontes, isLoading } = useFontes();
  const testar = useTestarFonte();
  const ativar = useAtivarFonte();
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string; latencia: number }>>({});
  const [testando, setTestando] = useState<string | null>(null);

  async function handleTestar(id: string) {
    setTestando(id);
    try {
      const res = await testar.mutateAsync(id);
      const r = res.resultado;
      setTestResults((prev) => ({ ...prev, [id]: { ok: r.ok, msg: r.mensagem, latencia: r.latenciaMs } }));
      toast[r.ok ? 'success' : 'error'](r.ok ? `Fonte OK — ${r.latenciaMs}ms` : r.mensagem);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao testar');
    } finally {
      setTestando(null);
    }
  }

  async function handleAtivar(id: string, ativo: boolean) {
    await ativar.mutateAsync({ id, ativo });
    toast.success(ativo ? 'Fonte ativada' : 'Fonte desativada');
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Fontes de Cotação</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Configure as fontes consultadas durante o processamento</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="card animate-pulse h-40" />)}
        </div>
      ) : !fontes?.length ? (
        <EmptyState icon={Database} title="Nenhuma fonte cadastrada" description="Adicione fontes para habilitar o motor de cotação." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fontes.map((fonte, i) => {
            const Icon = TIPO_ICON[fonte.tipo];
            const testRes = testResults[fonte.id];
            const isTesting = testando === fonte.id;

            return (
              <motion.div
                key={fonte.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="card hover:shadow-lg transition-shadow duration-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-blue-500" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-zinc-900 dark:text-white truncate">{fonte.nome}</p>
                      <p className="text-xs text-zinc-400 truncate">{fonte.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{TIPO_LABEL[fonte.tipo]}</span>
                    <FonteBadge status={fonte.statusValidacao} />
                  </div>
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleTestar(fonte.id)}
                      disabled={isTesting}
                      className="btn-ghost text-xs px-3 py-1.5"
                    >
                      {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                      Testar
                    </button>
                    {testRes && (
                      <span className={cn('text-xs', testRes.ok ? 'text-emerald-500' : 'text-red-500')}>
                        {testRes.ok ? `✓ ${testRes.latencia}ms` : `✗ ${testRes.msg.slice(0, 30)}`}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleAtivar(fonte.id, !fonte.ativo)}
                    className={cn('flex items-center gap-1.5 text-xs font-medium transition-colors', fonte.ativo ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400')}
                  >
                    {fonte.ativo ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                    {fonte.ativo ? 'Ativa' : 'Inativa'}
                  </button>
                </div>

                {fonte.ultimoTesteEm && (
                  <p className="text-[10px] text-zinc-300 dark:text-zinc-600 mt-1">Último teste: {formatDate(fonte.ultimoTesteEm)}</p>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </>
  );
}
