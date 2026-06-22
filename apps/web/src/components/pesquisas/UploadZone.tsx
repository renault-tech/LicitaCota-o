'use client';
import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, ClipboardPaste, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import type { ResultadoLeitura } from '@/types/api';

interface Props {
  pesquisaId: string;
  onPreview: (resultado: ResultadoLeitura) => void;
}

export default function UploadZone({ pesquisaId, onPreview }: Props) {
  const [mode, setMode] = useState<'idle' | 'file' | 'text'>('idle');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [textoTSV, setTextoTSV] = useState('');

  const processFile = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const form = new FormData();
      form.append('arquivo', file);
      const res = await apiFetch<{ preview: ResultadoLeitura }>(
        `/api/pesquisas/${pesquisaId}/planilha`,
        { method: 'POST', body: form },
      );
      onPreview(res.preview);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao processar arquivo');
    } finally {
      setLoading(false);
    }
  }, [pesquisaId, onPreview]);

  async function submitText() {
    if (!textoTSV.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ preview: ResultadoLeitura }>(
        `/api/pesquisas/${pesquisaId}/texto`,
        { method: 'POST', body: JSON.stringify({ texto: textoTSV }) },
      );
      onPreview(res.preview);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao processar texto');
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  if (mode === 'text') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="label text-sm">Cole os dados (TSV / planilha copiada)</label>
          <button onClick={() => setMode('idle')} className="btn-ghost text-xs"><X className="w-3.5 h-3.5" /> Voltar</button>
        </div>
        <textarea
          value={textoTSV}
          onChange={(e) => setTextoTSV(e.target.value)}
          rows={8}
          className="input font-mono text-xs resize-none"
          placeholder={"Nº\tDescrição\tQtd\tUnidade\n1\tCaneta esferográfica azul\t100\tun"}
          autoFocus
        />
        <p className="text-xs text-zinc-400">Cole diretamente de uma planilha (Ctrl+C → Ctrl+V). A primeira linha deve ser o cabeçalho.</p>
        <button onClick={submitText} disabled={loading || !textoTSV.trim()} className="btn-primary">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Processar dados'}
        </button>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      <motion.label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        animate={{ scale: dragging ? 1.01 : 1 }}
        className={`
          flex flex-col items-center justify-center gap-3 p-10 rounded-2xl border-2 border-dashed cursor-pointer
          transition-all duration-200
          ${dragging
            ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/20'
            : 'border-zinc-200 dark:border-zinc-700 hover:border-blue-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}
        `}
      >
        <input type="file" accept=".xlsx,.xls,.tsv,.csv" onChange={onInputChange} className="sr-only" />
        {loading ? (
          <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
        ) : (
          <motion.div
            animate={{ y: dragging ? -6 : 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Upload className="w-10 h-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1.5} />
          </motion.div>
        )}
        <div className="text-center">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {dragging ? 'Solte aqui!' : 'Arraste a planilha ou clique para selecionar'}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">.xlsx, .xls, .tsv — detecção automática de colunas</p>
        </div>
      </motion.label>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        <span className="text-xs text-zinc-400">ou</span>
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
      </div>

      <button onClick={() => setMode('text')} className="btn-secondary w-full gap-2">
        <ClipboardPaste className="w-4 h-4" /> Colar dados de planilha (TSV)
      </button>
    </div>
  );
}
