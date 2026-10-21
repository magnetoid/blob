/**
 * One browser run against a booted production image (`.github/workflows/ci.yml`, the
 * `image` job): the client is the acceptance test for the server, and this is that
 * acceptance test run end to end rather than by parts.
 *
 * Chrome is the runner's own (`channel: 'chrome'` — GitHub's Ubuntu images carry it), so
 * nothing downloads a browser. One worker and no retries: the run founds a workspace, and
 * a second attempt would meet a server that is no longer fresh.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
