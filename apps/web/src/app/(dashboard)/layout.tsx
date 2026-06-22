'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import { useAuthStore } from '@/lib/auth';

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
  const { accessToken, refreshToken } = useAuthStore();

  useEffect(() => {
    if (!accessToken && !refreshToken) {
      router.replace('/login');
    }
  }, [accessToken, refreshToken, router]);

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
