import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup-env.ts'],
    // Runs once before all workers: guards against truncating a non-test database
    // and creates the test database if missing (see test/global-setup.ts).
    globalSetup: ['./test/global-setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests share one Postgres database; run test files serially to
    // avoid cross-file truncation races.
    fileParallelism: false,
    // Real WebSocket collaboration tests do multi-step connect/sync/restart flows
    // over a live socket + Postgres, which need more than the 5s default.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
