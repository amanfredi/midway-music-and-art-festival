import { defineConfig } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Each checkout gets its own stable test port, derived from this file's
// absolute path, so concurrent sessions in different worktrees never fight
// over one hardcoded port. Deterministic (not a random free port) because
// Playwright re-evaluates this config in worker processes, which must all
// agree with the main process. PW_PORT overrides on the off chance two
// checkouts hash to the same port.
const checkoutDir = fileURLToPath(new URL('.', import.meta.url));
const hashedPort = 4173 + (createHash('sha256').update(checkoutDir).digest().readUInt16BE(0) % 20000);
const port = process.env.PW_PORT ? Number(process.env.PW_PORT) : hashedPort;

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  webServer: {
    command: `node scripts/serve.mjs --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: 'chromium',
  },
});
