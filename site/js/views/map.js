// The #/map tab, rendered by MapLibre GL JS 6.
//
// The ground is vector: streets, water, rail and labels drawn from
// assets/map-vector.geojson, which tools/make-map-geojson.mjs generates from the
// committed Overpass response in tools/osm-cache.json. Labels are symbol layers,
// so the engine re-places them at every zoom instead of carrying one placement
// baked for the whole map.
//
// Georeferencing still runs through geo.js: the map's extent and home view come
// from map-calibration.json's control points, inverted through the same affine
// projector the SVG map used forwards. Recalibrating to commissioned artwork
// remains a pure data change.
//
// A four-corner `ImageSource` ground for artwork was auditioned alongside this
// one and is not shipped -- see BACKLOG.md's artwork entry for what it cost and
// what it would need. tools/make-map-raster.mjs still produces the raster.

import { esc, showToast } from '../util.js';
import { makeProjector } from '../geo.js';
import { openVenueSheet, openSponsorSheet, openTransitSheet, openPickerSheet } from './sheet.js';

// View widths, in meters across the map frame, converted to MapLibre zooms at
// runtime once the frame's pixel width is known.
//
// HOME (3000 m) and the full extent carry over from the SVG map unchanged. The
// closest zoom does not: that map stopped at 350 m across, where two venues 14 m
// apart are still only ~15 px apart -- closer together than one pin is wide. No
// amount of collision or cluster handling can separate points inside a zoom
// range that never resolves them, so the ceiling is 120 m.
const HOME_VIEW_M = 3000;
const MIN_VIEW_M = 120;
// Where the two treatments for venues that share a location meet: wider than
// this they stack as one cluster glyph carrying their key-list numbers, from
// here inward each draws as its own displaced diamond tethered to the point it
// really occupies.
const SPLIT_VIEW_M = 1200;

// Transit pins are limited to stops within this distance of the festival
// center, as the retired SVG map did it -- the extent reaches both downtowns
// and transit.json carries 76 stops.
const TRANSIT_PIN_RADIUS_M = 2414;

const TRANSIT_LINE_LETTER = { green: 'G', a: 'A', b: 'B' };
const TRANSIT_LINE_NAME = { green: 'METRO Green Line', a: 'METRO A Line', b: 'METRO B Line' };
const FEATURED_SPONSOR_TIERS = new Set(['emerald', 'ruby', 'sapphire']);

// Every color the map draws comes from app.css, resolved at render time.
//
// The SVG map had to state its colors twice -- once in app.css for the legend
// swatches, once inside map.svg's own <style> block -- and CONTRACTS.md carried
// a rule plus a test to keep the two copies honest. Drawing through an engine
// removes the second copy: a legend swatch and the line it stands for are now
// the same custom property, so they cannot drift.
const MAP_COLOR_VARS = {
  paper: '--map-paper',
  water: '--map-water',
  venue: '--pin-venue',
  transit: '--pin-transit',
  sponsor: '--pin-sponsor',
  railGreen: '--rail-green',
  railBlue: '--rail-blue',
  busRouteBrt: '--bus-route-brt',
  busRouteLocal: '--bus-route-local',
  accent: '--color-accent',
  accentDark: '--color-accent-dark',
  streetCasing: '--street-casing',
  streetFill: '--street-fill',
  spineCasing: '--spine-casing',
  spineFill: '--spine-fill',
  motorwayCasing: '--motorway-casing',
  motorwayFill: '--motorway-fill',
  stationStroke: '--station-stroke',
  labelSpine: '--map-label-spine',
  labelArterial: '--map-label-arterial',
  labelStation: '--map-label-station',
  leaderDot: '--map-leader-dot',
  leaderLine: '--map-leader-line',
  surface: '--color-surface',
};

/**
 * Resolves custom properties to concrete colors.
 *
 * Reading a custom property directly hands back whatever token stream was
 * authored -- often another `var()` -- so each one is bounced through a probe
 * element's `color`, which the browser must resolve to an rgb() triple.
 */
function resolveMapColors(host) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  const out = {};
  try {
    for (const [key, name] of Object.entries(MAP_COLOR_VARS)) {
      probe.style.color = `var(${name})`;
      out[key] = getComputedStyle(probe).color;
    }
  } finally {
    probe.remove();
  }
  return out;
}

// MapLibre 6 draws glyphs locally with TinySDF whenever a style carries no
// `glyphs` URL -- for every codepoint, not just CJK (GlyphManager
// _getAndCacheGlyphsPromise: `if (!this.url || ...) return this._drawGlyph(...)`).
// So these styles deliberately omit `glyphs`: no font server, no committed SDF
// PBFs, nothing fetched, and labels come out in the device's own UI font, which
// is what the rest of the site already uses.
//
// The engine reads a weight out of the FIRST family name in the stack
// (GlyphManager._fontWeight, a case-insensitive `\bbold\b`-style word match)
// and then uses the whole stack, weight word included, as a CSS font-family --
// appending `sans-serif` itself. So the weight word has to be a family that
// resolves NOWHERE, or it wins the cascade and the rest of the stack is never
// consulted.
//
// A bare "Bold" or "Semibold" is not that. WebKit/CoreText matches bare style
// words against face names, so on Safari/macOS `Bold` resolved to a real face
// (measured: 277.4 units/digit against system-ui's 299.5) and pin numbers came
// out in a font nothing else on the page uses -- the whole stack behind it dead
// code. Blink skips those words, which is why it only ever showed up in Safari.
// Prefixing the project's initialism kills the match on both engines while
// keeping the word the weight sniff needs. Any name that surrounds the style
// word would do, with one limit: keep to letters, digits, spaces and `-`,
// because MapLibre leaves these names unquoted and a paren or comma would make
// the whole declaration unparseable.
//
// Everything after the weight word is a family that really resolves inside a
// canvas: `system-ui` is the standard generic for the platform UI font, which
// is what `app.css` asks for and therefore what the venue key list draws its
// numbers in. The vendor aliases these stacks used to lead with
// (`-apple-system`, `BlinkMacSystemFont`) are each understood by exactly one
// engine, so on any other engine the first family that could match was
// Helvetica; they are gone rather than reordered, because a stack whose early
// entries are dead weight is how pin labels end up in a font nothing else on
// the page uses.
const UI_FONT_STACK = 'system-ui,Helvetica Neue,Helvetica,Arial';
const FONT_BOLD = [`MMAF Bold,${UI_FONT_STACK}`];
const FONT_SEMIBOLD = [`MMAF Semibold,${UI_FONT_STACK}`];

