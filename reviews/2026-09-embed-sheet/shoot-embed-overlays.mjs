#!/usr/bin/env node
// Capture harness for the embedded map's overlays: the venue sheet and the
// toasts, in an iframe on a tall host page.
//
// Two rounds, four prefixes, all out of ONE browser session:
//   before-/after-  whether an overlay is anchored at all, shot with the map on
//                   screen (a pin tap, and the locate button's toast)
//   frame-/tap-     which anchor, shot from the end of the venue key with the
//                   map frame off screen (a venue-card tap)
// The earlier state in each pair is reproduced on the live page -- `before-` by
// stripping the anchor off the element, `frame-` by putting the sheet back on
// the map frame after it opens, which is what the previous code computed.
// Shooting them from a git checkout instead would put the two prefixes in
// different browser launches, which this repo has already been bitten by: the
// CSS font stack resolves differently per launch (../2026-09-map-collisions).
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

/**
 * Undoes the anchoring on one overlay, which is the "before" state: with the
 * custom properties and the data attribute gone, every `body.is-embed` rule
 * falls back to the app's own values and the overlay returns to the bottom of
 * the iframe. Done to the element rather than by deleting rules out of the
 * stylesheet -- selector names change, and a harness that quietly strips the
 * wrong rule photographs a state nothing ever shipped.
 */
const STRIP_ANCHOR = `(selector) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  for (const p of ['left', 'width', 'height', 'bottom', 'middle']) el.style.removeProperty('--embed-anchor-' + p);
  delete el.dataset.embedAnchor;
  return true;
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
      if (prefix === 'before') {
        const stripped = await frame.evaluate(new Function('return ' + STRIP_ANCHOR)(), 'dialog.sheet');
        if (!stripped) throw new Error('no sheet to un-anchor');
      }
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
      if (prefix === 'before') {
        const stripped = await frame.evaluate(new Function('return ' + STRIP_ANCHOR)(), '#toast-root');
        if (!stripped) throw new Error('no toast root to un-anchor');
      }
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

  // --- the second round: which anchor, not whether there is one -------------
  //
  // `frame-` is the state above (`after-`), photographed from the other end of
  // the page: the visitor has scrolled to the end of the venue key and the map
  // frame the sheet anchors to is a screen above them. `tap-` anchors the sheet
  // to the card instead. Same session, same page, and `frame-` is reproduced by
  // putting the sheet back on the frame after it opens -- which is exactly what
  // the previous code computed.
  const RE_ANCHOR_TO_FRAME = `() => {
    const d = document.querySelector('dialog.sheet');
    const f = document.querySelector('.map-frame').getBoundingClientRect();
    d.dataset.embedAnchor = 'bottom';
    d.style.setProperty('--embed-anchor-bottom', String(Math.round(window.innerHeight - f.bottom)) + 'px');
  }`;

  for (const { name: viewport, ctx } of VIEWPORTS) {
    const context = await browser.newContext({ ...ctx, serviceWorkers: 'block' });
    for (const prefix of ['frame', 'tap']) {
      const page = await context.newPage();
      await page.route('**/embed-host.html', (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: hostPage(PORT) }),
      );
      await page.goto(`http://localhost:${PORT}/embed-host.html`, { waitUntil: 'load' });
      await page.waitForSelector('.mmaf-map-embed');
      const frame = page.frames().find((f) => f.url().includes('embed=map'));
      await frame.waitForFunction(() => window.__mmafMap && window.__mmafMap.loaded(), null, { timeout: 30_000 });
      await page.waitForTimeout(1200);

      const ids = await frame.evaluate(() =>
        [...document.querySelectorAll('.venue-key-btn')].map((b) => b.dataset.venueId),
      );
      const last = ids[ids.length - 1];
      const cardTop = await frame.evaluate(
        (id) => document.querySelector(`.venue-key-btn[data-venue-id="${id}"]`).getBoundingClientRect().top,
        last,
      );
      const box = await page.locator('.mmaf-map-embed').boundingBox();
      const vh = await page.evaluate(() => window.innerHeight);
      await page.evaluate(
        (y) => window.scrollTo(0, y),
        box.y + (await page.evaluate(() => window.scrollY)) + cardTop - vh / 2,
      );
      await page.waitForTimeout(300);

      await page.frameLocator('.mmaf-map-embed').locator(`.venue-key-btn[data-venue-id="${last}"]`).click();
      await page.waitForTimeout(500);
      if (prefix === 'frame') await frame.evaluate(new Function('return ' + RE_ANCHOR_TO_FRAME)());
      await page.waitForTimeout(300);

      const sheetAt = await frame.evaluate(() => {
        const d = document.querySelector('dialog.sheet');
        return d ? Math.round(d.getBoundingClientRect().top) : null;
      });
      console.log(`   ${prefix}/${viewport}: card tap on ${last} opens the sheet at y=${sheetAt} inside the iframe`);
      const file = join(HERE, `${prefix}-card-${viewport}.png`);
      await page.screenshot({ path: file });
      written.push(file.replace(ROOT + '/', ''));
      await page.close();
    }
    await context.close();
  }

  await browser.close();
} finally {
  server.kill();
}
console.log(written.join('\n'));
