'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Gavel, Loader2, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';

const schema = z.object({
  senha: z.string().min(8, 'Mínimo 8 caracteres'),
  confirmar: z.string(),
}).refine((d) => d.senha === d.confirmar, { message: 'As senhas não coincidem', path: ['confirmar'] });

type Form = z.infer<typeof schema>;

function RedefinirSenhaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [showPass, setShowPass] = useState(false);
  const [done, setDone] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: Form) {
    try {
      await apiFetch('/api/auth/redefinir-senha', {
        method: 'POST',
        body: JSON.stringify({ token, senha: values.senha }),
        skipAuth: true,
      });
      setDone(true);
      setTimeout(() => router.replace('/login'), 3000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Link inválido ou expirado.');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50 dark:from-zinc-950 dark:via-blue-950/20 dark:to-zinc-950 p-4">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-400/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-indigo-400/20 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="glass-strong rounded-3xl p-8 space-y-8">
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Gavel className="w-8 h-8 text-white" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Nova senha</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">Crie uma senha segura para sua conta</p>
            </div>
          </div>

          {!token ? (
            <p className="text-center text-sm text-red-500 py-4">
              Link inválido. Solicite um novo link de redefinição.
            </p>
          ) : done ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-4"
            >
              <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <ShieldCheck className="w-7 h-7 text-emerald-500" />
              </div>
              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                Senha redefinida com sucesso! Redirecionando para o login…
              </p>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="label">Nova senha</label>
                <div className="relative">
                  <input
                    {...register('senha')}
                    type={showPass ? 'text' : 'password'}
                    placeholder="Mínimo 8 caracteres"
                    className="input pr-10"
                  />
                  <button type="button" onClick={() => setShowPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.senha && <p className="mt-1 text-xs text-red-500">{errors.senha.message}</p>}
              </div>

              <div>
                <label className="label">Confirmar senha</label>
                <input {...register('confirmar')} type="password" placeholder="Repita a senha" className="input" />
                {errors.confirmar && <p className="mt-1 text-xs text-red-500">{errors.confirmar.message}</p>}
              </div>

              <button type="submit" disabled={isSubmitting || !token} className="btn-primary w-full h-11 text-base mt-2">
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Redefinir senha'}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </main>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <Suspense>
      <RedefinirSenhaForm />
    </Suspense>
  );
}
