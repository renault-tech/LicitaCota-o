'use client';
import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Upload, Play, Download, Pencil, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { usePesquisa, useProcessarPesquisa } from '@/lib/queries';
import { apiFetch, apiUrl } from '@/lib/api';
import { getAccessToken } from '@/lib/api';
import { PesquisaBadge, ItemBadge } from '@/components/common/StatusBadge';
import UploadZone from '@/components/pesquisas/UploadZone';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { ResultadoLeitura, ItemPlanilhaEntrada } from '@/types/api';
import { cn } from '@/lib/utils';

type Tab = 'visao-geral' | 'upload' | 'itens';

export default function PesquisaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: pesquisa, isLoading, refetch } = usePesquisa(id);
  const processar = useProcessarPesquisa(id);
  const [tab, setTab] = useState<Tab>('visao-geral');
  const [preview, setPreview] = useState<ResultadoLeitura | null>(null);
  const [confirmandoItens, setConfirmandoItens] = useState(false);
  const [itensEditados, setItensEditados] = useState<ItemPlanilhaEntrada[]>([]);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  function handlePreview(r: ResultadoLeitura) {
    setPreview(r);
    setItensEditados(r.itens);
    setTab('itens');
  }

  async function handleConfirmar() {
    setConfirmandoItens(true);
    try {
      await apiFetch(`/api/pesquisas/${id}/confirmar`, {
        method: 'POST',
        body: JSON.stringify({ itens: itensEditados }),
      });
      toast.success('Itens confirmados!');
      setPreview(null);
      refetch();
      setTab('visao-geral');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao confirmar itens');
    } finally {
      setConfirmandoItens(false);
    }
  }

  async function handleProcessar() {
    try {
      await processar.mutateAsync();
      toast.success('Pesquisa enfileirada para processamento!');
      router.push(`/pesquisas/${id}/processar`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao processar');
    }
  }

  function handleDownload() {
    const token = getAccessToken();
    const a = document.createElement('a');
    a.href = `${apiUrl(`/api/pesquisas/${id}/resultado/planilha`)}`;
    if (token) {
      // Use fetch to download with auth
      fetch(a.href, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.blob())
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          a.href = url;
          a.download = `cotacao-${pesquisa?.titulo?.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30)}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        });
    }
  }

  if (isLoading) return (
    <div className="max-w-4xl mx-auto space-y-4 animate-pulse">
      <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded-full w-1/3" />
      <div className="card h-40" />
    </div>
  );
  if (!pesquisa) return null;

  const canUpload = pesquisa.status === 'AGUARDANDO' || pesquisa.status === 'ERRO';
  const canProcess = pesquisa.status === 'AGUARDANDO' && (pesquisa.totalItens ?? 0) > 0;
  const isProcessing = pesquisa.status === 'PROCESSANDO';
  const isDone = pesquisa.status === 'CONCLUIDA';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back + header */}
      <div className="flex items-start gap-3 mb-6">
        <button onClick={() => router.back()} className="btn-ghost mt-0.5 w-8 h-8 p-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white truncate">{pesquisa.titulo}</h2>
            <PesquisaBadge status={pesquisa.status} />
          </div>
          {pesquisa.descricao && <p className="text-sm text-zinc-500 mt-0.5">{pesquisa.descricao}</p>}
          <p className="text-xs text-zinc-400 mt-1">{formatDate(pesquisa.createdAt)}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isDone && (
            <button onClick={handleDownload} className="btn-secondary gap-2">
              <Download className="w-4 h-4" /> Baixar planilha
            </button>
          )}
          {isProcessing && (
            <button onClick={() => router.push(`/pesquisas/${id}/processar`)} className="btn-primary gap-2">
              <Play className="w-4 h-4" /> Ver progresso
            </button>
          )}
          {canProcess && (
            <button onClick={handleProcessar} disabled={processar.isPending} className="btn-primary gap-2">
              <Play className="w-4 h-4" /> Processar
            </button>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total de itens', value: pesquisa.totalItens, color: 'text-zinc-900 dark:text-white' },
          { label: 'Cotados', value: pesquisa.itensComCotacao, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Sem resultado', value: pesquisa.itensSemCotacao, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Com erro', value: pesquisa.itensComErro, color: 'text-red-600 dark:text-red-400' },
        ].map((s) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="card p-4 text-center">
            <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{s.label}</p>
          </motion.div>
        ))}
      </div>
      {pesquisa.valorTotalEstimado && (
        <div className="card p-4 mb-6 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">Valor total estimado</span>
          <span className="text-xl font-bold text-blue-700 dark:text-blue-400">{formatCurrency(pesquisa.valorTotalEstimado)}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-2xl mb-6 w-fit">
        {([
          { id: 'visao-geral', label: 'Visão geral' },
          { id: 'upload', label: 'Upload' },
          { id: 'itens', label: `Itens ${pesquisa.totalItens > 0 ? `(${pesquisa.totalItens})` : ''}` },
        ] as Array<{ id: Tab; label: string }>).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-1.5 rounded-xl text-sm font-medium transition-all duration-200',
              tab === t.id
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'visao-geral' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Detalhes</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['Município', [pesquisa.municipio, pesquisa.uf].filter(Boolean).join('/') || '—'],
                ['Status', pesquisa.status],
                ['Criado em', formatDate(pesquisa.createdAt)],
                ['Concluído em', formatDate(pesquisa.concluidaEm)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-zinc-400">{k}</dt>
                  <dd className="font-medium text-zinc-800 dark:text-zinc-200">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          {pesquisa.erroProcessamento && (
            <div className="card bg-red-50 dark:bg-red-900/20 ring-1 ring-red-200 dark:ring-red-800">
              <p className="text-sm text-red-700 dark:text-red-400 font-medium">Erro no processamento</p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-1">{pesquisa.erroProcessamento}</p>
            </div>
          )}
          {canUpload && !pesquisa.totalItens && (
            <div className="card border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-center py-10">
              <p className="text-sm text-zinc-500 mb-3">Faça upload da planilha de itens para iniciar</p>
              <button onClick={() => setTab('upload')} className="btn-primary gap-2">
                <Upload className="w-4 h-4" /> Fazer upload
              </button>
            </div>
          )}
        </motion.div>
      )}

      {tab === 'upload' && canUpload && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card">
          <h3 className="text-sm font-semibold mb-4">Importar itens</h3>
          <UploadZone pesquisaId={id} onPreview={handlePreview} />
        </motion.div>
      )}

      {tab === 'itens' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {/* Preview mode — confirm before saving */}
          {preview && itensEditados.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {itensEditados.length} itens detectados — revise antes de confirmar
                </p>
                <button onClick={handleConfirmar} disabled={confirmandoItens} className="btn-primary gap-2">
                  {confirmandoItens ? 'Confirmando…' : `Confirmar ${itensEditados.length} itens`}
                </button>
              </div>
              <div className="card overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                        {['Nº', 'Nome', 'Descrição', 'Qtd', 'Un'].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 first:rounded-tl-2xl last:rounded-tr-2xl">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {itensEditados.map((item) => (
                        <tr key={item.sequencia} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-4 py-2.5 text-zinc-400 text-xs">{item.sequencia}</td>
                          <td className="px-4 py-2.5 font-medium text-zinc-800 dark:text-zinc-200 max-w-[200px] truncate">{item.nome}</td>
                          <td className="px-4 py-2.5 text-zinc-500 max-w-[250px] truncate text-xs">{item.descricao}</td>
                          <td className="px-4 py-2.5 text-right">{item.quantidade}</td>
                          <td className="px-4 py-2.5 text-zinc-400 text-xs">{item.unidadeMedida}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (pesquisa.itens ?? []).length > 0 ? (
            <div className="card overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                      {['Nº', 'Nome / Descrição', 'Qtd', 'Preço ref.', 'Total', 'Status'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(pesquisa.itens ?? []).map((item) => (
                      <>
                        <tr
                          key={item.id}
                          onClick={() => setExpandedItem(expandedItem === item.sequencia ? null : item.sequencia)}
                          className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-2.5 text-zinc-400 text-xs">{item.sequencia}</td>
                          <td className="px-4 py-2.5 max-w-[240px]">
                            <p className="font-medium text-zinc-800 dark:text-zinc-200 truncate">{item.nome}</p>
                            <p className="text-xs text-zinc-400 truncate">{item.descricao}</p>
                          </td>
                          <td className="px-4 py-2.5 text-sm">{Number(item.quantidade)} {item.unidadeMedida}</td>
                          <td className="px-4 py-2.5 font-mono text-sm">{formatCurrency(item.precoReferencia)}</td>
                          <td className="px-4 py-2.5 font-mono font-semibold text-sm">{formatCurrency(item.precoTotal)}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <ItemBadge status={item.statusItem} />
                              {expandedItem === item.sequencia
                                ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                                : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
                            </div>
                          </td>
                        </tr>
                        {expandedItem === item.sequencia && item.cotacoes && (
                          <tr className="bg-zinc-50 dark:bg-zinc-800/30">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                {item.cotacoes.map((c) => (
                                  <div key={c.id} className={cn(
                                    'rounded-xl px-3 py-2 text-xs border',
                                    c.erro
                                      ? 'bg-red-50 border-red-100 dark:bg-red-900/10 dark:border-red-800'
                                      : 'bg-white border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700',
                                  )}>
                                    <p className="font-semibold text-zinc-600 dark:text-zinc-400">{c.fonte}</p>
                                    {c.preco ? (
                                      <p className="font-bold text-zinc-900 dark:text-white">{formatCurrency(c.preco)}</p>
                                    ) : (
                                      <p className="text-red-500">{c.erro ?? 'Sem resultado'}</p>
                                    )}
                                    {c.referencia && <p className="text-zinc-400 truncate max-w-[150px]">{c.referencia}</p>}
                                  </div>
                                ))}
                              </div>
                              {item.observacao && (
                                <p className="text-xs text-zinc-400 mt-2 flex items-center gap-1">
                                  <Pencil className="w-3 h-3" /> {item.observacao}
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card text-center py-12">
              <p className="text-sm text-zinc-400">Nenhum item encontrado. Faça upload de uma planilha.</p>
              <button onClick={() => setTab('upload')} className="btn-secondary mt-4">Fazer upload</button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
