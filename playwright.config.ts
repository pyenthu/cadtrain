/**
 * Playwright config for cadtrain e2e tests.
 *
 * Two run modes (selected via PWHEAD env or --headed CLI flag):
 *   PWHEAD=1   bun run test:e2e:headed     watch in a real browser, slow_mo 250
 *   (default)  bun run test:e2e             headless, fast, CI-suitable
 *
 * The dev server is auto-started on a fresh port (4445) so it doesn't
 * collide with manual `bun run dev` on 3333. Reuse if already up.
 *
 * Add new specs under tests/e2e/. Smoke tests should each finish in
 * under a few seconds; longer flows go in tests/e2e/integration/ once
 * we have any.
 */

import { defineConfig, devices } from '@playwright/test';

const HEADED = process.env.PWHEAD === '1';
const PORT = Number(process.env.PWPORT ?? 4445);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // dev server is single-threaded; serial avoids flake
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/results/playwright-report' }]],
  outputDir: 'tests/results/playwright-output',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: HEADED ? 'off' : 'retain-on-failure',
    headless: !HEADED,
    launchOptions: HEADED ? { slowMo: 250 } : {},
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: `bun run dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
