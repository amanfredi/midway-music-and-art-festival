#!/usr/bin/env node
// tools/make-map.mjs
//
// One-off generator (NOT part of `npm run build`): fetches real street
// geometry for the Snelling & University corridor from the OSM Overpass API
// and generates site/assets/map.svg + site/assets/map-calibration.json.
//
// Usage:
//   node tools/make-map.mjs            # use tools/osm-cache.json if present
//   node tools/make-map.mjs --refresh  # refetch from Overpass, overwrite cache
//
// Node >=24, zero npm dependencies, ES module.
//
// Rerun by hand whenever the bbox, style, or fallback data needs to change --
// this is a generator, not a server-side build step. See CONTRACTS.md
// ("Map + geo contract") for the coordinate system this must produce.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_PATH = path.join(__dirname, 'osm-cache.json');
const SVG_OUT = path.join(ROOT, 'site/assets/map.svg');
const CALIBRATION_OUT = path.join(ROOT, 'site/assets/map-calibration.json');

// ---------------------------------------------------------------------------
// Projection: plain local equirectangular, matching site/js/geo.js's contract
// (x proportional to lng*cos(lat0), y proportional to -lat, north up). This
// is the single source of truth for the numbers baked into map-calibration.json.
// ---------------------------------------------------------------------------
// Extent (QA, 2026-08-08): centered on Hamline Park, 6 miles east-west by 4
// miles north-south. The festival's own footprint is the inner 4x2 miles; the
// extra mile on every side is context, so someone arriving from outside the
// neighborhood can see where they are relative to it. Reaching this far west
// is also what brings the Raymond Avenue Green Line station onto the map.
//
// The whole extent is never the default view — see CORE below and the home
// view in site/js/views/map.js.
const CENTER = { lat: 44.9599375, lng: -93.1666875 }; // Hamline Park (venues sheet)
const MILE_M = 1609.344;
const M_PER_DEG_LAT = 111320; // standard equirectangular constant (meters/degree latitude)
const M_PER_DEG_LNG_AT = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

const HALF_HEIGHT_MI = 2;
const HALF_WIDTH_MI = 3;
const dLat = (HALF_HEIGHT_MI * MILE_M) / M_PER_DEG_LAT;
const dLng = (HALF_WIDTH_MI * MILE_M) / M_PER_DEG_LNG_AT(CENTER.lat);

const BBOX = {
  south: round6(CENTER.lat - dLat),
  north: round6(CENTER.lat + dLat),
  west: round6(CENTER.lng - dLng),
  east: round6(CENTER.lng + dLng),
};

// Residential streets are drawn only inside CORE -- a 2.4 x 1.8 mile box
// around the same center, comfortably containing every venue. Outside it the
// map keeps arterials, spines and motorways only. Drawing every residential
// street across all 24 square miles produced a gray mat with no legible
// structure, and roughly quadrupled the file that has to be cached offline.
const CORE_HALF_W_MI = 1.2;
const CORE_HALF_H_MI = 0.9;
const CORE = {
  south: CENTER.lat - (CORE_HALF_H_MI * MILE_M) / M_PER_DEG_LAT,
  north: CENTER.lat + (CORE_HALF_H_MI * MILE_M) / M_PER_DEG_LAT,
  west: CENTER.lng - (CORE_HALF_W_MI * MILE_M) / M_PER_DEG_LNG_AT(CENTER.lat),
  east: CENTER.lng + (CORE_HALF_W_MI * MILE_M) / M_PER_DEG_LNG_AT(CENTER.lat),
};

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

const LAT0 = (BBOX.south + BBOX.north) / 2;
const M_PER_DEG_LNG = M_PER_DEG_LNG_AT(LAT0);

function project(lat, lng) {
  return {
    x: (lng - BBOX.west) * M_PER_DEG_LNG,
    y: (BBOX.north - lat) * M_PER_DEG_LAT, // lat = north -> y = 0 (north up)
  };
}

