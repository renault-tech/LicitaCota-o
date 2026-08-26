'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import { useAuthStore } from '@/lib/auth';
import { apiUrl } from '@/lib/api';

const PAGE_TITLES: Record<string, string> = {
  '/pesquisas': 'Pesquisas de Preços',
  '/fontes': 'Fontes de Cotação',
  '/usuarios': 'Usuários',
  '/fornecedores': 'Fornecedores',
  '/configuracoes': 'Configurações',
  '/auditoria': 'Auditoria',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, refreshToken, hasHydrated } = useAuthStore();

  useEffect(() => {
    // Só decide "sem sessão" depois que o localStorage terminou de ser lido
    // — antes disso accessToken/refreshToken são nulos por padrão mesmo com
    // uma sessão válida salva, e redirecionar nesse momento manda pro login
    // a cada F5.
    if (hasHydrated && !accessToken && !refreshToken) {
      router.replace('/login');
    }
  }, [hasHydrated, accessToken, refreshToken, router]);

  // Ping a cada 4 min para manter o servidor Render acordado
  useEffect(() => {
    const ping = () => fetch(apiUrl('/health')).catch(() => {});
    ping();
    const id = setInterval(ping, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (!hasHydrated) return null;
  if (!accessToken && !refreshToken) return null;

  const title = Object.entries(PAGE_TITLES).find(([k]) => pathname.startsWith(k))?.[1] ?? 'LicitaPreço';

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-60">
        <Topbar title={title} />
        <AnimatePresence mode="wait">
          <motion.main
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex-1 p-6"
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  );
}
