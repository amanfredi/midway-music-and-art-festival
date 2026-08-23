// Shared helpers for tests that drive the #/map view.
//
// The map is drawn into a WebGL canvas, so there is no DOM node per pin to
// locate, click or assert on. Everything below goes through `window.__mmafMap`,
// the MapLibre Map the view publishes as a test hook (CONTRACTS.md, Test hooks)
// — asking the engine what it actually rendered is the only way to make claims
// about pins at all, and it is a stronger claim than a DOM query was: a symbol
// only appears in a query result once placement has really put it on screen.

import { expect } from '@playwright/test';

export const DEMO_CLOCK = '?t=2026-10-03T15:00';

/** Navigates to #/map and waits until the engine says it has finished drawing. */
export async function gotoMap(page, { clock = DEMO_CLOCK, route = '#/map' } = {}) {
  await page.goto('/' + clock + route);
  await waitForMapIdle(page);
}

export async function waitForMapIdle(page) {
  await page.waitForFunction(() => window.__mmafMap && window.__mmafMap.loaded(), null, { timeout: 30_000 });
  // `loaded()` covers style and sources; symbol placement lands a frame or two
  // later, so wait for a real idle before asking what is on screen.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const map = window.__mmafMap;
        const done = () => setTimeout(resolve, 250);
        map.loaded() ? done() : map.once('idle', done);
      }),
  );
}

/** Runs `fn(map, arg)` in the page against the live map. */
export function mapEval(page, fn, arg) {
  return page.evaluate(
    ([body, value]) => new Function('map', 'arg', `return (${body})(map, arg)`)(window.__mmafMap, value),
    [fn.toString(), arg ?? null],
  );
}

/**
 * A rendered symbol of `layer` that is comfortably inside the canvas, with the
 * viewport coordinates to click it.
 *
 * The inset matters: queryRenderedFeatures answers for symbols in a buffer
 * beyond the viewport edge, so a feature it returns is not necessarily one a
 * click can reach. Zoom is walked outward until something qualifies, because at
 * the closest zooms most of the pin set is off screen.
 */
export async function findPin(page, layer, { inset = 24 } = {}) {
  return page.evaluate(
    async ([layerId, edge]) => {
      const map = window.__mmafMap;
      const settle = () =>
        new Promise((r) => (map.loaded() ? setTimeout(r, 120) : map.once('idle', () => setTimeout(r, 120))));
      for (let zoom = map.getMaxZoom() - 1; zoom > map.getMinZoom(); zoom -= 0.5) {
        map.jumpTo({ zoom });
        await settle();
        const rect = map.getCanvas().getBoundingClientRect();
        for (const feature of map.queryRenderedFeatures({ layers: [layerId] })) {
          const point = map.project(feature.geometry.coordinates);
          if (point.x < edge || point.y < edge || point.x > rect.width - edge || point.y > rect.height - edge) continue;
          return {
            properties: feature.properties,
            x: rect.left + point.x,
            y: rect.top + point.y,
            zoom: map.getZoom(),
          };
        }
      }
      return null;
    },
    [layer, inset],
  );
}

/**
 * The features a GeoJSON source was given, as a page-side expression.
 *
 * MapLibre keeps inline source data as `{ geojson: <FeatureCollection> }` and
 * URL-backed data as `{ url }`, so reaching for `_data.features` gets undefined
 * rather than an error — worth having in exactly one place.
 */
export const SOURCE_FEATURES_FN = `(map, id) => {
  const raw = map.getSource(id)._data ?? {};
  return (raw.geojson ?? raw).features ?? [];
}`;

/** Centres the map on a known stop/venue id, then returns its viewport point. */
export async function centreOnPin(page, layer, id) {
  return page.evaluate(
    async ([layerId, wanted, featuresFn]) => {
      const map = window.__mmafMap;
      const source =
        { 'transit-pin': 'transit', 'venue-pin': 'venues', 'venue-leader-pin': 'venue-groups' }[layerId] ?? 'sponsors';
      const features = new Function('return ' + featuresFn)()(map, source);
      const match = features.find((f) => f.properties.id === wanted);
      if (!match) return null;
      map.jumpTo({ center: match.geometry.coordinates, zoom: map.getMaxZoom() - 2 });
      await new Promise((r) => (map.loaded() ? setTimeout(r, 200) : map.once('idle', () => setTimeout(r, 200))));
      const rect = map.getCanvas().getBoundingClientRect();
      const point = map.project(match.geometry.coordinates);
      return { x: rect.left + point.x, y: rect.top + point.y };
    },
    [layer, id, SOURCE_FEATURES_FN],
  );
}

/** The features a source was built from, read back in the test process. */
export function sourceFeatures(page, id) {
  return page.evaluate(
    ([sourceId, featuresFn]) => new Function('return ' + featuresFn)()(window.__mmafMap, sourceId),
    [id, SOURCE_FEATURES_FN],
  );
}

/** A point on the canvas with no pin under it, for tests about the map itself. */
export async function findEmptySpot(page, { slop = 14 } = {}) {
  return page.evaluate(
    ([pad]) => {
      const map = window.__mmafMap;
      const rect = map.getCanvas().getBoundingClientRect();
      const layers = [
        'venue-pin',
        'venue-leader-pin',
        'venue-cluster',
        'sponsor-generic-pin',
        'sponsor-featured-pin',
        'transit-leader-pin',
        'transit-pin',
      ].filter((id) => map.getLayer(id));
      for (let fy = 0.15; fy < 0.9; fy += 0.1) {
        for (let fx = 0.15; fx < 0.9; fx += 0.1) {
          const x = rect.width * fx;
          const y = rect.height * fy;
          const box = [
            [x - pad, y - pad],
            [x + pad, y + pad],
          ];
          if (map.queryRenderedFeatures(box, { layers }).length === 0) {
            return { x: rect.left + x, y: rect.top + y };
          }
        }
      }
      return null;
    },
    [slop],
  );
}

export const sheet = (page) => page.locator('.sheet[role="dialog"]');

export async function expectSheetClosed(page) {
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
}
