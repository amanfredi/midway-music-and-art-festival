#!/usr/bin/env node
// Capture harness for the venue sheet's scroll cue: the fade that says content
// runs past the sheet's edge (PROGRESS.md, "the sheet admits it scrolls").
//
// Three prefixes, all out of ONE browser session, for the same reason the other
// harness in this directory keeps its four in one: the CSS font stack resolves
// differently between headless launches (../2026-09-map-collisions/RECIPE.md),
// and a pair shot in two launches is a pair with two variables in it.
//
//   before-cue-  the sheet as it shipped: content clipped at the border
//   after-cue-   the same sheet with the fade at the edge that has more behind it
//   end-cue-     the same sheet scrolled to its end, where the cue moves to the
//                top edge and the bottom one goes out
//
// `before-` removes the two fade elements from the open dialog. That is the
// whole of the visible change — the dialog/scroller split behind it moved no
// padding and no pixel — so the shot is the previous state rather than an
// approximation of it. Done to the element rather than by deleting rules out of
// the stylesheet, per the other harness's note: selector names change, and a
// harness that strips the wrong rule photographs a state that never shipped.
//
// Two surfaces, because the sheet overflows on both. `-phone` is the embed on a
// phone, inside a host page, which is where the report came from; `-app` is the
// app's own bottom sheet in a short window (a landscape phone, a small laptop),
// where 80vh is no roomier than the embed's frame.
//
// Run from the repo root, after building from the snapshot (see RECIPE.md):
//   node reviews/2026-09-embed-sheet/shoot-sheet-cue.mjs
// Output lands next to this script.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = 4189; // not 4187: the other harness in this directory owns that one
const CLOCK = '2026-10-03T15:00';

const PHONE = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };
/** A short window: the app's own sheet at 80vh has no more room than the embed's. */
const SHORT_WINDOW = { viewport: { width: 393, height: 480 } };

/** The host page from README's snippet, with the viewport meta the real one has. */
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

/** Every rendered venue pin clear of the canvas edges, topmost first. */
const PINS_BY_HEIGHT = `() => {
  const map = window.__mmafMap;
  const canvas = map.getCanvas().getBoundingClientRect();
  return map
    .queryRenderedFeatures({ layers: ['venue-pin'] })
    .map((f) => ({ id: f.properties.id, p: map.project(f.geometry.coordinates) }))
    .filter((f) => f.p.x > 40 && f.p.x < canvas.width - 40 && f.p.y > 30 && f.p.y < canvas.height - 40)
    .sort((a, b) => a.p.y - b.p.y)
    .map((f) => ({ id: f.id, x: Math.round(f.p.x), y: Math.round(f.p.y) }));
}`;

/** What the open sheet reports about itself: how far past its edge it runs. */
const SHEET_STATE = `() => {
  const d = document.querySelector('dialog.sheet');
  if (!d) return null;
  const s = d.querySelector('.sheet__scroll');
  return {
    state: d.dataset.sheetScroll ?? null,
    height: Math.round(d.getBoundingClientRect().height),
    overflow: s ? Math.round(s.scrollHeight - s.clientHeight) : null,
    fades: d.querySelectorAll('.sheet__fade').length,
  };
}`;

/** The "before": the sheet without its cue, which is exactly what shipped. */
const STRIP_CUE = `() => {
  const d = document.querySelector('dialog.sheet');
  if (!d) return false;
  const fades = d.querySelectorAll('.sheet__fade');
  fades.forEach((el) => el.remove());
  return fades.length > 0;
}`;

