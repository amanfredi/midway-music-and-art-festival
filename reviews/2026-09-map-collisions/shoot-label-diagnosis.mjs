#!/usr/bin/env node
// Why three venues with visible free space around them go unnamed at the leader
// zoom on a phone frame (Anthony, 2026-09-04, reading before/after-labels-phone).
//
// Turns on MapLibre's own `showCollisionBoxes`, which draws the box every
// symbol reserves. That is the whole answer in one picture: the boxes a
// displaced pin reserves are far larger than the pin it draws, because the
// composite image spans dot to diamond and the collision box is the image rect.
// The paper that looks free is inside somebody's box.
//
// Run from the repo root:
//   node reviews/2026-09-map-collisions/shoot-label-diagnosis.mjs
// Output lands next to this script as diag-*.png.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = 4187;
const CLOCK = '2026-10-03T15:00';

// The three Anthony named, plus the overview they were read from.
const CLOSE_UPS = [
  { name: 'ginkgo', id: 'ginkgocoffeehouse' },
  { name: 'mosaic', id: 'mosaiconastick' },
  { name: 'fluidink', id: 'fluidinktattoos' },
];

const VIEWPORTS = [
  { name: 'phone', ctx: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } },
  { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } } },
];

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

const settle = (page, ms = 400) =>
  page.evaluate(
    (delay) =>
      new Promise((resolve) => {
        const done = () => setTimeout(resolve, delay);
        window.__mmafMap.once('idle', done);
        setTimeout(done, 2000);
      }),
    ms,
  );

const server = spawn('node', [join(ROOT, 'scripts/serve.mjs'), '--port', String(PORT)], { stdio: 'ignore' });
const written = [];
try {
  await waitForServer(`http://localhost:${PORT}/index.html`);
  const browser = await chromium.launch();
  for (const { name: viewport, ctx } of VIEWPORTS) {
    const context = await browser.newContext(ctx);
    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/?t=${CLOCK}#/map`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mmafMap && window.__mmafMap.loaded(), null, { timeout: 30_000 });
    await settle(page);
    await page.evaluate(() => {
      window.__mmafMap.showCollisionBoxes = true;
    });

    const shot = async (label) => {
      const file = join(HERE, `diag-${label}-${viewport}.png`);
      await page.screenshot({ path: file });
      written.push(file.replace(ROOT + '/', ''));
    };

    // The view the complaint was read from: home centre, leader zoom.
    const home = await page.evaluate(() => {
      const map = window.__mmafMap;
      const centre = map.getCenter().toArray();
      const zoom = map.getLayer('venue-leader-pin').minzoom;
      map.jumpTo({ center: centre, zoom });
      return { centre, zoom };
    });
    await settle(page);
    await shot('overview');

    // Desktop is here for contrast only: the boxes are identical, the frame is
    // wider, and more names therefore fit. The diagnosis is about the phone.
    if (viewport === 'desktop') {
      await context.close();
      continue;
    }

    for (const { name, id } of CLOSE_UPS) {
      const found = await page.evaluate(
        ([wanted, zoom]) => {
          const map = window.__mmafMap;
          const featuresOf = (source) => {
            const raw = map.getSource(source)._data ?? {};
            return (raw.geojson ?? raw).features ?? [];
          };
          const match = [...featuresOf('venue-groups'), ...featuresOf('venues')].find(
            (f) => f.properties.id === wanted,
          );
          if (!match) return null;
          map.jumpTo({ center: match.geometry.coordinates, zoom });
          return match.properties.name;
        },
        [id, home.zoom],
      );
      if (!found) {
        console.log(`!! ${id} is not a venue any more — shot skipped`);
        continue;
      }
      await settle(page);
      await shot(name);
    }
    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
console.log(written.join('\n'));
