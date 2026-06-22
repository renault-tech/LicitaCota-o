'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Gavel, Loader2, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Suspense } from 'react';

const schema = z.object({
  senha: z.string().min(8, 'Mínimo 8 caracteres'),
  confirmar: z.string(),
}).refine((d) => d.senha === d.confirmar, { message: 'As senhas não coincidem', path: ['confirmar'] });

type Form = z.infer<typeof schema>;

function DefinirSenhaForm() {
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
      await apiFetch('/api/auth/definir-senha', {
        method: 'POST',
        body: JSON.stringify({ conviteToken: token, senha: values.senha }),
        skipAuth: true,
      });
      setDone(true);
      setTimeout(() => router.replace('/login'), 2500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Link inválido ou expirado.');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50 dark:from-zinc-950 dark:via-blue-950/20 dark:to-zinc-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        className="w-full max-w-md"
      >
        <div className="glass-strong rounded-3xl p-8 space-y-8">
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Gavel className="w-8 h-8 text-white" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Definir senha</h1>
              <p className="text-sm text-zinc-500 mt-0.5">Crie sua senha de acesso ao LicitaPreço</p>
            </div>
          </div>

          {done ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-4"
            >
              <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <ShieldCheck className="w-7 h-7 text-emerald-500" />
              </div>
              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                Senha definida! Redirecionando para o login…
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
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Definir senha'}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </main>
  );
}

export default function DefinirSenhaPage() {
  return (
    <Suspense>
      <DefinirSenhaForm />
    </Suspense>
  );
}
