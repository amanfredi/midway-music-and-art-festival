#!/usr/bin/env node
// Capture harness for the embedded map's overlays: the venue sheet and the
// toasts, in an iframe on a tall host page.
//
// Both states come out of ONE browser session. The two prefixes are the same
// page, loaded twice, differing only in whether the `body.is-embed .sheet` and
// `body.is-embed #toast-root` rules are deleted from the stylesheet after load
// -- those rules are the entire positional change, so deleting them reproduces
// the reported behaviour exactly. Shooting `before` from a git checkout instead
// would put the two prefixes in different browser launches, which this repo has
// already been bitten by: the CSS font stack resolves differently per launch
// (see ../2026-09-map-collisions/RECIPE.md).
//
// Run from the repo root:
//   node reviews/2026-09-embed-sheet/shoot-embed-overlays.mjs
// Output lands next to this script.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = 4187;
const CLOCK = '2026-10-03T15:00'; // same demo clock as tools/shoot.mjs

const VIEWPORTS = [
  { name: 'phone', ctx: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } },
  { name: 'desktop', ctx: { viewport: { width: 1280, height: 900 } } },
];

/** The host page from README's snippet: bands of content with the embed between them. */
const hostPage = (port) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Host page</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; font: 16px system-ui; color: #2b1830; }
  .band { padding: 3rem 1.5rem; background: #f4eef6; }
  .band p { max-width: 40rem; margin: 0 auto 1rem; line-height: 1.5; }
  .mmaf-map-embed { display: block; width: 100%; border: 0; height: 1400px; }
  @media (max-width: 520px) { .mmaf-map-embed { height: 1810px; } }
</style></head>
<body>
<div class="band"><p><b>Festival map</b></p><p>Stand-in for the Squarespace page: enough
copy above and below the embed that the host page scrolls the way the real one does.</p></div>
<iframe class="mmaf-map-embed" src="http://localhost:${port}/?t=${CLOCK}&embed=map"
        title="Midway Music &amp; Arts Fest map" allow="geolocation"></iframe>
<div class="band"><p>Planning your day? The full schedule, your saved events and the map
are at go.midwaymusicandart.org.</p></div>
<script>
  window.addEventListener('message', function (event) {
    var frame = document.querySelector('.mmaf-map-embed');
    if (!frame || !event.data || event.data.type !== 'mmaf-embed-height') return;
    if (event.source !== frame.contentWindow) return;
    var height = Number(event.data.height);
    if (height > 200 && height < 6000) frame.style.height = height + 'px';
  });
</script>
</body></html>`;

/** The rules js/embed.js feeds. Deleting them is the "before" state. */
const STRIP_ANCHOR_RULES = `() => {
  let removed = 0;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (let i = rules.length - 1; i >= 0; i--) {
      const sel = rules[i].selectorText;
      if (sel === 'body.is-embed .sheet' || sel === 'body.is-embed #toast-root') {
        sheet.deleteRule(i);
        removed++;
      }
    }
  }
  return removed;
}`;

const TOPMOST_PIN = `() => {
  const map = window.__mmafMap;
  const canvas = map.getCanvas().getBoundingClientRect();
  const inside = map
    .queryRenderedFeatures({ layers: ['venue-pin'] })
    .map((f) => ({ id: f.properties.id, p: map.project(f.geometry.coordinates) }))
    .filter((f) => f.p.x > 40 && f.p.x < canvas.width - 40 && f.p.y > 30 && f.p.y < canvas.height - 40)
    .sort((a, b) => a.p.y - b.p.y);
  return inside.length ? { id: inside[0].id, x: Math.round(inside[0].p.x), y: Math.round(inside[0].p.y) } : null;
}`;

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

const server = spawn('node', [join(ROOT, 'scripts/serve.mjs'), '--port', String(PORT)], { stdio: 'ignore' });
const written = [];
try {
  await waitForServer(`http://localhost:${PORT}/index.html`);
  const browser = await chromium.launch();
  for (const { name: viewport, ctx } of VIEWPORTS) {
    // Service workers blocked: the site's own would install on the first load
    // and then serve the *app* for /embed-host.html on the second, because a
    // page route cannot intercept what a service worker answers.
    const context = await browser.newContext({ ...ctx, serviceWorkers: 'block' });

    // A page per prefix, so nothing the first shoot did can carry into the second.
    for (const prefix of ['before', 'after']) {
      const page = await context.newPage();
      await page.route('**/embed-host.html', (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: hostPage(PORT) }),
      );
      await page.goto(`http://localhost:${PORT}/embed-host.html`, { waitUntil: 'load' });
      await page.waitForSelector('.mmaf-map-embed');
      const frame = page.frames().find((f) => f.url().includes('embed=map'));
      await frame.waitForFunction(() => window.__mmafMap && window.__mmafMap.loaded(), null, { timeout: 30_000 });
      await frame.evaluate(
        () =>
          new Promise((resolve) => {
            const map = window.__mmafMap;
            const done = () => setTimeout(resolve, 400);
            map.once('idle', done);
            setTimeout(done, 2000);
          }),
      );
      if (prefix === 'before') {
        const removed = await frame.evaluate(new Function('return ' + STRIP_ANCHOR_RULES)());
        if (removed !== 2) throw new Error(`expected to strip 2 anchor rules, stripped ${removed}`);
      }

      // The reader's position: the map at the top of the screen, the rest of the
      // embed below the fold. This is what makes a bottom-of-iframe overlay
      // invisible, and it is where the report came from.
      const box = await page.locator('.mmaf-map-embed').boundingBox();
      console.log(`   ${prefix}/${viewport}: iframe is ${Math.round(box.height)}px tall`);
      const mapTop = await frame.evaluate(
        () => document.querySelector('#map-svg-wrap').getBoundingClientRect().top + window.scrollY,
      );
      await page.evaluate((y) => window.scrollTo(0, y), box.y + (await page.evaluate(() => window.scrollY)) + mapTop);
      await page.waitForTimeout(300);

      const shot = async (label) => {
        const file = join(HERE, `${prefix}-${label}-${viewport}.png`);
        await page.screenshot({ path: file });
        written.push(file.replace(ROOT + '/', ''));
      };

      const pin = await frame.evaluate(new Function('return ' + TOPMOST_PIN)());
      if (!pin) throw new Error('no venue pin clear of the canvas edges');
      await page
        .frameLocator('.mmaf-map-embed')
        .locator('.maplibregl-canvas')
        .click({ position: { x: pin.x, y: pin.y } });
      await page.waitForTimeout(600);
      const sheetAt = await frame.evaluate(() => {
        const d = document.querySelector('dialog.sheet');
        return d ? Math.round(d.getBoundingClientRect().top) : null;
      });
      console.log(`   ${prefix}/${viewport}: sheet for ${pin.id} opens at y=${sheetAt} inside the iframe`);
      await shot('sheet');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.frameLocator('.mmaf-map-embed').locator('#locate-btn').click();
      await page.waitForTimeout(600);
      const toastAt = await frame.evaluate(() => {
        const t = document.querySelector('.toast');
        return t ? Math.round(t.getBoundingClientRect().top) : null;
      });
      console.log(`   ${prefix}/${viewport}: toast opens at y=${toastAt} inside the iframe`);
      await shot('toast');
      await page.close();
    }

    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
console.log(written.join('\n'));
