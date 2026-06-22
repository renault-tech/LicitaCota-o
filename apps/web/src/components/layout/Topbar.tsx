'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, LogOut, User, Sun, Moon, CheckCheck } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useAuthStore } from '@/lib/auth';
import { useNotificacoes, useMarcarTodasLidas, useMarcarLida } from '@/lib/queries';
import { apiFetch, setAccessToken } from '@/lib/api';
import { cn, formatDate, initials } from '@/lib/utils';
import type { TipoNotificacao } from '@/types/api';

const NOTIF_COLORS: Record<TipoNotificacao, string> = {
  PESQUISA_CONCLUIDA: 'bg-emerald-400',
  FONTE_FALHOU: 'bg-amber-400',
  VARIACAO_PRECO: 'bg-orange-400',
  SISTEMA: 'bg-blue-400',
};

export default function Topbar({ title }: { title?: string }) {
  const router = useRouter();
  const { usuario, logout } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const { data: notifData } = useNotificacoes();
  const marcarTodas = useMarcarTodasLidas();
  const marcarLida = useMarcarLida();

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAccessToken(null);
    logout();
    router.replace('/login');
  }

  return (
    <header className="h-14 flex items-center justify-between px-6 glass border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-20">
      <h1 className="text-base font-semibold text-zinc-900 dark:text-white truncate">{title}</h1>

      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="btn-ghost w-9 h-9 p-0"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Notificações */}
        <div className="relative">
          <button onClick={() => { setNotifOpen((v) => !v); setUserOpen(false); }} className="btn-ghost w-9 h-9 p-0 relative">
            <Bell className="w-4 h-4" />
            {(notifData?.totalNaoLidas ?? 0) > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-900" />
            )}
          </button>

          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-80 glass-strong rounded-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="text-sm font-semibold">Notificações</span>
                  {(notifData?.totalNaoLidas ?? 0) > 0 && (
                    <button onClick={() => marcarTodas.mutate()} className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                      <CheckCheck className="w-3.5 h-3.5" /> Marcar todas
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {!notifData?.notificacoes?.length ? (
                    <p className="text-center text-sm text-zinc-400 py-8">Nenhuma notificação</p>
                  ) : (
                    notifData.notificacoes.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => { marcarLida.mutate(n.id); if (n.link) router.push(n.link); setNotifOpen(false); }}
                        className={cn(
                          'w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors border-b border-zinc-100 dark:border-zinc-800 last:border-0',
                          !n.lida && 'bg-blue-50/50 dark:bg-blue-500/5',
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', NOTIF_COLORS[n.tipo])} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-zinc-900 dark:text-white truncate">{n.titulo}</p>
                            <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{n.mensagem}</p>
                            <p className="text-[10px] text-zinc-400 mt-1">{formatDate(n.createdAt)}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User menu */}
        <div className="relative ml-1">
          <button onClick={() => { setUserOpen((v) => !v); setNotifOpen(false); }} className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-blue-500 flex items-center justify-center text-white text-[11px] font-semibold">
              {initials(usuario?.nome ?? 'U')}
            </div>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 hidden sm:block">{usuario?.nome?.split(' ')[0]}</span>
          </button>

          <AnimatePresence>
            {userOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-48 glass-strong rounded-2xl overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs font-semibold text-zinc-900 dark:text-white truncate">{usuario?.nome}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{usuario?.email}</p>
                </div>
                <button className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <User className="w-4 h-4" /> Perfil
                </button>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors border-t border-zinc-100 dark:border-zinc-800"
                >
                  <LogOut className="w-4 h-4" /> Sair
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
