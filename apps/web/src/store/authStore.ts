import { create } from 'zustand';

interface User {
  id: string;
  email: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

const STORAGE_KEY = 'flowforge_auth';

function loadInitial(): Pick<AuthState, 'user' | 'accessToken' | 'refreshToken'> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, accessToken: null, refreshToken: null };
    return JSON.parse(raw);
  } catch {
    return { user: null, accessToken: null, refreshToken: null };
  }
}

function persist(state: Pick<AuthState, 'user' | 'accessToken' | 'refreshToken'>) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...loadInitial(),
  setSession: (user, accessToken, refreshToken) => {
    const next = { user, accessToken, refreshToken };
    persist(next);
    set(next);
  },
  setTokens: (accessToken, refreshToken) => {
    const next = { user: get().user, accessToken, refreshToken };
    persist(next);
    set({ accessToken, refreshToken });
  },
  logout: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));