const SCROLL_TO_END = `() => {
  const s = document.querySelector('dialog.sheet .sheet__scroll');
  if (!s) return false;
  s.scrollTop = s.scrollHeight;
  return true;
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

async function settleMap(target) {
  await target.waitForFunction(() => window.__mmafMap && window.__mmafMap.loaded(), null, { timeout: 30_000 });
  await target.evaluate(
    () =>
      new Promise((resolve) => {
        const map = window.__mmafMap;
        const done = () => setTimeout(resolve, 400);
        map.once('idle', done);
        setTimeout(done, 2000);
      }),
  );
}

const server = spawn('node', [join(ROOT, 'scripts/serve.mjs'), '--port', String(PORT)], { stdio: 'ignore' });
const written = [];
const shoot = async (page, name) => {
  const file = join(HERE, `${name}.png`);
  await page.screenshot({ path: file });
  written.push(file.replace(ROOT + '/', ''));
};

try {
  await waitForServer(`http://localhost:${PORT}/index.html`);
  const browser = await chromium.launch();

  // -- the embed on a phone, inside a host page: where the report came from ---
  {
    // Service workers blocked: the site's own installs on the first load and
    // then answers /embed-host.html with the *app*, because a page route cannot
    // intercept what a service worker serves.
    const context = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
    for (const prefix of ['before', 'after', 'end']) {
      const page = await context.newPage();
      await page.route('**/embed-host.html', (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: hostPage(PORT) }),
      );
      await page.goto(`http://localhost:${PORT}/embed-host.html`, { waitUntil: 'load' });
      await page.waitForSelector('.mmaf-map-embed');
      const frame = page.frames().find((f) => f.url().includes('embed=map'));
      await settleMap(frame);

      // The reader's position: the map at the top of the screen, the rest of the
      // embed below the fold.
      const box = await page.locator('.mmaf-map-embed').boundingBox();
      const mapTop = await frame.evaluate(
        () => document.querySelector('#map-svg-wrap').getBoundingClientRect().top + window.scrollY,
      );
      await page.evaluate((y) => window.scrollTo(0, y), box.y + (await page.evaluate(() => window.scrollY)) + mapTop);
      await page.waitForTimeout(300);

      // A pin tap, so the sheet sits on the map frame's bottom edge and the shot
      // is comparable with the committed after-sheet-phone.png. The first pin
      // whose venue actually overflows the frame -- a venue with a short blurb
      // and no events would photograph nothing.
      const pins = await frame.evaluate(new Function('return ' + PINS_BY_HEIGHT)());
      let chosen = null;
      for (const pin of pins) {
        await page
          .frameLocator('.mmaf-map-embed')
          .locator('.maplibregl-canvas')
          .click({ position: { x: pin.x, y: pin.y } });
        await page.waitForTimeout(500);
        const state = await frame.evaluate(new Function('return ' + SHEET_STATE)());
        if (state && state.overflow > 0) {
          chosen = { pin, state };
          break;
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }
      if (!chosen) throw new Error('no venue sheet overflows the map frame; nothing to photograph');

      if (prefix === 'before') {
        const stripped = await frame.evaluate(new Function('return ' + STRIP_CUE)());
        if (!stripped) throw new Error('no cue to strip; is this the old code?');
      }
      if (prefix === 'end') {
        await frame.evaluate(new Function('return ' + SCROLL_TO_END)());
        await page.waitForTimeout(400);
      }
      const shown = await frame.evaluate(new Function('return ' + SHEET_STATE)());
      console.log(
        `   ${prefix}/phone: ${chosen.pin.id} — sheet ${shown.height}px, ${shown.overflow}px past its edge, ` +
          `data-sheet-scroll="${shown.state}", ${shown.fades} fade element(s)`,
      );
      await shoot(page, `${prefix}-cue-phone`);
      await page.close();
    }
    await context.close();
  }

  // -- the app's own bottom sheet in a short window --------------------------
  {
    const context = await browser.newContext({ ...SHORT_WINDOW, serviceWorkers: 'block' });
    for (const prefix of ['before', 'after', 'end']) {
      const page = await context.newPage();
      await page.goto(`http://localhost:${PORT}/?t=${CLOCK}#/map`, { waitUntil: 'load' });
      await settleMap(page);

      await page.locator('.venue-key-btn').first().click();
      await page.waitForSelector('dialog.sheet');
      await page.waitForTimeout(400);

      if (prefix === 'before') {
        const stripped = await page.evaluate(new Function('return ' + STRIP_CUE)());
        if (!stripped) throw new Error('no cue to strip; is this the old code?');
      }
      if (prefix === 'end') {
        await page.evaluate(new Function('return ' + SCROLL_TO_END)());
        await page.waitForTimeout(400);
      }
      const shown = await page.evaluate(new Function('return ' + SHEET_STATE)());
      console.log(
        `   ${prefix}/app: sheet ${shown.height}px, ${shown.overflow}px past its edge, ` +
          `data-sheet-scroll="${shown.state}", ${shown.fades} fade element(s)`,
      );
      await shoot(page, `${prefix}-cue-app`);
      await page.close();
    }
    await context.close();
  }

  // -- the edge itself, magnified -------------------------------------------
  //
  // The cue lives in the last ~35px of a 361px sheet, which is exactly the band
  // a whole-screen shot at 1x loses. These two are the same crop of the same
  // sheet with and without it, at 3x, and they are what the question "is this
  // visible enough" should actually be judged on. Same surface as the phone
  // shots above: the embed, on a host page, sheet sitting on the map frame.
  {
    const context = await browser.newContext({ ...PHONE, deviceScaleFactor: 3, serviceWorkers: 'block' });
    for (const prefix of ['before', 'after']) {
      const page = await context.newPage();
      await page.route('**/embed-host.html', (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: hostPage(PORT) }),
      );
      await page.goto(`http://localhost:${PORT}/embed-host.html`, { waitUntil: 'load' });
      await page.waitForSelector('.mmaf-map-embed');
      const frame = page.frames().find((f) => f.url().includes('embed=map'));
      await settleMap(frame);
      const box = await page.locator('.mmaf-map-embed').boundingBox();
      const mapTop = await frame.evaluate(
        () => document.querySelector('#map-svg-wrap').getBoundingClientRect().top + window.scrollY,
      );
      await page.evaluate((y) => window.scrollTo(0, y), box.y + (await page.evaluate(() => window.scrollY)) + mapTop);
      await page.waitForTimeout(300);

      const pins = await frame.evaluate(new Function('return ' + PINS_BY_HEIGHT)());
      let opened = false;
      for (const pin of pins) {
        await page
          .frameLocator('.mmaf-map-embed')
          .locator('.maplibregl-canvas')
          .click({ position: { x: pin.x, y: pin.y } });
        await page.waitForTimeout(500);
        const state = await frame.evaluate(new Function('return ' + SHEET_STATE)());
        if (state && state.overflow > 0) {
          opened = true;
          break;
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }
      if (!opened) throw new Error('no venue sheet overflows the map frame; nothing to photograph');
      if (prefix === 'before') await frame.evaluate(new Function('return ' + STRIP_CUE)());
      await page.waitForTimeout(300);

      // The sheet is `position: fixed` inside the iframe, so its rect is in the
      // iframe's viewport coordinates; the iframe's own box puts it back into
      // the host page's. Both are viewport-relative, which is what a clip on a
      // non-fullPage screenshot is measured in.
      const iframeBox = await page.locator('.mmaf-map-embed').boundingBox();
      const rect = await frame.evaluate(() => {
        const r = document.querySelector('dialog.sheet').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      await page.screenshot({
        path: join(HERE, `${prefix}-cue-phone-edge.png`),
        clip: {
          x: Math.round(iframeBox.x + rect.x),
          y: Math.round(iframeBox.y + rect.y + rect.height - 56),
          width: Math.round(rect.width),
          height: 56,
        },
      });
      written.push(`reviews/2026-09-embed-sheet/${prefix}-cue-phone-edge.png`);
      await page.close();
    }
    await context.close();
  }

  await browser.close();
} finally {
  server.kill();
}
console.log(written.join('\n'));
