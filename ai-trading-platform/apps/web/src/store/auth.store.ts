'use client';

import { create } from 'zustand';
import { authApi } from '@/lib/api';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  checkAuth: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  authenticated: false,
  loading: true,

  checkAuth: async () => {
    try {
      await authApi.me();
      set({ authenticated: true, loading: false });
    } catch {
      set({ authenticated: false, loading: false });
    }
  },

  login: async (password: string) => {
    await authApi.login(password);
    set({ authenticated: true });
  },

  logout: async () => {
    await authApi.logout();
    set({ authenticated: false });
  },
}));
