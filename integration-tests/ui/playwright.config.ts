import { defineConfig, devices } from '@playwright/test';

// The Dev Hub (RHDH) route. Override with RHDH_BASE_URL if it changes.
const RHDH =
  process.env.RHDH_BASE_URL ||
  'https://v1-developer-hub-rhdh-test.apps.salamander.aimlworkbench.com';

export default defineConfig({
  testDir: './tests',
  // Agent creation drives the real scaffolder (repo publish + ArgoCD app +
  // operator reconcile) — give it room.
  timeout: 5 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: RHDH,
    // Reused GitHub-OAuth session captured by `npm run capture-auth`.
    storageState: 'auth/storageState.json',
    // VISIBLE by default (matches the "show real Chromium" preference).
    // Set HEADLESS=1 for CI / headless runs.
    headless: process.env.HEADLESS === '1',
    ignoreHTTPSErrors: true, // cluster route uses an internal CA
    actionTimeout: 30 * 1000,
    navigationTimeout: 60 * 1000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
