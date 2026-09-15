import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E for the graded offline scenarios (testing-strategy.md → "E2E").
 * These use REAL browsers, REAL IndexedDB, a REAL WebSocket, and Playwright's real
 * network-offline control (`context.setOffline`) — the only layer that can prove
 * the demo end to end (jsdom cannot exercise IndexedDB or true offline).
 *
 * Distinct users get distinct browser CONTEXTS (§17): each context has its own
 * cookie jar + IndexedDB, so User A and User B are genuinely separate sessions —
 * never two tabs sharing one auth/session.
 *
 * The stack must be running first (`docker compose up` or `pnpm dev`, with the DB
 * migrated). BASE_URL points at the web app; it defaults to the Vite dev server,
 * which proxies `/api` and `/collab` to the backend. Set PLAYWRIGHT_BASE_URL to
 * target another deployment.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  // Offline convergence needs a real (bounded) settling window; keep generous but
  // finite so a genuine failure still surfaces rather than hanging CI.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // These scenarios coordinate two contexts against one shared server document, so
  // they must not run in parallel with each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