// Pin geometry in CSS pixels. The SVG map authors pins in map units at home-view
// scale and counter-scales them on every zoom to hold a constant on-screen size;
// symbol layers are in screen pixels already, so that whole mechanism goes away.
// SMALL_R carries over from the SVG's home-view size (a 92-unit radius over a
// 3000 m view on a ~360 px frame is ~11 px). VENUE_R does not: the a11y guide
// wants venue pins a size level above the rest, and growing the venue pin is
// the direction that satisfies both that and WCAG 2.5.8 (shrinking the others
// would cut their hit targets).
//
// 19 rather than the guide's full 2x step (which would be 22), because the
// home view will not hold pins that big. Diamonds with half-diagonal R
// overlap when their centres are less than 2R apart measured |dx| + |dy|, and
// the closest pair of separately-drawn venue pins at the home view is 39.2 px
// apart on that measure (venues 2 and 11, in the 560 px frame the map caps
// at; the phone frames are looser because clustering merges that pair). So
// 2R <= 39.2 px, and 19 is the largest whole radius that clears it — 38 px
// pins against 22 px ones, a 1.73x step. Clustering does not rescue a larger
// value: `clusterRadius` is 26 px, so it only guarantees separated pins are
// 26 px apart and leaves anything above R = 13 to the data. That 39.2 px is a
// property of the current venue set, not a floor — re-measure if the sheet
// gains venues.
const VENUE_R = 19;
const SMALL_R = 11;
const CLUSTER_R = 17;
// The number inside the venue diamond, sized so a two-digit label still clears
// the diamond's sloping sides: at the label's cap height the diamond is about
// 2 * (VENUE_R - 6) = 26 px wide, and "11" sets to ~20 px here.
const VENUE_TEXT_PX = 16;
// Two member numbers stacked inside a CLUSTER_R diamond. Two lines at this size
// reach ~8.5 px either side of the centre, where the diamond is still ~17 px
// wide, and a two-digit number sets to ~12 px (measured in the engine's own
// font stack, 2026-08-23).
const CLUSTER_TEXT_PX = 10;
// The tap-highlight halo extends this far beyond the pin it rings.
const HALO_PAD = 6;
// Displaced-pin geometry. Members of a coincident group sit in east-west lanes
// a pin wide plus a leader run either side, which is what makes adjacent
// diamonds clear each other AND leaves each line long enough to be seen: at
// the minimum 2 * VENUE_R spacing the diamond's inner tip lands on its own dot.
const LEADER_RUN_PX = 13;
const LEADER_LANE_PX = 2 * (VENUE_R + LEADER_RUN_PX);
const LEADER_DOT_R = 3.5;
const LEADER_LINE_W = 2;
// Taps are matched against a box around the touch point rather than the icon's
// own pixels, which is how the SVG map's oversized diamond hit targets are
// reproduced without inflating the icons (and their collision boxes) to match.
const TAP_SLOP_PX = 10;

// Camera motion added by this view (pan buttons, key-list recentering) is
// non-essential animation under prefers-reduced-motion: the movement still
// happens, instantly. The engine also zeroes durations itself when the
// preference is set, but stating it here keeps the behavior local and testable.
function cameraDuration(ms) {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}

let enginePromise = null;
let cssInjected = false;

// The engine is ~1 MB of module across two files, so it is imported on the
// first visit to #/map rather than at boot -- the other five tabs never need it.
function loadEngine() {
  enginePromise ||= import('../../assets/maplibre/maplibre-gl.mjs');
  return enginePromise;
}

// MapLibre's stylesheet is injected on first use for the same reason. It styles
// the canvas container and the controls; the site's own CSS handles everything
// around it.
function injectEngineCss() {
  if (cssInjected) return;
  cssInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'assets/maplibre/maplibre-gl.css';
  document.head.appendChild(link);
}

let calibrationCache = null;
let transitStopsCache = null;

async function loadCalibration() {
  if (calibrationCache) return calibrationCache;
  const r = await fetch('assets/map-calibration.json');
  if (!r.ok) throw new Error('calibration fetch failed');
  calibrationCache = await r.json();
  return calibrationCache;
}

// Transit pins are an informational overlay, not core map infrastructure: a
// failed fetch means no transit pins, not a broken map, and the next visit
// retries. Same posture as the SVG implementation.
async function loadTransitStops() {
  if (transitStopsCache) return transitStopsCache;
  try {
    const r = await fetch('assets/transit.json');
    if (r.ok) transitStopsCache = (await r.json()).stops ?? [];
  } catch {
    /* offline/missing transit.json: the map still works without the overlay */
  }
  return transitStopsCache ?? [];
}

/**
 * MapLibre zoom at which `meters` spans `pixels` of screen at this latitude.
 *
 * The familiar 156543.03392 m/px constant is for 256 px tiles. MapLibre's world
 * is 512 px wide at zoom 0, so its zoom is one level coarser than the classic
 * formula returns -- get this wrong and every view is exactly twice as tight as
 * intended, which is subtle enough to look merely "a bit close" rather than wrong.
 */
function zoomForMeters(meters, pixels, lat) {
  return Math.log2((metersPerPixel(0, lat) * pixels) / meters);
}

/** The same relation read the other way: ground meters per screen pixel at `zoom`. */
function metersPerPixel(zoom, lat) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 / 2 ** zoom;
}

/**
 * Venues the split zoom cannot draw apart, and the east-west offset each one
 * is displaced by from there inward.
 *
 * Two diamonds with half-diagonal R overlap when their centres are closer than
 * 2R measured |dx| + |dy| -- the measure VENUE_R itself was sized against.
 * Anything failing that test at the split zoom, the widest view where
 * individual numbered pins draw, is grouped by single linkage; zooming further
 * in only spreads true positions apart, so one static offset per venue holds
 * for the whole range. Membership comes from the coordinates alone: the sheet's
 * coincident venues are a fact about the addresses, not a list of ids.
 */
function coincidentGroups(venues, { splitZoom, lat }) {
  const mPerPx = metersPerPixel(splitZoom, lat);
  const mPerDegLat = 111320;
  const mPerDegLng = mPerDegLat * Math.cos((lat * Math.PI) / 180);
  const parent = venues.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < venues.length; i++) {
    for (let j = i + 1; j < venues.length; j++) {
      const dx = Math.abs(venues[i].lng - venues[j].lng) * mPerDegLng;
      const dy = Math.abs(venues[i].lat - venues[j].lat) * mPerDegLat;
      if ((dx + dy) / mPerPx < 2 * VENUE_R) parent[root(i)] = root(j);
    }
  }

  const members = new Map();
  venues.forEach((_, i) => members.set(root(i), [...(members.get(root(i)) ?? []), i]));
  const offsets = new Map();
  for (const group of members.values()) {
    if (group.length < 2) continue;
    // Lanes run west to east so a displaced diamond stays on the side of the
    // group its venue is really on. An odd group's middle lane is offset 0 --
    // that member draws at its own coordinate, needing no tether.
    group.sort((a, b) => venues[a].lng - venues[b].lng || a - b);
    group.forEach((index, lane) => {
      offsets.set(index, (lane - (group.length - 1) / 2) * LEADER_LANE_PX);
    });
  }
  return offsets;
}

function diamondPath(ctx, cx, cy, radius) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx + radius, cy);
  ctx.lineTo(cx, cy + radius);
  ctx.lineTo(cx - radius, cy);
  ctx.closePath();
}

/**
 * A canvas at `dpr`, sized in CSS pixels, plus the centre to draw around. The
 * centre is where MapLibre anchors the image on the feature's coordinate, so a
 * composite icon states its true position by what it draws there.
 */
function pinCanvas(halfWidth, halfHeight, dpr) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(halfWidth * 2 * dpr);
  canvas.height = Math.ceil(halfHeight * 2 * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, cx: canvas.width / (2 * dpr), cy: canvas.height / (2 * dpr) };
}

/**
 * A diamond pin as a canvas image for map.addImage(). The SVG map's pins are
 * unstroked diamonds (no white keyline) except the generic sponsor pin, which is
 * an outline; this reproduces both.
 */
function diamondImage(radius, { fill, stroke, strokeWidth = 0 }, dpr) {
  const half = radius + 2 + strokeWidth;
  const { ctx, cx, cy } = pinCanvas(half, half, dpr);
  diamondPath(ctx, cx, cy, radius);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && strokeWidth) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  return { data: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), pixelRatio: dpr };
}

/**
 * The cluster symbol: three diamonds fanned behind each other. The front one is
 * centred on the anchor, so a label placed on the feature lands on it.
 *
 * A *count* here is actively misleading. Venue pins carry a venue's number from
 * the key list, so a cluster reading "3" is indistinguishable from venue 3 --
 * on the phone it was read as exactly that (Anthony, 2026-08-10). The member
 * venues' own numbers are the sanctioned exception (2026-08-23): those digits
 * are the pin vocabulary rather than a competing one. Past two members they
 * stop fitting and the glyph goes back to saying only "more than one venue".
 */
