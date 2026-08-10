#!/usr/bin/env node
// tools/verify-spike.mjs
//
// SPIKE verification. Checks the two claims the audition cannot be reported
// without: that both ground modes actually render, and that their pins land on
// the venue coordinates in the built content.json rather than merely somewhere
// on a pretty map.
//
// It also measures the Mode B georeferencing error. The SVG is drawn in a local
// equirectangular projection (y linear in latitude); MapLibre places an
// ImageSource by four corners in Web Mercator (y linear in ln tan). Those two
// disagree in the middle of a 16 km sheet, and the size of that disagreement is
// a real input to the "can artwork be georeferenced" question.
//
// Usage: node tools/verify-spike.mjs [--port 8099]

import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

const portFlag = process.argv.indexOf('--port');
const PORT = portFlag === -1 ? 8099 : Number(process.argv[portFlag + 1]);
const BASE = `http://localhost:${PORT}/`;

const content = JSON.parse(await readFile(new URL('../site/data/content.json', import.meta.url), 'utf8'));
const venues = content.venues.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));

const browser = await chromium.launch();
const results = [];
let failures = 0;

function check(label, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function openMap(mode) {
  // A context, not browser.newPage(): @axe-core/playwright refuses a page that
  // isn't attached to one.
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const suffix = mode === 'vector' ? '' : `?map=${mode}`;
  await page.goto(`${BASE}${suffix}#/map`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__spikeMap, null, { timeout: 30000 });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const m = window.__spikeMap;
        if (m.loaded()) return void setTimeout(resolve, 800);
        m.once('idle', () => setTimeout(resolve, 800));
      })
  );
  return { page, errors };
}

