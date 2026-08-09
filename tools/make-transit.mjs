#!/usr/bin/env node
// tools/make-transit.mjs
//
// One-off generator (NOT part of `npm run build`): fetches METRO Green Line
// LRT station + A Line/B Line BRT stop data for the map bbox from the OSM
// Overpass API and writes the committed site/assets/transit.json. Does NOT
// touch site/assets/map.svg or map-calibration.json -- see tools/make-map.mjs
// for those.
//
// Usage:
//   node tools/make-transit.mjs            # use tools/osm-transit-cache.json if present
//   node tools/make-transit.mjs --refresh  # refetch from Overpass, overwrite cache
//
// Node >=24, zero npm dependencies, ES module.
//
// Unlike make-map.mjs's street grid (decorative scaffolding with a hardcoded
// fallback), there is deliberately NO fallback data here: a wrong or invented
// transit stop is worse than a missing one, so if Overpass is unreachable and
// no cache exists, this tool fails loudly instead of fabricating stops. See
// CONTRACTS.md ("Map + geo contract") for the transit.json shape this must
// produce.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_PATH = path.join(__dirname, 'osm-transit-cache.json');
const TRANSIT_OUT = path.join(ROOT, 'site/assets/transit.json');

// Must match CONTRACTS.md's Map + geo contract bbox and tools/make-map.mjs's
// BBOX exactly -- this is the same map, just a different data layer. Derived
// the same way there: Hamline Park +/- 3 miles east-west, +/- 2 miles
// north-south (QA, 2026-08-08).
const BBOX = { south: 44.931024, west: -93.22798, north: 44.988851, east: -93.105395 };

// ---------------------------------------------------------------------------
// Overpass query: Green Line LRT stations (single node per station, already
// merged in OSM) plus the A Line/B Line BRT route relations (recursed to
// their member stop nodes, which we filter to the bbox client-side since
// Overpass's bbox filter only applies cleanly to direct node/way queries, not
// to relations that span the whole metro).
// ---------------------------------------------------------------------------
const OVERPASS_PRIMARY = 'https://overpass-api.de/api/interpreter';
const OVERPASS_MIRROR = 'https://overpass.kumi.systems/api/interpreter';

const QUERY = `[out:json][timeout:75];
(
  node["railway"="station"]["station"="light_rail"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  relation["route"="bus"]["ref"~"^(A|B)$"]["network"="Metro Transit"];
);
out body;
>;
out body qt;`;

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Overpass's Apache front end 406s requests with no Accept header
        // (mod_negotiation), and its usage policy asks for an identifying
        // User-Agent -- both required for Node's fetch() to succeed here.
        Accept: '*/*',
        'User-Agent': 'mmaf-make-transit.mjs (github.com/amanfredi/midway-music-and-art-festival)',
      },
      body: 'data=' + encodeURIComponent(QUERY),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    JSON.parse(text); // validate before trusting the cache
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetries(url, retries) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      console.warn(`  retry ${attempt}/${retries} for ${url}...`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    try {
      return await fetchOnce(url);
    } catch (err) {
      lastErr = err;
      console.warn(`  attempt ${attempt + 1} failed: ${err.message}`);
    }
  }
  throw lastErr;
}

async function fetchOverpass() {
  console.log(`Fetching OSM transit data from primary endpoint (${OVERPASS_PRIMARY})...`);
  try {
    return await fetchWithRetries(OVERPASS_PRIMARY, 2);
  } catch (err) {
    console.warn(`Primary Overpass endpoint failed after retries: ${err.message}`);
  }
  console.log(`Trying mirror endpoint (${OVERPASS_MIRROR})...`);
  try {
    return await fetchWithRetries(OVERPASS_MIRROR, 1);
  } catch (err) {
    console.warn(`Mirror Overpass endpoint also failed: ${err.message}`);
  }
  return null; // signal: no cache, no fallback -- caller must fail
}

// ---------------------------------------------------------------------------
// Extraction + merge
// ---------------------------------------------------------------------------
function inBbox(lat, lng) {
  return lat >= BBOX.south && lat <= BBOX.north && lng >= BBOX.west && lng <= BBOX.east;
}