function clusterImage(radius, { fill, stroke }, dpr) {
  const offset = Math.round(radius * 0.34);
  const strokeWidth = 2;
  const half = radius + 2 + strokeWidth + offset * 2;
  const { ctx, cx, cy } = pinCanvas(half, half, dpr);

  // Back to front. Each rear diamond is outlined in the surface color so the
  // stack reads as separate sheets rather than one blurred blob.
  for (const [dx, dy] of [
    [offset, -offset],
    [offset / 2, -offset / 2],
    [0, 0],
  ]) {
    diamondPath(ctx, cx + dx, cy + dy, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  return { data: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), pixelRatio: dpr };
}

/**
 * A venue pin displaced `offset` pixels east or west of the coordinate it
 * belongs to, with a dot back at that coordinate and a line joining the two.
 *
 * All three parts are one image, anchored on the dot. MapLibre has no
 * leader-line primitive and its collision handling hides symbols rather than
 * moving them (which is why addPins turns collision off entirely), so the
 * displacement is precomputed and static -- and baking the line into the icon
 * is what makes it impossible for another label to be placed across it.
 */
function leaderImage(offset, { fill, dot, line }, dpr) {
  const { ctx, cx, cy } = pinCanvas(Math.abs(offset) + VENUE_R + 2, VENUE_R + 2, dpr);

  if (offset !== 0) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + offset, cy);
    ctx.strokeStyle = line;
    ctx.lineWidth = LEADER_LINE_W;
    ctx.stroke();
  }

  diamondPath(ctx, cx + offset, cy, VENUE_R);
  ctx.fillStyle = fill;
  ctx.fill();

  // Drawn last: the dot is the one part that must never be covered, since it is
  // the only thing on the map claiming the venue's real position. A member the
  // lane layout leaves at its own coordinate has nothing to point at.
  if (offset !== 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, LEADER_DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = dot;
    ctx.fill();
  }
  return { data: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), pixelRatio: dpr };
}

/**
 * The tap-highlight ring for a displaced pin, positioned inside the image the
 * same way leaderImage() positions its diamond.
 *
 * The circle layers the other pins use draw at the feature's geometry, which
 * for these pins is the dot rather than the diamond -- a halo around empty
 * paper. Sharing one offset between two composite images is what keeps ring and
 * diamond aligned by construction instead of by two expressions agreeing.
 */
function leaderHaloImage(offset, { fill, stroke }, dpr) {
  const radius = VENUE_R + HALO_PAD;
  const strokeWidth = 2;
  const pad = 2 + strokeWidth;
  const { ctx, cx, cy } = pinCanvas(Math.abs(offset) + radius + pad, radius + pad, dpr);

  ctx.beginPath();
  ctx.arc(cx + offset, cy, radius, 0, Math.PI * 2);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
  return { data: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), pixelRatio: dpr };
}

/** Image ids for a displaced pin. One pair per distinct offset. */
const leaderIconId = (offset) => `pin-venue-leader-${offset < 0 ? 'w' : 'e'}${Math.abs(offset)}`;
const leaderHaloId = (offset) => `halo-venue-leader-${offset < 0 ? 'w' : 'e'}${Math.abs(offset)}`;

// The three zooms every zoom-keyed stop below is pinned to: the full extent,
// the home view, and the closest zoom. They follow from the calibration and the
// view widths above -- roughly 10.4 / 12.8 / 17.5 on a phone-width frame.
const Z_WIDE = 10.5;
const Z_HOME = 12.8;
const Z_CLOSE = 17.5;

/** Zoom-interpolated line width, the engine's answer to the SVG's fixed map-unit strokes. */
function widthByZoom(atWide, atHome, atClose) {
  return ['interpolate', ['exponential', 1.5], ['zoom'], Z_WIDE, atWide, Z_HOME, atHome, Z_CLOSE, atClose];
}

/** The vector ground: streets, water, rail and labels from the OSM GeoJSON. */
function groundLayersVector(colors) {
  return [
    { id: 'paper', type: 'background', paint: { 'background-color': colors.paper } },
    {
      id: 'water-line',
      type: 'line',
      source: 'mapdata',
      filter: ['==', ['get', 'kind'], 'water-line'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.water, 'line-width': widthByZoom(3, 9.5, 26) },
    },
    {
      id: 'water-area',
      type: 'fill',
      source: 'mapdata',
      filter: ['==', ['get', 'kind'], 'water-area'],
      paint: { 'fill-color': colors.water },
    },
    // Casing under fill for each road tier, matching the SVG's two-stroke roads.
    {
      id: 'motorway-casing',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'motorway']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.motorwayCasing, 'line-width': widthByZoom(3.5, 9, 22), 'line-opacity': 0.6 },
    },
    {
      id: 'motorway-fill',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'motorway']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.motorwayFill, 'line-width': widthByZoom(2.5, 7, 18), 'line-opacity': 0.6 },
    },
    {
      id: 'arterial-casing',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'arterial']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.streetCasing, 'line-width': widthByZoom(2.5, 7, 17) },
    },
    {
      id: 'arterial-fill',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'arterial']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.streetFill, 'line-width': widthByZoom(1.6, 5.2, 13) },
    },
    {
      id: 'spine-casing',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'spine']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.spineCasing, 'line-width': widthByZoom(3.5, 9.5, 24) },
    },
    {
      id: 'spine-fill',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'spine']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.spineFill, 'line-width': widthByZoom(2.6, 7.8, 20) },
    },
    // Color keys off `class`, not `ref`: Metro Transit's own map convention
    // groups BRT (A, B) and local (67, 72) into two hues, not one per route.
    {
      id: 'bus-route',
      type: 'line',
      source: 'mapdata',
      filter: ['==', ['get', 'kind'], 'bus-route'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'class'],
          'brt',
          colors.busRouteBrt,
          'local',
          colors.busRouteLocal,
          colors.busRouteBrt,
        ],
        'line-width': widthByZoom(1.2, 2.5, 5),
      },
    },
    // One thick solid stroke per line, not two thin dashed ones: each direction
    // is a separate OSM way, so thin dashes read as two railways.
    {
      id: 'rail-green',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'rail'], ['==', ['get', 'line'], 'green']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.railGreen, 'line-width': widthByZoom(2, 4.2, 9) },
    },
    {
      id: 'rail-blue',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'rail'], ['==', ['get', 'line'], 'blue']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.railBlue, 'line-width': widthByZoom(2, 4.2, 9) },
    },
    {
      id: 'station-dot',
      type: 'circle',
      source: 'mapdata',
      filter: ['==', ['get', 'kind'], 'station'],
      paint: {
        'circle-radius': widthByZoom(2, 4, 7),
        'circle-color': '#ffffff',
        'circle-stroke-color': colors.stationStroke,
        'circle-stroke-width': 1.2,
      },
    },
  ];
}

/**
 * Street and station labels. These are the half of the audition that pins can't
 * show: the SVG map places every label once for the whole map and counter-scales
 * it, so a close view can land between labels. `symbol-placement: line` re-runs
 * placement at every zoom, repeating a name along the street as often as there
 * is room and dropping the ones that collide.
 */
