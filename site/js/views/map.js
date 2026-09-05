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
import { isEmbed } from '../embed.js';
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
// really occupies. Group membership is decided at this view; the displaced
// treatment itself starts one whole zoom level wider when it provably fits
// there -- see leaderStartZoom.
const SPLIT_VIEW_M = 1200;
// Collision-behavior zooms (cluster release, split, leader zoom) derive from
// this fixed reference frame, never the device's: pins are constant CSS pixels
// at a given zoom everywhere, so where they stop fitting apart is a property
// of the venue set, not the screen -- frame-derived, a 560 px frame decided
// membership a level deeper than every phone and shipped a different map
// (2026-08-23). View zooms (extent, home, closest) still use the real frame.
const PIN_GEOMETRY_REF_PX = 375;

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
  labelVenue: '--map-label-venue',
  labelSponsor: '--map-label-sponsor',
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
// What a venue pin RESERVES, as the half-side of an axis-aligned square.
//
// Collision boxes in MapLibre are axis-aligned, and the bounding box of a
// 45-degree square is twice its area: a diamond of half-diagonal R has area
// 2R^2 and its AABB has 4R^2. The error is worst exactly where it shows -- on
// the diagonals, where the ink stops at 0.71R and the box corner sits at 1.41R,
// so a corner-placed name stood off twice as far as it looked like it should
// (Anthony, 2026-09-04). This is the side of the square with the diamond's own
// area, R * sqrt(2), so the box gives up the four tips and keeps the body.
//
// The tips are allowed to be grazed. What may not be covered is the diamond's
// body or the number inside it, and the number is central: at VENUE_TEXT_PX a
// two-digit label reaches ~12 px from the centre against this box's 13.4, so it
// stays inside. A test pins that rather than trusting the arithmetic.
const PIN_BLOCK_HALF = VENUE_R / Math.SQRT2;
const SMALL_R = 11;
const CLUSTER_R = 17;
// The Featured Destination pin: **the venue diamond unrotated**, 27 px. Same
// ink as a venue pin (a diamond of half-diagonal R has area 2R^2, and so does a
// square of side R * sqrt(2)), which is the point -- a featured sponsor is as
// important as a venue and no more, so it gets the venue pin's weight and a
// different shape rather than a bigger one. The alternative reading, a square
// filling the diamond's 38 px bounding box, doubles the ink and puts sponsors
// above venues in the hierarchy.
//
// One constant to change: the outline, the mark's inset, the halo, the name
// offsets and the clearance inequalities below are all derived from it.
const FEATURED_SIDE = Math.round(VENUE_R * Math.SQRT2);
// The red keyline, drawn INSIDE the square's 27 px so the outer extent is
// exactly FEATURED_SIDE, and a 1 px of paper between it and the mark so a mark
// with ink at its own edge doesn't read as part of the outline. What is left
// for the mark is 27 - 2*2 - 2*1 = 21 px.
const FEATURED_STROKE = 2;
const FEATURED_MARK_INSET = 1;
// The number inside the venue diamond, sized so a two-digit label still clears
// the diamond's sloping sides: at the label's cap height the diamond is about
// 2 * (VENUE_R - 6) = 26 px wide, and "11" sets to ~20 px here.
const VENUE_TEXT_PX = 16;
// Two member numbers stacked inside a CLUSTER_R diamond. Two lines at this size
// reach ~8.5 px either side of the centre, where the diamond is still ~17 px
// wide, and a two-digit number sets to ~12 px (measured in the engine's own
// font stack, 2026-08-23).
const CLUSTER_TEXT_PX = 10;
// Name labels beside venue and sponsor pins, from the leader zoom inward.
// NAME_CLEAR_PX is how far past the pin's radius the label starts, and it is
// measured to the pin's COLLISION BOX, not its drawn diamond: a symbol's box
// is the whole image rect -- 2 px of canvas bleed included -- inflated by the
// engine's default icon-padding and text-padding (2 px each), so an offset
// that only clears the visible shape is rejected by the very collision pass
// that places the label, and every name silently disappears. 8 px is that
// 6 px of box-beyond-diamond plus a 2 px visible gap.
const NAME_TEXT_PX = 12;
const SPONSOR_NAME_TEXT_PX = 11;
const NAME_CLEAR_PX = 8;
// How far out a diagonal name starts, per axis. The diamond's edge crosses the
// 45-degree ray at R/2 on each axis -- half as far as the box corner the name
// used to clear -- so measuring the gap from the ink instead of from the box
// pulls every corner name in by 0.2R and closes the reserved emptiness Anthony
// could see (2026-09-04). It still clears the box: the label's own padded
// corner lands ~2 px outside PIN_BLOCK_HALF, so no name is rejected by the pin
// it belongs to.
const CORNER_CLEAR_PX = VENUE_R / 2 + NAME_CLEAR_PX;
// The order a name beside an undisplaced pin tries its positions in; the engine
// keeps the first that fits. Named by where the label goes, not by the anchor
// that puts it there -- `bottom` anchors the label's bottom edge, so it is the
// one that puts the name ABOVE the pin, and that inversion is worth hiding.
//
// Vertical first because of where this festival is: its venues are strung along
// University Avenue, so a pin's nearest neighbour is almost always due east or
// west of it, and a horizontal-first order aims every name straight down the
// row at the next pin.
//
// The corners come last and were worth adding (2026-09-04): they are the only
// candidates that fit beside a pin whose four sides are all spoken for, which
// on this map is common. They only work with a per-anchor offset -- see
// nameCandidates.
const NAME_ANCHOR_ORDER = ['above', 'below', 'east', 'west', 'upRight', 'upLeft', 'downRight', 'downLeft'];
// The tap-highlight halo extends this far beyond the pin it rings.
const HALO_PAD = 6;
// Displaced-pin geometry. Members of a coincident group sit in lanes a pin wide
// plus a leader run either side, which is what makes adjacent diamonds clear
// each other AND leaves each line long enough to be seen: at the minimum
// 2 * VENUE_R spacing the diamond's inner tip lands on its own dot. The lane
// step is the same whichever axis the group runs on -- coincidentGroups picks
// that per group.
// One cell of the plus codes the venues sheet is filled in with. A 10-digit
// Open Location Code -- the form a Google Maps place card copies, `XR4M+CC` --
// names a square 1/8000 of a degree on a side: 13.9 m of latitude, 9.8 m of
// longitude here. Two venues inside one cell can carry any difference up to a
// cell and it says nothing about where they are, only which cell was clicked.
//
// Compared in degrees rather than metres because that is the shape of the
// quantization, and because the two axes round to different distances. The
// Urban Lights trio differs by exactly 0.000125 degrees of latitude -- one
// cell, to the digit -- and its three venues are a row of buildings on the
// north side of University Avenue with their entrances on one sidewalk
// (Anthony, 2026-09-04). Sundin Music Hall and Soeffker Gallery differ by
// three cells, which is a real 42 m. So: a group whose spread along its lane
// axis is within a cell is spread by rounding, and ordering its lanes
// geographically orders noise.
const PLUS_CODE_CELL_DEG = 1 / 8000;
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
 * Venues the split zoom cannot draw apart, and the pixel offset each one is
 * displaced by from there inward.
 *
 * Two diamonds with half-diagonal R overlap when their centres are closer than
 * 2R measured |dx| + |dy| -- the measure VENUE_R itself was sized against.
 * Anything failing that test at the split zoom, the widest view where
 * individual numbered pins draw, is grouped by single linkage; zooming further
 * in only spreads true positions apart, so one static offset per venue holds
 * for the whole range. Membership comes from the coordinates alone: the sheet's
 * coincident venues are a fact about the addresses, not a list of ids.
 *
 * **Each group picks its own lane axis**, from its own spread: a group strung
 * out east to west lays its lanes east to west, a group stacked north to south
 * lays them north to south. That is what makes "a displaced diamond stays on
 * the side of the group its venue is really on" true rather than incidental.
 * One fixed east-west axis for every group is what put Vig Guitars and Fluid
 * Ink Tattoos -- identical longitudes, 14 m apart in latitude -- side by side
 * along the one axis they do not differ in.
 *
 * The axis is whichever of latitude and longitude spreads further in meters,
 * not the group's principal axis: an axis-aligned lane keeps the leader line
 * horizontal or vertical, which is what lets it be baked into the pin image
 * (see leaderLineImage) and read as a tether rather than a stray diagonal.
 *
 * A group with **no spread at all** -- venues at one exact coordinate -- has no
 * side to stay on, so nothing is owed to either axis; it prefers north-south,
 * because names are set horizontally and an east-west lane grows each member's
 * whole assembly (leader line, diamond, then the name running further outward
 * still) along the same axis on both sides -- for a coincident pair that
 * reaches ~320 px across, wider than a narrow phone's viewport, where stacking
 * keeps it one name wide.
 *
 * **A blocked axis is given up.** If laying a group out on its own axis would
 * put one of its diamonds on top of a pin outside the group, and the other axis
 * would not, the group takes the other axis: two diamonds in one place is a
 * worse failure than a diamond on the less expressive side of its group, and
 * the dot and leader line still say exactly where each venue is either way.
 * What is lost is that on the fallback axis the members' order carries little
 * information -- it is still their true order along that axis, but a group that
 * barely varies there is sorted by noise. If neither axis clears, the group
 * keeps its own: the overlap then belongs to a crowded neighbourhood rather
 * than to the axis, and being honest about the group's shape is the only thing
 * still on offer.
 *
 * Which groups give way is decided for all of them at once (see the search
 * below), from the coordinates and a fixed group order alone, so the answer is
 * the same on every device -- the property the 2026-08-23 frame-width
 * regression was about.
 */
