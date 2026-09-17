import { create } from 'zustand';

/**
 * Theme preference (task §6). This is a per-browser UI PREFERENCE — never document
 * content — so localStorage is the correct home for it. The resolved light/dark
 * value is applied to `document.documentElement[data-theme]`, which the design
 * system's CSS variables key off (see index.css + tailwind.config.js). The document
 * SHEET itself stays a readable light surface in both themes; only the application
 * chrome changes (see the `.scribe-page-sheet` overrides in index.css).
 */
export type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'scribe-theme';

function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Private mode / blocked storage — fall back to the default.
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

/** Apply the resolved theme to the document root (drives the CSS variables). */
function applyTheme(pref: ThemePreference): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const initial = readStoredPreference();
  applyTheme(initial);

  // Keep "system" live: react to OS theme changes while that preference is active.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readStoredPreference() === 'system') applyTheme('system');
    };
    // addEventListener is supported everywhere we target; ignore if unavailable.
    mq.addEventListener?.('change', onChange);
  }

  return {
    preference: initial,
    setPreference: (preference) => {
      try {
        localStorage.setItem(STORAGE_KEY, preference);
      } catch {
        // Persisting is best-effort; the in-memory value still applies this session.
      }
      applyTheme(preference);
      set({ preference });
    },
  };
});
