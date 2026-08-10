// SPIKE (maplibre-spike branch): the #/map tab rendered by MapLibre GL JS 6
// instead of the hand-rolled inline-SVG map. Everything around it -- the shell,
// routes, venue data, sheets, the venue key list -- is untouched, so the two
// implementations can be compared side by side on a real phone.
//
// Two ground modes, chosen with a `map` query param on the page URL (the same
// place the demo clock's `?t=` lives, so the two compose: `?t=...&map=raster`):
//
//   ?map=vector  (default) streets, transit and labels as engine-styled vector
//                layers from assets/map-vector.geojson -- the same OSM source
//                data make-map.mjs bakes into map.svg. Labels are symbol layers,
//                so the engine re-places them at every zoom.
//   ?map=raster  a four-corner georeferenced ImageSource carrying a rasterized
//                map.svg, standing in for commissioned artwork. Same pins on top.
//   ?map=hybrid  the raster ground with the engine's street labels drawn over
//                it. Not in the spike brief; it costs five lines and it is the
//                configuration the deferred "artwork with no baked lettering"
//                question is actually asking about.
//
// The corner coordinates for the raster come from geo.js's projector, inverted
// -- so Mode B is a live test of the georeferencing story the artist constraint
// depends on, not a hand-tuned placement.

import { esc, showToast } from '../util.js';
import { makeProjector } from '../geo.js';
import { openVenueSheet, openSponsorSheet, openTransitSheet, openPickerSheet } from './sheet.js';

// View widths, in meters across the map frame, converted to MapLibre zooms at
// runtime once the frame's pixel width is known.
//
// HOME (3000 m) and the full extent match the hand-rolled map exactly. The
// closest zoom does NOT: the SVG map stops at 350 m across, and at that scale
// two venues 14 m apart are still only ~15 px apart -- closer than one pin is
// wide. No amount of collision handling fixes a zoom range that never separates
// the points, so the spike opens the ceiling to 120 m. This is a deliberate
// deviation from parity, and it is the thing to look at first on the phone.
const HOME_VIEW_M = 3000;
const MIN_VIEW_M = 120;

// Transit pins are limited to stops within this distance of the festival
// center, exactly as the SVG map does it -- the extent reaches both downtowns
// and transit.json carries 64 stops.
const TRANSIT_PIN_RADIUS_M = 2414;

const TRANSIT_LINE_LETTER = { green: 'G', a: 'A', b: 'B' };
const TRANSIT_LINE_NAME = { green: 'METRO Green Line', a: 'METRO A Line', b: 'METRO B Line' };
const FEATURED_SPONSOR_TIERS = new Set(['emerald', 'ruby', 'sapphire']);

