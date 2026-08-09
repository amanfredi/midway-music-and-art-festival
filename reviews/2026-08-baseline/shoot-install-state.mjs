#!/usr/bin/env node
// Captures the install-prompt states that tools/shoot.mjs cannot reach.
//
// Headless Chromium neither fires `beforeinstallprompt` nor defines
// `navigator.standalone`, so pwa-install.js's mode() returns null and the
// install button never renders in a plain shoot.mjs run. Defining
// `navigator.standalone = false` before any page script runs puts the app on
// its Safari code path instead: 'ios' flavor on the touch (phone) context,
// 'macos' on the desktop context (discriminated by maxTouchPoints), which is
// exactly the pair of instruction sheets a real Safari user sees.
//
// Run from the repo root:  node reviews/2026-08-baseline/shoot-install-state.mjs
// Output lands next to this script.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = 4181;
const CLOCK = '2026-10-03T15:00'; // same demo clock as tools/shoot.mjs

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start on ${url}`);
}

const server = spawn('node', [join(ROOT, 'scripts/serve.mjs'), '--port', String(PORT)], {
  stdio: 'ignore',
});
try {
  await waitForServer(`http://localhost:${PORT}/index.html`);
  const browser = await chromium.launch();
  const variants = [
    { name: 'phone', ctx: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } } },
  ];
  for (const { name, ctx } of variants) {
    const context = await browser.newContext(ctx);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { get: () => false });
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/?t=${CLOCK}#/now`, { waitUntil: 'networkidle' });
    await page
      .waitForFunction(() => !document.querySelector('#view > .splash'), { timeout: 10_000 })
      .catch(() => {});
    const btn = page.locator('[data-testid="install-button"]');
    await btn.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(HERE, `now-install-button-${name}.png`) });
    await btn.click();
    await page.waitForSelector('.sheet', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(HERE, `install-sheet-${name}.png`) });
    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
console.log('install-state shots written to', HERE);
