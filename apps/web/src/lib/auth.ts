'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Usuario } from '@/types/api';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  usuario: Usuario | null;
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
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setUsuario: (usuario) => set({ usuario }),
      logout: () => set({ accessToken: null, refreshToken: null, usuario: null }),
    }),
    {
      name: 'licitapreco-auth',
      partialize: (s) => ({ refreshToken: s.refreshToken, usuario: s.usuario }),
    },
  ),
);
