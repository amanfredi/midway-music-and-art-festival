#!/usr/bin/env node
// tools/make-map-geojson.mjs
//
// SPIKE (maplibre-spike branch). Emits site/assets/map-vector.geojson from the
// SAME OSM source data tools/make-map.mjs consumes -- tools/osm-cache.json,
// which is committed -- so this runs offline and needs no Overpass access.
//
// Usage: node tools/make-map-geojson.mjs
//
// This is the Mode A ground for the MapLibre audition: where make-map.mjs
// bakes the streets into a projected SVG with labels placed once for the whole
// map, this emits the same features as WGS84 GeoJSON and lets the engine
// project, simplify, and re-place labels per zoom.
//
// The selection and classification rules are deliberately identical to
// make-map.mjs (arterials and above only, light rail from route relations
// rather than railway ways, water as area + centerline), so the two grounds are
// a fair comparison rather than two different maps. The one difference that
// matters: coordinates stay in lng/lat instead of being projected to the SVG's
// local meter grid, because MapLibre does its own projection.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_PATH = path.join(ROOT, 'tools/osm-cache.json');
const OUT = path.join(ROOT, 'site/assets/map-vector.geojson');

// Same tag set as make-map.mjs: residential/unclassified are never fetched, so
// they are never drawn.
const HIGHWAY_TAGS =
  'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const HIGHWAY_RE = new RegExp(`^(${HIGHWAY_TAGS})$`);

// Coordinates are emitted at 5 decimal places (~1.1 m at this latitude). The
// closest zoom the map allows is ~1 m/px, so a finer grid would cost bytes on
// every attendee's phone to encode detail no one can see. Simplification is
// done in meters, matching make-map.mjs's 2 m threshold.
const COORD_DP = 5;
const SIMPLIFY_M = 2;

const M_PER_DEG_LAT = 111320;
const LAT0 = 44.9599375; // Hamline Park, the extent's center
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

function round(v) {
  return +v.toFixed(COORD_DP);
}

/** Drop points closer than SIMPLIFY_M to the previously kept point, measuring in meters. */
function simplify(coords) {
  if (coords.length <= 2) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const last = out[out.length - 1];
    const dx = (coords[i][0] - last[0]) * M_PER_DEG_LNG;
    const dy = (coords[i][1] - last[1]) * M_PER_DEG_LAT;
    if (Math.hypot(dx, dy) >= SIMPLIFY_M) out.push(coords[i]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

function wayToCoords(way) {
  if (!way.geometry) return null;
  const pts = way.geometry
    .filter((g) => g && typeof g.lat === 'number' && typeof g.lon === 'number')
    .map((g) => [round(g.lon), round(g.lat)]);
  const simplified = simplify(pts);
  return simplified.length >= 2 ? simplified : null;
}

function widthTier(way) {
  const name = way.tags.name;
  if (name === 'Snelling Avenue' || name === 'University Avenue') return 'spine';
  const hw = way.tags.highway;
  if (hw === 'motorway' || hw === 'motorway_link' || hw === 'trunk' || hw === 'trunk_link') return 'motorway';
  if (hw === 'residential' || hw === 'unclassified') return 'resid';
  return 'arterial';
}

function isClosedWay(way) {
  const g = way.geometry;
  if (!g || g.length < 4) return false;
  return g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
}

function railLineKey(tags = {}) {
  const s = `${tags.ref || ''} ${tags.name || ''} ${tags.colour || ''}`.toLowerCase();
  if (s.includes('blue')) return 'blue';
  if (s.includes('green')) return 'green';
  return null;
}

const raw = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
const features = [];
const counts = { street: 0, rail: 0, station: 0, waterArea: 0, waterLine: 0 };

for (const el of raw.elements) {
  if (el.type === 'relation' && el.tags?.route === 'light_rail') {
    const line = railLineKey(el.tags);
    if (!line) continue;
    for (const member of el.members || []) {
      if (member.type !== 'way' || !member.geometry) continue;
      const coords = wayToCoords(member);
      if (!coords) continue;
      features.push({
        type: 'Feature',
        properties: { kind: 'rail', line },
        geometry: { type: 'LineString', coordinates: coords },
      });
      counts.rail++;
    }
    continue;
  }

  const isWater =
    el.type === 'way' &&
    (el.tags?.natural === 'water' || el.tags?.waterway === 'riverbank' || el.tags?.waterway === 'river');

  if (isWater) {
    const coords = wayToCoords(el);
    if (!coords) continue;
    if (isClosedWay(el)) {
      // Re-close the ring: simplify() can drop the duplicated last point.
      const ring = coords.slice();
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
      if (ring.length < 4) continue;
      features.push({
        type: 'Feature',
        properties: { kind: 'water-area' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
      counts.waterArea++;
    } else if (el.tags.waterway === 'river') {
      features.push({
        type: 'Feature',
        properties: { kind: 'water-line' },
        geometry: { type: 'LineString', coordinates: coords },
      });
      counts.waterLine++;
    }
    continue;
  }

  if (el.type === 'way' && el.tags?.highway && HIGHWAY_RE.test(el.tags.highway)) {
    const coords = wayToCoords(el);
    if (!coords) continue;
    const tier = widthTier(el);
    // `name` drives the symbol layer's text-field. Unnamed ways still draw as
    // street geometry; they just never get a label.
    const properties = { kind: 'street', tier };
    if (el.tags.name) properties.name = el.tags.name;
    features.push({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } });
    counts.street++;
  } else if (el.type === 'node' && /^(station|tram_stop)$/.test(el.tags?.railway || '')) {
    const name = (el.tags.name || 'Station').replace(/\s+Avenue$/, '');
    features.push({
      type: 'Feature',
      properties: { kind: 'station', name },
      geometry: { type: 'Point', coordinates: [round(el.lon), round(el.lat)] },
    });
    counts.station++;
  }
}

// One feature per line keeps the file diffable despite its size; a single
// JSON.stringify would emit it as one unreadable multi-megabyte line.
const body = features.map((f) => JSON.stringify(f)).join(',\n');
const out = `{"type":"FeatureCollection","features":[\n${body}\n]}\n`;
await writeFile(OUT, out, 'utf8');

console.log(`Wrote ${path.relative(ROOT, OUT)} (${(Buffer.byteLength(out, 'utf8') / 1e6).toFixed(2)} MB)`);
console.log(
  `  streets ${counts.street}, rail ways ${counts.rail}, stations ${counts.station}, ` +
    `water ${counts.waterArea} area(s) + ${counts.waterLine} centerline(s)`
);
const named = new Set(features.filter((f) => f.properties.kind === 'street' && f.properties.name).map((f) => f.properties.name));
console.log(`  named streets: ${named.size} (the engine places and re-places their labels per zoom)`);
