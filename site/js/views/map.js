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

// Transit pins are limited to stops within this distance of the festival
// center, exactly as the SVG map does it -- the extent reaches both downtowns
// and transit.json carries 64 stops.
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
// The engine reads a weight out of the FIRST family name in the stack and uses
// the whole stack as a CSS font-family. "Bold"/"Semibold" are not real
// families, so they set the weight and then fall through to the system font.
const FONT_BOLD = ['Bold,-apple-system,BlinkMacSystemFont,Helvetica'];
const FONT_SEMIBOLD = ['Semibold,-apple-system,BlinkMacSystemFont,Helvetica'];

// Pin geometry in CSS pixels. The SVG map authors pins in map units at home-view
// scale and counter-scales them on every zoom to hold a constant on-screen size;
// symbol layers are in screen pixels already, so that whole mechanism goes away.
// These are the SVG's home-view sizes: a 115-unit venue radius over a 3000 m
// view on a ~360 px frame is ~14 px.
const VENUE_R = 14;
const SMALL_R = 11;
const CLUSTER_R = 17;
// Taps are matched against a box around the touch point rather than the icon's
// own pixels, which is how the SVG map's oversized diamond hit targets are
// reproduced without inflating the icons (and their collision boxes) to match.
const TAP_SLOP_PX = 10;

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
  const mPerPixelAtZ0 = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2;
  return Math.log2((mPerPixelAtZ0 * pixels) / meters);
}

/**
 * A diamond pin as a canvas image for map.addImage(). The SVG map's pins are
 * unstroked diamonds (no white keyline) except the generic sponsor pin, which is
 * an outline; this reproduces both.
 */
function diamondImage(radius, { fill, stroke, strokeWidth = 0 }, dpr) {
  const pad = 2 + strokeWidth;
  const size = Math.ceil((radius + pad) * 2 * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const c = size / (2 * dpr);
  ctx.beginPath();
  ctx.moveTo(c, c - radius);
  ctx.lineTo(c + radius, c);
  ctx.lineTo(c, c + radius);
  ctx.lineTo(c - radius, c);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && strokeWidth) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  return { data: ctx.getImageData(0, 0, size, size), pixelRatio: dpr };
}

/**
 * The cluster symbol: three diamonds fanned behind each other, no number.
 *
 * A count here is actively misleading. Venue pins carry a venue's number from
 * the key list, so a cluster reading "3" is indistinguishable from venue 3 --
 * on the phone it was read as exactly that (Anthony, 2026-08-10). The stack
 * says "more than one venue, zoom or tap" using the same diamond vocabulary,
 * and numbers stay the exclusive property of individual venue pins.
 */
