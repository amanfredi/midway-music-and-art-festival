// node --test tests/map-vector.test.mjs
//
// Shape checks on the committed map ground (site/assets/map-vector.geojson).
// The OSM cache behind it is refreshed by hand, so a regression arrives as a
// silent data change rather than a code diff — these assertions are where it
// surfaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, '..', rel), 'utf8');

// Route 67's OSM relation is missing its Franklin Avenue bridge span upstream
// (in the live data too — verified 2026-08-23), so make-map-geojson.mjs
// completes it from cached highway ways (BUS_ROUTE_GAP_FILL). What attendees
// see is the drawn line, and its contract is continuity: every route-67
// segment reachable from every other through shared endpoints. A cache refresh
// that breaks the gap fill, or a new hole elsewhere in the relation, lands here.
test('route 67 draws as one continuous line', () => {
  const geo = JSON.parse(read('site/assets/map-vector.geojson'));
  const segments = geo.features.filter((f) => f.properties.kind === 'bus-route' && f.properties.ref === '67');
  assert.ok(segments.length > 0, 'route 67 is not drawn at all');

  const adjacency = new Map();
  const node = (key) => {
    if (!adjacency.has(key)) adjacency.set(key, new Set());
    return adjacency.get(key);
  };
  for (const feature of segments) {
    const coords = feature.geometry.coordinates;
    const a = coords[0].join(',');
    const b = coords[coords.length - 1].join(',');
    node(a).add(b);
    node(b).add(a);
  }

  const start = adjacency.keys().next().value;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of adjacency.get(queue.pop())) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  assert.equal(seen.size, adjacency.size, 'route 67 has disconnected segments — a gap in the drawn line');
});
