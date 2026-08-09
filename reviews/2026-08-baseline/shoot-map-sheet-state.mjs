#!/usr/bin/env node
// Captures the map view with a venue detail sheet open — a state
// tools/shoot.mjs --click cannot reach: Playwright's page.click() times out
// on the SVG pin <g> (pin taps are dispatched from a listener on the svg
// root via elementFromPoint, and the pin's own center is covered by its
// .pin__hit polygon), and shoot.mjs swallows the click failure silently.
// Keyboard activation is the reliable path — pins carry role="button"
// tabindex="0" with Enter/Space handling, and tests/a11y.spec.mjs activates
// them the same way.
//
// Run from the repo root:  node reviews/2026-08-baseline/shoot-map-sheet-state.mjs
// Output lands next to this script.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = 4183;
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
    { name: 'narrow', ctx: { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true } },
  ];
  for (const { name, ctx } of variants) {
    const context = await browser.newContext(ctx);
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/?t=${CLOCK}#/map`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.circuit-map-svg', { timeout: 10_000 });
    const pin = page.locator('[data-testid="venue-pin"]').first();
    await pin.press('Enter');
    await page.waitForSelector('.sheet', { timeout: 5000 });
    await page.waitForTimeout(300); // let the open transition settle
    await page.screenshot({ path: join(HERE, `map-sheet-open-${name}.png`) });
    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
console.log('map-sheet shots written to', HERE);
