import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Theme preference (task §6): persisted to localStorage and applied to the document
 * root as `data-theme`, so it survives reload and drives the design-system CSS
 * variables. The store initializes at import time, so each test imports it fresh
 * with a controlled localStorage.
 */
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  // Deterministic system preference (light) for the tests.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('themeStore', () => {
  it('defaults to system and resolves to the OS preference', async () => {
    const { useThemeStore, resolveTheme } = await import('./themeStore.js');
    expect(useThemeStore.getState().preference).toBe('system');
    // matchMedia stubbed to light → system resolves to light.
    expect(resolveTheme('system')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies and persists an explicit dark preference', async () => {
    const { useThemeStore } = await import('./themeStore.js');
    useThemeStore.getState().setPreference('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('scribe-theme')).toBe('dark');
  });

  it('restores a saved preference on the next load (survives reload)', async () => {
    localStorage.setItem('scribe-theme', 'dark');
    const { useThemeStore } = await import('./themeStore.js');
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('switching light applies the light theme', async () => {
    localStorage.setItem('scribe-theme', 'dark');
    const { useThemeStore } = await import('./themeStore.js');
    useThemeStore.getState().setPreference('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('scribe-theme')).toBe('light');
  });
});