function clusterImage(radius, { fill, stroke }, dpr) {
  const offset = Math.round(radius * 0.34);
  const strokeWidth = 2;
  const pad = 2 + strokeWidth + offset * 2;
  const size = Math.ceil((radius + pad) * 2 * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const c = size / (2 * dpr);

  const diamond = (cx, cy, r) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  };

  // Back to front. Each rear diamond is outlined in the surface color so the
  // stack reads as separate sheets rather than one blurred blob.
  for (const [dx, dy] of [
    [offset, -offset],
    [offset / 2, -offset / 2],
    [0, 0],
  ]) {
    diamond(c + dx, c + dy, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  return { data: ctx.getImageData(0, 0, size, size), pixelRatio: dpr };
}

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
          <li><svg class="legend-icon legend-icon--sponsor-featured" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon></svg> Featured Destination</li>
          <li><svg class="legend-icon legend-icon--sponsor-generic" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,4 28,16 16,28 4,16"></polygon></svg> Sponsor</li>
        </ul>
      </div>
      ${content.settings.map_attribution ? `<p class="map-attribution">${esc(content.settings.map_attribution)}</p>` : ''}
      <h2 class="view-subtitle">Venues</h2>
      <ol class="venue-key-list" id="venue-key-list"></ol>
    </section>`;

  // Tapping another tab mid-load wipes #view while these awaits are in flight;
  // every DOM reference is re-queried through here and a null answer ends the
  // render, so nothing lands in a detached tree.
  const mapWrap = () => (generation === renderGeneration ? container.querySelector('#map-svg-wrap') : null);

  const venues = content.venues.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  renderVenueKeyList(container, venues);

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

  wrap.innerHTML = '<div class="map-gl" id="map-gl" data-testid="map-canvas"></div>';
  const glHost = wrap.querySelector('#map-gl');
  const colors = resolveMapColors(glHost);

  const { Map: MlMap, LngLatBounds, Marker } = engine;

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

  const transitById = new Map(stops.map((s) => [s.id, s]));

  map.on('load', () => {
    if (generation !== renderGeneration) return;
    addPins(map, engine, { venues, stops, content, home, clusterMaxZoom, colors });
    wirePinTaps(map, { venues, transitById, content, maxZoom });
  });

  wireControls(container, map, { home, homeZoom, maxZoom, cleanupFns });
  if (youAreHereEnabled) {
    wireLocate(container, map, Marker, { west, east, south, north, cleanupFns });
  }

  return cleanup;
}

function renderVenueKeyList(container, venues) {
  const keyList = container.querySelector('#venue-key-list');
  keyList.innerHTML = venues
    .map(
      (v, i) => `<li class="venue-key-item"><button type="button" class="venue-key-btn" data-venue-id="${esc(v.id)}">
        <svg class="venue-key-btn__pin" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <polygon points="16,1 31,16 16,31 1,16"></polygon>
          <text x="16" y="16">${i + 1}</text>
        </svg>${esc(v.name)}</button></li>`
    )
    .join('');
  keyList.querySelectorAll('.venue-key-btn').forEach((btn) => {
    btn.addEventListener('click', () => openVenueSheet(btn.dataset.venueId));
  });
}

function addPins(map, engine, { venues, stops, content, home, clusterMaxZoom, colors }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  map.addImage('pin-venue', diamondImage(VENUE_R, { fill: colors.venue }, dpr).data, { pixelRatio: dpr });
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

  const homeSvgDistanceOk = makeTransitFilter(home);

  map.addSource('venues', {
    type: 'geojson',
    cluster: true,
    clusterRadius: 26,
    clusterMaxZoom,
    data: {
      type: 'FeatureCollection',
      features: venues.map((v, i) => ({
        type: 'Feature',
        properties: { id: v.id, label: String(i + 1), name: v.name },
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      })),
    },
  });

  map.addSource('transit', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: stops
        .filter(
          (s) =>
            Number.isFinite(s.lat) &&
            Number.isFinite(s.lng) &&
            Array.isArray(s.lines) &&
            s.lines.length > 0 &&
            homeSvgDistanceOk(s.lat, s.lng)
        )
        .map((s) => ({
          type: 'Feature',
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

  // Sponsor pins exist only for emerald/ruby/sapphire ("Featured Destination")
  // and topaz ("Sponsor") -- quartz never gets one -- and only with a location.
  const sponsors = content.sponsors.filter(
    (s) =>
      (FEATURED_SPONSOR_TIERS.has(s.tier_slug) || s.tier_slug === 'topaz') &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng)
  );
  map.addSource('sponsors', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: sponsors.map((s) => ({
        type: 'Feature',
        properties: { id: s.id, featured: FEATURED_SPONSOR_TIERS.has(s.tier_slug) },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    },
  });

  // Layer order IS paint order, lowest first: transit, featured destination,
  // sponsor, venue -- the priority the SVG map gets from document order.
  // allow-overlap/ignore-placement keep every pin drawn: MapLibre's collision
  // handling HIDES the loser, which would be worse than today's overlap. What
  // stops venues piling up is the clustering above, not collision.
  const pinLayout = { 'icon-allow-overlap': true, 'icon-ignore-placement': true };
  const labelLayout = {
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-font': FONT_BOLD,
  };

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
    filter: ['has', 'point_count'],
    // No text of any kind: see clusterImage(). The stacked glyph carries the
    // meaning, and a digit here would read as a venue number.
    layout: { ...pinLayout, 'icon-image': 'pin-cluster' },
  });
  map.addLayer({
    id: 'venue-pin',
    type: 'symbol',
    source: 'venues',
    filter: ['!', ['has', 'point_count']],
    layout: {
      ...pinLayout,
      ...labelLayout,
      'icon-image': 'pin-venue',
      'text-field': ['get', 'label'],
      'text-size': 14,
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

function wirePinTaps(map, { venues, transitById, content, maxZoom }) {
  const venueById = new Map(venues.map((v) => [v.id, v]));
  // Topmost first, so an overlap resolves the way the SVG map's paint order does.
  const PIN_LAYERS = ['venue-pin', 'venue-cluster', 'sponsor-generic-pin', 'sponsor-featured-pin', 'transit-pin'];

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
        const p = map.project(f.geometry.coordinates);
        const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
        if (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && i < best.rank)) {
          best = { layer, feature: f, d, rank: i };
        }
      }
    }
    if (!best) return;

    if (best.layer === 'venue-pin') openVenueSheet(best.feature.properties.id);
    else if (best.layer === 'venue-cluster') expandCluster(map, best.feature, { venueById, maxZoom });
    else if (best.layer === 'transit-pin') openTransit(best.feature.properties.id);
    else openSponsorSheet(best.feature.properties.id);
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
 * either way. That case is the whole reason the overlapping-pin item was open.
 */
function expandCluster(map, feature, { venueById, maxZoom }) {
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
        if (err.code === err.PERMISSION_DENIED) showToast('Location permission denied.');
        else showToast("Couldn't get your location.");
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
