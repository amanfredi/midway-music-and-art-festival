// node --test tests/static-assets.test.mjs
//
// Accessibility properties of hand-edited shipped assets that no runtime test
// can reach: the web app manifest applies only to an installed PWA, and the
// map SVG's own text is authored in tools/make-map.mjs rather than the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the manifest leaves the installed app free to follow the device orientation', () => {
  const manifest = JSON.parse(read('site/manifest.webmanifest'));
  assert.ok(
    !('orientation' in manifest),
    `manifest pins "orientation": ${JSON.stringify(manifest.orientation)}; an installed app must follow the device (WCAG 1.3.4)`,
  );
});

// The attribution attendees actually read is HTML below the map frame, from
// settings.map_attribution. The SVG once carried a second copy that scaled with
// the map instead of holding its size, so it rendered ~1-2 px at the only zoom
// where it was on screen at all.
//
// The SVG no longer ships: the map is drawn by MapLibre, and tools/make-map.mjs
// writes it to the gitignored artwork/ directory for the artwork exploration
// alone. Only the generator is asserted now — that is where the mistake would
// return if artwork is ever picked up, and since regenerating needs Overpass it
// gets hand-edited and can drift.
test('tools/make-map.mjs bakes no attribution text into the map artwork', () => {
  assert.ok(
    !read('tools/make-map.mjs').includes('attribution'),
    'tools/make-map.mjs still declares SVG attribution text (WCAG 1.4.3)',
  );
});

// The map engine and its data are the largest things the service worker
// precaches, and precache is all-or-nothing: one missing entry and cache.addAll
// rejects, the worker never activates, and the whole site stops working offline
// while looking fine online. These are the files site/js/views/map.js names.
for (const asset of [
  'site/assets/map-vector.geojson',
  'site/assets/map-calibration.json',
  'site/assets/transit.json',
  'site/assets/maplibre/maplibre-gl.mjs',
  'site/assets/maplibre/maplibre-gl-shared.mjs',
  'site/assets/maplibre/maplibre-gl-worker.mjs',
  'site/assets/maplibre/maplibre-gl.css',
]) {
  test(`${asset} is present for the map to load and the worker to precache`, () => {
    assert.ok(read(asset).length > 0, `${asset} is missing or empty`);
  });
}

// Retired assets that must not creep back into the deploy root: between them
// they are ~2.7 MB of bytes nothing renders, precached onto every phone.
for (const gone of ['site/assets/map.svg', 'site/assets/map-raster.webp']) {
  test(`${gone} does not ship`, () => {
    assert.ok(
      !existsSync(path.join(__dirname, '..', gone)),
      `${gone} is back in the deploy root; the map is drawn from map-vector.geojson and nothing reads this`,
    );
  });
}
