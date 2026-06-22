'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, X, Loader2, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useUsuarios, useConvidarUsuario } from '@/lib/queries';
import EmptyState from '@/components/common/EmptyState';
import { formatDate, initials, cn } from '@/lib/utils';
import type { Role } from '@/types/api';

const ROLE_COLORS: Record<Role, string> = {
  ADMIN: 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400',
  OPERADOR: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  VISUALIZADOR: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  nome: z.string().min(2, 'Nome muito curto'),
  role: z.enum(['ADMIN', 'OPERADOR', 'VISUALIZADOR']).default('OPERADOR'),
  cargo: z.string().optional(),
});
type Form = z.infer<typeof schema>;

export default function UsuariosPage() {
  const { data, isLoading } = useUsuarios();
  const convidar = useConvidarUsuario();
  const [modalOpen, setModalOpen] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'OPERADOR' },
  });

  async function onSubmit(values: Form) {
    try {
      await convidar.mutateAsync(values);
      toast.success(`Convite enviado para ${values.email}`);
      reset();
      setModalOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao convidar usuário');
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Usuários</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Gerencie os usuários e permissões do sistema</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary gap-2">
          <UserPlus className="w-4 h-4" /> Convidar usuário
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="card animate-pulse h-20" />)}</div>
      ) : !data?.usuarios?.length ? (
        <EmptyState icon={Users} title="Nenhum usuário" description="Convide usuários para acessar o sistema." />
      ) : (
        <div className="card p-0 overflow-hidden">
          {data.usuarios.map((u, i) => (
            <motion.div
              key={u.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={cn('flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors', i > 0 && 'border-t border-zinc-100 dark:border-zinc-800')}
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-blue-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                {initials(u.nome)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-zinc-900 dark:text-white">{u.nome}</p>
                <p className="text-xs text-zinc-400 truncate">{u.email}</p>
                {u.cargo && <p className="text-xs text-zinc-300 dark:text-zinc-600">{u.cargo}</p>}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={cn('text-xs font-medium px-2.5 py-0.5 rounded-full', ROLE_COLORS[u.role])}>{u.role}</span>
                <span className={cn('text-xs px-2 py-0.5 rounded-full', u.ativo ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400' : 'text-zinc-400 bg-zinc-100 dark:bg-zinc-800')}>
                  {u.ativo ? 'Ativo' : 'Inativo'}
                </span>
                <p className="text-[11px] text-zinc-300 dark:text-zinc-600 hidden sm:block">
                  {formatDate(u.createdAt)}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modal convite */}
      <AnimatePresence>
        {modalOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setModalOpen(false)} className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
              className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
            >
              <div className="glass-strong rounded-3xl w-full max-w-md pointer-events-auto">
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
                  <h2 className="text-base font-semibold">Convidar usuário</h2>
                  <button onClick={() => setModalOpen(false)} className="btn-ghost w-8 h-8 p-0"><X className="w-4 h-4" /></button>
                </div>
                <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
                  <div>
                    <label className="label">Nome *</label>
                    <input {...register('nome')} className="input" placeholder="Nome completo" autoFocus />
                    {errors.nome && <p className="mt-1 text-xs text-red-500">{errors.nome.message}</p>}
                  </div>
                  <div>
                    <label className="label">E-mail *</label>
                    <input {...register('email')} type="email" className="input" placeholder="usuario@municipio.gov.br" />
                    {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Perfil</label>
                      <select {...register('role')} className="input">
                        <option value="OPERADOR">Operador</option>
                        <option value="VISUALIZADOR">Visualizador</option>
                        <option value="ADMIN">Administrador</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Cargo</label>
                      <input {...register('cargo')} className="input" placeholder="Opcional" />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400">Um e-mail com o link de acesso será enviado ao usuário.</p>
                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
                    <button type="submit" disabled={isSubmitting} className="btn-primary flex-1">
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar convite'}
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