for (const mode of ['vector', 'raster', 'hybrid']) {
  const { page, errors } = await openMap(mode);

  const info = await page.evaluate(() => {
    const m = window.__spikeMap;
    return {
      zoom: m.getZoom(),
      minZoom: m.getMinZoom(),
      maxZoom: m.getMaxZoom(),
      center: m.getCenter().toArray(),
      sources: Object.keys(m.getStyle().sources),
    };
  });

  // The map canvas is WebGL without preserveDrawingBuffer, so reading it back
  // through drawImage yields an empty buffer and would "pass" for a blank map.
  // A composited screenshot, decoded back in the page, is the honest test.
  const shot = await page.locator('#map-gl').screenshot();
  const ink = await page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${b64}`)).blob()
    );
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let nonPaper = 0;
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
      if (Math.abs(r - 238) > 6 || Math.abs(g - 238) > 6 || Math.abs(b - 236) > 6) nonPaper++;
      if (r < 120 && g < 120 && b < 120) dark++;
    }
    return { nonPaper, dark, total: c.width * c.height };
  }, shot.toString('base64'));

  check(
    `[${mode}] renders a non-blank map`,
    ink.nonPaper > ink.total * 0.05 && ink.dark > 200,
    `${((ink.nonPaper / ink.total) * 100).toFixed(1)}% non-paper, ${ink.dark} dark px (labels/pins)`
  );
  check(`[${mode}] no page/console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  // MapLibre's 512 px tiles put these a level below the 256 px-tile figures the
  // usual formula gives: the ~16 km extent is z10.4, the 3000 m home view z12.8,
  // and the 120 m ceiling z17.5.
  check(
    `[${mode}] zoom range spans full extent to close-in`,
    info.minZoom < 11 && info.maxZoom > 17 && info.zoom > info.minZoom && info.zoom < info.maxZoom,
    `min ${info.minZoom.toFixed(2)}, home ${info.zoom.toFixed(2)}, max ${info.maxZoom.toFixed(2)}`
  );

  // Pin round-trip: every venue must be *reachable* at its content.json
  // coordinate -- either as its own pin, or (for venues sharing a coordinate,
  // which no zoom can separate) inside a cluster whose leaves list it, which is
  // what the picker sheet opens.
  const pinCheck = await page.evaluate(
    async (expected) => {
      const m = window.__spikeMap;
      const direct = new Map();
      const viaCluster = [];
      const unreachable = [];
      for (const v of expected) {
        m.jumpTo({ center: [v.lng, v.lat], zoom: m.getMaxZoom() - 0.01 });
        await new Promise((r) => (m.loaded() ? setTimeout(r, 60) : m.once('idle', () => setTimeout(r, 60))));
        const p = m.project([v.lng, v.lat]);
        const box = [
          [p.x - 6, p.y - 6],
          [p.x + 6, p.y + 6],
        ];
        const hit = m.queryRenderedFeatures(box, { layers: ['venue-pin'] }).find((h) => h.properties.id === v.id);
        if (hit) {
          direct.set(v.id, Math.hypot(m.project(hit.geometry.coordinates).x - p.x, m.project(hit.geometry.coordinates).y - p.y));
          continue;
        }
        const cluster = m.queryRenderedFeatures(box, { layers: ['venue-cluster'] })[0];
        if (cluster) {
          const leaves = await m.getSource('venues').getClusterLeaves(cluster.properties.cluster_id, Infinity, 0);
          if (leaves.some((l) => l.properties.id === v.id)) {
            viaCluster.push(v.id);
            continue;
          }
        }
        unreachable.push(v.id);
      }
      return {
        direct: [...direct.keys()],
        maxOffsetPx: Math.max(0, ...direct.values()),
        viaCluster,
        unreachable,
      };
    },
    venues.map((v) => ({ id: v.id, lat: v.lat, lng: v.lng }))
  );

  check(
    `[${mode}] every venue is reachable at its content.json coordinate`,
    pinCheck.unreachable.length === 0 && pinCheck.maxOffsetPx < 0.5,
    `${pinCheck.direct.length} as own pin (max offset ${pinCheck.maxOffsetPx.toFixed(3)} px), ` +
      `${pinCheck.viaCluster.length} via cluster picker [${pinCheck.viaCluster.join(', ')}]` +
      (pinCheck.unreachable.length ? `, UNREACHABLE: ${pinCheck.unreachable.join(', ')}` : '')
  );

  if (mode === 'vector' || mode === 'hybrid') {
    // Labels are checked at two zooms, because the point is not that labels
    // exist but that the engine re-runs placement as the view changes -- the
    // behavior the SVG map cannot have, since it places every label once.
    const labels = await page.evaluate(
      async ([home, homeZoom]) => {
        const m = window.__spikeMap;
        const at = async (zoom) => {
          m.jumpTo({ center: home, zoom });
          await new Promise((r) => m.once('idle', () => setTimeout(r, 400)));
          const names = new Set();
          for (const layer of ['street-label-spine', 'street-label-arterial']) {
            for (const f of m.queryRenderedFeatures({ layers: [layer] })) names.add(f.properties.name);
          }
          return [...names];
        };
        return { wide: await at(homeZoom - 1), close: await at(homeZoom + 1.5) };
      },
      [info.center, info.zoom]
    );
    check(
      `[${mode}] street labels render from GeoJSON`,
      labels.wide.length >= 5,
      `${labels.wide.length} named streets at the wide view`
    );
    check(
      `[${mode}] labels are re-placed per zoom, not placed once`,
      labels.close.join('|') !== labels.wide.join('|'),
      `wide: ${labels.wide.slice(0, 4).join(', ')} … / close: ${labels.close.slice(0, 4).join(', ')} …`
    );
  }

  if (mode === 'raster' || mode === 'hybrid') {
    check(`[${mode}] artwork ImageSource is in the style`, info.sources.includes('artwork'), info.sources.join(','));
  }

  await page.close();
}

// The mode switch lives in the page query string, which is also where the demo
// clock lives. They have to compose, or evaluating the map during the festival
// weekend means giving up "On now".
{
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}?t=2026-10-03T15:00&map=raster#/map`);
  await page.waitForFunction(() => window.__spikeMap, null, { timeout: 30000 });
  const modeNote = await page.locator('.map-mode-note strong').textContent();
  const clock = await page.evaluate(async () => {
    const { now } = await import('./js/time.js');
    return now().toISOString();
  });
  check(
    '[params] ?t= demo clock and ?map= ground compose',
    modeNote.trim() === 'raster' && clock.startsWith('2026-10-03'),
    `ground "${modeNote.trim()}", clock ${clock}`
  );
  await context.close();
}

