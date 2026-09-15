import type { LoginInput, RegisterInput, UserDto } from '@scribe/shared';
import { create } from 'zustand';
import { ApiError, api, setOnAuthFailure } from '../api/index.js';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  user: UserDto | null;
  status: AuthStatus;
  error: string | null;
  restore: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

/**
 * Authentication state. This is UI/session state (who is logged in) — NOT
 * document content, which will live in Yjs in a later phase. The access token
 * itself lives in the api client's memory, never here or in localStorage.
 */
export const useAuthStore = create<AuthState>((set) => {
  // When a transparent refresh fails, the client calls this — drop to anonymous.
  setOnAuthFailure(() => set({ user: null, status: 'anonymous' }));

  return {
    user: null,
    status: 'loading',
    error: null,

    async restore() {
      const res = await api.auth.restore();
      if (res) set({ user: res.user, status: 'authenticated', error: null });
      else set({ user: null, status: 'anonymous' });
    },

    async login(input) {
      try {
        const res = await api.auth.login(input);
        set({ user: res.user, status: 'authenticated', error: null });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : 'Login failed' });
        throw err;
      }
    },

    async register(input) {
      try {
        const res = await api.auth.register(input);
        set({ user: res.user, status: 'authenticated', error: null });
      } catch (err) {
        set({ error: err instanceof ApiError ? err.message : 'Registration failed' });
        throw err;
      }
    },

    async logout() {
      await api.auth.logout().catch(() => {});
      set({ user: null, status: 'anonymous', error: null });
    },

    clearError() {
      set({ error: null });
    },
  };
});