// Brand colors, lifted from the SVG map's own stylesheet so both grounds and
// both implementations agree.
const PAPER = '#eeeeec';
const WATER = '#bcd2de';
const PIN_VENUE = '#10577b';
const PIN_TRANSIT = '#298d4e';
const PIN_SPONSOR = '#a11f22';

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
function groundLayersVector() {
  return [
    { id: 'paper', type: 'background', paint: { 'background-color': PAPER } },
    {
      id: 'water-line',
      type: 'line',
      source: 'mapdata',
      filter: ['==', ['get', 'kind'], 'water-line'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': WATER, 'line-width': widthByZoom(3, 9.5, 26) },
    },
    {
      id: 'water-area',
      type: 'fill',
      source: 'mapdata',
      filter: ['==', ['get', 'kind'], 'water-area'],
      paint: { 'fill-color': WATER },
    },
    // Casing under fill for each road tier, matching the SVG's two-stroke roads.
    {
      id: 'motorway-casing',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'motorway']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#b4b4b2', 'line-width': widthByZoom(3.5, 9, 22), 'line-opacity': 0.6 },
    },
    {
      id: 'motorway-fill',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'motorway']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#d9d9d9', 'line-width': widthByZoom(2.5, 7, 18), 'line-opacity': 0.6 },
    },
    {
      id: 'arterial-casing',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'arterial']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#c4c4c2', 'line-width': widthByZoom(2.5, 7, 17) },
    },
    {
      id: 'arterial-fill',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'arterial']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#dedede', 'line-width': widthByZoom(1.6, 5.2, 13) },
    },
    {
      id: 'spine-casing',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'spine']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#a8a8a6', 'line-width': widthByZoom(3.5, 9.5, 24) },
    },
    {
      id: 'spine-fill',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'street'], ['==', ['get', 'tier'], 'spine']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#cfcfcf', 'line-width': widthByZoom(2.6, 7.8, 20) },
    },
    // One thick solid stroke per line, not two thin dashed ones: each direction
    // is a separate OSM way, so thin dashes read as two railways.
    {
      id: 'rail-green',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'rail'], ['==', ['get', 'line'], 'green']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2f7d4f', 'line-width': widthByZoom(2, 4.2, 9) },
    },
    {
      id: 'rail-blue',
      type: 'line',
      source: 'mapdata',
      filter: ['all', ['==', ['get', 'kind'], 'rail'], ['==', ['get', 'line'], 'blue']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2b5fa8', 'line-width': widthByZoom(2, 4.2, 9) },
    },
    {
      id: 'station-dot',
      type: 'circle',
      source: 'mapdata',
      filter: ['==', ['get', 'kind'], 'station'],
      paint: {
        'circle-radius': widthByZoom(2, 4, 7),
        'circle-color': '#ffffff',
        'circle-stroke-color': '#4a4a4a',
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
function labelLayers() {
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
      paint: { 'text-color': '#565654', 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
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
      paint: { 'text-color': '#3d5c4d', 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
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
      paint: { 'text-color': '#3f3f3f', 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
    },
  ];
}

/** The raster ground: today's map.svg, rasterized, placed by four corners. */
function groundLayersRaster() {
  return [
    { id: 'paper', type: 'background', paint: { 'background-color': PAPER } },
    { id: 'artwork', type: 'raster', source: 'artwork', paint: { 'raster-fade-duration': 0 } },
  ];
}

const NO_CLEANUP = () => {};
let renderGeneration = 0;

export async function renderMap(container, content) {
  const generation = ++renderGeneration;
  const youAreHereEnabled = content.settings.you_are_here_enabled === 'true';
  const mode = pickMode();

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
      <p class="map-mode-note">Ground: <strong>${esc(mode)}</strong> (MapLibre spike &mdash; switch with <code>?map=vector</code>, <code>?map=raster</code>, <code>?map=hybrid</code>)</p>
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

  wrap.innerHTML = '<div class="map-gl" id="map-gl"></div>';
  const glHost = wrap.querySelector('#map-gl');

  const { Map: MlMap, LngLatBounds, Marker } = engine;

  const sources = {};
  let layers;
  if (mode === 'vector') {
    // The URL, not a parsed object: MapLibre hands it to the worker, so 2.6 MB
    // of GeoJSON is fetched (from the service-worker cache, offline) and parsed
    // off the main thread.
    sources.mapdata = { type: 'geojson', data: 'assets/map-vector.geojson' };
    layers = [...groundLayersVector(), ...labelLayers()];
  } else {
    sources.artwork = { type: 'image', url: 'assets/map-raster.webp', coordinates: [nw, ne, se, sw] };
    layers = groundLayersRaster();
    if (mode === 'hybrid') {
      sources.mapdata = { type: 'geojson', data: 'assets/map-vector.geojson' };
      layers = [...layers, ...labelLayers()];
    }
  }

  const map = new MlMap({
    container: glHost,
    style: { version: 8, sources, layers },
    center: home,
    zoom: homeZoom,
    minZoom,
    maxZoom,
    maxBounds: new LngLatBounds([west, south], [east, north]),
    // North-up, like the SVG map and like the artwork Mode B stands in for.
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

  // Spike-only handle: lets the verification pass drive the real map object,
  // and lets Anthony poke at it from Safari's inspector during the audition.
  // It is not one of the contract's test hooks and would not survive adoption.
  window.__spikeMap = map;

  const cleanupFns = [];
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    if (window.__spikeMap === map) delete window.__spikeMap;
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
    addPins(map, engine, { venues, stops, content, home, clusterMaxZoom });
    wirePinTaps(map, { venues, transitById, content, maxZoom });
  });

  wireControls(container, map, { home, homeZoom, maxZoom, cleanupFns });
  if (youAreHereEnabled) {
    wireLocate(container, map, Marker, { west, east, south, north, cleanupFns });
  }

  return cleanup;
}

/** `?map=` on the page URL, alongside the demo clock's `?t=`. */
function pickMode() {
  const value = new URLSearchParams(location.search).get('map');
  return value === 'raster' || value === 'hybrid' ? value : 'vector';
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

function addPins(map, engine, { venues, stops, content, home, clusterMaxZoom }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  map.addImage('pin-venue', diamondImage(VENUE_R, { fill: PIN_VENUE }, dpr).data, { pixelRatio: dpr });
  map.addImage('pin-cluster', diamondImage(CLUSTER_R, { fill: PIN_VENUE }, dpr).data, { pixelRatio: dpr });
  map.addImage('pin-transit', diamondImage(SMALL_R, { fill: PIN_TRANSIT }, dpr).data, { pixelRatio: dpr });
  map.addImage('pin-sponsor-featured', diamondImage(SMALL_R, { fill: PIN_SPONSOR }, dpr).data, { pixelRatio: dpr });
  // Generic sponsor pins are outlined rather than filled, as in the SVG map.
  map.addImage(
    'pin-sponsor-generic',
    diamondImage(SMALL_R, { fill: '#ffffff', stroke: PIN_SPONSOR, strokeWidth: 3 }, dpr).data,
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
    layout: {
      ...pinLayout,
      ...labelLayout,
      'icon-image': 'pin-cluster',
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 15,
    },
    paint: { 'text-color': '#ffffff' },
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

  // The engine's own double-tap zooms in; the SVG map additionally sends a
  // double-tap at maximum zoom back to the home view, which is the only way out
  // of a close view without pinching. Kept.
  const onDblClick = (e) => {
    if (map.getZoom() < maxZoom - 0.05) return;
    e.preventDefault();
    map.easeTo({ center: home, zoom: homeZoom, duration: 400 });
  };
  map.on('dblclick', onDblClick);
  cleanupFns.push(() => map.off('dblclick', onDblClick));
}

function wireLocate(container, map, Marker, { west, east, south, north, cleanupFns }) {
  const locateBtn = container.querySelector('#locate-btn');
  if (!locateBtn) return;
  let marker = null;

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
