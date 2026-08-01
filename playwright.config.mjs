import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  webServer: {
    command: 'node scripts/serve.mjs --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173',
    browserName: 'chromium',
  },
});
