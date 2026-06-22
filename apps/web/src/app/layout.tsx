import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import Providers from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'LicitaPreço', template: '%s — LicitaPreço' },
  description: 'Sistema de Pesquisa de Preços para Licitações — Lei 14.133/2021',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={inter.variable}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <Providers>
            {children}
            <Toaster richColors position="top-right" closeButton />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
