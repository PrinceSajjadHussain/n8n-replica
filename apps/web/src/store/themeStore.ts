import { create } from 'zustand';

export type ThemeName = 'black' | 'blue' | 'white';

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const STORAGE_KEY = 'flowforge_theme';

function applyToDocument(theme: ThemeName) {
  document.documentElement.setAttribute('data-theme', theme);
}

function loadInitial(): ThemeName {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'black' || raw === 'blue' || raw === 'white') return raw;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return 'black';
}

const initialTheme = loadInitial();
if (typeof document !== 'undefined') applyToDocument(initialTheme);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore persistence errors, theme still applies for this session */
    }
    applyToDocument(theme);
    set({ theme });
  },
}));