function coincidentGroups(venues, { splitZoom, maxZoom, lat, nameRank }) {
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
  const points = pxAtZoom(venues, splitZoom, lat);
  const sMax = 2 ** (maxZoom - splitZoom);

  /**
   * True where `index`'s diamond, drawn at its own coordinate, would cover the
   * centre of any other member's dot.
   *
   * "Majority of the dot still visible" reduces to exactly this. A chord through
   * a circle's centre halves it, so the dot is more than half covered precisely
   * when its centre is inside the diamond -- and the diamond is the set of
   * points within `VENUE_R` of its centre measured |dx| + |dy|. No separate
   * threshold to pick, and none to get wrong: the shape is the rule.
   *
   * Checked at the split zoom, the widest view the treatment draws at and so
   * the one where true positions are closest together. Zooming in only moves
   * them apart, and the diamond does not grow.
   */
  const buriesADot = (index, group) =>
    group.some(
      (other) =>
        other !== index &&
        Math.abs(points[index].x - points[other].x) + Math.abs(points[index].y - points[other].y) <= VENUE_R
    );

  /** Lanes for one group along one axis. */
  const layOut = (group, axis) => {
    const along = group.map((i) => (axis === 'ew' ? venues[i].lng : venues[i].lat));
    const spreadDeg = Math.max(...along) - Math.min(...along);

    // West to east, or north to south -- screen y grows southward, so latitude
    // sorts the other way.
    const geographic = [...group].sort(
      axis === 'ew' ? (a, b) => venues[a].lng - venues[b].lng || a - b : (a, b) => venues[b].lat - venues[a].lat || a - b
    );

    // Below a plus code's own resolution that geographic order is noise, so the
    // lanes are handed out by name rank instead -- see PLUS_CODE_CELL_M.
    const byNoise = spreadDeg <= PLUS_CODE_CELL_DEG;
    const byRank = [...group].sort((a, b) => (nameRank.get(a) ?? 0) - (nameRank.get(b) ?? 0) || a - b);

    // An odd group has a middle lane at offset 0, whose member draws at its own
    // coordinate with no tether and no dot. It is the best place for a pin --
    // the diamond is exactly where the venue is -- and the worst for a name,
    // which has neighbours on both sides.
    //
    // Whoever holds it must not bury a neighbour's dot with their diamond. When
    // rank is assigning lanes it goes to the best-ranked member that can hold
    // it; when geography is, the middle member holds it or nobody does. If
    // nobody can, the group shifts half a lane so every member is tethered and
    // no dot has a diamond parked on it. The shift costs the group straddling
    // its own centre, and it removes the tetherless case rather than proving no
    // diamond covers any dot -- in a group where every member buries every
    // other, only a search over assignments could, and no venue set has ever
    // been that tight.
    const odd = group.length % 2 === 1;
    let ordered = geographic;
    let shift = 0;
    if (!byNoise) {
      const middle = odd ? geographic[(group.length - 1) / 2] : null;
      if (middle !== null && buriesADot(middle, group)) shift = 0.5;
    } else {
      const holder = odd ? byRank.find((i) => !buriesADot(i, group)) : undefined;
      if (odd && holder === undefined) shift = 0.5;
      // Middle first, then outward, so rank maps onto lanes by how good the
      // position is rather than by where it sits on the map.
      const positions = group
        .map((_, i) => i)
        .sort((a, b) => {
          const centre = (group.length - 1) / 2;
          return Math.abs(a - centre) - Math.abs(b - centre) || a - b;
        });
      const queue = holder === undefined ? [...byRank] : [holder, ...byRank.filter((i) => i !== holder)];
      ordered = [];
      positions.forEach((position, n) => {
        ordered[position] = queue[n];
      });
    }

    return ordered.map((index, lane) => {
      const step = (lane - (group.length - 1) / 2 + shift) * LEADER_LANE_PX;
      return [index, axis === 'ew' ? { x: step, y: 0, axis } : { x: 0, y: step, axis }];
    });
  };

  /** True where no displaced diamond in `lanes` lands on any other venue's pin. */
  const clears = (lanes) => {
    for (const [i, laneI] of lanes) {
      for (let j = 0; j < venues.length; j++) {
        if (j === i) continue;
        const a = { ...points[i], off: laneI };
        const b = { ...points[j], off: lanes.get(j) ?? NO_LANE };
        if (leastDrawnL1(a, b, sMax) < 2 * VENUE_R) return false;
      }
    }
    return true;
  };

  // Lowest member index first: a fixed order is what makes the search below
  // answer the same on every device and every run.
  const groups = [...members.values()].filter((g) => g.length > 1).sort((a, b) => Math.min(...a) - Math.min(...b));
  const ownAxis = groups.map((group) => {
    const lats = group.map((i) => venues[i].lat);
    const lngs = group.map((i) => venues[i].lng);
    const spreadNS = (Math.max(...lats) - Math.min(...lats)) * mPerDegLat;
    const spreadEW = (Math.max(...lngs) - Math.min(...lngs)) * mPerDegLng;
    return spreadEW > spreadNS ? 'ew' : 'ns';
  });
  const layoutFor = (flipped) => {
    const lanes = new Map();
    groups.forEach((group, g) => {
      const axis = flipped & (1 << g) ? (ownAxis[g] === 'ew' ? 'ns' : 'ew') : ownAxis[g];
      for (const [index, lane] of layOut(group, axis)) lanes.set(index, lane);
    });
    return lanes;
  };

  // Which groups give up their own axis is a joint choice, not a series of
  // independent ones: in the committed fixtures the Hamline Park pair's
  // east-west lanes are blocked by the Vig Guitars pair's north-south ones and
  // vice versa, so deciding either first and keeping it locks in an overlap.
  // With one bit per group the whole space is a few dozen layouts, walked in
  // preference order -- fewest groups moved off their own axis first, and among
  // equals the ones that keep the earliest groups honest -- so the first that
  // clears is the answer. Nothing clearing means the neighbourhood is simply
  // full, and every group keeps its own axis.
  const MAX_SEARCHED_GROUPS = 8;
  if (groups.length <= MAX_SEARCHED_GROUPS) {
    const bits = (n) => {
      let count = 0;
      for (let i = 0; i < groups.length; i++) if (n & (1 << i)) count++;
      return count;
    };
    const order = [...Array(1 << groups.length).keys()].sort((a, b) => {
      if (bits(a) !== bits(b)) return bits(a) - bits(b);
      // Same number of groups moved: prefer the layout that leaves the earliest
      // group on its own axis.
      for (let i = 0; i < groups.length; i++) {
        const inA = a & (1 << i);
        const inB = b & (1 << i);
        if (inA !== inB) return inA ? 1 : -1;
      }
      return 0;
    });
    for (const flipped of order) {
      const lanes = layoutFor(flipped);
      if (clears(lanes)) return lanes;
    }
  }
  return layoutFor(0);
}

/** No displacement at all, and the axis a lone middle lane falls back to. */
const NO_LANE = { x: 0, y: 0, axis: 'ew' };

/**
 * A lane's identity for the `match` expressions that key text placement off it.
 *
 * The axis is part of it even though it never moves the pin: the middle lane of
 * an odd group is offset 0 either way, and its name still has to know which
 * axis its neighbours took so it can go on the other one.
 */
const laneKey = (offset) => `${offset.axis}:${offset.x},${offset.y}`;

/**
 * True positions as screen px at `zoom`, one shared frame for drawn-position
 * checks: x grows east, **y grows south**, matching the canvas and the engine.
 *
 * The southward y is not cosmetic. Every lane offset in this file is consumed
 * by a canvas image and by the tap resolver, both of which count y downward, so
 * a north-up frame here would silently invert the sign of a north-south lane in
 * every clearance check that mixes the two. It cost nothing while lanes only
 * ever ran east-west.
 */
function pxAtZoom(list, zoom, lat) {
  const mPerPx = metersPerPixel(zoom, lat);
  const mPerDegLat = 111320;
  const mPerDegLng = mPerDegLat * Math.cos((lat * Math.PI) / 180);
  return list.map((p) => ({ x: (p.lng * mPerDegLng) / mPerPx, y: -(p.lat * mPerDegLat) / mPerPx }));
}

/**
 * The minimum |dx| + |dy| between two drawn pins across a zoom range, each pin
 * its true position (px at the range's widest zoom) plus a static lane offset.
 *
 * Static offsets make this non-monotone in zoom: either component can shrink
 * toward a kink where offset and true separation cancel. As a function of the
 * zoom scale factor `s` (1 at the widest zoom, doubling per level) it is the
 * sum of two absolute values, so it is convex and piecewise linear with one
 * kink per axis -- the minimum sits at an endpoint or at a kink, checked
 * exactly, where sampling zooms could step over the dip. Lanes run on one axis
 * at a time (see coincidentGroups), but the pair being compared may be in two
 * groups that chose differently, so both kinks are live.
 */
function leastDrawnL1(a, b, sMax, sFrom = 1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const offX = (b.off?.x ?? 0) - (a.off?.x ?? 0);
  const offY = (b.off?.y ?? 0) - (a.off?.y ?? 0);
  const l1At = (s) => Math.abs(dx * s + offX) + Math.abs(dy * s + offY);
  let least = Math.min(l1At(sFrom), l1At(sMax));
  for (const [delta, off] of [
    [dx, offX],
    [dy, offY],
  ]) {
    const kink = delta !== 0 ? -off / delta : -1;
    if (kink > sFrom && kink < sMax) least = Math.min(least, l1At(kink));
  }
  return least;
}

/**
 * Where the displaced-pin treatment starts: one whole zoom level outside the
 * split zoom when every drawn pin provably clears there, otherwise the split
 * zoom itself.
 *
 * Membership is decided at the split zoom; one level out every true position
 * sits at half the pixel distance, so the fit cannot be assumed -- the current
 * venue sheet rejects it (two ungrouped venues would draw 33 px apart there
 * against the 38 they need, measured 2026-08-23). Plain pairs only count from
 * the zoom where clustering releases them -- an integer tile zoom, since
 * supercluster builds per tile, so modeling release as continuous rejected
 * states that never render. A grouped venue within clusterRadius of a plain
 * one rejects outright, because that stack would draw the venue twice (once
 * in the glyph, once displaced). Both cluster tests are pairwise, a
 * conservative stand-in for supercluster's hierarchical merge.
 */
