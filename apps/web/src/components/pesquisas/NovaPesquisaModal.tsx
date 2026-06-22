'use client';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCreatePesquisa } from '@/lib/queries';

const schema = z.object({
  titulo: z.string().min(3, 'Mínimo 3 caracteres'),
  descricao: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().max(2).optional(),
});
type Form = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NovaPesquisaModal({ open, onClose }: Props) {
  const router = useRouter();
  const create = useCreatePesquisa();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: Form) {
    try {
      const p = await create.mutateAsync(values);
      toast.success('Pesquisa criada!');
      reset();
      onClose();
      router.push(`/pesquisas/${p.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar pesquisa');
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
          >
            <div className="glass-strong rounded-3xl w-full max-w-lg pointer-events-auto">
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Nova pesquisa de preços</h2>
                <button onClick={onClose} className="btn-ghost w-8 h-8 p-0"><X className="w-4 h-4" /></button>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
                <div>
                  <label className="label">Título *</label>
                  <input {...register('titulo')} className="input" placeholder="Ex: Materiais de escritório 2025" autoFocus />
                  {errors.titulo && <p className="mt-1 text-xs text-red-500">{errors.titulo.message}</p>}
                </div>

                <div>
                  <label className="label">Descrição</label>
                  <textarea {...register('descricao')} rows={3} className="input resize-none" placeholder="Descrição ou observação da pesquisa…" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Município</label>
                    <input {...register('municipio')} className="input" placeholder="São Paulo" />
                  </div>
                  <div>
                    <label className="label">UF</label>
                    <input {...register('uf')} maxLength={2} className="input uppercase" placeholder="SP" />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
                  <button type="submit" disabled={isSubmitting} className="btn-primary flex-1">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar pesquisa'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
