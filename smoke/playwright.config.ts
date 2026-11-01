import { defineConfig } from '@playwright/test';

/**
 * Smoke test (docs/SMOKE_TEST.md): starts the PRODUCTION build (`next start`) with
 * dummy settings and loads a handful of pages, to catch a broken deploy before a coach does.
 *
 * It needs `npm run smoke:build` first (a production build made with the same dummy settings),
 * then `npm run smoke`. No real Supabase, Stripe, Google or YouTube is used or reachable: the
 * pages never get a session, and the tests abort every request that leaves the local server.
 */
const PORT = Number(process.env.SMOKE_PORT ?? 3100);
export const BASE_URL = `http://localhost:${PORT}`;

/** Dummy values, also used for `smoke:build` (NEXT_PUBLIC_* are fixed into the build). */
export const SMOKE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://smoke.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'smoke-anon-key',
};

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // One retry in CI only; a test that passes on retry is reported as "flaky", not hidden.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '.output/report' }]] : 'list',
  outputDir: '.output/test-results',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    cwd: '..', // the repository root (the config lives in smoke/)
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...(process.env as Record<string, string>), ...SMOKE_ENV },
  },
});