function leaderStartZoom(venues, offsets, { splitZoom, maxZoom, lat }) {
  const candidate = splitZoom - 1;
  const sMax = 2 ** (maxZoom - candidate);
  const points = pxAtZoom(venues, candidate, lat).map((p, i) => ({
    ...p,
    off: offsets.get(i) ?? NO_LANE,
    grouped: offsets.has(i),
  }));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      const euclid = Math.hypot(b.x - a.x, b.y - a.y);
      if (a.grouped !== b.grouped && euclid < 26) return splitZoom;
      // Released at the first integer tile zoom where the pair spans more than
      // clusterRadius; `candidate` is itself whole, so powers of two land on
      // tile boundaries.
      const sFrom = !a.grouped && !b.grouped && euclid < 26 ? 2 ** Math.ceil(Math.log2(26 / euclid)) : 1;
      if (sFrom <= sMax && leastDrawnL1(a, b, sMax, sFrom) < 2 * VENUE_R) return splitZoom;
    }
  }
  return candidate;
}

// A displaced small pin's lane: far enough from its own coordinate, on whichever
// side displacedStopOffsets picks, that its diamond clears a venue diamond drawn
// at that exact coordinate, with a leader run left visible between them.
const SMALL_LEADER_OFF_PX = VENUE_R + LEADER_RUN_PX + SMALL_R;

/**
 * Transit stops whose pins cannot clear a venue pin somewhere in the displaced
 * range, and the offset each one moves by, keyed by stop index.
 *
 * The venue never moves: it is the primary content and its own placement is
 * already spoken for by the venue groups, so the smaller pin is the one
 * displaced, with the same dot-and-leader honesty. Lanes are tried in the order
 * the stop's own position argues for -- the axis it is further from the venue
 * on, and on each axis the side it is really on -- which is coincidentGroups'
 * rule applied to a pair rather than a group: displacement should exaggerate a
 * difference that exists and never invent one along an axis where there is
 * none. If a lane's diamond would land on any other pin anywhere in the range
 * the next one is tried, and if none of the four clears the stop stays put --
 * the overlap it had anyway, now a decision rather than an accident. Below the
 * leader zoom the stop draws plain and can tuck under a venue pin, as every
 * small pin may at wide zooms: that is ordinary map generalization, where the
 * venue wins the space by paint order and the zoom that separates them is
 * always available.
 */
function displacedStopOffsets(stops, venues, groupOffsets, sponsors, { leaderZoom, maxZoom, lat }) {
  const sMax = 2 ** (maxZoom - leaderZoom);
  const venuePins = pxAtZoom(venues, leaderZoom, lat).map((p, i) => ({
    ...p,
    off: groupOffsets.get(i) ?? NO_LANE,
    clear: VENUE_R + SMALL_R,
  }));
  // What a stop must keep between itself and each sponsor pin, measured the one
  // way this file measures anything: |dx| + |dy|.
  //
  // Two shapes are disjoint exactly when the offset between their centres lies
  // outside the Minkowski sum of the two, so the clearance is that sum's
  // extent along the measure in use. For an L1 measure that is the sum's own L1
  // radius, and it adds:
  //
  //   diamond of half-diagonal R -> L1 radius R      (its tip IS the L1 extreme)
  //   axis-aligned square, side s -> L1 radius s     (its corner: s/2 + s/2)
  //
  // So, against a stop's diamond (SMALL_R):
  //   vs a generic sponsor diamond (SMALL_R): 2 * SMALL_R, as before.
  //   vs a featured sponsor square (FEATURED_SIDE): SMALL_R + FEATURED_SIDE.
  // and, for completeness, two featured squares would need 2 * FEATURED_SIDE.
  //
  // The L1 test is sufficient but not tight for a square: two squares also
  // clear at max(|dx|,|dy|) >= side, which |dx| + |dy| >= 2 * side does not
  // capture, so a stop can be pushed further than it strictly had to be. That
  // is the right way to be wrong here -- it costs a few pixels of displacement
  // and never lets a mark end up under a transit diamond -- and it keeps one
  // measure across the whole file rather than two that must agree.
  const sponsorPins = pxAtZoom(sponsors, leaderZoom, lat).map((p, i) => ({
    ...p,
    off: NO_LANE,
    clear: SMALL_R + (FEATURED_SPONSOR_TIERS.has(sponsors[i].tier_slug) ? FEATURED_SIDE : SMALL_R),
  }));
  const stopPins = pxAtZoom(stops, leaderZoom, lat).map((p) => ({ ...p, off: NO_LANE }));

  const offsets = new Map();
  const collides = (pin, index) =>
    [...venuePins, ...sponsorPins].some((o) => leastDrawnL1(pin, o, sMax) < o.clear) ||
    stopPins.some(
      (s, j) => j !== index && leastDrawnL1(pin, { ...s, off: offsets.get(j) ?? NO_LANE }, sMax) < 2 * SMALL_R
    );

  stopPins.forEach((pin, index) => {
    const blocker = venuePins.find((v) => leastDrawnL1(pin, v, sMax) < v.clear);
    if (!blocker) return;
    const toBlockerX = pin.x - (blocker.x + blocker.off.x);
    const toBlockerY = pin.y - (blocker.y + blocker.off.y);
    const lane = (x, y) => ({ x: x * SMALL_LEADER_OFF_PX, y: y * SMALL_LEADER_OFF_PX, axis: x === 0 ? 'ns' : 'ew' });
    const sideX = toBlockerX >= 0 ? 1 : -1;
    const sideY = toBlockerY >= 0 ? 1 : -1;
    const eastWest = [lane(sideX, 0), lane(-sideX, 0)];
    const northSouth = [lane(0, sideY), lane(0, -sideY)];
    const order =
      Math.abs(toBlockerX) >= Math.abs(toBlockerY) ? [...eastWest, ...northSouth] : [...northSouth, ...eastWest];
    for (const offset of order) {
      if (!collides({ ...pin, off: offset }, index)) {
        offsets.set(index, offset);
        return;
      }
    }
  });
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
 * The Featured Destination pin: an axis-aligned square of paper, red-keylined,
 * carrying the sponsor's own square mark.
 *
 * `mark` is a loaded `Image` or null. Null is not an error case to be avoided —
 * it is what draws while the marks are still loading, and what stays if one of
 * them never arrives. An empty red square is a legible pin; waiting for a file
 * before drawing any of the layer would let one bad asset empty it.
 *
 * The mark is drawn **contain-fit**: scaled to fit inside the inner box without
 * cropping and centred, so a mark of any aspect keeps its proportions and a
 * wide one simply uses less of the square. Cover-fit would crop somebody's
 * brand, and stretching it is worse than either.
 */
function squareMarkImage(side, mark, { stroke, fill }, dpr) {
  // The same 2 px of canvas bleed diamondImage leaves, so the tests' shared
  // "image width minus 4 is the drawn size" reading holds for this pin too.
  const half = side / 2 + 2;
  const { ctx, cx, cy } = pinCanvas(half, half, dpr);
  const left = cx - side / 2;
  const top = cy - side / 2;

  ctx.fillStyle = fill;
  ctx.fillRect(left, top, side, side);
  // Stroked on the inset rectangle, not on the outline of the fill: a canvas
  // stroke straddles its path, so stroking the full square would put half the
  // keyline outside the 27 px and make the pin 29.
  ctx.strokeStyle = stroke;
  ctx.lineWidth = FEATURED_STROKE;
  ctx.strokeRect(
    left + FEATURED_STROKE / 2,
    top + FEATURED_STROKE / 2,
    side - FEATURED_STROKE,
    side - FEATURED_STROKE
  );

  if (mark && mark.width > 0 && mark.height > 0) {
    const box = side - 2 * (FEATURED_STROKE + FEATURED_MARK_INSET);
    const scale = Math.min(box / mark.width, box / mark.height);
    const width = mark.width * scale;
    const height = mark.height * scale;
    ctx.drawImage(mark, cx - width / 2, cy - height / 2, width, height);
  }
  return { data: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), pixelRatio: dpr };
}

/** The image id a featured sponsor's own pin is registered under. */
const featuredPinId = (sponsorId) => `pin-sponsor-featured-${sponsorId}`;

/**
 * Loads every featured sponsor's mark, and calls back with the ones that
 * arrived. Never rejects: a mark is one sponsor's picture, and losing it must
 * not take the map's whole pin layer with it.
 *
 * The marks come from the precache like every other asset, so this works
 * offline; a failure here means the file is missing or corrupt, not that the
 * phone is off the network, and that is worth a console warning.
 */
function loadSponsorMarks(sponsors) {
  return Promise.all(
    sponsors.map(
      (sponsor) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve({ sponsor, image });
          image.onerror = () => {
            console.warn(`[map] sponsor mark failed to load: ${sponsor.mark} (${sponsor.id}); pin drawn empty`);
            resolve(null);
          };
          image.src = sponsor.mark;
        })
    )
  ).then((loaded) => loaded.filter(Boolean));
}

/**
 * A pin's collision footprint: a square that reserves space and draws nothing.
 *
 * MapLibre ties a symbol's collision box to its image rect, so the only way to
 * reserve less than the pin draws is to let something else do the reserving --
 * the same decoupling the tether uses. The pin layer stops registering and this
 * rides beside it, at the same position, with the box we actually want.
 *
 * Fully transparent rather than nearly so: the box comes from the image's
 * dimensions, not its pixels, and a square of faint grey over the map's paper
 * would be visible at exactly the sizes that matter.
 */
function blockerImage(halfSide, dpr) {
  const { ctx } = pinCanvas(halfSide, halfSide, dpr);
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
 * The leader line of a displaced pin: the stroke from the coordinate the venue
 * really occupies out to where its diamond is drawn. The dot at that coordinate
 * and the diamond at the far end are separate symbols -- see leaderDotImage and
 * the `icon-offset` on the pin layers.
 *
 * Three symbols rather than one is what stopped the treatment eating the map's
 * label space (Anthony, 2026-09-04). A symbol's collision box is its whole image
 * rect, so a single dot-line-diamond image 32 px wide reserved 110 x 46 px where
 * the diamond it protects is 46 x 46 -- and a displaced transit stop reserved
 * 116 x 30. Most of that box was the empty paper alongside the line, and on a
 * phone frame those boxes covered the middle of the map: three venues with
 * visible space around them went unnamed because of paper nothing was drawn on
 * (`reviews/2026-09-map-collisions/diag-*.png`).
 *
 * The line is the one part that reserves nothing (`icon-ignore-placement` on its
 * layer), and that is the whole of what was given up: **a label may be drawn
 * across a leader line. It may not be drawn across a diamond, its number, or a
 * location dot.**
 */
function leaderLineImage({ x, y }, { line }, dpr) {
  const { ctx, cx, cy } = pinCanvas(Math.abs(x) + LEADER_LINE_W, Math.abs(y) + LEADER_LINE_W, dpr);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + x, cy + y);
  ctx.strokeStyle = line;
  ctx.lineWidth = LEADER_LINE_W;
  ctx.stroke();
  return { data: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), pixelRatio: dpr };
}