/** Raw, unmerged stop points: one per OSM node, tagged with which line it serves. */
function extractRawPoints(elements) {
  const nodes = new Map();
  for (const el of elements) if (el.type === 'node') nodes.set(el.id, el);
  const relations = elements.filter((el) => el.type === 'relation');

  const points = [];

  // Green Line: each station is already a single node covering both
  // directions (confirmed against the live data -- no per-direction platform
  // duplication for railway=station nodes in this bbox).
  for (const n of nodes.values()) {
    const tags = n.tags || {};
    if (tags.railway === 'station' && tags.station === 'light_rail' && inBbox(n.lat, n.lon)) {
      points.push({ name: tags.name || 'Green Line Station', lat: n.lat, lng: n.lon, line: 'green' });
    }
  }

  // A Line / B Line: relations carry directional route variants (e.g.
  // "A Line (southbound)" and "A Line (northbound)"), each referencing its
  // own platform node per stop -- hence the same physical stop shows up as
  // two (or more, where A and B share a platform) separate node ids that
  // need merging below.
  for (const rel of relations) {
    const ref = rel.tags?.ref; // "A" or "B"
    const line = ref === 'A' ? 'a' : ref === 'B' ? 'b' : null;
    if (!line) continue;
    for (const member of rel.members || []) {
      if (member.type !== 'node') continue;
      const n = nodes.get(member.ref);
      if (!n || !inBbox(n.lat, n.lon)) continue;
      points.push({ name: n.tags?.name || `${ref} Line Stop`, lat: n.lat, lng: n.lon, line });
    }
  }

  // Deterministic processing order so clustering below doesn't depend on
  // Overpass's element order.
  const lineRank = { green: 0, a: 1, b: 2 };
  points.sort((p, q) => lineRank[p.line] - lineRank[q.line] || p.name.localeCompare(q.name) || p.lat - q.lat);
  return points;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const MERGE_RADIUS_M = 100;

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Single-linkage merge of raw points within MERGE_RADIUS_M of an existing
 * cluster's running centroid. This handles both cases the brief calls out:
 * same-named directional platform pairs (e.g. two "Selby & Hamline Station"
 * nodes ~24m apart), and a differently-named but co-located transfer point
 * (Green Line's "Snelling Avenue" station and the A Line's "Snelling Avenue &
 * University Station" platforms, ~73m apart -- the real Snelling & University
 * interchange).
 *
 * Single-linkage clustering can in general chain together points that are
 * each within range of a neighbor but far apart themselves. Not an issue for
 * this bbox's actual data (verified by hand: every merged pair is a genuine
 * same-stop pair, and the nearest *distinct* stops are 300m+ apart), but
 * would need real spatial clustering (e.g. complete-linkage) if this bbox or
 * stop density grew significantly.
 */
function mergeStops(points) {
  const clusters = [];
  for (const p of points) {
    const cluster = clusters.find((c) => haversineMeters(c.lat, c.lng, p.lat, p.lng) <= MERGE_RADIUS_M);
    if (cluster) {
      cluster.points.push(p);
      cluster.lat = cluster.points.reduce((s, q) => s + q.lat, 0) / cluster.points.length;
      cluster.lng = cluster.points.reduce((s, q) => s + q.lng, 0) / cluster.points.length;
    } else {
      clusters.push({ points: [p], lat: p.lat, lng: p.lng });
    }
  }

  const lineOrder = ['green', 'a', 'b'];
  return clusters
    .map((c) => {
      const lines = lineOrder.filter((l) => c.points.some((p) => p.line === l));
      // When a cluster merges differently-named stops (a same-stop transfer
      // point), prefer the longest distinct name -- in practice that's the
      // more descriptive "X & Y" cross-street form over a bare street name.
      const distinctNames = [...new Set(c.points.map((p) => p.name))];
      distinctNames.sort((a, b) => b.length - a.length || a.localeCompare(b));
      const name = distinctNames[0];
      return {
        id: slugify(name),
        name,
        lines,
        lat: Math.round(c.lat * 1e6) / 1e6,
        lng: Math.round(c.lng * 1e6) / 1e6,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const refresh = process.argv.includes('--refresh');
  let rawText;

  if (!refresh && existsSync(CACHE_PATH)) {
    console.log(`Using cached OSM data at ${path.relative(ROOT, CACHE_PATH)} (pass --refresh to refetch).`);
    rawText = await readFile(CACHE_PATH, 'utf8');
  } else {
    rawText = await fetchOverpass();
    if (rawText === null) {
      console.error('\n' + '!'.repeat(72));
      console.error('OSM OVERPASS FETCH FAILED after retries on primary + mirror endpoints,');
      console.error('and no cache is present at ' + path.relative(ROOT, CACHE_PATH) + '.');
      console.error('Unlike make-map.mjs, this tool has no hardcoded fallback: inventing');
      console.error('transit stop data would be worse than failing. Rerun with network');
      console.error('access, or restore a previous tools/osm-transit-cache.json.');
      console.error('!'.repeat(72) + '\n');
      process.exit(1);
    }
    await writeFile(CACHE_PATH, rawText, 'utf8');
    console.log(`Wrote fresh OSM response to ${path.relative(ROOT, CACHE_PATH)} (${rawText.length} bytes).`);
  }

  const elements = JSON.parse(rawText).elements;
  const rawPoints = extractRawPoints(elements);
  const stops = mergeStops(rawPoints);

  const output = { stops };
  await writeFile(TRANSIT_OUT, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${path.relative(ROOT, TRANSIT_OUT)} (${stops.length} stops from ${rawPoints.length} raw points).`);
  for (const s of stops) {
    console.log(`  ${s.id.padEnd(38)} [${s.lines.join(',').padEnd(5)}] ${s.name}  (${s.lat}, ${s.lng})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
