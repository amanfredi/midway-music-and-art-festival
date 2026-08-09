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
// The full extent is never the default view — see the home view in
// site/js/views/map.js, which opens on a ~3000 m square around CENTER.
const CENTER = { lat: 44.9599375, lng: -93.1666875 }; // Hamline Park (venues sheet)
const MILE_M = 1609.344;
const M_PER_DEG_LAT = 111320; // standard equirectangular constant (meters/degree latitude)
const M_PER_DEG_LNG_AT = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

// A 10-mile SQUARE centered on Hamline Park (QA, 2026-08-09). The previous
// extent was a wide, short rectangle anchored on the two downtowns; that left
// the north and south edges looking torn, because a way is fetched whenever it
// intersects the bbox and Overpass returns its whole geometry, so some
// features ran past the edge and others stopped dead at it. A square with
// generous margin puts that boundary well outside anything anyone will look
// at, and it covers both downtowns comfortably.
const HALF_SIDE_MI = 5;
const dLat = (HALF_SIDE_MI * MILE_M) / M_PER_DEG_LAT;
const dLng = (HALF_SIDE_MI * MILE_M) / M_PER_DEG_LNG_AT(CENTER.lat);

const BBOX = {
  south: round6(CENTER.lat - dLat),
  north: round6(CENTER.lat + dLat),
  west: round6(CENTER.lng - dLng),
  east: round6(CENTER.lng + dLng),
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

// Residential and unclassified streets are deliberately NOT fetched: at this
// extent they added ~1500 ways that rendered as an undifferentiated gray mat,
// obscuring the arterial structure people actually navigate by, and they
// dominated the file that has to be cached for offline use (QA, 2026-08-09;
// previously they were drawn inside a central "core" box only, now nowhere).
// Motorway is included because I-94 in this bbox is OSM-tagged
// highway=motorway (confirmed via a scoped Overpass probe).
const HIGHWAY_TAGS =
  'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';

// Water: the Mississippi is the one landmark that makes this metro-wide view
// readable at a glance, so it's fetched as area geometry (natural=water /
// the legacy waterway=riverbank) with the river centerline as a fallback for
// stretches mapped only as a line.
//
// Light rail comes from the ROUTE RELATIONS, not from railway=light_rail ways.
// Querying the ways swept in the Franklin Avenue maintenance yard and its
// switching leads, which rendered as a hatched blob indistinguishable from the
// Green Line (QA, 2026-08-09). A route relation contains only the revenue
// alignment, and it also tells us which line each way belongs to, so Blue and
// Green can be drawn in their own colors.
const QUERY = `[out:json][timeout:120];
(
  way["highway"~"^(${HIGHWAY_TAGS})$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  relation["route"="light_rail"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  node["railway"~"^(station|tram_stop)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["natural"="water"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["waterway"="riverbank"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["waterway"="river"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
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

/** A closed way whose first and last node coincide — i.e. an area, not a line. */
function isClosedWay(way) {
  const g = way.geometry;
  if (!g || g.length < 4) return false;
  const a = g[0];
  const b = g[g.length - 1];
  return a.lat === b.lat && a.lon === b.lon;
}

/** Which METRO line a light-rail route relation belongs to, or null. */
function railLineKey(tags = {}) {
  const s = `${tags.ref || ''} ${tags.name || ''} ${tags.colour || ''}`.toLowerCase();
  if (s.includes('blue')) return 'blue';
  if (s.includes('green')) return 'green';
  return null;
}

function extractFromOverpass(elements) {
  const tiers = { resid: [], arterial: [], spine: [], motorway: [] };
  const streetGroups = new Map();
  const rail = { green: [], blue: [] };
  const stations = [];
  const waterAreas = [];
  const waterLines = [];

  for (const el of elements) {
    if (el.type === 'relation' && el.tags?.route === 'light_rail') {
      const key = railLineKey(el.tags);
      if (!key) continue;
      for (const member of el.members || []) {
        if (member.type !== 'way' || !member.geometry) continue;
        const pts = wayToPoints(member);
        if (pts) rail[key].push(pts);
      }
      continue;
    }

    const isWater =
      el.type === 'way' &&
      (el.tags?.natural === 'water' || el.tags?.waterway === 'riverbank' || el.tags?.waterway === 'river');

    if (isWater) {
      const pts = wayToPoints(el);
      if (!pts) continue;
      if (isClosedWay(el)) waterAreas.push(pts);
      else if (el.tags.waterway === 'river') waterLines.push(pts);
      continue;
    }

    if (el.type === 'way' && el.tags?.highway && HIGHWAY_RE.test(el.tags.highway)) {
      const pts = wayToPoints(el);
      if (!pts) continue;
      tiers[widthTier(el)].push(pts);
      const name = el.tags.name;
      if (name) {
        if (!streetGroups.has(name)) streetGroups.set(name, []);
        streetGroups.get(name).push({ points: pts, tier: widthTier(el), id: el.id });
      }
    } else if (el.type === 'node' && /^(station|tram_stop)$/.test(el.tags?.railway || '')) {
      const p = project(el.lat, el.lon);
      const label = (el.tags.name || 'Station').replace(/\s+Avenue$/, '');
      stations.push({ x: round1(p.x), y: round1(p.y), name: label });
    }
  }

  console.log(`  water: ${waterAreas.length} area(s), ${waterLines.length} centerline(s)`);
  console.log(`  rail: ${rail.green.length} green way(s), ${rail.blue.length} blue way(s)`);
  return { tiers, streetGroups, rail, stations, waterAreas, waterLines };
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
    // Repeat a street's name roughly every LABEL_SPACING_M so it stays
    // identifiable when zoomed in. Labels are placed once for the whole map,
    // and since they no longer scale with the view (see map.js), a single
    // label per street left most of the map anonymous at close zoom. The
    // collision test below is what actually prevents crowding, so asking for
    // more here is safe -- surplus candidates are simply rejected.
    const numWanted = Math.min(8, Math.max(1, Math.round(totalLen / LABEL_SPACING_M)));
    const fontSize = tier === 'spine' ? t(14) : t(11);

    const candidates = [];
    for (const rec of recs) {
      const len = polylineLength(rec.points);
      if (len < fontSize * 3) continue; // too short to bother
      const steps = Math.min(9, Math.max(1, Math.round(len / LABEL_SPACING_M) * 2 + 1));
      const fractions = Array.from({ length: steps }, (_, i) => (i + 1) / (steps + 1));
      // Prefer the middle of a segment, then work outward.
      fractions.sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5));
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
      // Level of detail. The spines (Snelling, University) keep one name at
      // every zoom; arterials appear a level in; each additional repeat of the
      // same street is a level further out again, so zooming out thins the
      // repeats before it drops whole streets.
      const lod = tier === 'spine' ? Math.min(1, placed) : Math.min(3, 1 + placed);
      labels.push({ name, x, y, angle, tier, lod });
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
// Target distance between repeats of the same street name, in meters.
const LABEL_SPACING_M = 900;
const s = (v) => +(v * SCALE).toFixed(1);
const t = (v) => +(v * TEXT_SCALE).toFixed(1);

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

// Neutral grays (QA, 2026-08-09): the base map is context, and the only things
// that should carry color are the pins overlaid on it and the transit lines.
// The warm tan palette competed with the brand red/blue/green pins.
const PAPER = '#eeeeec';
const WATER = '#bcd2de'; // the one non-neutral in the base map, so the river reads as water

const STYLE = `
  .street { fill:none; stroke-linecap:round; stroke-linejoin:round; }
  .water-area { fill:${WATER}; stroke:none; }
  .water-line { fill:none; stroke:${WATER}; stroke-width:${s(28)}; stroke-linecap:round; stroke-linejoin:round; }
  .arterial-casing { stroke:#c4c4c2; stroke-width:${s(21)}; }
  .arterial-fill   { stroke:#dedede; stroke-width:${s(16)}; }
  .spine-casing    { stroke:#a8a8a6; stroke-width:${s(29)}; }
  .spine-fill      { stroke:#cfcfcf; stroke-width:${s(24)}; }
  .motorway-casing { stroke:#b4b4b2; stroke-width:${s(23)}; opacity:0.6; }
  .motorway-fill   { stroke:#d9d9d9; stroke-width:${s(18)}; opacity:0.6; }
  /* Solid and thick, not thin and dashed: LRT is double-tracked and each track
     is a separate OSM way, so two thin dashes read as two railways. One heavy
     stroke merges them into the single line a rider thinks of. */
  .rail { fill:none; stroke-width:${s(9)}; stroke-linecap:round; stroke-linejoin:round; }
  .rail-green { stroke:#2f7d4f; }
  .rail-blue  { stroke:#2b5fa8; }
  .station-dot   { fill:#ffffff; stroke:#4a4a4a; stroke-width:${s(2.5)}; }
  .station-label { font-family:${FONT}; font-size:${t(9)}px; font-weight:600; fill:#3d5c4d; text-anchor:middle; }
  .street-label  { font-family:${FONT}; text-anchor:middle; paint-order:stroke; stroke:${PAPER}; stroke-width:${t(1.1)}; stroke-linejoin:round; }
  .street-label.spine    { font-size:${t(14)}px; font-weight:700; fill:#3f3f3f; }
  .street-label.arterial { font-size:${t(11)}px; font-weight:600; fill:#565654; }
  .attribution { font-family:${FONT}; font-size:${t(8)}px; fill:#8c8c8a; }

  /* Level of detail. Every label carries a lod class; the UI sets data-lod on
     the root as the user zooms, hiding anything above that level. Zoomed out,
     only the spines survive and only once each -- 171 names at a 10-mile view
     is noise, not information (QA, 2026-08-09). With no data-lod set (the SVG
     opened on its own) everything shows. */
  #circuit-map[data-lod="0"] .lod1,
  #circuit-map[data-lod="0"] .lod2,
  #circuit-map[data-lod="0"] .lod3,
  #circuit-map[data-lod="1"] .lod2,
  #circuit-map[data-lod="1"] .lod3,
  #circuit-map[data-lod="2"] .lod3 { display:none; }
`.trim();

function buildSvg({ tiers, rail, stations, labels, waterAreas = [], waterLines = [] }) {
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" id="circuit-map" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(
      1
    )}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`
  );
  parts.push('<title>Midway Music &amp; Arts Fest street map</title>');
  parts.push(`<style>${STYLE}</style>`);
  parts.push(`<rect x="0" y="0" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="${PAPER}"/>`);

  // Water goes down first, under the streets — bridges should read as crossing
  // it. Centerlines before areas so a mapped riverbank wins where both exist.
  if (waterLines.length) {
    parts.push(`<path class="water-line" d="${waterLines.map(pathD).join(' ')}"/>`);
  }
  if (waterAreas.length) {
    parts.push(`<path class="water-area" d="${waterAreas.map((p) => pathD(p) + ' Z').join(' ')}"/>`);
  }

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

  for (const [key, ways] of Object.entries(rail)) {
    if (!ways.length) continue;
    parts.push(`<path class="rail rail-${key}" d="${ways.map(pathD).join(' ')}"/>`);
  }

  // Labels and station dots are wrapped in a positioned group plus an inner
  // .map-label__scale group. The UI counter-scales that inner group as the
  // user zooms (site/js/views/map.js), exactly as it does for pins, so type
  // holds a constant size on screen instead of ballooning when zoomed in.
  // Left alone, the scale is 1 and everything renders at home-view size, so
  // the SVG still looks right opened on its own.
  const scalable = (x, y, inner, { rotate = 0, lod = 0 } = {}) =>
    `<g class="map-label lod${lod}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})${
      rotate ? ` rotate(${rotate.toFixed(1)})` : ''
    }"><g class="map-label__scale">${inner}</g></g>`;

  // Station dots stay visible at every zoom (they're anchors); their names are
  // one level in, so a wide view isn't papered over with station names.
  for (const st of stations) {
    parts.push(scalable(st.x, st.y, `<circle class="station-dot" cx="0" cy="0" r="${s(7)}"/>`));
  }
  for (const st of stations) {
    parts.push(
      scalable(st.x, st.y, `<text class="station-label" x="0" y="${-t(9)}">${esc(st.name)}</text>`, { lod: 2 })
    );
  }

  for (const l of labels) {
    const cls = l.tier === 'spine' ? 'spine' : 'arterial';
    parts.push(
      scalable(l.x, l.y, `<text class="street-label ${cls}" x="0" y="0">${esc(l.name)}</text>`, {
        rotate: l.angle,
        lod: l.lod,
      })
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
  const svg = buildSvg({
    tiers: data.tiers,
    rail: data.rail,
    stations: data.stations,
    waterAreas: data.waterAreas,
    waterLines: data.waterLines,
    labels,
  });
  await writeFile(SVG_OUT, svg, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, SVG_OUT)} (${Buffer.byteLength(svg, 'utf8')} bytes).`);

  // home_center is where the UI opens the map. It is CENTER (Hamline Park),
  // not the middle of the viewBox -- the bbox is anchored on the two downtowns
  // instead, so the two no longer coincide. See the BBOX comment above and
  // site/js/views/map.js.
  const home = project(CENTER.lat, CENTER.lng);
  const calibration = {
    svg_viewbox: [0, 0, W, H],
    home_center: { x: round1(home.x), y: round1(home.y) },
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
