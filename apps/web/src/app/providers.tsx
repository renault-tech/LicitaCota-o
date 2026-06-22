'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/lib/auth';
import { setAccessToken } from '@/lib/api';

function AuthInit() {
  const { accessToken } = useAuthStore();
  useEffect(() => {
    setAccessToken(accessToken);
  }, [accessToken]);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthInit />
      {children}
    </QueryClientProvider>
  );
}