/**
 * The dot: the one mark on the map claiming where a displaced venue really is.
 *
 * Its own symbol, at the feature's own coordinate, so its collision box is the
 * dot rather than the composite -- about 15 px square against the 110 x 46 the
 * whole tether used to reserve. It blocks, unlike the line: with the line out of
 * the index a name could be placed straight over the dots either side of it, and
 * three venues' worth of tether then points at ink you cannot see (Anthony,
 * 2026-09-04, reading after-fill-urban-lights-desktop.png). A dot identifies a
 * place; a line only connects two things that are already visible.
 *
 * One image for every lane, since the dot never moves off the coordinate.
 */
function leaderDotImage({ dot }, dpr) {
  const { ctx, cx, cy } = pinCanvas(LEADER_DOT_R + 2, LEADER_DOT_R + 2, dpr);
  ctx.beginPath();
  ctx.arc(cx, cy, LEADER_DOT_R, 0, Math.PI * 2);
  ctx.fillStyle = dot;
  ctx.fill();
  return { data: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), pixelRatio: dpr };
}

/**
 * The tap-highlight ring, centred on its own image.
 *
 * The circle layers the other pins use draw at the feature's geometry, which
 * for a displaced pin is the dot rather than the diamond -- a halo around empty
 * paper. This is a symbol instead, and it rides the same `icon-offset`
 * expression the diamond does, so ring and diamond stay aligned because they
 * are moved by one expression rather than by two agreeing.
 */
function ringImage(pinRadius, { fill, stroke }, dpr) {
  const radius = pinRadius + HALO_PAD;
  const strokeWidth = 2;
  const half = radius + 2 + strokeWidth;
  const { ctx, cx, cy } = pinCanvas(half, half, dpr);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
  return { data: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), pixelRatio: dpr };
}

/**
 * Image id for a leader line. One per pin kind per distinct offset -- keyed on
 * the offset alone, not on laneKey: two groups that chose different axes and
 * both left a member at 0,0 need no line at all.
 */
const leaderLineId = (kind, { x, y }) => `leader-line-${kind}-${x}_${y}`;

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
        <!-- Festival content first (venue, then the two sponsor tiers), transit
             after: the legend ranks what attendees came for above how they get
             there. -->
        <ul class="map-legend__list">
          <li><svg class="legend-icon legend-icon--venue" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon></svg> Venue</li>
          <!-- The featured swatch is a square and the venue swatch a diamond of
               the same ink: same area, one rotated from the other, which is what
               the two pins are. The rect is inset 3 and stroked 2, so its outer
               edge spans the same 28 of 32 units the polygons do. -->
          <li><svg class="legend-icon legend-icon--sponsor-featured" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26"></rect></svg> Featured Destination</li>
          <li><svg class="legend-icon legend-icon--sponsor-generic" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon></svg> Sponsor</li>
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
        </ul>
      </div>
      ${content.settings.map_attribution ? `<p class="map-attribution">${esc(content.settings.map_attribution)}</p>` : ''}
      <div class="map-key" id="map-key"></div>
      <div id="map-pin-alt"></div>
    </section>`;

  // Tapping another tab mid-load wipes #view while these awaits are in flight;
  // every DOM reference is re-queried through here and a null answer ends the
  // render, so nothing lands in a detached tree.
  const mapWrap = () => (generation === renderGeneration ? container.querySelector('#map-svg-wrap') : null);

  const venues = content.venues.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  // The sponsors that draw a pin, and therefore the sponsors the key list
  // holds: the list under the map is a map key, so it mirrors the pins exactly.
  // Computed here rather than beside the pin layers because the key list is
  // rendered before the engine exists and has to say the same thing.
  const pinnedSponsors = pinnedSponsorsOf(content.sponsors);
  // Reassigned once the engine map exists; until then a key-list tap only opens
  // the sheet, exactly as it does on a device that never gets a map at all.
  let linkVenueToMap = () => {};
  let linkSponsorToMap = () => {};
  // Rendered before the engine is loaded, and left in place if it never is:
  // on a device without WebGL2 this list is the map view.
  // The card comes back with the id because in the embed it is where the sheet
  // opens: a tap on it is the only proof of where the visitor is looking, and by
  // the time they are reading this list the map frame may be well off screen.
  renderMapKeyList(container, venues, pinnedSponsors, {
    onVenue: (venueId, card) => {
      linkVenueToMap(venueId);
      openVenueSheet(venueId, { openedBy: card });
    },
    onSponsor: (sponsorId) => {
      linkSponsorToMap(sponsorId);
      openSponsorSheet(sponsorId);
    },
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

  // View zooms come from the frame's SHORTER side, not its width. On a phone
  // the frame is square and the two are the same thing; at desktop widths the
  // frame is wider than tall (app.css), and measuring the long side would mean
  // "3000 m across the home view" bought less map north to south than a phone
  // gets -- cropping the venue set on the axis it was already tightest on.
  // Taking the short side makes the extra width extra map instead, and holds
  // the on-screen scale identical to the square frame's, which is what the
  // 560 px cap's readability rationale rests on.
  const framePx = Math.min(wrap.clientWidth || 360, wrap.clientHeight || 360);
  const lat = home[1];
  const minZoom = zoomForMeters(extentMeters, framePx, lat);
  const maxZoom = zoomForMeters(MIN_VIEW_M, framePx, lat);
  const homeZoom = zoomForMeters(HOME_VIEW_M, framePx, lat);
  // Venues stop clustering once they would be drawn far enough apart to tap
  // individually -- about a pin's width between the closest real pair. Capped
  // at 17 because a GeoJSON source's own maxzoom is 18 and tiles above it are
  // overzoomed: a clusterMaxZoom of 18 would bake clusters into the last real
  // tile, so they would never break apart no matter how far you zoomed.
  const clusterMaxZoom = Math.min(17, Math.round(zoomForMeters(210, PIN_GEOMETRY_REF_PX, lat)));
  // A whole zoom level, like clusterMaxZoom: the filter that drops a stack of
  // displaced venues reads `zoom`, which MapLibre evaluates only at integer
  // zooms (tile zoom), so a fractional split would swap the two treatments in
  // at different moments and briefly draw both.
  const splitZoom = Math.round(zoomForMeters(SPLIT_VIEW_M, PIN_GEOMETRY_REF_PX, lat));
  const nameRank = venueNameRanks(venues, content.events);
  // Name box sizes, measured in the layer's own font. MapLibre wraps at
  // text-max-width (10 em), so a long name is capped in width and grows in
  // lines; close enough to order candidates by, which is all this feeds.
  const widthOf = (() => {
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `600 ${NAME_TEXT_PX}px ${UI_FONT_STACK}`;
    const maxWidth = 10 * NAME_TEXT_PX;
    return (name) => {
      const measured = probe.measureText(name).width;
      const lines = Math.max(1, Math.ceil(measured / maxWidth));
      return { width: Math.min(measured, maxWidth), height: lines * NAME_TEXT_PX * 1.2 };
    };
  })();
  const groupOffsets = coincidentGroups(venues, { splitZoom, maxZoom, lat, nameRank });
  const leaderZoom = leaderStartZoom(venues, groupOffsets, { splitZoom, maxZoom, lat });
  const displaced = [...groupOffsets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, offset]) => ({
      index,
      venue: venues[index],
      label: String(index + 1),
      offset,
      sortKey: nameRank.get(index),
    }));

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
    // On the app's own page the map is the page, so one finger panning it and
    // the wheel zooming it are right. In an iframe on somebody else's page
    // they are a trap: the visitor scrolling past the map gets the map zoomed
    // instead, with no way on. Cooperative gestures (ctrl+wheel to zoom, two
    // fingers to pan) are the standard answer, and they cost the app nothing
    // because they apply only to the embed.
    cooperativeGestures: isEmbed(),
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

  // The same subset the transit pin layers draw (see addPins): stops within the
  // pin radius. Computed here so the visually-hidden button list and the map
  // itself can't disagree about what is on the map. (Sponsors get the same
  // treatment further up, where the key list needs them.)
  const nearFestival = makeTransitFilter(home);
  const pinnedStops = stops.filter(
    (s) =>
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      Array.isArray(s.lines) &&
      s.lines.length > 0 &&
      nearFestival(s.lat, s.lng)
  );
  renderPinAltList(container, pinnedStops);

  const displacedStops = displacedStopOffsets(pinnedStops, venues, groupOffsets, pinnedSponsors, {
    leaderZoom,
    maxZoom,
    lat,
  });

  // Which order each venue tries its name positions in -- see nameOrders. Done
  // here rather than in addPins because it needs the projection, and the answer
  // is one static list per venue.
  const nameOrder = nameOrders(venues, {
    groupOffsets,
    stops: pinnedStops,
    displacedStops,
    sponsors: pinnedSponsors,
    leaderZoom,
    lat,
    widthOf,
  });

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
    addPins(map, {
      venues,
      stops: pinnedStops,
      sponsors: pinnedSponsors,
      clusterMaxZoom,
      colors,
      displaced,
      displacedStops,
      leaderZoom,
      nameRank,
      nameOrder,
    });
    wirePinTaps(map, { transitById, maxZoom, selectPin });
    // A venue card in the key list behaves as though its pin was tapped:
    // highlight the pin and recenter on it, on top of opening the sheet.
    linkVenueToMap = (venueId) => {
      const ref = pinRef.get(venueId);
      if (!ref) return;
      selectPin(ref.source, ref.id);
      revealPin(map, { venueId, center: ref.center, floor: leaderZoom, maxZoom });
    };
    // A sponsor card does the same, with the simpler camera a sponsor pin
    // allows: sponsors never cluster and are never displaced, so a sponsor
    // always has a pin of its own and there is nothing to check afterwards.
    // The leader zoom is still the floor -- it is where sponsor names appear,
    // so it is the view where the recentred pin is identifiable.
    linkSponsorToMap = (sponsorId) => {
      const index = pinnedSponsors.findIndex((s) => s.id === sponsorId);
      if (index === -1) return;
      const sponsor = pinnedSponsors[index];
      selectPin('sponsors', index);
      map.easeTo({
        center: [sponsor.lng, sponsor.lat],
        zoom: Math.max(map.getZoom(), leaderZoom),
        duration: cameraDuration(450),
      });
    };
  });

  wireControls(container, map, { home, homeZoom, maxZoom, cleanupFns });
  if (youAreHereEnabled) {
    wireLocate(container, map, Marker, { west, east, south, north, cleanupFns });
  }

  return cleanup;
}

/**
 * The sponsors that draw a pin: tiers emerald–topaz, and only with a location
 * (Map contract). `quartz` never gets one whatever its location says.
 *
 * One function because three places have to agree about it — the pin source,
 * the clearance checks, and the key list — and the day they disagree is the day
 * a sponsor is in the list with no pin to point at.
 */
function pinnedSponsorsOf(sponsors) {
  return sponsors.filter(
    (s) =>
      (FEATURED_SPONSOR_TIERS.has(s.tier_slug) || s.tier_slug === 'topaz') &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng)
  );
}

/**
 * The key below the map: Featured Destinations, Venues, Sponsors, in that
 * order, each under a visible heading.
 *
 * It is a **map key**, so it holds exactly what the map draws: the sponsors are
 * the pinned ones and nobody else, and a section with nothing in it renders
 * nothing at all rather than a heading over empty space — an empty "Sponsors"
 * heading is a claim that there are sponsors on the map.
 *
 * The headings are visible text rather than `aria-label`s because the list is
 * read by sighted people too, and because the three card shapes (numbered
 * diamond, mark thumbnail, red diamond) are the same argument as the legend:
 * shape and word together, never colour alone.
 *
 * `#venue-key-list` keeps its id and its `<ol>`: the numbering is the venue
 * pins' own vocabulary, the embed styles it by that id, and tests address it.
 */