// Offline sanity, the project's actual acceptance criterion: one online visit,
// then airplane mode, then both grounds must still draw. This exercises the
// vendored engine (1.1 MB across three modules plus a module worker), the 1.8 MB
// GeoJSON and the 0.9 MB raster entirely from the service-worker precache.
{
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null, null, {
    timeout: 30000,
  });
  // The worker precaches on install; give it the round trip before cutting the
  // network, or the test measures the race rather than the cache.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state;
  });
  await page.waitForTimeout(2500);

  await context.setOffline(true);

  for (const mode of ['vector', 'raster']) {
    const suffix = mode === 'vector' ? '' : `?map=${mode}`;
    await page.goto(`${BASE}${suffix}#/map`);
    let ok = true;
    let detail = '';
    try {
      await page.waitForFunction(() => window.__spikeMap, null, { timeout: 30000 });
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const m = window.__spikeMap;
            const timer = setTimeout(() => reject(new Error('never became idle')), 25000);
            const done = () => {
              clearTimeout(timer);
              setTimeout(resolve, 600);
            };
            m.loaded() ? done() : m.once('idle', done);
          })
      );
      const rendered = await page.evaluate(() => {
        const m = window.__spikeMap;
        const pins = m.queryRenderedFeatures({ layers: ['venue-pin'] }).length +
          m.queryRenderedFeatures({ layers: ['venue-cluster'] }).length;
        const ground =
          m.getStyle().layers.some((l) => l.id === 'artwork') ||
          m.queryRenderedFeatures({ layers: ['arterial-fill'] }).length > 0;
        return { pins, ground };
      });
      ok = rendered.pins > 0 && rendered.ground;
      detail = `${rendered.pins} venue symbols, ground ${rendered.ground ? 'drawn' : 'MISSING'}`;
    } catch (err) {
      ok = false;
      detail = err.message.split('\n')[0];
    }
    check(`[offline] ${mode} ground renders in airplane mode`, ok, detail);
  }
  await context.close();
}

// The repo's own axe gate for #/map fails on this branch only because it waits
// for the inline SVG that no longer exists, so it never scans anything. That
// leaves a real question unanswered -- accessibility is a binding contract --
// so the scan is run here directly against the MapLibre view.
{
  const { page } = await openMap('vector');
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  check(
    '[a11y] MapLibre map view has no WCAG A/AA violations',
    scan.violations.length === 0,
    scan.violations.map((v) => `${v.id} (${v.nodes.length})`).join(', ') || 'clean'
  );

  // And the venue sheet reached from the key list, which is the keyboard path
  // to a venue now that pins are canvas-drawn rather than DOM nodes.
  await page.locator('.venue-key-btn').first().click();
  await page.locator('dialog.sheet').waitFor({ state: 'visible' });
  const sheetScan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  check(
    '[a11y] venue sheet opened from the key list has no WCAG A/AA violations',
    sheetScan.violations.length === 0,
    sheetScan.violations.map((v) => `${v.id} (${v.nodes.length})`).join(', ') || 'clean'
  );
  await page.close();
}

// Mode B georeferencing error: how far the equirectangular raster drifts from
// the Mercator projection the pins use, at its worst (mid-sheet).
{
  const calibration = JSON.parse(await readFile(new URL('../site/assets/map-calibration.json', import.meta.url), 'utf8'));
  const cps = calibration.control_points;
  const north = Math.max(...cps.map((p) => p.lat));
  const south = Math.min(...cps.map((p) => p.lat));
  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  // The image's own middle row, placed linearly between the corners in Mercator
  // space, versus the latitude that actually belongs at the sheet's middle.
  const midLatEquirect = (north + south) / 2;
  const midMerc = (mercY(north) + mercY(south)) / 2;
  const latAtMidMerc = ((2 * Math.atan(Math.exp(midMerc)) - Math.PI / 2) * 180) / Math.PI;
  const offsetM = Math.abs(midLatEquirect - latAtMidMerc) * 111320;
  results.push(
    `INFO  Mode B raster drift at mid-sheet: ${offsetM.toFixed(1)} m ` +
      `(equirectangular artwork placed by four corners in Mercator)`
  );
}

await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