function labelLayers(colors) {
  // Order matters twice over, and in opposite directions. Later layers draw on
  // top, but they are also placed FIRST -- MapLibre runs collision from the top
  // of the layer stack down, so whatever is drawn last wins the space. The two
  // spines therefore come last: listed first, they lost every contested slot to
  // ordinary side streets and the map's two most important names never
  // appeared at all.
  return [
    {
      id: 'street-label-arterial',
      type: 'symbol',
      source: 'mapdata',
      // Arterial names appear a step in, mirroring the SVG's level-of-detail
      // rule that keeps a 10-mile view from carrying 400 street names. The SVG
      // drops them above a ~7000 m view, which is this zoom on a phone frame.
      minzoom: 11.6,
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'arterial'], ['has', 'name']],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 180,
        'text-field': ['get', 'name'],
        'text-font': FONT_SEMIBOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11.6, 9.5, Z_HOME, 11.5, Z_CLOSE, 13.5],
        'text-max-angle': 40,
      },
      paint: { 'text-color': colors.labelArterial, 'text-halo-color': colors.paper, 'text-halo-width': 1.5 },
    },
    {
      id: 'station-label',
      type: 'symbol',
      source: 'mapdata',
      // Station names one level further in again, as in the SVG's lod2.
      minzoom: 12.5,
      filter: ['==', ['get', 'kind'], 'station'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_SEMIBOLD,
        'text-size': 11,
        'text-anchor': 'bottom',
        'text-offset': [0, -0.7],
      },
      paint: { 'text-color': colors.labelStation, 'text-halo-color': colors.paper, 'text-halo-width': 1.5 },
    },
    {
      id: 'street-label-spine',
      type: 'symbol',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'spine'], ['has', 'name']],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 180,
        'text-field': ['get', 'name'],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], Z_WIDE, 10, Z_HOME, 12.5, Z_CLOSE, 15],
        'text-max-angle': 40,
      },
      paint: { 'text-color': colors.labelSpine, 'text-halo-color': colors.paper, 'text-halo-width': 1.5 },
    },
  ];
}

/**
 * Whether this device can run the map engine at all.
 *
 * MapLibre requires WebGL2, and that floor is accepted rather than worked around
 * (decided 2026-08-10; a second, non-WebGL implementation was the alternative
 * and was rejected as two maps to maintain). What is not acceptable is a blank
 * square, so this is checked before the engine is even imported: a device that
 * cannot draw the map skips ~1.1 MB of module it could never use, and gets the
 * venue list instead — which carries every location and its directions link.
 *
 * The probe context is released immediately. iOS caps how many live WebGL
 * contexts a page may hold, and holding one open to answer a yes/no question
 * would spend one of them for the life of the view.
 */