function renderMapKeyList(container, venues, sponsors, { onVenue, onSponsor }) {
  const host = container.querySelector('#map-key');
  if (!host) return;
  const featured = sponsors.filter((s) => FEATURED_SPONSOR_TIERS.has(s.tier_slug));
  const generic = sponsors.filter((s) => !FEATURED_SPONSOR_TIERS.has(s.tier_slug));

  // "Venue N" is in the accessible name, not only in the aria-hidden SVG: a
  // screen-reader user has to be able to cross-reference the number a sighted
  // companion reads off the map.
  const venueCard = (v, i) =>
    `<li class="venue-key-item"><button type="button" class="venue-key-btn" data-venue-id="${esc(v.id)}">
        <svg class="venue-key-btn__pin" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <polygon points="16,1 31,16 16,31 1,16"></polygon>
          <text x="16" y="16">${i + 1}</text>
        </svg><span class="sr-only">Venue ${i + 1}: </span>${esc(v.name)}</button></li>`;

  // The mark is the pin's own picture at a size that can actually be read, and
  // it is decorative here: the sponsor's name is right beside it in text.
  const featuredCard = (s) =>
    `<li class="venue-key-item"><button type="button" class="sponsor-key-btn" data-sponsor-id="${esc(s.id)}" data-featured="true">
        ${
          s.mark
            ? `<img class="sponsor-key-btn__mark" src="${esc(s.mark)}" alt="" width="28" height="28">`
            : `<svg class="sponsor-key-btn__square" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3" y="3" width="26" height="26"></rect></svg>`
        }${esc(s.name)}</button></li>`;

  const sponsorCard = (s) =>
    `<li class="venue-key-item"><button type="button" class="sponsor-key-btn" data-sponsor-id="${esc(s.id)}" data-featured="false">
        <svg class="sponsor-key-btn__pin" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <polygon points="16,2 30,16 16,30 2,16"></polygon>
        </svg>${esc(s.name)}</button></li>`;

  const section = (heading, tag, id, cards) =>
    cards.length
      ? `<h2 class="view-subtitle">${heading}</h2>
         <${tag} class="venue-key-list"${id ? ` id="${id}"` : ''}>${cards.join('')}</${tag}>`
      : '';

  host.innerHTML = [
    section('Featured Destinations', 'ul', 'featured-key-list', featured.map(featuredCard)),
    section('Venues', 'ol', 'venue-key-list', venues.map(venueCard)),
    section('Sponsors', 'ul', 'sponsor-key-list', generic.map(sponsorCard)),
  ].join('');

  // `.venue-key-btn` means a venue card and nothing else — it is what the
  // contract's test hook names and what every test selects on, so the sponsor
  // cards get their own class and share only the CSS.
  host.querySelectorAll('.venue-key-btn[data-venue-id]').forEach((btn) => {
    btn.addEventListener('click', () => onVenue(btn.dataset.venueId, btn));
  });
  host.querySelectorAll('.sponsor-key-btn[data-sponsor-id]').forEach((btn) => {
    btn.addEventListener('click', () => onSponsor(btn.dataset.sponsorId, btn));
  });
}

/**
 * Keyboard/AT path to the canvas transit pins (Accessibility contract). Pins
 * are drawn into WebGL, so a transit pin has no DOM presence a keyboard or
 * screen reader could reach — venues and sponsors are covered by the visible
 * key list above. The fix is a visually-hidden button per pinned stop, opening
 * the same sheet a tap on the pin would. Each button un-hides while focused
 * (skip-link style) so sighted keyboard users can see where focus is; focus
 * returns to the button when the sheet closes, per the sheet's own contract.
 *
 * Sponsors left this list when they gained key-list cards (2026-09-05): a
 * sponsor with both would be announced twice, once visibly and once not, and
 * two buttons for one pin is worse than none.
 */
function renderPinAltList(container, stops) {
  const host = container.querySelector('#map-pin-alt');
  if (!host || !stops.length) return;
  const stopLabel = (s) =>
    [s.name, s.lines.map((l) => TRANSIT_LINE_NAME[l] || l).join(', ')].filter(Boolean).join(' — ');
  host.innerHTML = `
    <h2 class="sr-only">Transit stops on the map</h2>
    <ul class="pin-alt-list">
      ${stops
        .map(
          (s) =>
            `<li><button type="button" class="pin-alt-btn" data-kind="transit" data-id="${esc(s.id)}">${esc(stopLabel(s))}</button></li>`
        )
        .join('')}
    </ul>`;
  const stopById = new Map(stops.map((s) => [s.id, s]));
  host.querySelectorAll('.pin-alt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stop = stopById.get(btn.dataset.id);
      if (stop) openTransitSheet(stop, stop.lines.map((l) => TRANSIT_LINE_NAME[l] || l));
    });
  });
}

/**
 * Which venue keeps its name when two names contest the same space: a rank per
 * venue index, most events first, lowest rank wins.
 *
 * `symbol-sort-key` places lower keys first and, with `text-allow-overlap` off,
 * a name placed first is a name kept. Without one MapLibre falls back to the
 * order the features arrive in, which here is the order the organizers happened
 * to type rows into the sheet -- so the venue whose name survived was an
 * accident of the spreadsheet. Event count is the closest thing the content has
 * to "how much of the festival happens here", and a venue's number is a sheet
 * artifact rather than curation (ruled 2026-09-04), so it serves only as the
 * deterministic tiebreak, applied through the venue's own id.
 *
 * Which name survives therefore moves when the organizers edit the lineup. That
 * is the point: importance should track the actual lineup. Nothing here reaches
 * the build, so `content.json` stays byte-identical either way.
 */
function venueNameRanks(venues, events) {
  const counts = new Map();
  for (const event of events) counts.set(event.venue_id, (counts.get(event.venue_id) ?? 0) + 1);
  const ranks = new Map();
  venues
    .map((venue, index) => ({ index, count: counts.get(venue.id) ?? 0, id: venue.id }))
    .sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .forEach((entry, rank) => ranks.set(entry.index, rank));
  return ranks;
}

/**
 * Candidate positions for a name beside a pin, best first, as the flat
 * anchor/offset pairs `text-variable-anchor-offset` takes.
 *
 * `clear` is how far past the pin's own collision box the label starts, and
 * every offset is measured from the feature's geometry -- which for a displaced
 * pin is the dot, so `lane` carries the label out to the diamond first.
 *
 * The corners use `clear` on BOTH axes rather than `clear` along the diagonal.
 * A pin's collision box is a square, so its corner is at (clear, clear) and a
 * diagonal candidate has to clear the corner, not the edge. A radial distance
 * would land the label inside its own pin's box, where the placement pass that
 * is trying to seat it rejects it -- which is why corner anchors measured inert
 * on this map before the offsets were given per anchor (2026-09-04).
 *
 * Offsets are in **ems of the layer's own text size**, which is the unit the
 * property takes, and the coupling is a trap worth naming: change the text size
 * without dividing by the new one and every name moves relative to its pin, and
 * any that land inside the pin's box disappear. Measured on a phone frame:
 * 12px -> 11px took the placed names from 8 to 4, and 10px to none.
 */
function nameCandidates({ clear, cornerClear = clear, textPx, order, lane = NO_LANE }) {
  const ems = (px) => px / textPx;
  const at = {
    east: ['left', [ems(lane.x + clear), ems(lane.y)]],
    west: ['right', [ems(lane.x - clear), ems(lane.y)]],
    above: ['bottom', [ems(lane.x), ems(lane.y - clear)]],
    below: ['top', [ems(lane.x), ems(lane.y + clear)]],
    upRight: ['bottom-left', [ems(lane.x + cornerClear), ems(lane.y - cornerClear)]],
    upLeft: ['bottom-right', [ems(lane.x - cornerClear), ems(lane.y - cornerClear)]],
    downRight: ['top-left', [ems(lane.x + cornerClear), ems(lane.y + cornerClear)]],
    downLeft: ['top-right', [ems(lane.x - cornerClear), ems(lane.y + cornerClear)]],
  };
  return order.flatMap((where) => at[where]);
}

/**
 * The order a displaced venue's name tries its positions in.
 *
 * The lane's own side leads: a name out past the diamond, on the side the
 * tether points, is part of what the displacement says. What changed on
 * 2026-09-04 is that being blocked there stopped being fatal. A displaced name
 * had exactly this one position and vanished if anything held it, which is most
 * of why five of the six displaced venues on a phone frame went unnamed; now it
 * works its way round the diamond.
 *
 * The far side comes late rather than never. It puts the name back across the
 * tether, which reads worse than the rest -- but since the line stopped
 * reserving space a name there is legible, and a legible name slightly out of
 * place beats no name.
 */
function laneNameOrder(offset) {
  if (offset.x > 0) return ['east', 'above', 'below', 'upRight', 'downRight', 'west', 'upLeft', 'downLeft'];
  if (offset.x < 0) return ['west', 'above', 'below', 'upLeft', 'downLeft', 'east', 'upRight', 'downRight'];
  if (offset.y > 0) return ['below', 'east', 'west', 'downRight', 'downLeft', 'above', 'upRight', 'upLeft'];
  if (offset.y < 0) return ['above', 'east', 'west', 'upRight', 'upLeft', 'below', 'downRight', 'downLeft'];
  // The middle lane of an odd group draws at its own coordinate, so its name
  // starts on the axis its neighbours did not take.
  return offset.axis === 'ns'
    ? ['east', 'west', 'upRight', 'downRight', 'upLeft', 'downLeft', 'above', 'below']
    : ['below', 'above', 'downRight', 'downLeft', 'upRight', 'upLeft', 'east', 'west'];
}

/**
 * Where a name would sit for one candidate direction, as a screen-pixel box
 * relative to the feature's own coordinate.
 *
 * The anchor names the edge of the label held at the offset point, so this
 * mirrors nameCandidates: the offset positions one edge or corner, and the
 * label grows away from the pin from there.
 */
function candidateBox(where, { lane, clear, cornerClear, width, height }) {
  const w = width / 2;
  const h = height / 2;
  const spot = {
    east: [lane.x + clear + w, lane.y],
    west: [lane.x - clear - w, lane.y],
    above: [lane.x, lane.y - clear - h],
    below: [lane.x, lane.y + clear + h],
    upRight: [lane.x + cornerClear + w, lane.y - cornerClear - h],
    upLeft: [lane.x - cornerClear - w, lane.y - cornerClear - h],
    downRight: [lane.x + cornerClear + w, lane.y + cornerClear + h],
    downLeft: [lane.x - cornerClear - w, lane.y + cornerClear + h],
  }[where];
  return { x0: spot[0] - w, x1: spot[0] + w, y0: spot[1] - h, y1: spot[1] + h };
}

/** Euclidean distance from a point to the nearest point of a box. */
function distanceToBox(box, x, y) {
  const dx = Math.max(box.x0 - x, 0, x - box.x1);
  const dy = Math.max(box.y0 - y, 0, y - box.y1);
  return Math.hypot(dx, dy);
}

/**
 * The order each venue tries its name positions in, with the placements that
 * would read as labelling somebody else's pin pushed to the back.
 *
 * MapLibre's placement pass is ambiguity-blind: it takes the first candidate
 * whose box is free, and a box can be free while sitting directly over a
 * neighbouring pin. That is how "Anderson Center" came to sit on top of the
 * Creative Writing House pin with open paper to its own left (Anthony,
 * 2026-09-04).
 *
 * A candidate is ambiguous when **any other mark on the map is nearer to the
 * label than the label's own pin is** — which is what the reader is doing when
 * they decide which pin a name belongs to, and needs no threshold to tune. The
 * ambiguous candidates are not dropped, only demoted: a name in an ambiguous
 * place still beats no name, and on a crowded map every position is sometimes
 * the last one left.
 *
 * Scored once, at the leader zoom, because the answer has to be a static list
 * per feature and that is the widest view the names draw at — the crowded one.
 * Zooming in only spreads the marks apart, which can retire an ambiguity but
 * never creates one.
 */
function nameOrders(venues, { groupOffsets, stops, displacedStops, sponsors, leaderZoom, lat, widthOf }) {
  const venuePx = pxAtZoom(venues, leaderZoom, lat);
  const stopPx = pxAtZoom(stops, leaderZoom, lat);
  const sponsorPx = pxAtZoom(sponsors, leaderZoom, lat);

  // Every mark a name could be mistaken for labelling: the diamonds where they
  // are drawn, the dots that stand for a displaced venue's real position, and
  // the smaller pins. `owner` keeps a venue's own marks from counting against
  // its own name.
  const marks = [];
  venuePx.forEach((p, i) => {
    const lane = groupOffsets.get(i) ?? NO_LANE;
    marks.push({ owner: i, x: p.x + lane.x, y: p.y + lane.y });
    if (lane.x !== 0 || lane.y !== 0) marks.push({ owner: i, x: p.x, y: p.y });
  });
  stopPx.forEach((p, i) => {
    const lane = displacedStops.get(i) ?? NO_LANE;
    marks.push({ owner: -1, x: p.x + lane.x, y: p.y + lane.y });
  });
  sponsorPx.forEach((p) => marks.push({ owner: -1, x: p.x, y: p.y }));

  const orders = new Map();
  venues.forEach((venue, i) => {
    const lane = groupOffsets.get(i) ?? NO_LANE;
    const base = groupOffsets.has(i) ? laneNameOrder(lane) : NAME_ANCHOR_ORDER;
    const { width, height } = widthOf(venue.name);
    const own = { x: venuePx[i].x + lane.x, y: venuePx[i].y + lane.y };
    const clear = { lane, clear: VENUE_R + NAME_CLEAR_PX, cornerClear: CORNER_CLEAR_PX, width, height };
    const ambiguous = (where) => {
      const box = candidateBox(where, clear);
      const toOwn = distanceToBox(box, lane.x, lane.y);
      return marks.some(
        (m) => m.owner !== i && distanceToBox(box, m.x - venuePx[i].x, m.y - venuePx[i].y) < toOwn
      );
    };
    const clean = base.filter((where) => !ambiguous(where));
    orders.set(i, [...clean, ...base.filter((where) => !clean.includes(where))]);
  });
  return orders;
}

function addPins(
  map,
  { venues, stops, sponsors, clusterMaxZoom, colors, displaced, displacedStops, leaderZoom, nameRank, nameOrder }
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  // The distinct lanes in play, deduplicated by laneKey. NO_LANE is always
  // legal -- an odd group's middle member keeps its own coordinate -- and
  // seeding it keeps the `match` expressions below well formed when nothing is
  // displaced at all, since a match needs at least one branch.
  const distinctLanes = (lanes) => [...new Map(lanes.map((lane) => [laneKey(lane), lane])).values()];
  const laneOffsets = distinctLanes([NO_LANE, ...displaced.map((d) => d.offset)]);
  const stopLaneOffsets = distinctLanes([NO_LANE, ...displacedStops.values()]);
  // Tether images are keyed on the pixel offset alone, so two lanes that differ
  // only in axis share one, and a lane of 0,0 needs none at all.
  const tethers = (lanes) =>
    [...new Map(lanes.map((lane) => [`${lane.x}_${lane.y}`, lane])).values()].filter((l) => l.x !== 0 || l.y !== 0);
  map.addImage('pin-venue', diamondImage(VENUE_R, { fill: colors.venue }, dpr).data, { pixelRatio: dpr });
  // Reserves the diamond's own area rather than its bounding box -- see
  // PIN_BLOCK_HALF and the venue blocker layers below.
  map.addImage('pin-venue-block', blockerImage(PIN_BLOCK_HALF - 2, dpr).data, { pixelRatio: dpr });
  const haloColors = { fill: colors.accent, stroke: colors.accentDark };
  const tetherColors = { dot: colors.leaderDot, line: colors.leaderLine };
  map.addImage('leader-dot', leaderDotImage(tetherColors, dpr).data, { pixelRatio: dpr });
  // One ring per pin size, moved onto the diamond by the same icon-offset the
  // diamond uses -- see the halo layers below.
  map.addImage('halo-venue', ringImage(VENUE_R, haloColors, dpr).data, { pixelRatio: dpr });
  map.addImage('halo-transit', ringImage(SMALL_R, haloColors, dpr).data, { pixelRatio: dpr });
  for (const offset of tethers(laneOffsets)) {
    map.addImage(leaderLineId('venue', offset), leaderLineImage(offset, tetherColors, dpr).data, { pixelRatio: dpr });
  }
  for (const offset of tethers(stopLaneOffsets)) {
    map.addImage(leaderLineId('transit', offset), leaderLineImage(offset, tetherColors, dpr).data, { pixelRatio: dpr });
  }
  /** The lane as an icon-offset, matched off the feature's lane key. */
  const laneIconOffset = (lanes) => [
    'match',
    ['get', 'lane'],
    ...lanes.flatMap((offset) => [laneKey(offset), ['literal', [offset.x, offset.y]]]),
    ['literal', [0, 0]],
  ];
  map.addImage('pin-cluster', clusterImage(CLUSTER_R, { fill: colors.venue, stroke: colors.surface }, dpr).data, {
    pixelRatio: dpr,
  });
  map.addImage('pin-transit', diamondImage(SMALL_R, { fill: colors.transit }, dpr).data, { pixelRatio: dpr });
  // The featured square with nothing in it. Registered synchronously and used
  // as the layer's icon-image from the start, so the pins are on screen in the
  // same frame as every other pin; the marks replace it below when they arrive,
  // and it stays under any sponsor whose mark never does.
  map.addImage(
    'pin-sponsor-featured',
    squareMarkImage(FEATURED_SIDE, null, { stroke: colors.sponsor, fill: colors.paper }, dpr).data,
    { pixelRatio: dpr }
  );
  // Generic sponsor pins are solid, and the featured pin carries its weight
  // through size and a mark instead. The old convention was inverted --
  // featured filled, generic outlined, at one size -- so the heavier-looking
  // pin was the lesser sponsor.
  map.addImage('pin-sponsor-generic', diamondImage(SMALL_R, { fill: colors.sponsor }, dpr).data, {
    pixelRatio: dpr,
  });

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
          // Collision priority for this venue's name label; see venueNameRanks.
          sortKey: nameRank.get(i) ?? 0,
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
          // The lane as three scalars: GeoJSON-to-tile conversion stringifies
          // any property that isn't one, so an {x, y} object would arrive as
          // "[object Object]". `lane` is what the placement matches key off;
          // offsetX/offsetY are what the tap resolver measures with.
          lane: laneKey(d.offset),
          offsetX: d.offset.x,
          offsetY: d.offset.y,
          sortKey: d.sortKey ?? 0,
          line: leaderLineId('venue', d.offset),
          tethered: d.offset.x !== 0 || d.offset.y !== 0,
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
          grouped: displacedStops.has(i),
          ...(displacedStops.has(i) && {
            lane: laneKey(displacedStops.get(i)),
            offsetX: displacedStops.get(i).x,
            offsetY: displacedStops.get(i).y,
            line: leaderLineId('transit', displacedStops.get(i)),
          }),
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
        properties: { id: s.id, name: s.name, featured: FEATURED_SPONSOR_TIERS.has(s.tier_slug) },
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
  // allow-overlap keeps every pin drawn: MapLibre's collision handling HIDES
  // the loser, which would be worse than today's overlap. What stops venues
  // piling up is the clustering and the displacement above, not collision.
  // ignore-placement stays OFF, though -- a pin that registers its collision
  // box cannot be drawn across by the name and street labels placed after it,
  // which is what makes the leader images' baked-in line actually
  // untrespassable rather than only drawn on top of.
  const pinLayout = { 'icon-allow-overlap': true, 'icon-ignore-placement': false };
  const labelLayout = {
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-font': FONT_BOLD,
  };

  // A displaced stop leaves the plain layers from the leader zoom inward, where
  // its own leader layers draw it instead -- the same handoff the venues make,
  // in one source since transit never clusters.
  const plainTransit = ['any', ['<', ['zoom'], leaderZoom], ['==', ['get', 'grouped'], false]];
  map.addLayer({ id: 'transit-highlight', type: 'circle', source: 'transit', filter: plainTransit, paint: haloPaint(SMALL_R) });
  // One halo layer for both sponsor shapes, with the radius switched per
  // feature: a ring has to enclose the pin it rings, and the featured square's
  // furthest ink is its CORNER, at side/sqrt(2) from the centre. That lands on
  // VENUE_R but for the rounding (19.09 against 19) -- the square and the venue
  // diamond are the same shape rotated, so they share a circumradius -- and the
  // two halos therefore match, which is what "same weight in the hierarchy"
  // looks like when a pin is lit.
  map.addLayer({
    id: 'sponsor-highlight',
    type: 'circle',
    source: 'sponsors',
    paint: {
      ...haloPaint(SMALL_R),
      'circle-radius': [
        'case',
        ['boolean', ['get', 'featured'], false],
        FEATURED_SIDE / Math.SQRT2 + HALO_PAD,
        SMALL_R + HALO_PAD,
      ],
    },
  });
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
  // The leader lines, drawn under everything and reserving nothing. This is the
  // one part of the old composite that gave up its collision box, and the whole
  // of what "a label may cross a leader line" means -- see leaderLineImage.
  map.addLayer({
    id: 'venue-leader-line',
    type: 'symbol',
    source: 'venue-groups',
    minzoom: leaderZoom,
    filter: ['==', ['get', 'tethered'], true],
    layout: { ...pinLayout, 'icon-ignore-placement': true, 'icon-image': ['get', 'line'] },
  });
  map.addLayer({
    id: 'transit-leader-line',
    type: 'symbol',
    source: 'transit',
    minzoom: leaderZoom,
    filter: ['==', ['get', 'grouped'], true],
    layout: { ...pinLayout, 'icon-ignore-placement': true, 'icon-image': ['get', 'line'] },
  });

  // The dots, over their own lines, reserving a box the size of a dot. These
  // DO block. With the line out of the collision index a name could be placed
  // straight across the dots either side of it, leaving three tethers pointing
  // at ink you cannot see (Anthony, 2026-09-04). A dot identifies a place; a
  // line only joins two things already visible. The box is ~15 px square,
  // against the 110 x 46 the whole composite used to take.
  const dotLayer = (id, source, filter) =>
    map.addLayer({
      id,
      type: 'symbol',
      source,
      minzoom: leaderZoom,
      filter,
      layout: { ...pinLayout, 'icon-image': 'leader-dot' },
    });
  dotLayer('venue-leader-dot', 'venue-groups', ['==', ['get', 'tethered'], true]);
  dotLayer('transit-leader-dot', 'transit', ['==', ['get', 'grouped'], true]);

  // A displaced pin's halo is a symbol rather than a circle, for the one reason
  // that a circle layer draws at the feature's geometry -- which for these pins
  // is the leader dot, so the ring would land on empty paper beside the diamond
  // it is meant to mark. Ring and diamond ride the same icon-offset expression,
  // so they are moved by one thing rather than by two that have to agree.
  // Halos are the one exception to pins registering their boxes: a ring that
  // is invisible until its pin is selected must not reserve label room around
  // every displaced pin all the time.
  map.addLayer({
    id: 'venue-leader-halo',
    type: 'symbol',
    source: 'venue-groups',
    minzoom: leaderZoom,
    layout: {
      ...pinLayout,
      'icon-ignore-placement': true,
      'icon-image': 'halo-venue',
      'icon-offset': laneIconOffset(laneOffsets),
    },
    paint: { 'icon-opacity': selectedOnly(1) },
  });
  map.addLayer({
    id: 'transit-leader-halo',
    type: 'symbol',
    source: 'transit',
    minzoom: leaderZoom,
    filter: ['==', ['get', 'grouped'], true],
    layout: {
      ...pinLayout,
      'icon-ignore-placement': true,
      'icon-image': 'halo-transit',
      'icon-offset': laneIconOffset(stopLaneOffsets),
    },
    paint: { 'icon-opacity': selectedOnly(1) },
  });

  // Layer order IS paint order, lowest first: transit, featured destination,
  // sponsor, venue -- the priority the SVG map gets from document order.
  map.addLayer({
    id: 'transit-pin',
    type: 'symbol',
    source: 'transit',
    filter: plainTransit,
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
    id: 'transit-leader-pin',
    type: 'symbol',
    source: 'transit',
    minzoom: leaderZoom,
    filter: ['==', ['get', 'grouped'], true],
    layout: {
      ...pinLayout,
      ...labelLayout,
      // The ordinary stop diamond, moved into its lane. The dot and the line
      // back to the stop's real position are the tether layer's job.
      'icon-image': 'pin-transit',
      'icon-offset': laneIconOffset(stopLaneOffsets),
      'text-field': ['get', 'letters'],
      'text-size': 11,
      'text-line-height': 0.95,
      // Letters ride the displaced diamond, offset in ems of their own size --
      // a match over the lanes for the same reason as the venue layer below.
      'text-offset': [
        'match',
        ['get', 'lane'],
        ...stopLaneOffsets.flatMap((offset) => [laneKey(offset), ['literal', [offset.x / 11, offset.y / 11]]]),
        ['literal', [0, 0]],
      ],
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
  // Each featured sponsor's mark, drawn into its own copy of the square. This is
  // the only asynchronous thing on the map, and it is deliberately after the
  // fact: the layer above is already drawing empty squares, and this swaps in
  // the marks that loaded. Nothing waits on it, so a mark that 404s costs that
  // one sponsor its picture and no more.
  const featuredSponsors = sponsors.filter((s) => FEATURED_SPONSOR_TIERS.has(s.tier_slug) && s.mark);
  if (featuredSponsors.length) {
    loadSponsorMarks(featuredSponsors).then((loaded) => {
      if (!loaded.length) return;
      // The view may have been torn down while the marks were in flight -- a
      // route change removes the map, and every call below then reaches into a
      // style that no longer exists. Caught rather than checked: `getLayer`
      // itself throws on a removed map, so there is no test to run first.
      try {
        for (const { sponsor, image } of loaded) {
          map.addImage(
            featuredPinId(sponsor.id),
            squareMarkImage(FEATURED_SIDE, image, { stroke: colors.sponsor, fill: colors.paper }, dpr).data,
            { pixelRatio: dpr }
          );
        }
        map.setLayoutProperty('sponsor-featured-pin', 'icon-image', [
          'match',
          ['get', 'id'],
          ...loaded.flatMap(({ sponsor }) => [sponsor.id, featuredPinId(sponsor.id)]),
          'pin-sponsor-featured',
        ]);
      } catch {
        /* the map went away; the empty squares it was drawing went with it */
      }
    });
  }
  map.addLayer({
    id: 'venue-cluster',
    type: 'symbol',
    source: 'venues',
    filter: [
      'all',
      ['has', 'point_count'],
      [
        'any',
        ['<', ['zoom'], leaderZoom],
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
  // The venue pins draw but no longer reserve: the blocker layers below do that,
  // with a box the size of the diamond's own area rather than of its bounding
  // box (see PIN_BLOCK_HALF). Splitting them is the only way -- MapLibre takes a
  // symbol's collision box from its image rect, and icon-padding cannot go
  // negative.
  map.addLayer({
    id: 'venue-pin',
    type: 'symbol',
    source: 'venues',
    filter: plainVenue,
    layout: {
      ...pinLayout,
      ...labelLayout,
      'icon-ignore-placement': true,
      'icon-image': 'pin-venue',
      'text-field': ['get', 'label'],
      'text-size': VENUE_TEXT_PX,
    },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'venue-pin-block',
    type: 'symbol',
    source: 'venues',
    filter: plainVenue,
    layout: { ...pinLayout, 'icon-image': 'pin-venue-block' },
  });
  map.addLayer({
    id: 'venue-leader-pin',
    type: 'symbol',
    source: 'venue-groups',
    minzoom: leaderZoom,
    layout: {
      ...pinLayout,
      ...labelLayout,
      // The ordinary venue diamond, moved into its lane. What it reserves is the
      // blocker layer's business, not this one's.
      'icon-ignore-placement': true,
      'icon-image': 'pin-venue',
      'icon-offset': laneIconOffset(laneOffsets),
      'text-field': ['get', 'label'],
      'text-size': VENUE_TEXT_PX,
      // The number rides the diamond, so it is displaced by as much as the icon
      // draws it -- in ems here, unlike every other measure in this file. Built
      // as a match over the lane rather than read from the feature because the
      // GeoJSON-to-tile conversion stringifies any property that isn't a scalar,
      // and an array offset comes back as "[-2,0]" and silently falls back to 0.
      'text-offset': [
        'match',
        ['get', 'lane'],
        ...laneOffsets.flatMap((offset) => [
          laneKey(offset),
          ['literal', [offset.x / VENUE_TEXT_PX, offset.y / VENUE_TEXT_PX]],
        ]),
        ['literal', [0, 0]],
      ],
    },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'venue-leader-block',
    type: 'symbol',
    source: 'venue-groups',
    minzoom: leaderZoom,
    layout: { ...pinLayout, 'icon-image': 'pin-venue-block', 'icon-offset': laneIconOffset(laneOffsets) },
  });

  // Venue and sponsor names beside their pins, from the leader zoom inward --
  // the same threshold as the leader treatment. Text only, and none of
  // pinLayout's overlap escape hatches: names are long, so the engine's
  // collision pass hides the ones that don't fit rather than piling them up.
  // They are inserted BELOW every pin layer (before transit-highlight, the
  // first layer this function added) and above the street labels: placement
  // runs from the top of the stack down, so the pins are in the collision
  // index before any name looks for room -- no name lands across a diamond, a
  // number or a leader line -- and the names in turn outrank street names.
  // Among themselves, venue names place before sponsor names. Transit stops
  // get no name: their pins already say what they are, and a stop name is a
  // sheet-tap away.
  const nameLabelPaint = (color) => ({
    'text-color': color,
    'text-halo-color': colors.paper,
    'text-halo-width': 1.5,
  });
  map.addLayer(
    {
      id: 'sponsor-name-label',
      type: 'symbol',
      source: 'sponsors',
      minzoom: leaderZoom,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_SEMIBOLD,
        'text-size': SPONSOR_NAME_TEXT_PX,
        // The engine tries each side in turn and keeps the first that fits.
        //
        // Measured to the FEATURED square, the wider of the two boxes this
        // layer serves (the generic diamond would want SMALL_R + 8 = 19). A
        // name stood off a 27 px square by the 22 px a diamond of the same ink
        // wanted lands inside the square's own collision box, and the placement
        // pass then rejects it: the diamond's tip is a point, the square's
        // corner is the whole corner.
        //
        // And for the same reason the corner offset is NOT pulled in the way
        // the venue pin's is. That trick works because a diamond's edge crosses
        // the 45-degree ray at half its radius; a square's ink goes all the way
        // to (side/2, side/2), so `cornerClear` stays equal to `clear` — which
        // is nameCandidates' default, stated here because it looks like an
        // omission next to the venue layer.
        'text-variable-anchor-offset': [
          'literal',
          nameCandidates({
            clear: FEATURED_SIDE / 2 + NAME_CLEAR_PX,
            textPx: SPONSOR_NAME_TEXT_PX,
            order: NAME_ANCHOR_ORDER,
          }),
        ],
        'text-justify': 'auto',
      },
      paint: nameLabelPaint(colors.labelSponsor),
    },
    'transit-highlight'
  );
  map.addLayer(
    {
      id: 'venue-name-label',
      type: 'symbol',
      source: 'venues',
      minzoom: leaderZoom,
      filter: plainVenue,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_SEMIBOLD,
        'text-size': NAME_TEXT_PX,
        // One ordered list per venue: the order is what nameOrders worked out
        // for that pin's own surroundings, so a name that would sit on a
        // neighbour's diamond tries somewhere else first.
        'text-variable-anchor-offset': [
          'match',
          ['get', 'id'],
          ...venues.flatMap((venue, i) => [
            venue.id,
            [
              'literal',
              nameCandidates({
                clear: VENUE_R + NAME_CLEAR_PX,
                cornerClear: CORNER_CLEAR_PX,
                textPx: NAME_TEXT_PX,
                order: nameOrder.get(i) ?? NAME_ANCHOR_ORDER,
              }),
            ],
          ]),
          [
            'literal',
            nameCandidates({
              clear: VENUE_R + NAME_CLEAR_PX,
              cornerClear: CORNER_CLEAR_PX,
              textPx: NAME_TEXT_PX,
              order: NAME_ANCHOR_ORDER,
            }),
          ],
        ],
        'text-justify': 'auto',
        // Whose name survives a collision, decided rather than inherited from
        // sheet row order -- see venueNameRanks.
        'symbol-sort-key': ['get', 'sortKey'],
      },
      paint: nameLabelPaint(colors.labelVenue),
    },
    'transit-highlight'
  );
  // A displaced venue's name goes where its diamond is DRAWN, not where its
  // coordinate is (which is empty paper beside the leader line -- and for a
  // coincident pair, the same box twice, so collision would keep one name of
  // two). The lane's own outward side is still the first choice, so the name
  // reads as part of what the tether says; the rest of the way around the
  // diamond is the fallback, in the order laneNameOrder sets.
  //
  // `text-variable-anchor-offset` rather than `text-variable-anchor`, because
  // the plain variable anchor pairs one radial distance with every anchor and
  // measures it from the feature -- which for these pins is the dot, not the
  // diamond, so every candidate would land a lane's length out of place. This
  // property takes an offset per anchor, and it is data-driven (verified
  // against the vendored engine, 2026-09-04), so each lane gets its own
  // ordered list. It supersedes text-anchor, text-offset and
  // text-radial-offset on this layer; setting any of them here does nothing.
  const displacedName = (offset, order) =>
    nameCandidates({
      clear: VENUE_R + NAME_CLEAR_PX,
      cornerClear: CORNER_CLEAR_PX,
      textPx: NAME_TEXT_PX,
      order: order ?? laneNameOrder(offset),
      lane: offset,
    });
  map.addLayer(
    {
      id: 'venue-leader-name-label',
      type: 'symbol',
      source: 'venue-groups',
      minzoom: leaderZoom,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_SEMIBOLD,
        'text-size': NAME_TEXT_PX,
        // A match over the lanes for the same stringification reason as the
        // number layer above.
        // Keyed on the venue rather than on the lane, because the order now
        // depends on what is around that particular pin as well as on which way
        // its tether points -- see nameOrders.
        'text-variable-anchor-offset': [
          'match',
          ['get', 'id'],
          ...displaced.flatMap((d) => [d.venue.id, ['literal', displacedName(d.offset, nameOrder.get(d.index))]]),
          ['literal', displacedName(NO_LANE)],
        ],
        'text-justify': 'auto',
        'symbol-sort-key': ['get', 'sortKey'],
      },
      paint: nameLabelPaint(colors.labelVenue),
    },
    'transit-highlight'
  );
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
    'transit-leader-pin',
    'transit-pin',
  ];
  const LEADER_LAYERS = new Set(['venue-leader-pin', 'transit-leader-pin']);

  // Where a pin's tappable diamond is drawn, which for a displaced venue is not
  // where its coordinate is. Measuring the coordinate instead is the one hazard
  // in this treatment: the two Hamline Park venues share theirs exactly, so
  // every tap ties and resolves by whichever feature the engine enumerated
  // first -- one of the two could not be opened at all. The offset applies only
  // when a leader layer drew the pin: below the leader zoom the same displaced
  // stop draws plain, at its own coordinate.
  const drawnPoint = (feature, layer) => {
    const point = map.project(feature.geometry.coordinates);
    const { offsetX, offsetY } = feature.properties;
    return LEADER_LAYERS.has(layer) && typeof offsetX === 'number' && typeof offsetY === 'number'
      ? { x: point.x + offsetX, y: point.y + offsetY }
      : point;
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
        const p = drawnPoint(f, layer);
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
    } else if (best.layer === 'transit-pin' || best.layer === 'transit-leader-pin') {
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

/** Is `venueId` on screen as a pin of its own, rather than inside a stack? */
function pinIsDrawn(map, venueId) {
  return ['venue-pin', 'venue-leader-pin'].some(
    (layer) =>
      map.getLayer(layer) &&
      map.queryRenderedFeatures({ layers: [layer] }).some((f) => f.properties.id === venueId)
  );
}

/**
 * Moves the camera until a venue is drawn as its own tappable pin.
 *
 * Centring alone is not enough, which is what a key-list tap used to do. A
 * venue in a stack has no pin of its own to centre on: below the leader zoom
 * its coincident group draws as a single symbol, and below that supercluster
 * has whole neighbourhoods rolled into one numbered bubble. Measured
 * 2026-09-05 on a phone at the home view: 17 of 21 venues had nothing to show
 * for the tap. Never zooms out — a visitor already looking closely stays there.
 *
 * The leader zoom is the floor because that is where the displaced treatment
 * switches on: from there inward every venue in a group has a pin of its own on
 * a leader line. It happens to clear the clusters too — measured over the whole
 * sheet, the deepest floor of 21 venues is exactly the leader zoom — but that is
 * arithmetic about this data, not a guarantee. Clustering releases on its own
 * radius: a pair 60 m apart is too far apart to be a coincident group and still
 * close enough to share a bubble at the leader zoom, and the venue sheet is
 * edited by people with no reason to know that. So the camera checks its work
 * against what the engine actually drew and steps in again if it has to, by
 * whole zoom levels because that is where clustering changes.
 */
function revealPin(map, { venueId, center, floor, maxZoom }) {
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const step = (zoom) => {
    map.easeTo({ center, zoom, duration: cameraDuration(450) });
    // `idle` rather than `moveend`: symbol placement lands a frame or two after
    // the camera stops, and a query before that reports the pin as missing.
    // If it never fires, the correction is simply skipped.
    map.once('idle', () => {
      const at = map.getCenter();
      // A visitor who grabbed the map mid-flight has overruled this; leaving
      // their camera alone matters more than finishing the job.
      if (!near(at.lng, center[0]) || !near(at.lat, center[1])) return;
      if (zoom >= maxZoom || pinIsDrawn(map, venueId)) return;
      step(Math.min(maxZoom, Math.floor(zoom) + 1));
    });
  };
  step(Math.max(map.getZoom(), floor));
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
