#!/usr/bin/env node
// tools/shoot.mjs — dev-only screenshot harness. Renders routes of the local
// site to PNGs so a change can be eyeballed (by a human or by an agent that
// can read images) without a manual browser pass. NOT part of `npm run build`
// or `npm test`; output goes to .screenshots/, which is gitignored.
//
// Usage:
//   node tools/shoot.mjs                                  # default routes, phone + desktop
//   node tools/shoot.mjs --routes '#/map,#/schedule'
//   node tools/shoot.mjs --viewports phone
//   node tools/shoot.mjs --full                           # full-page, not just the viewport
//   node tools/shoot.mjs --scroll 400                     # scroll #view down N px first
//   node tools/shoot.mjs --out .screenshots/before
//
// Serves site/ on its own port so it never collides with a dev server.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg('port', 4180));
const OUT = join(ROOT, arg('out', '.screenshots'));
const FULL = has('full');
const SCROLL = Number(arg('scroll', 0));
// Demo clock, so "On now" and the schedule have content outside October.
const CLOCK = arg('t', '2026-10-03T15:00');

// deviceScaleFactor stays 1 even for phones: these PNGs are for eyeballing
// layout, and 2x doubles the file size for no extra information.
const ALL_VIEWPORTS = {
  phone: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
  wide: { viewport: { width: 1920, height: 1080 } },
  narrow: { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true },
};

const routes = arg('routes', '#/now,#/schedule,#/map,#/starred,#/vendors,#/sponsors')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
const viewportNames = arg('viewports', 'phone,desktop')
  .split(',')
  .map((v) => v.trim())
  .filter((v) => ALL_VIEWPORTS[v]);

const slug = (route) => route.replace(/^#\//, '').replace(/[^a-z0-9]+/gi, '-') || 'root';

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

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const server = spawn('node', [join(ROOT, 'scripts/serve.mjs'), '--port', String(PORT)], {
  stdio: 'ignore',
});
const shots = [];
try {
  await waitForServer(`http://localhost:${PORT}/index.html`);
  const browser = await chromium.launch();
  for (const name of viewportNames) {
    const context = await browser.newContext(ALL_VIEWPORTS[name]);
    // Seed starred events so #/starred has something to show. addInitScript
    // runs before any page script, so the store sees them on first render.
    const stars = arg('stars', '');
    if (stars) {
      await context.addInitScript((ids) => {
        localStorage.setItem('mfc:starred', JSON.stringify(ids));
      }, stars.split(',').map((s) => s.trim()).filter(Boolean));
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    for (const route of routes) {
      await page.goto(`http://localhost:${PORT}/?t=${CLOCK}${route}`, { waitUntil: 'networkidle' });
      // Views render async (content.json fetch, map.svg inline); wait for the
      // splash to be replaced by real content rather than a fixed sleep.
      await page
        .waitForFunction(() => !document.querySelector('#view > .splash'), { timeout: 10_000 })
        .catch(() => {});
      if (route === '#/map') {
        await page.waitForSelector('.circuit-map-svg', { timeout: 10_000 }).catch(() => {});
      }
      // --click '#zoom-out x3' presses a control before shooting, for states
      // that only exist after interaction (zoom levels, open sheets).
      const click = arg('click', '');
      if (click) {
        const [sel, times] = click.split(/\s+x/);
        for (let i = 0; i < Number(times || 1); i++) {
          await page.click(sel).catch(() => {});
          await page.waitForTimeout(120);
        }
      }
      if (SCROLL) {
        await page.evaluate((y) => window.scrollTo(0, y), SCROLL);
        await page.waitForTimeout(150);
      }
      const file = join(OUT, `${slug(route)}-${name}.png`);
      await page.screenshot({ path: file, fullPage: FULL });
      shots.push(file.replace(ROOT, ''));
    }
    await context.close();
    if (errors.length) {
      console.log(`\n!! console/page errors at ${name}:`);
      for (const e of [...new Set(errors)]) console.log(`   ${e}`);
    }
  }
  await browser.close();
} finally {
  server.kill();
}

console.log(shots.join('\n'));
