'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gavel, FileSearch, Database, Users, Settings,
  Building2, ClipboardList, ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth';
import { cn, initials } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/pesquisas', icon: FileSearch, label: 'Pesquisas', roles: ['ADMIN', 'OPERADOR', 'VISUALIZADOR'] },
  { href: '/fornecedores', icon: Building2, label: 'Fornecedores', roles: ['ADMIN', 'OPERADOR'] },
  { href: '/fontes', icon: Database, label: 'Fontes', roles: ['ADMIN'] },
  { href: '/usuarios', icon: Users, label: 'Usuários', roles: ['ADMIN'] },
  { href: '/auditoria', icon: ClipboardList, label: 'Auditoria', roles: ['ADMIN'] },
  { href: '/configuracoes', icon: Settings, label: 'Configurações', roles: ['ADMIN'] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { usuario } = useAuthStore();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !usuario || item.roles.includes(usuario.role),
  );

  return (
    <aside className="fixed left-0 top-0 h-full w-60 glass border-r border-zinc-200 dark:border-zinc-800 flex flex-col z-30">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/25 flex-shrink-0">
          <Gavel className="w-4.5 h-4.5 text-white" strokeWidth={1.5} />
        </div>
        <div>
          <span className="font-semibold text-sm text-zinc-900 dark:text-white">LicitaPreço</span>
          <p className="text-[10px] text-zinc-400 leading-none">Lei 14.133/2021</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                whileTap={{ scale: 0.97 }}
                className={cn(
                  'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 group',
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
                )}
              >
                {active && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-xl bg-blue-50 dark:bg-blue-500/10"
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                  />
                )}
                <item.icon
                  className={cn('w-4.5 h-4.5 relative z-10 flex-shrink-0', active ? 'text-blue-500' : '')}
                  strokeWidth={active ? 2 : 1.75}
                />
                <span className="relative z-10">{item.label}</span>
                {active && (
                  <ChevronRight className="w-3.5 h-3.5 ml-auto relative z-10 text-blue-400" />
                )}
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <AnimatePresence>
        {usuario && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-4 py-4 border-t border-zinc-200 dark:border-zinc-800"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-blue-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                {initials(usuario.nome)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-900 dark:text-white truncate">{usuario.nome}</p>
                <p className="text-[10px] text-zinc-400 truncate">{usuario.role}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}
