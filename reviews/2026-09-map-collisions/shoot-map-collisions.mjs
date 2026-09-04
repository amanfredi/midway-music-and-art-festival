#!/usr/bin/env node
// Capture harness for the deliberate-collision and desktop-layout work.
//
// tools/shoot.mjs can only shoot a route at its home view, and every claim in
// this review is about a specific pair of venues at a specific zoom — so the
// states here are reached by driving the engine through the `window.__mmafMap`
// test hook (CONTRACTS.md) and centring on venues by id, which makes the shots
// reproducible as the sheet changes underneath them.
//
// Run from the repo root, once per side of the change:
//   node reviews/2026-09-map-collisions/shoot-map-collisions.mjs --prefix before
//   node reviews/2026-09-map-collisions/shoot-map-collisions.mjs --prefix after
// Output lands next to this script.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = 4185;
const CLOCK = '2026-10-03T15:00'; // same demo clock as tools/shoot.mjs

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const PREFIX = arg('prefix', 'before');
// --only <site> reshoots one site and leaves the rest of the set alone. The
// three prefixes have to be built from identical content to be comparable, so
// re-running everything to add one site would silently replace the committed
// shots with a different build's.
const ONLY = arg('only', '');

// The places the change is judged at, named by venue id so a sheet edit that
// moves them is a loud failure rather than a silently different picture.
//
// `zoom: 'leader'` means the zoom the displaced treatment switches on at, read
// from the map rather than written down, because that is where pins are at
// their most crowded and so where a lane arrangement is worth looking at.
const SITES = [
  // Two groups that vary in latitude far more than in longitude — the case
  // east–west lanes get wrong.
  { name: 'vig-fluid', ids: ['vigguitars', 'fluidinktattoos'], zoom: 16.5 },
  { name: 'sundin-soeffker', ids: ['sundinmusichall', 'soeffkergallery'], zoom: 16.5 },
  // The three-venue group that gives up its own east–west axis, plus the plain
  // venue that made it give way: Black Hart's east lane drew within 36 px of
  // Black Garnet Books, under the 38 px two diamonds need to clear each other.
  // Both facts only exist at the leader zoom — one level in, the pair has
  // spread far enough apart that there was never anything to see.
  {
    name: 'urban-lights',
    ids: ['urbanlights', 'elsashouseofsleep', 'blackhartofsaintpaul', 'blackgarnetbooks'],
    zoom: 'leader',
  },
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

/** Waits for the engine to finish drawing. Raced against a timer: `idle` never
 *  fires again on a map that is already idle when we start listening. */
const settle = (page, ms = 400) =>
  page.evaluate(
    (delay) =>
      new Promise((resolve) => {
        const map = window.__mmafMap;
        const done = () => setTimeout(resolve, delay);
        map.once('idle', done);
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

    const wanted = (label) => !ONLY || ONLY === label;
    const shot = async (label) => {
      const file = join(HERE, `${PREFIX}-${label}-${viewport}.png`);
      await page.screenshot({ path: file });
      written.push(file.replace(ROOT + '/', ''));
    };

    // The view as a visitor meets it, and the same page scrolled to prove the
    // legend and venue key are still reachable (the 560 px cap's whole reason).
    if (wanted('home')) await shot('home');
    const home = await page.evaluate(() => ({
      center: window.__mmafMap.getCenter().toArray(),
      zoom: window.__mmafMap.getZoom(),
      leaderZoom: window.__mmafMap.getLayer('venue-leader-pin').minzoom,
    }));

    // Where venue names compete for room: the leader zoom is where they switch
    // on, so it is the widest view at which any name is sacrificed at all.
    if (wanted('labels')) {
      await page.evaluate(([c, z]) => window.__mmafMap.jumpTo({ center: c, zoom: z }), [home.center, home.leaderZoom]);
      await settle(page);
      await shot('labels');
    }

    for (const site of SITES) {
      if (!wanted(site.name)) continue;
      const found = await page.evaluate(
        ([ids, zoom]) => {
          const map = window.__mmafMap;
          const featuresOf = (id) => {
            const raw = map.getSource(id)._data ?? {};
            return (raw.geojson ?? raw).features ?? [];
          };
          // Displaced venues first: a venue in a coincident group appears in
          // both sources, and the displaced feature is the one on screen.
          const displaced = featuresOf('venue-groups');
          const pool = [...displaced, ...featuresOf('venues')];
          const members = ids.map((id) => pool.find((f) => f.properties.id === id)).filter(Boolean);
          if (members.length !== ids.length) return null;
          const centre = members
            .reduce((a, f) => [a[0] + f.geometry.coordinates[0], a[1] + f.geometry.coordinates[1]], [0, 0])
            .map((v) => v / members.length);
          map.jumpTo({
            center: centre,
            zoom: zoom === 'leader' ? map.getLayer('venue-leader-pin').minzoom : zoom,
          });
          return {
            zoom: map.getZoom(),
            displaced: ids.filter((id) => displaced.some((f) => f.properties.id === id)).length,
          };
        },
        [site.ids, site.zoom],
      );
      if (!found) {
        console.log(`!! ${site.name}: not every one of ${site.ids.join(', ')} is a venue any more — shot skipped`);
        continue;
      }
      console.log(
        `   ${site.name} @ z${found.zoom.toFixed(2)}: ${found.displaced} of ${site.ids.length} venues displaced`,
      );
      await settle(page);
      await shot(site.name);
    }

    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
console.log(written.join('\n'));
