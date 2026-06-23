'use client';
import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Gavel, Loader2, MailCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';

const schema = z.object({ email: z.string().email('E-mail inválido') });
type Form = z.infer<typeof schema>;

export default function EsqueciSenhaPage() {
  const [enviado, setEnviado] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: Form) {
    try {
      await apiFetch('/api/auth/esqueci-senha', {
        method: 'POST',
        body: JSON.stringify(values),
        skipAuth: true,
      });
      setEnviado(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao processar solicitação.');
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
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Esqueci minha senha</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                {enviado ? 'Verifique seu e-mail' : 'Informe seu e-mail para receber o link'}
              </p>
            </div>
          </div>

          {enviado ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-4"
            >
              <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <MailCheck className="w-7 h-7 text-blue-500" />
              </div>
              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                Se o e-mail estiver cadastrado, você receberá um link de redefinição em breve.
                <br /><br />
                <span className="text-xs text-zinc-400">O link expira em 1 hora.</span>
              </p>
              <Link href="/login" className="btn-primary w-full h-10 text-sm flex items-center justify-center mt-2">
                Voltar ao login
              </Link>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

              <button type="submit" disabled={isSubmitting} className="btn-primary w-full h-11 text-base mt-2">
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar link de redefinição'}
              </button>

              <Link
                href="/login"
                className="flex items-center justify-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors mt-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Voltar ao login
              </Link>
            </form>
          )}
        </div>
      </motion.div>
    </main>
  );
}