const W = round1((BBOX.east - BBOX.west) * M_PER_DEG_LNG);
const H = round1((BBOX.north - BBOX.south) * M_PER_DEG_LAT);

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------
// Overpass fetch: primary + mirror endpoint, retries, hardcoded fallback.
// ---------------------------------------------------------------------------
const OVERPASS_PRIMARY = 'https://overpass-api.de/api/interpreter';
const OVERPASS_MIRROR = 'https://overpass.kumi.systems/api/interpreter';

// Fetched highway types: the six named in the brief (primary/secondary/
// tertiary/residential/unclassified/trunk) plus motorway/motorway_link.
// Motorway was added beyond the literal brief because I-94 in this bbox is
// OSM-tagged highway=motorway (confirmed via a scoped Overpass probe), and
// the brief itself anticipates "if trunk/motorway ways appear, render subtly
// at the boundary" -- that clause is unreachable without fetching motorway.
const HIGHWAY_TAGS =
  'motorway|trunk|primary|secondary|tertiary|residential|unclassified|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';

const QUERY = `[out:json][timeout:60];
(
  way["highway"~"^(${HIGHWAY_TAGS})$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["railway"="light_rail"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  node["railway"~"^(station|tram_stop)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out geom;`;

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Overpass's Apache front end 406s requests with no Accept header
        // (mod_negotiation), and its usage policy asks for an identifying
        // User-Agent -- both required for Node's fetch() to succeed here.
        Accept: '*/*',
        'User-Agent': 'mmaf-make-map.mjs (github.com/amanfredi/midway-music-and-art-festival)',
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
      await new Promise((r) => setTimeout(r, 1500 * attempt));
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
  console.log(`Fetching OSM data from primary endpoint (${OVERPASS_PRIMARY})...`);
  try {
    return await fetchWithRetries(OVERPASS_PRIMARY, 2); // initial + 2 retries
  } catch (err) {
    console.warn(`Primary Overpass endpoint failed after retries: ${err.message}`);
  }
  console.log(`Trying mirror endpoint (${OVERPASS_MIRROR})...`);
  try {
    return await fetchWithRetries(OVERPASS_MIRROR, 1);
  } catch (err) {
    console.warn(`Mirror Overpass endpoint also failed: ${err.message}`);
  }
  return null; // signal: use hardcoded fallback
}

// ---------------------------------------------------------------------------
// Hardcoded fallback grid (used only if Overpass is unreachable everywhere).
// Derived from the bbox: University Ave (E-W) and Snelling Ave (N-S) as the
// two spine streets, a handful of real named cross streets from the
// neighborhood at evenly spaced positions, and the three known Green Line
// stations. This is a deliberately simplified stand-in, not a geometrically
// accurate street grid -- if this path runs, the report says so loudly.
// ---------------------------------------------------------------------------
function buildFallbackData() {
  const tiers = { resid: [], arterial: [], spine: [], motorway: [] };
  const streetGroups = new Map();
  const rail = [];
  const stations = [];

  const UNIV_LAT = 44.9558;
  const SNELLING_LNG = -93.1668;

  function addStreet(name, tier, points) {
    tiers[tier].push(points);
    if (!streetGroups.has(name)) streetGroups.set(name, []);
    streetGroups.get(name).push({ points, tier, id: name });
  }

  function vLine(lng) {
    return [project(BBOX.north, lng), project(BBOX.south, lng)].map((p) => ({
      x: round1(p.x),
      y: round1(p.y),
    }));
  }
  function hLine(lat) {
    return [project(lat, BBOX.west), project(lat, BBOX.east)].map((p) => ({
      x: round1(p.x),
      y: round1(p.y),
    }));
  }

  addStreet('University Avenue', 'spine', hLine(UNIV_LAT));
  addStreet('Snelling Avenue', 'spine', vLine(SNELLING_LNG));

  const crossStreets = [
    'Fairview Avenue',
    'Syndicate Street',
    'Griggs Street',
    'Pascal Street',
    'Hamline Avenue',
    'Simpson Street',
    'Asbury Street',
    'Albert Street',
    'Dewey Street',
    'Aldine Street',
  ];
  const lngStep = (BBOX.east - BBOX.west) / (crossStreets.length + 1);
  crossStreets.forEach((name, i) => {
    addStreet(name, 'resid', vLine(BBOX.west + lngStep * (i + 1)));
  });

  const crossAvenues = ['Van Buren Avenue', 'Minnehaha Avenue', 'Concordia Avenue', 'Sherburne Avenue'];
  const latStep = (BBOX.north - BBOX.south) / (crossAvenues.length + 1);
  crossAvenues.forEach((name, i) => {
    addStreet(name, 'arterial', hLine(BBOX.south + latStep * (i + 1)));
  });

  rail.push(hLine(UNIV_LAT));

  for (const [name, lng] of [
    ['Fairview', -93.1787],
    ['Snelling', SNELLING_LNG],
    ['Hamline', -93.1568],
  ]) {
    const p = project(UNIV_LAT, lng);
    stations.push({ x: round1(p.x), y: round1(p.y), name });
  }

  return { tiers, streetGroups, rail, stations };
}

