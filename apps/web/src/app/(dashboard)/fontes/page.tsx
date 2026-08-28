'use client';
import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, ToggleLeft, ToggleRight, Database, Loader2, Globe, Table, RefreshCw, BookOpen, Upload, ExternalLink, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useFontes, useTestarFonte, useAtivarFonte, useStatusCatalogo, useSincronizarCatalogo, useImportarCatalogo, useImportarCatalogoAutomatico } from '@/lib/queries';
import { FonteBadge } from '@/components/common/StatusBadge';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { useAuthStore } from '@/lib/auth';
import { formatDate, cn } from '@/lib/utils';
import type { TipoFonte } from '@/types/api';

const TIPO_ICON = { API_REST: Globe, SCRAPING: Zap, TABELA_REFERENCIA: Table };
const TIPO_LABEL: Record<TipoFonte, string> = { API_REST: 'API REST', SCRAPING: 'Scraping', TABELA_REFERENCIA: 'Tabela' };
const TIPO_CATALOGO_LABEL = { MATERIAL: 'materiais', SERVICO: 'serviços' };

function formatSegundos(s: number): string {
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  const seg = s % 60;
  return seg > 0 ? `${min}min ${seg}s` : `${min}min`;
}

export default function FontesPage() {
  const { data: fontes, isLoading, isError, error, refetch } = useFontes();
  const testar = useTestarFonte();
  const ativar = useAtivarFonte();
  const { usuario } = useAuthStore();
  const { data: catalogo } = useStatusCatalogo();
  const sincronizarCatalogo = useSincronizarCatalogo();
  const importarCatalogo = useImportarCatalogo();
  const importarAutomatico = useImportarCatalogoAutomatico();
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string; latencia: number }>>({});
  const [testando, setTestando] = useState<string | null>(null);
  const [tipoImportar, setTipoImportar] = useState<'MATERIAL' | 'SERVICO'>('MATERIAL');
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  async function handleSincronizarCatalogo() {
    try {
      const res = await sincronizarCatalogo.mutateAsync();
      toast[res.disparou ? 'success' : 'info'](
        res.disparou ? 'Sincronização do catálogo iniciada.' : 'Uma sincronização já está em andamento.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao iniciar sincronização');
    }
  }

  async function handleImportarAutomatico() {
    try {
      const res = await importarAutomatico.mutateAsync(tipoImportar);
      toast[res.disparou ? 'success' : 'info'](
        res.disparou ? 'Importação do catálogo iniciada em segundo plano.' : 'Uma sincronização/importação já está em andamento.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar catálogo automaticamente');
    }
  }

  async function handleArquivoSelecionado(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    try {
      const res = await importarCatalogo.mutateAsync({ tipo: tipoImportar, arquivo });
      toast.success(`Planilha importada — ${res.processados.toLocaleString('pt-BR')} itens.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar planilha');
    }
  }

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

      {catalogo && (
        <div className="card mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 text-indigo-500" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-zinc-900 dark:text-white">Catálogo oficial CATMAT/CATSER</p>
              <p className="text-xs text-zinc-400">
                {catalogo.materiais.toLocaleString('pt-BR')} materiais · {catalogo.servicos.toLocaleString('pt-BR')} serviços
                {catalogo.ultimaAtualizacao && <> · atualizado em {formatDate(catalogo.ultimaAtualizacao)}</>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {catalogo.sincronizacao.emAndamento ? (
              <span className="flex items-center gap-1.5 text-xs text-blue-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Sincronizando...
              </span>
            ) : catalogo.sincronizacao.ultimoResultado?.erro ? (
              <span className="text-xs text-red-500">Falha na última sincronização</span>
            ) : catalogo.sincronizacao.ultimoResultado ? (
              <span className="text-xs text-emerald-500">Última importação concluída com sucesso</span>
            ) : catalogo.materiais === 0 && catalogo.servicos === 0 ? (
              <span className="text-xs text-amber-500">Ainda não sincronizado</span>
            ) : null}

            {usuario?.role === 'ADMIN' && (
              <>
                <button
                  onClick={handleSincronizarCatalogo}
                  disabled={catalogo.sincronizacao.emAndamento || sincronizarCatalogo.isPending}
                  className="btn-ghost text-xs px-3 py-1.5"
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', catalogo.sincronizacao.emAndamento && 'animate-spin')} />
                  Sincronizar agora
                </button>

                <span className="text-zinc-200 dark:text-zinc-700">|</span>

                <select
                  value={tipoImportar}
                  onChange={(e) => setTipoImportar(e.target.value as 'MATERIAL' | 'SERVICO')}
                  disabled={importarCatalogo.isPending}
                  className="text-xs bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5"
                  title="Tipo da planilha a importar"
                >
                  <option value="MATERIAL">CATMAT (materiais)</option>
                  <option value="SERVICO">CATSER (serviços)</option>
                </select>
                <input
                  ref={inputArquivoRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={handleArquivoSelecionado}
                />
                <button
                  onClick={handleImportarAutomatico}
                  disabled={catalogo.sincronizacao.emAndamento || importarAutomatico.isPending}
                  className="btn-ghost text-xs px-3 py-1.5"
                  title="Baixar e importar automaticamente (direto de repositorio.dados.gov.br, sem sair do app)"
                >
                  {importarAutomatico.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Importar direto
                </button>
                <button
                  onClick={() => inputArquivoRef.current?.click()}
                  disabled={importarCatalogo.isPending}
                  className="btn-ghost text-xs px-3 py-1.5"
                  title="Importar planilha .xlsx baixada manualmente do Portal de Compras"
                >
                  {importarCatalogo.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Importar planilha
                </button>
                <a
                  href="https://repositorio.dados.gov.br/seges/comprasgov/catalogo_cnbs/"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir a página com os arquivos CATMAT/CATSER para baixar manualmente"
                  className="text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </>
            )}
          </div>

          {catalogo.sincronizacao.emAndamento && catalogo.sincronizacao.progresso && (() => {
            const p = catalogo.sincronizacao.progresso;
            const pct = p.totalEstimado ? Math.min(100, Math.round((p.processados / p.totalEstimado) * 100)) : null;
            return (
              <div className="w-full mt-1">
                <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                  <span>
                    Baixando {TIPO_CATALOGO_LABEL[p.tipo]} — página {p.pagina} · {p.processados.toLocaleString('pt-BR')}
                    {p.totalEstimado ? ` de ~${p.totalEstimado.toLocaleString('pt-BR')}` : ''}
                    {pct !== null && ` (${pct}%)`}
                  </span>
                  <span>
                    {p.itensPorSegundo > 0 && `${p.itensPorSegundo.toLocaleString('pt-BR')}/s`}
                    {p.segundosRestantesEstimados !== null && ` · ~${formatSegundos(p.segundosRestantesEstimados)} restantes`}
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  {pct !== null ? (
                    <div className="h-full rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${pct}%` }} />
                  ) : (
                    <div className="h-full w-1/3 rounded-full bg-blue-500 animate-pulse" />
                  )}
                </div>
              </div>
            );
          })()}

          {!catalogo.sincronizacao.emAndamento && catalogo.sincronizacao.ultimoResultado?.erro && (
            <p className="w-full text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 mt-1">
              {catalogo.sincronizacao.ultimoResultado.erro}
            </p>
          )}

          {!catalogo.sincronizacao.emAndamento && catalogo.sincronizacao.ultimoResultado && !catalogo.sincronizacao.ultimoResultado.erro && (
            <p className="w-full text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 mt-1">
              Importação concluída{catalogo.sincronizacao.concluidoEm ? ` em ${formatDate(catalogo.sincronizacao.concluidoEm)}` : ''} —{' '}
              {catalogo.sincronizacao.ultimoResultado.materiais.toLocaleString('pt-BR')} materiais e{' '}
              {catalogo.sincronizacao.ultimoResultado.servicos.toLocaleString('pt-BR')} serviços no catálogo agora.
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="card animate-pulse h-40" />)}
        </div>
      ) : isError ? (
        <ErrorState message={error instanceof Error ? error.message : 'Erro ao carregar fontes.'} onRetry={() => refetch()} />
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
