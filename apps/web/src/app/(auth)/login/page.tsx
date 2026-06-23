'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import Link from 'next/link';
import { Eye, EyeOff, Gavel, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth';
import { setAccessToken } from '@/lib/api';
import type { Usuario } from '@/types/api';

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  senha: z.string().min(1, 'Informe a senha'),
});
type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { setTokens, setUsuario } = useAuthStore();
  const [showPass, setShowPass] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: Form) {
    try {
      const res = await apiFetch<{ accessToken: string; refreshToken: string; usuario: Usuario }>(
        '/api/auth/login',
        { method: 'POST', body: JSON.stringify(values), skipAuth: true },
      );
      setTokens(res.accessToken, res.refreshToken);
      setAccessToken(res.accessToken);
      setUsuario(res.usuario);
      router.replace('/pesquisas');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao fazer login');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50 dark:from-zinc-950 dark:via-blue-950/20 dark:to-zinc-950 p-4">
      {/* Background blur blobs */}
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
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="flex flex-col items-center gap-3"
          >
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Gavel className="w-8 h-8 text-white" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">LicitaPreço</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">Pesquisa de preços — Lei 14.133/2021</p>
            </div>
          </motion.div>

          {/* Form */}
          <motion.form
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.4 }}
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
          >
            <div>
              <label className="label">E-mail</label>
              <input
                {...register('email')}
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="nome@municipio.gov.br"
                className="input"
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label !mb-0">Senha</label>
                <Link href="/esqueci-senha" className="text-xs text-blue-500 hover:text-blue-700 transition-colors">
                  Esqueci minha senha
                </Link>
              </div>
              <div className="relative">
                <input
                  {...register('senha')}
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.senha && <p className="mt-1 text-xs text-red-500">{errors.senha.message}</p>}
            </div>

            <motion.button
              type="submit"
              disabled={isSubmitting}
              whileTap={{ scale: 0.97 }}
              className="btn-primary w-full mt-2 h-11 text-base"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Entrar'}
            </motion.button>
          </motion.form>
        </div>

        <p className="text-center text-xs text-zinc-400 mt-6">
          Problemas para acessar? Fale com o administrador do sistema.
        </p>
      </motion.div>
    </main>
  );
}