// ---------------------------------------------------------------------------
// OSM element processing
// ---------------------------------------------------------------------------
function simplify(points, minDist = 2) {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function wayToPoints(way) {
  if (!way.geometry) return null;
  const pts = way.geometry
    .filter((g) => g && typeof g.lat === 'number' && typeof g.lon === 'number')
    .map((g) => {
      const p = project(g.lat, g.lon);
      return { x: round1(p.x), y: round1(p.y) };
    });
  const simplified = simplify(pts, 2);
  return simplified.length >= 2 ? simplified : null;
}

const HIGHWAY_RE = new RegExp(`^(${HIGHWAY_TAGS})$`);

function widthTier(way) {
  const name = way.tags.name;
  if (name === 'Snelling Avenue' || name === 'University Avenue') return 'spine';
  const hw = way.tags.highway;
  if (hw === 'motorway' || hw === 'motorway_link' || hw === 'trunk' || hw === 'trunk_link') return 'motorway';
  if (hw === 'residential' || hw === 'unclassified') return 'resid';
  return 'arterial'; // primary/secondary/tertiary + their links (excluding the two spines)
}

/** True when any part of the way's geometry falls inside CORE (see above). */
function touchesCore(way) {
  return (way.geometry || []).some(
    (g) =>
      g &&
      g.lat >= CORE.south &&
      g.lat <= CORE.north &&
      g.lon >= CORE.west &&
      g.lon <= CORE.east
  );
}

function extractFromOverpass(elements) {
  const tiers = { resid: [], arterial: [], spine: [], motorway: [] };
  const streetGroups = new Map();
  const rail = [];
  const stations = [];
  let droppedResid = 0;

  for (const el of elements) {
    if (el.type === 'way' && el.tags?.highway && HIGHWAY_RE.test(el.tags.highway)) {
      const tier = widthTier(el);
      // Sparse surround: residential streets survive only in the core.
      if (tier === 'resid' && !touchesCore(el)) {
        droppedResid++;
        continue;
      }
      const pts = wayToPoints(el);
      if (!pts) continue;
      tiers[tier].push(pts);
      const name = el.tags.name;
      if (name) {
        if (!streetGroups.has(name)) streetGroups.set(name, []);
        streetGroups.get(name).push({ points: pts, tier, id: el.id });
      }
    } else if (el.type === 'way' && el.tags?.railway === 'light_rail') {
      const pts = wayToPoints(el);
      if (pts) rail.push(pts);
    } else if (el.type === 'node' && /^(station|tram_stop)$/.test(el.tags?.railway || '')) {
      const p = project(el.lat, el.lon);
      const label = (el.tags.name || 'Station').replace(/\s+Avenue$/, '');
      stations.push({ x: round1(p.x), y: round1(p.y), name: label });
    }
  }

  if (droppedResid) console.log(`  dropped ${droppedResid} residential ways outside the core`);
  return { tiers, streetGroups, rail, stations };
}

// ---------------------------------------------------------------------------
// Label placement: rotate along the street's local tangent, place once (or
// twice for long streets), and skip a label if it would collide with an
// already-placed one -- the "fits without clutter" rule from the brief.
// ---------------------------------------------------------------------------
function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function pointAtFraction(points, fraction) {
  const target = polylineLength(points) * fraction;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const segLen = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (acc + segLen >= target || i === points.length - 1) {
      const t = segLen === 0 ? 0 : (target - acc) / segLen;
      const x = points[i - 1].x + (points[i].x - points[i - 1].x) * t;
      const y = points[i - 1].y + (points[i].y - points[i - 1].y) * t;
      let angle = (Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      return { x, y, angle };
    }
    acc += segLen;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

function rotatedAABB(cx, cy, w, h, angleRad, pad) {
  const hw = w / 2 + pad;
  const hh = h / 2 + pad;
  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [
    cx + x * Math.cos(angleRad) - y * Math.sin(angleRad),
    cy + x * Math.sin(angleRad) + y * Math.cos(angleRad),
  ]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function aabbOverlap(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function tierRank(tier) {
  return tier === 'spine' ? 0 : tier === 'arterial' ? 1 : 2;
}

function placeLabels(streetGroups) {
  const placedBoxes = [];
  const labels = [];
  const skipped = [];

  const ordered = [...streetGroups.entries()].sort((a, b) => {
    const rankA = tierRank(a[1][0].tier);
    const rankB = tierRank(b[1][0].tier);
    if (rankA !== rankB) return rankA - rankB;
    const lenA = a[1].reduce((s, r) => s + polylineLength(r.points), 0);
    const lenB = b[1].reduce((s, r) => s + polylineLength(r.points), 0);
    return lenB - lenA;
  });

  for (const [name, recs] of ordered) {
    const tier = recs[0].tier;
    // Only arterials and the two spines get names (QA, 2026-08-08). At this
    // extent, labeling every residential street produced ~900 labels that were
    // unreadable at any zoom the map actually opens at, and they crowded out
    // the arterial names that people navigate by.
    if (tier !== 'spine' && tier !== 'arterial') continue;
    const totalLen = recs.reduce((sum, r) => sum + polylineLength(r.points), 0);
    const numWanted = totalLen > 600 * SCALE ? 2 : 1;
    const fontSize = tier === 'spine' ? t(14) : t(11);

    const candidates = [];
    for (const rec of recs) {
      const len = polylineLength(rec.points);
      if (len < fontSize * 3) continue; // too short to bother
      const fractions = len > 300 * SCALE ? [0.5, 0.25, 0.75] : [0.5];
      for (const f of fractions) candidates.push({ rec, len, f });
    }
    candidates.sort((a, b) => b.len - a.len || Math.abs(a.f - 0.5) - Math.abs(b.f - 0.5));

    let placed = 0;
    for (const cand of candidates) {
      if (placed >= numWanted) break;
      const { x, y, angle } = pointAtFraction(cand.rec.points, cand.f);
      // Ways near the bbox edge carry full OSM geometry, some of it outside
      // the viewBox -- skip candidate points that would place a label off
      // the visible map (with a small margin so edge-hugging text still
      // renders cleanly).
      const margin = 4;
      if (x < margin || x > W - margin || y < margin || y > H - margin) continue;
      const textWidth = name.length * fontSize * 0.62;
      const textHeight = fontSize * 1.3;
      const box = rotatedAABB(x, y, textWidth, textHeight, (angle * Math.PI) / 180, 3);
      if (placedBoxes.some((b) => aabbOverlap(b, box))) continue;
      placedBoxes.push(box);
      labels.push({ name, x, y, angle, tier });
      placed++;
    }
    if (placed === 0) skipped.push(name);
  }

  return { labels, skipped };
}

// ---------------------------------------------------------------------------
// SVG assembly
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pathD(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

// Everything below is in map units (= meters), so on-screen size depends on how
// much map fits the viewport. The old values were tuned when the whole 2-mile
// bbox filled a desktop window; on a phone they rendered as hairlines and
// illegible labels. SCALE re-tunes the entire sheet at once against the *home*
// view (site/js/views/map.js HOME_VIEW_M, ~3000 m across a ~360 px phone map),
// which is the view that has to be readable at a glance on festival day.
// Change SCALE and re-run rather than nudging individual numbers.
// Text needs a much larger factor than line work. Stroke widths represent real
// road widths and look right at ~2.75x; type has a legibility floor that has
// nothing to do with scale, and at 2.75x street names rendered at ~3.5 CSS px
// on a phone -- present in the file, unreadable on the device.
const SCALE = 2.75;
const TEXT_SCALE = 7;
const s = (v) => +(v * SCALE).toFixed(1);
const t = (v) => +(v * TEXT_SCALE).toFixed(1);

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

const STYLE = `
  .street { fill:none; stroke-linecap:round; stroke-linejoin:round; }
  .resid-casing    { stroke:#cdb99a; stroke-width:${s(15)}; }
  .resid-fill      { stroke:#f0e2c6; stroke-width:${s(10)}; }
  .arterial-casing { stroke:#b0854f; stroke-width:${s(21)}; }
  .arterial-fill   { stroke:#e8c793; stroke-width:${s(16)}; }
  .spine-casing    { stroke:#8a5a2e; stroke-width:${s(29)}; }
  .spine-fill      { stroke:#d9a75f; stroke-width:${s(24)}; }
  .motorway-casing { stroke:#b7b0a1; stroke-width:${s(23)}; opacity:0.5; }
  .motorway-fill   { stroke:#ded7c8; stroke-width:${s(18)}; opacity:0.5; }
  .greenline  { fill:none; stroke:#3f7d5c; stroke-width:${s(3.5)}; stroke-dasharray:${s(7)} ${s(6)}; stroke-linecap:round; }
  .station-dot   { fill:#fbf8f0; stroke:#3f7d5c; stroke-width:${s(2.5)}; }
  .station-label { font-family:${FONT}; font-size:${t(9)}px; font-weight:600; fill:#2e4a3c; text-anchor:middle; }
  .street-label  { font-family:${FONT}; text-anchor:middle; paint-order:stroke; stroke:#faf3e7; stroke-width:${t(1.1)}; stroke-linejoin:round; }
  .street-label.spine    { font-size:${t(14)}px; font-weight:700; fill:#4a3218; }
  .street-label.arterial { font-size:${t(11)}px; font-weight:600; fill:#5c4326; }
  .attribution { font-family:${FONT}; font-size:${t(8)}px; fill:#8a7a63; }
`.trim();

function buildSvg({ tiers, rail, stations, labels }) {
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" id="circuit-map" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(
      1
    )}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`
  );
  parts.push('<title>Midway Music &amp; Arts Fest street map</title>');
  parts.push(`<style>${STYLE}</style>`);
  parts.push(`<rect x="0" y="0" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="#faf3e7"/>`);

  if (tiers.motorway.length) {
    const d = tiers.motorway.map(pathD).join(' ');
    parts.push(`<path class="street motorway-casing" d="${d}"/>`);
    parts.push(`<path class="street motorway-fill" d="${d}"/>`);
  }

  for (const tier of ['resid', 'arterial', 'spine']) {
    if (!tiers[tier].length) continue;
    const d = tiers[tier].map(pathD).join(' ');
    parts.push(`<path class="street ${tier}-casing" d="${d}"/>`);
    parts.push(`<path class="street ${tier}-fill" d="${d}"/>`);
  }

  if (rail.length) {
    parts.push(`<path class="greenline" d="${rail.map(pathD).join(' ')}"/>`);
  }

  for (const st of stations) {
    parts.push(`<circle class="station-dot" cx="${st.x.toFixed(1)}" cy="${st.y.toFixed(1)}" r="${s(7)}"/>`);
  }
  for (const st of stations) {
    parts.push(
      `<text class="station-label" x="${st.x.toFixed(1)}" y="${(st.y - t(9)).toFixed(1)}">${esc(st.name)}</text>`
    );
  }

  for (const l of labels) {
    const cls = l.tier === 'spine' ? 'spine' : 'arterial';
    const x = l.x.toFixed(1);
    const y = l.y.toFixed(1);
    parts.push(
      `<text class="street-label ${cls}" x="${x}" y="${y}" transform="rotate(${l.angle.toFixed(1)} ${x} ${y})">${esc(
        l.name
      )}</text>`
    );
  }

  parts.push(
    `<text class="attribution" x="${s(8)}" y="${(H - s(8)).toFixed(1)}">Map data © OpenStreetMap contributors</text>`
  );
  parts.push('</svg>');
  return parts.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const refresh = process.argv.includes('--refresh');
  let data;

  if (!refresh && existsSync(CACHE_PATH)) {
    console.log(`Using cached OSM data at ${path.relative(ROOT, CACHE_PATH)} (pass --refresh to refetch).`);
    const rawText = await readFile(CACHE_PATH, 'utf8');
    data = extractFromOverpass(JSON.parse(rawText).elements);
  } else {
    const rawText = await fetchOverpass();
    if (rawText === null) {
      console.warn('\n' + '!'.repeat(72));
      console.warn('OSM OVERPASS FETCH FAILED after retries on primary + mirror endpoints.');
      console.warn('Falling back to a HARDCODED, hand-derived street grid for the bbox.');
      console.warn('This map is DEGRADED -- rerun `node tools/make-map.mjs --refresh`');
      console.warn('with network access as soon as possible.');
      console.warn('!'.repeat(72) + '\n');
      data = buildFallbackData();
    } else {
      await writeFile(CACHE_PATH, rawText, 'utf8');
      console.log(`Wrote fresh OSM response to ${path.relative(ROOT, CACHE_PATH)} (${rawText.length} bytes).`);
      data = extractFromOverpass(JSON.parse(rawText).elements);
    }
  }

  const { labels, skipped } = placeLabels(data.streetGroups);
  const svg = buildSvg({ tiers: data.tiers, rail: data.rail, stations: data.stations, labels });
  await writeFile(SVG_OUT, svg, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, SVG_OUT)} (${Buffer.byteLength(svg, 'utf8')} bytes).`);

  const calibration = {
    svg_viewbox: [0, 0, W, H],
    control_points: [
      { lat: BBOX.north, lng: BBOX.west, x: 0, y: 0 },
      { lat: BBOX.north, lng: BBOX.east, x: W, y: 0 },
      { lat: BBOX.south, lng: BBOX.west, x: 0, y: H },
      { lat: BBOX.south, lng: BBOX.east, x: W, y: H },
    ],
  };
  await writeFile(CALIBRATION_OUT, JSON.stringify(calibration, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${path.relative(ROOT, CALIBRATION_OUT)}.`);

  console.log(`\nStreets labeled: ${labels.length} (of ${data.streetGroups.size} named streets found).`);
  if (skipped.length) {
    console.log(`Skipped for clutter/too-short: ${skipped.join(', ')}`);
  }
  console.log(`Stations: ${data.stations.map((s) => s.name).join(', ') || '(none)'}`);
  console.log(`Projection: lat0=${LAT0}, m/deg lat=${M_PER_DEG_LAT}, m/deg lng=${M_PER_DEG_LNG.toFixed(4)}`);
  console.log(`viewBox: 0 0 ${W} ${H}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
