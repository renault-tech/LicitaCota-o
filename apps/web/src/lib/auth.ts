'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Usuario } from '@/types/api';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  usuario: Usuario | null;
  // Zustand persist lê o localStorage de forma assíncrona em relação à
  // primeira renderização no cliente: logo após um F5, accessToken e
  // refreshToken ainda estão nulos (estado inicial) até essa reidratação
  // terminar. Sem essa flag, qualquer tela que decida "sem token = deslogado"
  // no primeiro render manda o usuário pro login mesmo com sessão válida.
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  setTokens: (access: string, refresh: string) => void;
  setUsuario: (u: Usuario) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      usuario: null,
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setUsuario: (usuario) => set({ usuario }),
      logout: () => set({ accessToken: null, refreshToken: null, usuario: null }),
    }),
    {
      name: 'licitapreco-auth',
      partialize: (s) => ({ refreshToken: s.refreshToken, usuario: s.usuario }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
