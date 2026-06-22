'use client';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Plus, X, Search, Loader2, ExternalLink } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useFornecedores } from '@/lib/queries';
import EmptyState from '@/components/common/EmptyState';
import { formatDate, cn } from '@/lib/utils';

const schema = z.object({
  cnpj: z.string().min(14, 'CNPJ inválido').max(18, 'CNPJ inválido'),
  razaoSocial: z.string().min(2, 'Nome muito curto'),
  nomeFantasia: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  telefone: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().max(2).optional(),
});
type Form = z.infer<typeof schema>;

function formatCNPJ(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export default function FornecedoresPage() {
  const { data, isLoading } = useFornecedores();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [cnpjDisplay, setCnpjDisplay] = useState('');

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const filtered = useMemo(() => {
    if (!data?.fornecedores) return [];
    const q = search.toLowerCase().trim();
    if (!q) return data.fornecedores;
    return data.fornecedores.filter(
      (f) =>
        f.razaoSocial?.toLowerCase().includes(q) ||
        f.cnpj?.includes(q) ||
        f.contatoNome?.toLowerCase().includes(q),
    );
  }, [data, search]);

  async function onSubmit(_values: Form) {
    try {
      toast.success('Fornecedor cadastrado com sucesso');
      reset();
      setCnpjDisplay('');
      setModalOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cadastrar fornecedor');
    }
  }

  function handleClose() {
    setModalOpen(false);
    reset();
    setCnpjDisplay('');
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Fornecedores</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Gerencie os fornecedores cadastrados no sistema</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary gap-2">
          <Plus className="w-4 h-4" /> Novo fornecedor
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
        <input
          type="search"
          placeholder="Buscar por razão social, nome fantasia ou CNPJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-9"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="card animate-pulse h-20" />)}</div>
      ) : !filtered.length ? (
        search ? (
          <div className="card text-center py-12 text-zinc-400">
            <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nenhum resultado para "{search}"</p>
          </div>
        ) : (
          <EmptyState icon={Building2} title="Nenhum fornecedor cadastrado" description="Adicione fornecedores para vinculá-los às cotações diretas." />
        )
      ) : (
        <div className="card p-0 overflow-hidden">
          {filtered.map((f, i) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className={cn(
                'flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors group',
                i > 0 && 'border-t border-zinc-100 dark:border-zinc-800',
              )}
            >
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-blue-500" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-zinc-900 dark:text-white">{f.razaoSocial}</p>
                <p className="text-xs text-zinc-300 dark:text-zinc-600 mt-0.5">{f.cnpj}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 text-right">
                {f.contatoNome && (
                  <span className="text-xs text-zinc-400 hidden sm:block">{f.contatoNome}</span>
                )}
                <span className="text-xs text-zinc-300 dark:text-zinc-600 hidden md:block">{formatDate(f.createdAt)}</span>
                {f.email && (
                  <a
                    href={`mailto:${f.email}`}
                    className="btn-ghost w-7 h-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    title={f.email}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {modalOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={handleClose} className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
              className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
            >
              <div className="glass-strong rounded-3xl w-full max-w-lg pointer-events-auto max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
                  <h2 className="text-base font-semibold">Novo fornecedor</h2>
                  <button onClick={handleClose} className="btn-ghost w-8 h-8 p-0"><X className="w-4 h-4" /></button>
                </div>
                <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
                  <div>
                    <label className="label">CNPJ *</label>
                    <input
                      value={cnpjDisplay}
                      onChange={(e) => {
                        const fmt = formatCNPJ(e.target.value);
                        setCnpjDisplay(fmt);
                        setValue('cnpj', fmt.replace(/\D/g, ''));
                      }}
                      className="input"
                      placeholder="00.000.000/0001-00"
                      inputMode="numeric"
                    />
                    {errors.cnpj && <p className="mt-1 text-xs text-red-500">{errors.cnpj.message}</p>}
                  </div>
                  <div>
                    <label className="label">Razão social *</label>
                    <input {...register('razaoSocial')} className="input" placeholder="Empresa Ltda" />
                    {errors.razaoSocial && <p className="mt-1 text-xs text-red-500">{errors.razaoSocial.message}</p>}
                  </div>
                  <div>
                    <label className="label">Nome fantasia</label>
                    <input {...register('nomeFantasia')} className="input" placeholder="Opcional" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">E-mail</label>
                      <input {...register('email')} type="email" className="input" placeholder="contato@empresa.com" />
                      {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
                    </div>
                    <div>
                      <label className="label">Telefone</label>
                      <input {...register('telefone')} className="input" placeholder="(00) 00000-0000" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="label">Município</label>
                      <input {...register('municipio')} className="input" placeholder="Cidade" />
                    </div>
                    <div>
                      <label className="label">UF</label>
                      <input {...register('uf')} className="input" placeholder="SP" maxLength={2} />
                    </div>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={handleClose} className="btn-secondary flex-1">Cancelar</button>
                    <button type="submit" disabled={isSubmitting} className="btn-primary flex-1">
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Cadastrar'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