function hasWebGl2() {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return false;
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const NO_CLEANUP = () => {};
let renderGeneration = 0;

export async function renderMap(container, content) {
  const generation = ++renderGeneration;
  const youAreHereEnabled = content.settings.you_are_here_enabled === 'true';

  container.innerHTML = `
    <section class="view map-view">
      <h1 class="sr-only">Map</h1>
      <div class="map-frame">
        <div class="map-svg-wrap" id="map-svg-wrap"><p class="map-loading">Loading map&hellip;</p></div>
        <div class="map-controls">
          <button type="button" class="map-btn" id="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" class="map-btn" id="zoom-out" aria-label="Zoom out">&minus;</button>
          <button type="button" class="map-btn" id="zoom-reset" aria-label="Reset view">&#10226;</button>
          ${youAreHereEnabled ? `<button type="button" class="map-btn map-btn--locate" id="locate-btn" aria-label="Show my location">&#9678;</button>` : ''}
        </div>
        <!-- WCAG 2.5.7 (dragging movements): panning must have a single-pointer
             alternative, and the criterion explicitly does not accept keyboard
             as that alternative -- these buttons are it. -->
        <div class="map-pan" id="map-pan">
          <button type="button" class="map-btn map-btn--pan" id="pan-up" aria-label="Pan up">&#8593;</button>
          <button type="button" class="map-btn map-btn--pan" id="pan-left" aria-label="Pan left">&#8592;</button>
          <button type="button" class="map-btn map-btn--pan" id="pan-right" aria-label="Pan right">&#8594;</button>
          <button type="button" class="map-btn map-btn--pan" id="pan-down" aria-label="Pan down">&#8595;</button>
        </div>
      </div>
      <div class="map-legend">
        <h2 class="map-legend__title sr-only">Legend</h2>
        <ul class="map-legend__list">
          <li><svg class="legend-icon legend-icon--venue" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon></svg> Venue</li>
          <li><svg class="legend-icon legend-icon--transit" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon></svg> Transit</li>
          <!-- The two rail lines draw at the same weight in different colors,
               so their names live here or nowhere: the Blue Line has no
               station pin within the pin radius to carry a letter. -->
          <li><svg class="legend-icon legend-icon--rail-green" viewBox="0 0 32 32" aria-hidden="true"><line x1="2" y1="16" x2="30" y2="16"></line></svg> METRO Green Line</li>
          <li><svg class="legend-icon legend-icon--rail-blue" viewBox="0 0 32 32" aria-hidden="true"><line x1="2" y1="16" x2="30" y2="16"></line></svg> METRO Blue Line</li>
          <li><svg class="legend-icon legend-icon--bus-brt" viewBox="0 0 32 32" aria-hidden="true"><line x1="2" y1="16" x2="30" y2="16"></line></svg> METRO A &amp; B Line (bus rapid transit)</li>
          <!-- Route 72 stays out of this label until OSM carries a relation for it
               (none exists metro-wide as of 2026-08-23): the legend names what the
               map draws, and 72 currently draws nothing. The query and class map
               are already wired for it. -->
          <li><svg class="legend-icon legend-icon--bus-local" viewBox="0 0 32 32" aria-hidden="true"><line x1="2" y1="16" x2="30" y2="16"></line></svg> Metro Transit Route 67 (local bus)</li>
          <li><svg class="legend-icon legend-icon--sponsor-featured" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon></svg> Featured Destination</li>
          <li><svg class="legend-icon legend-icon--sponsor-generic" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,4 28,16 16,28 4,16"></polygon></svg> Sponsor</li>
        </ul>
      </div>
      ${content.settings.map_attribution ? `<p class="map-attribution">${esc(content.settings.map_attribution)}</p>` : ''}
      <h2 class="view-subtitle">Venues</h2>
      <ol class="venue-key-list" id="venue-key-list"></ol>
      <div id="map-pin-alt"></div>
    </section>`;

  // Tapping another tab mid-load wipes #view while these awaits are in flight;
  // every DOM reference is re-queried through here and a null answer ends the
  // render, so nothing lands in a detached tree.
  const mapWrap = () => (generation === renderGeneration ? container.querySelector('#map-svg-wrap') : null);

  const venues = content.venues.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  // Reassigned once the engine map exists; until then a key-list tap only opens
  // the sheet, exactly as it does on a device that never gets a map at all.
  let linkVenueToMap = () => {};
  // Rendered before the engine is loaded, and left in place if it never is:
  // on a device without WebGL2 this list is the map view.
  renderVenueKeyList(container, venues, (venueId) => {
    linkVenueToMap(venueId);
    openVenueSheet(venueId);
  });

  if (!hasWebGl2()) {
    const frame = container.querySelector('#map-svg-wrap');
    if (frame) {
      frame.innerHTML = `<p class="empty-state map-unsupported" data-testid="map-unsupported">
        This device can&rsquo;t display the interactive map. Every venue is listed
        below, with directions.</p>`;
    }
    // The zoom, pan and locate controls steer a map that isn't there.
    container.querySelector('.map-controls')?.remove();
    container.querySelector('#map-pan')?.remove();
    return NO_CLEANUP;
  }

  let engine;
  let calibration;
  let stops;
  try {
    injectEngineCss();
    [engine, calibration, stops] = await Promise.all([loadEngine(), loadCalibration(), loadTransitStops()]);
  } catch {
    const failedWrap = mapWrap();
    if (failedWrap) {
      failedWrap.innerHTML = `<p class="empty-state">The map couldn't be loaded right now. It will be available next time you're online.</p>`;
    }
    return NO_CLEANUP;
  }

  const wrap = mapWrap();
  if (!wrap) return NO_CLEANUP;

  let projector;
  try {
    projector = makeProjector(calibration.control_points);
  } catch {
    wrap.innerHTML = `<p class="empty-state">The map calibration data is invalid.</p>`;
    return NO_CLEANUP;
  }

  // The map's geographic frame comes entirely from the calibration file, run
  // backwards through the same projector the SVG map uses forwards. Recalibrating
  // to commissioned artwork stays a pure data change, exactly as before.
  const [, , vbW, vbH] = calibration.svg_viewbox;
  const corner = (x, y) => {
    const { lat, lng } = projector.unproject(x, y);
    return [lng, lat];
  };
  const nw = corner(0, 0);
  const ne = corner(vbW, 0);
  const se = corner(vbW, vbH);
  const sw = corner(0, vbH);
  const homeCenterSvg = calibration.home_center ?? { x: vbW / 2, y: vbH / 2 };
  const home = corner(homeCenterSvg.x, homeCenterSvg.y);

  const west = Math.min(nw[0], sw[0]);
  const east = Math.max(ne[0], se[0]);
  const south = Math.min(sw[1], se[1]);
  const north = Math.max(nw[1], ne[1]);
  const extentMeters = (north - south) * 111320;

  const framePx = wrap.clientWidth || 360;
  const lat = home[1];
  const minZoom = zoomForMeters(extentMeters, framePx, lat);
  const maxZoom = zoomForMeters(MIN_VIEW_M, framePx, lat);
  const homeZoom = zoomForMeters(HOME_VIEW_M, framePx, lat);
  // Venues stop clustering once they would be drawn far enough apart to tap
  // individually -- about a pin's width between the closest real pair. Capped
  // at 17 because a GeoJSON source's own maxzoom is 18 and tiles above it are
  // overzoomed: a clusterMaxZoom of 18 would bake clusters into the last real
  // tile, so they would never break apart no matter how far you zoomed.
  const clusterMaxZoom = Math.min(17, Math.round(zoomForMeters(210, framePx, lat)));
  // A whole zoom level, like clusterMaxZoom: the filter that drops a stack of
  // displaced venues reads `zoom`, which MapLibre evaluates only at integer
  // zooms (tile zoom), so a fractional split would swap the two treatments in
  // at different moments and briefly draw both.
  const splitZoom = Math.round(zoomForMeters(SPLIT_VIEW_M, framePx, lat));
  const groupOffsets = coincidentGroups(venues, { splitZoom, lat });
  const displaced = [...groupOffsets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, offset]) => ({ venue: venues[index], label: String(index + 1), offset }));

  wrap.innerHTML = '<div class="map-gl" id="map-gl" data-testid="map-canvas"></div>';
  const glHost = wrap.querySelector('#map-gl');
  const colors = resolveMapColors(glHost);

  const { Map: MlMap, LngLatBounds, Marker, ScaleControl } = engine;

  const style = {
    version: 8,
    // The URL, not a parsed object: MapLibre hands it to the worker, so the
    // GeoJSON is fetched (from the service-worker cache when offline) and
    // parsed off the main thread.
    sources: { mapdata: { type: 'geojson', data: 'assets/map-vector.geojson' } },
    layers: [...groundLayersVector(colors), ...labelLayers(colors)],
  };

  const map = new MlMap({
    container: glHost,
    style,
    center: home,
    zoom: homeZoom,
    minZoom,
    maxZoom,
    maxBounds: new LngLatBounds([west, south], [east, north]),
    // North-up, as the SVG map was and as any future artwork would be.
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    // The site renders settings.map_attribution itself, below the frame.
    attributionControl: false,
    // Two-finger-only panning would fight a full-page-scroll layout; the map
    // sits in a fixed-height frame, so one finger panning it is right.
    cooperativeGestures: false,
    fadeDuration: 0,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.enable();

  // Scale bar (a11y guide Part C #5): across a 120 m – 16 km zoom range,
  // nothing else on screen says what scale the view is at. The control is pure
  // DOM and arithmetic — it fetches nothing. Imperial units: a St. Paul
  // audience reads blocks in feet and miles.
  map.addControl(new ScaleControl({ maxWidth: 96, unit: 'imperial' }), 'top-left');

  const canvas = map.getCanvas();
  canvas.setAttribute('role', 'group');
  canvas.setAttribute(
    'aria-label',
    'Festival map. Use the arrow keys to pan, and the zoom buttons below to zoom in and out.'
  );

  // Test hook (CONTRACTS.md): the live MapLibre Map for the current #/map view,
  // removed on teardown. Pins are drawn into a canvas, so there is no DOM node
  // per pin for a test to find and no `data-testid` that could stand in --
  // asking the engine what it rendered is the only way to assert on pins at all.
  // Doubles as the handle for poking at the map from a browser inspector.
  window.__mmafMap = map;

  const cleanupFns = [];
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    if (window.__mmafMap === map) delete window.__mmafMap;
    for (const fn of cleanupFns) {
      try {
        fn();
      } catch {
        /* teardown is best-effort */
      }
    }
    map.remove();
  };

  // A route change during style load must still tear the map down, or its
  // canvas and workers outlive the view that owns them.
  if (generation !== renderGeneration) {
    cleanup();
    return NO_CLEANUP;
  }

  // The same subsets the pin layers draw (see addPins): transit stops within
  // the pin radius, sponsor tiers that get a pin at all. Computed here so the
  // visually-hidden button list and the map itself can't disagree about what
  // is on the map.
  const nearFestival = makeTransitFilter(home);
  const pinnedStops = stops.filter(
    (s) =>
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      Array.isArray(s.lines) &&
      s.lines.length > 0 &&
      nearFestival(s.lat, s.lng)
  );
  const pinnedSponsors = content.sponsors.filter(
    (s) =>
      (FEATURED_SPONSOR_TIERS.has(s.tier_slug) || s.tier_slug === 'topaz') &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng)
  );
  renderPinAltList(container, pinnedStops, pinnedSponsors);

  const transitById = new Map(pinnedStops.map((s) => [s.id, s]));

  // Tap highlight: one selected pin at a time, marked through feature-state.
  // The halo layers' paint expressions (see addPins) light the selected
  // feature; nothing here draws anything.
  let selectedPin = null;
  const selectPin = (source, id) => {
    if (selectedPin) map.setFeatureState(selectedPin, { selected: false });
    selectedPin = source == null || id == null ? null : { source, id };
    if (selectedPin) map.setFeatureState(selectedPin, { selected: true });
  };

  // Which source holds the feature that draws a given venue: a displaced venue
  // is drawn from its own unclustered source, and feature-state addresses the
  // feature that is actually on screen.
  const pinRef = new Map(venues.map((v, i) => [v.id, { source: 'venues', id: i, center: [v.lng, v.lat] }]));
  displaced.forEach((d, i) =>
    pinRef.set(d.venue.id, { source: 'venue-groups', id: i, center: [d.venue.lng, d.venue.lat] })
  );

  map.on('load', () => {
    if (generation !== renderGeneration) return;
    addPins(map, { venues, stops: pinnedStops, sponsors: pinnedSponsors, clusterMaxZoom, colors, displaced, splitZoom });
    wirePinTaps(map, { transitById, maxZoom, selectPin });
    // A venue card in the key list behaves as though its pin was tapped:
    // highlight the pin and recenter on it, on top of opening the sheet.
    linkVenueToMap = (venueId) => {
      const ref = pinRef.get(venueId);
      if (!ref) return;
      selectPin(ref.source, ref.id);
      map.easeTo({ center: ref.center, duration: cameraDuration(450) });
    };
  });

  wireControls(container, map, { home, homeZoom, maxZoom, cleanupFns });
  if (youAreHereEnabled) {
    wireLocate(container, map, Marker, { west, east, south, north, cleanupFns });
  }

  return cleanup;
}

function renderVenueKeyList(container, venues, onSelect) {
  const keyList = container.querySelector('#venue-key-list');
  // "Venue N" is in the accessible name, not only in the aria-hidden SVG: a
  // screen-reader user has to be able to cross-reference the number a sighted
  // companion reads off the map.
  keyList.innerHTML = venues
    .map(
      (v, i) => `<li class="venue-key-item"><button type="button" class="venue-key-btn" data-venue-id="${esc(v.id)}">
        <svg class="venue-key-btn__pin" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <polygon points="16,1 31,16 16,31 1,16"></polygon>
          <text x="16" y="16">${i + 1}</text>
        </svg><span class="sr-only">Venue ${i + 1}: </span>${esc(v.name)}</button></li>`
    )
    .join('');
  keyList.querySelectorAll('.venue-key-btn').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(btn.dataset.venueId));
  });
}

/**
 * Keyboard/AT path to the canvas pins (Accessibility contract). Pins are drawn
 * into WebGL, so transit and sponsor pins have no DOM presence a keyboard or
 * screen reader could reach — venues are covered by the key list above. The
 * fix is a visually-hidden button per pinned transit stop and sponsor, opening
 * the same sheet a tap on the pin would. Each button un-hides while focused
 * (skip-link style) so sighted keyboard users can see where focus is; focus
 * returns to the button when the sheet closes, per the sheet's own contract.
 */
function renderPinAltList(container, stops, sponsors) {
  const host = container.querySelector('#map-pin-alt');
  if (!host || (!stops.length && !sponsors.length)) return;
  const stopLabel = (s) =>
    [s.name, s.lines.map((l) => TRANSIT_LINE_NAME[l] || l).join(', ')].filter(Boolean).join(' — ');
  host.innerHTML = `
    <h2 class="sr-only">Transit stops and sponsor locations on the map</h2>
    <ul class="pin-alt-list">
      ${stops
        .map(
          (s) =>
            `<li><button type="button" class="pin-alt-btn" data-kind="transit" data-id="${esc(s.id)}">${esc(stopLabel(s))}</button></li>`
        )
        .join('')}
      ${sponsors
        .map(
          (s) =>
            `<li><button type="button" class="pin-alt-btn" data-kind="sponsor" data-id="${esc(s.id)}">${esc(s.name)}</button></li>`
        )
        .join('')}
    </ul>`;
  const stopById = new Map(stops.map((s) => [s.id, s]));
  host.querySelectorAll('.pin-alt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.kind === 'transit') {
        const stop = stopById.get(btn.dataset.id);
        if (stop) openTransitSheet(stop, stop.lines.map((l) => TRANSIT_LINE_NAME[l] || l));
      } else {
        openSponsorSheet(btn.dataset.id);
      }
    });
  });
}

function addPins(map, { venues, stops, sponsors, clusterMaxZoom, colors, displaced, splitZoom }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  // Zero is always a legal lane -- an odd group's middle member keeps its own
  // coordinate -- and seeding it keeps the text-offset match below well formed
  // when nothing is displaced at all.
  const laneOffsets = [...new Set([0, ...displaced.map((d) => d.offset)])];
  map.addImage('pin-venue', diamondImage(VENUE_R, { fill: colors.venue }, dpr).data, { pixelRatio: dpr });
  const leaderColors = { fill: colors.venue, dot: colors.leaderDot, line: colors.leaderLine };
  const haloColors = { fill: colors.accent, stroke: colors.accentDark };
  for (const offset of laneOffsets) {
    map.addImage(leaderIconId(offset), leaderImage(offset, leaderColors, dpr).data, { pixelRatio: dpr });
    map.addImage(leaderHaloId(offset), leaderHaloImage(offset, haloColors, dpr).data, { pixelRatio: dpr });
  }
  map.addImage('pin-cluster', clusterImage(CLUSTER_R, { fill: colors.venue, stroke: colors.surface }, dpr).data, {
    pixelRatio: dpr,
  });
  map.addImage('pin-transit', diamondImage(SMALL_R, { fill: colors.transit }, dpr).data, { pixelRatio: dpr });
  map.addImage('pin-sponsor-featured', diamondImage(SMALL_R, { fill: colors.sponsor }, dpr).data, { pixelRatio: dpr });
  // Generic sponsor pins are outlined rather than filled, as in the SVG map.
  map.addImage(
    'pin-sponsor-generic',
    diamondImage(SMALL_R, { fill: colors.surface, stroke: colors.sponsor, strokeWidth: 3 }, dpr).data,
    { pixelRatio: dpr }
  );

  // Every feature carries a numeric feature id (its index) so feature-state
  // can address it — the tap highlight is a paint expression keyed on
  // `feature-state.selected`, and feature-state only works on features with
  // ids. The slug stays in properties; it is what the sheets open with.
  const displacedIds = new Set(displaced.map((d) => d.venue.id));
  map.addSource('venues', {
    type: 'geojson',
    cluster: true,
    clusterRadius: 26,
    clusterMaxZoom,
    // Displaced venues stay in here, clustering exactly as they always did, so
    // that the wide zooms this source owns are unchanged -- they are only
    // filtered out of the individual-pin layers, where their own source draws
    // them instead.
    clusterProperties: {
      // The member numbers a two-venue stack labels itself with. min/max rather
      // than a joined list because supercluster promises nothing about the order
      // it reduces leaves in, and these two digits have to come out stable.
      labelMin: ['min', ['get', 'labelNum']],
      labelMax: ['max', ['get', 'labelNum']],
      // A stack of nothing but displaced venues is drawn by those pins from the
      // split zoom inward, so it drops out of this layer there.
      groupedCount: ['+', ['case', ['get', 'grouped'], 1, 0]],
    },
    data: {
      type: 'FeatureCollection',
      features: venues.map((v, i) => ({
        type: 'Feature',
        id: i,
        properties: {
          id: v.id,
          label: String(i + 1),
          labelNum: i + 1,
          name: v.name,
          grouped: displacedIds.has(v.id),
        },
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      })),
    },
  });

  // Venues no zoom can draw apart, one feature each at its true coordinate,
  // never clustered: the clustered source hides them inside a stack for as long
  // as they are within clusterRadius, which is most of the range where they need
  // to be individually visible and tappable.
  map.addSource('venue-groups', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: displaced.map((d, i) => ({
        type: 'Feature',
        id: i,
        properties: {
          id: d.venue.id,
          label: d.label,
          name: d.venue.name,
          offset: d.offset,
          icon: leaderIconId(d.offset),
          halo: leaderHaloId(d.offset),
        },
        geometry: { type: 'Point', coordinates: [d.venue.lng, d.venue.lat] },
      })),
    },
  });

  // `stops` and `sponsors` arrive pre-filtered to what gets a pin (renderMap
  // computes the subsets once, shared with the hidden keyboard list).
  map.addSource('transit', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: stops.map((s, i) => ({
        type: 'Feature',
        id: i,
        properties: {
          id: s.id,
          // Multi-line stops stack their letters, as the SVG pins do: "G/A"
          // at pin size is less legible than two lines.
          letters: s.lines.map((l) => TRANSIT_LINE_LETTER[l]).filter(Boolean).join('\n'),
        },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    },
  });

  map.addSource('sponsors', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: sponsors.map((s, i) => ({
        type: 'Feature',
        id: i,
        properties: { id: s.id, featured: FEATURED_SPONSOR_TIERS.has(s.tier_slug) },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    },
  });

  // Tap-highlight halos, drawn under the pins: an accent ring that exists for
  // every pin but is fully transparent until its feature's `selected` state is
  // set. Feature-state is the mechanism because it repaints without touching
  // source data or layout — no symbol re-placement, no flicker.
  const selectedOnly = (on) => ['case', ['boolean', ['feature-state', 'selected'], false], on, 0];
  const haloPaint = (pinRadius) => ({
    'circle-radius': pinRadius + HALO_PAD,
    'circle-color': colors.accent,
    'circle-opacity': selectedOnly(0.95),
    // The dark keyline is what clears 3:1 against the pale ground; the accent
    // fill alone is a brand marigold that doesn't.
    'circle-stroke-color': colors.accentDark,
    'circle-stroke-width': 2,
    'circle-stroke-opacity': selectedOnly(1),
  });
  // allow-overlap/ignore-placement keep every pin drawn: MapLibre's collision
  // handling HIDES the loser, which would be worse than today's overlap. What
  // stops venues piling up is the clustering and the displacement above, not
  // collision.
  const pinLayout = { 'icon-allow-overlap': true, 'icon-ignore-placement': true };
  const labelLayout = {
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-font': FONT_BOLD,
  };

  map.addLayer({ id: 'transit-highlight', type: 'circle', source: 'transit', paint: haloPaint(SMALL_R) });
  map.addLayer({ id: 'sponsor-highlight', type: 'circle', source: 'sponsors', paint: haloPaint(SMALL_R) });
  // The individual venues this source still draws: not a stack, and not one of
  // the venues whose own source draws it displaced.
  const plainVenue = ['all', ['!', ['has', 'point_count']], ['==', ['get', 'grouped'], false]];
  map.addLayer({
    id: 'venue-highlight',
    type: 'circle',
    source: 'venues',
    filter: plainVenue,
    paint: haloPaint(VENUE_R),
  });
  // A displaced pin's halo is a symbol rather than a circle, for the one reason
  // that a circle layer draws at the feature's geometry -- which for these pins
  // is the leader dot, so the ring would land on empty paper beside the diamond
  // it is meant to mark. The ring sits inside its image exactly where the
  // diamond sits inside the pin's, both placed from the same offset.
  map.addLayer({
    id: 'venue-leader-halo',
    type: 'symbol',
    source: 'venue-groups',
    minzoom: splitZoom,
    layout: { ...pinLayout, 'icon-image': ['get', 'halo'] },
    paint: { 'icon-opacity': selectedOnly(1) },
  });

  // Layer order IS paint order, lowest first: transit, featured destination,
  // sponsor, venue -- the priority the SVG map gets from document order.
  map.addLayer({
    id: 'transit-pin',
    type: 'symbol',
    source: 'transit',
    layout: {
      ...pinLayout,
      ...labelLayout,
      'icon-image': 'pin-transit',
      'text-field': ['get', 'letters'],
      'text-size': 11,
      'text-line-height': 0.95,
    },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'sponsor-featured-pin',
    type: 'symbol',
    source: 'sponsors',
    filter: ['==', ['get', 'featured'], true],
    layout: { ...pinLayout, 'icon-image': 'pin-sponsor-featured' },
  });
  map.addLayer({
    id: 'sponsor-generic-pin',
    type: 'symbol',
    source: 'sponsors',
    filter: ['==', ['get', 'featured'], false],
    layout: { ...pinLayout, 'icon-image': 'pin-sponsor-generic' },
  });
  map.addLayer({
    id: 'venue-cluster',
    type: 'symbol',
    source: 'venues',
    filter: [
      'all',
      ['has', 'point_count'],
      [
        'any',
        ['<', ['zoom'], splitZoom],
        ['<', ['to-number', ['get', 'groupedCount']], ['to-number', ['get', 'point_count']]],
      ],
    ],
    layout: {
      ...pinLayout,
      ...labelLayout,
      'icon-image': 'pin-cluster',
      // Member venue numbers, stacked the way transit pins stack line letters.
      // Two fit; past that the fallback is no text at all, which is what keeps
      // a count off the glyph -- see clusterImage().
      'text-field': [
        'case',
        ['==', ['get', 'point_count'], 2],
        ['concat', ['to-string', ['get', 'labelMin']], '\n', ['to-string', ['get', 'labelMax']]],
        '',
      ],
      'text-size': CLUSTER_TEXT_PX,
      'text-line-height': 0.95,
    },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'venue-pin',
    type: 'symbol',
    source: 'venues',
    filter: plainVenue,
    layout: {
      ...pinLayout,
      ...labelLayout,
      'icon-image': 'pin-venue',
      'text-field': ['get', 'label'],
      'text-size': VENUE_TEXT_PX,
    },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'venue-leader-pin',
    type: 'symbol',
    source: 'venue-groups',
    minzoom: splitZoom,
    layout: {
      ...pinLayout,
      ...labelLayout,
      'icon-image': ['get', 'icon'],
      'text-field': ['get', 'label'],
      'text-size': VENUE_TEXT_PX,
      // The number rides the diamond, so it is displaced by as much as the icon
      // draws it -- in ems here, unlike every other measure in this file. Built
      // as a match over the lane rather than read from the feature because the
      // GeoJSON-to-tile conversion stringifies any property that isn't a scalar,
      // and an array offset comes back as "[-2,0]" and silently falls back to 0.
      'text-offset': [
        'match',
        ['get', 'offset'],
        ...laneOffsets.flatMap((offset) => [offset, ['literal', [offset / VENUE_TEXT_PX, 0]]]),
        ['literal', [0, 0]],
      ],
    },
    paint: { 'text-color': '#ffffff' },
  });
}

/**
 * Transit pins are limited to stops near the festival. The SVG map measures that
 * distance in projected SVG meters from home_center; measuring it in real meters
 * from the same point is the same test, without needing the projector here.
 */
function makeTransitFilter(home) {
  const [homeLng, homeLat] = home;
  const mPerDegLat = 111320;
  const mPerDegLng = mPerDegLat * Math.cos((homeLat * Math.PI) / 180);
  return (lat, lng) =>
    Math.hypot((lng - homeLng) * mPerDegLng, (lat - homeLat) * mPerDegLat) <= TRANSIT_PIN_RADIUS_M;
}

function wirePinTaps(map, { transitById, maxZoom, selectPin }) {
  // Topmost first, so an overlap resolves the way the SVG map's paint order does.
  const PIN_LAYERS = [
    'venue-leader-pin',
    'venue-pin',
    'venue-cluster',
    'sponsor-generic-pin',
    'sponsor-featured-pin',
    'transit-pin',
  ];

  // Where a pin's tappable diamond is drawn, which for a displaced venue is not
  // where its coordinate is. Measuring the coordinate instead is the one hazard
  // in this treatment: the two Hamline Park venues share theirs exactly, so
  // every tap ties and resolves by whichever feature the engine enumerated
  // first -- one of the two could not be opened at all.
  const drawnPoint = (feature) => {
    const point = map.project(feature.geometry.coordinates);
    const offset = feature.properties.offset;
    return typeof offset === 'number' ? { x: point.x + offset, y: point.y } : point;
  };

  const openTransit = (id) => {
    const stop = transitById.get(id);
    if (stop) openTransitSheet(stop, stop.lines.map((l) => TRANSIT_LINE_NAME[l] || l));
  };

  map.on('click', (e) => {
    // A box around the touch point, not the pixel under it: this is how the SVG
    // map's deliberately oversized diamond hit targets are reproduced without
    // growing the icons themselves.
    const box = [
      [e.point.x - TAP_SLOP_PX, e.point.y - TAP_SLOP_PX],
      [e.point.x + TAP_SLOP_PX, e.point.y + TAP_SLOP_PX],
    ];

    // Nearest pin wins, and paint order only breaks ties. Resolving by layer
    // priority first looks equivalent but isn't: with a slop box this wide, a
    // venue pin 10 px away beat the transit pin directly under the finger.
    let best = null;
    for (let i = 0; i < PIN_LAYERS.length; i++) {
      const layer = PIN_LAYERS[i];
      for (const f of map.queryRenderedFeatures(box, { layers: [layer] })) {
        const p = drawnPoint(f);
        const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
        if (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && i < best.rank)) {
          best = { layer, feature: f, d, rank: i };
        }
      }
    }
    if (!best) {
      // A tap on empty map clears the highlight, the same way it opens nothing.
      selectPin(null);
      return;
    }

    if (best.layer === 'venue-pin' || best.layer === 'venue-leader-pin') {
      selectPin(best.layer === 'venue-pin' ? 'venues' : 'venue-groups', best.feature.id);
      openVenueSheet(best.feature.properties.id);
    } else if (best.layer === 'venue-cluster') {
      // No highlight for a cluster: it stands for several pins, and the halo
      // marks exactly one.
      expandCluster(map, best.feature, { maxZoom });
    } else if (best.layer === 'transit-pin') {
      selectPin('transit', best.feature.id);
      openTransit(best.feature.properties.id);
    } else {
      selectPin('sponsors', best.feature.id);
      openSponsorSheet(best.feature.properties.id);
    }
  });

  // Desktop affordance for the side-by-side comparison; harmless on touch.
  for (const layer of PIN_LAYERS) {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
    });
  }
}

/**
 * Tapping a cluster zooms until its venues separate. When they can't -- two
 * venues in this sheet share identical coordinates, and coincident points have
 * no expansion zoom -- it lists them instead, so the pin underneath is reachable
 * either way. Only stacks below the split zoom reach this: from there inward
 * such a stack is drawn as displaced pins, one tap each.
 */
function expandCluster(map, feature, { maxZoom }) {
  const source = map.getSource('venues');
  const clusterId = feature.properties.cluster_id;
  const coords = feature.geometry.coordinates;

  Promise.all([
    source.getClusterExpansionZoom(clusterId),
    source.getClusterLeaves(clusterId, Infinity, 0),
  ])
    .then(([zoom, leaves]) => {
      if (zoom <= maxZoom && zoom > map.getZoom() + 0.01) {
        map.easeTo({ center: coords, zoom, duration: 400 });
        return;
      }
      const items = leaves.map((l) => ({ label: l.properties.name, id: l.properties.id }));
      openPickerSheet(`${items.length} venues here`, items, (picked) => openVenueSheet(picked.id));
    })
    .catch(() => {
      /* a cluster that can't be resolved just doesn't respond to the tap */
    });
}

function wireControls(container, map, { home, homeZoom, maxZoom, cleanupFns }) {
  const on = (id, handler) => {
    const el = container.querySelector(id);
    if (!el) return;
    el.addEventListener('click', handler);
    cleanupFns.push(() => el.removeEventListener('click', handler));
  };
  on('#zoom-in', () => map.zoomIn());
  on('#zoom-out', () => map.zoomOut());
  on('#zoom-reset', () => map.easeTo({ center: home, zoom: homeZoom, duration: 400 }));

  // Pan buttons (WCAG 2.5.7): the single-pointer alternative to dragging.
  // Keyboard panning exists but the criterion explicitly does not accept it as
  // the alternative. Step is a fraction of the frame so successive presses
  // overlap enough to keep visual continuity at any frame width.
  const panStep = () => Math.max(80, Math.round((map.getCanvas().clientWidth || 360) * 0.4));
  const pan = (dx, dy) => map.panBy([dx * panStep(), dy * panStep()], { duration: cameraDuration(300) });
  on('#pan-up', () => pan(0, -1));
  on('#pan-down', () => pan(0, 1));
  on('#pan-left', () => pan(-1, 0));
  on('#pan-right', () => pan(1, 0));

  // Double-tap zooms in, and a double-tap when already as close as the map goes
  // returns to the home view — otherwise the gesture strands you zoomed in with
  // no way back out but pinching. The SVG map behaved this way and it is worth
  // keeping, but it cannot be layered on top of the engine's own double-click
  // zoom: that handler runs after this one and its easeTo cancels this one's,
  // so the map simply stayed at maximum zoom. Owning the whole gesture is the
  // only version that works.
  map.doubleClickZoom.disable();
  let dblClickFrame = null;
  const onDblClick = (e) => {
    // Deferred by a frame, not run inline. MapLibre's handler manager finishes
    // processing the gesture after this event returns and stops any camera
    // animation in flight, so an easeTo started here is cancelled before it
    // moves — which is exactly how the original version failed, silently
    // leaving the map wherever it already was.
    const atClosest = map.getZoom() >= maxZoom - 0.05;
    // `around` keeps the tapped point under the finger, as the engine's own
    // handler does; it is what makes zooming toward something feel right.
    const camera = atClosest
      ? { center: home, zoom: homeZoom, duration: 400 }
      : { zoom: Math.min(maxZoom, map.getZoom() + 1), around: e.lngLat, duration: 300 };
    cancelAnimationFrame(dblClickFrame);
    dblClickFrame = requestAnimationFrame(() => map.easeTo(camera));
  };
  map.on('dblclick', onDblClick);
  cleanupFns.push(() => {
    cancelAnimationFrame(dblClickFrame);
    map.off('dblclick', onDblClick);
  });
}

function wireLocate(container, map, Marker, { west, east, south, north, cleanupFns }) {
  const locateBtn = container.querySelector('#locate-btn');
  if (!locateBtn) return;
  let marker = null;

  // Geolocation needs a secure context. On an insecure origin the call fails
  // immediately with PERMISSION_DENIED and no prompt, which is indistinguishable
  // from a real denial -- and the repo's documented device-evaluation workflow
  // is exactly that case, serving over http:// to a LAN IP. Left alone, every
  // LAN evaluation reports the feature as permanently denied and broken.
  if (!window.isSecureContext) {
    locateBtn.disabled = true;
    locateBtn.title = 'Location needs the deployed site (https).';
    locateBtn.setAttribute('aria-label', 'Show my location — needs the deployed site');
    return;
  }

  const handler = () => {
    if (!('geolocation' in navigator)) {
      showToast("This device doesn't support location.");
      return;
    }
    locateBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtn.disabled = false;
        const { latitude, longitude } = pos.coords;
        if (longitude < west || longitude > east || latitude < south || latitude > north) {
          showToast("You're outside the map area.");
          return;
        }
        // A DOM marker rather than a circle layer: the pulse is CSS, so it keeps
        // honoring prefers-reduced-motion the way the SVG map's dot does.
        if (!marker) {
          const el = document.createElement('div');
          el.className = 'you-are-here-gl';
          el.dataset.testid = 'you-are-here';
          el.innerHTML = '<span class="you-are-here-gl__pulse"></span><span class="you-are-here-gl__core"></span>';
          marker = new Marker({ element: el }).setLngLat([longitude, latitude]).addTo(map);
        } else {
          marker.setLngLat([longitude, latitude]);
        }
      },
      (err) => {
        locateBtn.disabled = false;
        // On iOS a code-1 failure looks identical whether the user once tapped
        // "Don't Allow" or Location Services is off for Safari websites
        // entirely (Settings shows no prompt in that state, observed
        // 2026-08-10) — so the message points at the setting that fixes both
        // instead of dead-ending. Longer toast timeout: this one is a path to
        // follow, not a status to glance at.
        if (err.code === err.PERMISSION_DENIED) {
          showToast(
            'Location permission denied. On iPhone you can allow it under Settings → Privacy & Security → Location Services → Safari Websites.',
            7000
          );
        } else showToast("Couldn't get your location.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };
  locateBtn.addEventListener('click', handler);
  cleanupFns.push(() => {
    locateBtn.removeEventListener('click', handler);
    if (marker) marker.remove();
  });
}
