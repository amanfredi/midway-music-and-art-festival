import { esc, showToast } from '../util.js';
import { makeProjector } from '../geo.js';
import { openVenueSheet, openSponsorSheet, openTransitSheet } from './sheet.js';

// The map SVG covers 6 x 4 miles, but the view never opens that far out. Two
// distinct rectangles matter (QA, 2026-08-08):
//
//   HOME  the square the map opens at and returns to on reset -- roughly the
//         festival footprint, centered on the SVG's own center (the bbox is
//         built around Hamline Park, see tools/make-map.mjs).
//   FULL  the SVG viewBox: the hard limit for panning and zooming out.
//
// Keeping them separate is what fixes the two complaints from QA: at the old
// default (home == full) there was nowhere to drag to, and no way to zoom out
// for context. Now the map opens pannable in every direction.
const HOME_VIEW_M = 3000; // side of the square home view, in meters
const MIN_VIEW_M = 350; // closest zoom: about a block and a half across

// Transit pins are limited to stops within this distance of the festival
// center. Widening the map to reach both downtowns pulled in 64 stops, most of
// them nowhere near the festival and unreadable as a wall of pins. 2414 m
// (1.5 miles) keeps 15 — including Raymond Avenue, the stop this round was
// asked to add — and the Green Line's route is still drawn across the whole
// map, so the line to downtown remains visible without pinning every station.
const TRANSIT_PIN_RADIUS_M = 2414;

// Pin sizes are in map units (1 unit = 1 meter, per CONTRACTS.md), not CSS
// pixels. They are authored at home-view scale and then counter-scaled as the
// user zooms (see updatePinScale), so a pin holds a constant *on-screen* size
// at every zoom level -- the behavior of every real map. Sizing them in fixed
// map units instead meant a pin swallowed the screen when zoomed in and
// vanished when zoomed out (QA, 2026-08-09).
//
// Venue pins are the dominant symbol; everything else is a step down and all
// non-venue pins are the same size. Vendor pins are gone entirely -- vendors
// moved to the #/vendors list view.
// Hit targets are diamonds, not circles, so the tappable area is the shape the
// user sees rather than a halo around it (QA, 2026-08-09). They used to be
// ~1.7x the pin and circular, which swallowed taps meant for the map or a
// neighboring pin.
//
// The radii are a little larger than the pin's (~1.26x) to offset geometry: a
// diamond of radius r has area 2r², a circle has πr², so matching the old
// radius exactly would have cut the tappable area by ~36%. At these values a
// venue's target is still ~26 CSS px across at home view on a phone. Since
// pins counter-scale with zoom, so does the hit area.
const VENUE_PIN_R = 115;
const VENUE_HIT_R = 145;
const TRANSIT_PIN_R = 92;
const TRANSIT_HIT_R = 118;
const SPONSOR_FEATURED_R = 92;
const SPONSOR_FEATURED_HIT_R = 118;
const SPONSOR_GENERIC_R = 92;
const SPONSOR_GENERIC_HIT_R = 118;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DIST = 24;
const TAP_MOVE_THRESHOLD = 10;
const KEYBOARD_PAN_FRACTION = 0.2; // how far one arrow-key press moves, relative to the current viewport

const TRANSIT_LINE_LETTER = { green: 'G', a: 'A', b: 'B' };
const TRANSIT_LINE_NAME = { green: 'METRO Green Line', a: 'METRO A Line', b: 'METRO B Line' };
const FEATURED_SPONSOR_TIERS = new Set(['emerald', 'ruby', 'sapphire']);

/** SVG polygon points for a diamond (equal-length diagonals) of "radius" r, centered on the pin's translate(). */
function diamondPoints(r) {
  return `0,${-r} ${r},0 0,${r} ${-r},0`;
}

/**
 * Transit pins carry the line letter(s) inside the diamond. Single-line stops
 * get one centered letter, same as a venue number. Multi-line stops (a
 * transfer point served by two lines) stack the letters on separate lines
 * rather than e.g. a "G/A" slash -- more legible at pin size. Design call,
 * see CONTRACTS.md / the map agent's final report for the reasoning.
 *
 * Coordinates are explicit (x="0" y="0") and vertical centering uses
 * `dominant-baseline` from CSS rather than an em-relative `dy` on the <text>.
 * The old form leaned on an implicit origin plus `dy="0.35em"` resolving
 * against a CSS-supplied font-size, which is exactly the combination WebKit
 * has historically been inconsistent about -- and a transit letter was
 * reported missing on iOS while rendering correctly in macOS Safari
 * (QA, 2026-08-09; overlap was ruled out, nearest pin was 652 m away).
 */
function transitLabelMarkup(lines) {
  if (lines.length === 1) {
    return `<text class="pin__label" x="0" y="0">${TRANSIT_LINE_LETTER[lines[0]]}</text>`;
  }
  // Stacked: first tspan lifted half a line above center, each subsequent one
  // a full line below the previous. Offsets are in map units, not em, so they
  // don't depend on how the engine resolves font-relative lengths.
  const lineHeight = 78;
  const firstOffset = -((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="0" dy="${i === 0 ? firstOffset : lineHeight}">${TRANSIT_LINE_LETTER[l]}</tspan>`)
    .join('');
  return `<text class="pin__label pin__label--stacked" x="0" y="0">${tspans}</text>`;
}

/**
 * Wires pan (drag) + pinch-zoom + double-tap-zoom + pin/background tap dispatch
 * onto an inlined <svg>.
 *
 * `full` is the SVG's own viewBox (the pan/zoom limit); `home` is the smaller
 * rectangle the map opens at and resets to.
 */
function setupInteraction(svg, full, home, onActivatePin) {
  let view = { ...home };
  const pointers = new Map();
  let pinchStartDist = null;
  let primaryDown = null; // {id, x, y, time} of the first pointer in a gesture
  let multiTouch = false;
  let lastTap = null; // {time, x, y}

  // Zooming out runs all the way to the map's full width, so the whole extent
  // -- both downtowns -- can be seen at once. Past the point where the square
  // view is taller than the map, the map is centered in it and the frame's
  // background (which matches the map's own paper color) fills above and
  // below, reading as margin rather than as a hole.
  const maxViewW = full.w;

  // Pins and map labels are authored at home-view scale; counter-scaling them
  // by how far the view has zoomed keeps them a constant size on screen, the
  // way symbols and type behave on any real map. Without this, zooming in blew
  // street names up to span a block while zooming out made pins vanish.
  // Cached so panning (which doesn't change scale) doesn't touch every node.
  const scalables = svg.querySelectorAll('.pin__scale, .map-label__scale');
  let appliedScale = null;
  let appliedLod = null;

  // Level of detail: how much of the map's labelling survives at this zoom.
  // The thresholds are view widths in meters. Wide views keep only the spine
  // names; each step in adds arterials, then their repeats, then station
  // names. See the lod rules in tools/make-map.mjs.
  function lodForView(viewW) {
    if (viewW > 7000) return 0;
    if (viewW > 3600) return 1;
    if (viewW > 1600) return 2;
    return 3;
  }

  function updateOverlayScale() {
    const scale = view.w / HOME_VIEW_M;
    const lod = lodForView(view.w);
    if (lod !== appliedLod) {
      appliedLod = lod;
      svg.dataset.lod = String(lod);
    }
    if (appliedScale !== null && Math.abs(scale - appliedScale) < 0.001) return;
    appliedScale = scale;
    const transform = `scale(${scale.toFixed(4)})`;
    for (const g of scalables) g.setAttribute('transform', transform);
  }

  function apply() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    updateOverlayScale();
  }

  function clampPan() {
    const maxX = full.x + full.w - view.w;
    const maxY = full.y + full.h - view.h;
    // Once the view is larger than the map on an axis there is nothing left to
    // pan to, so center the map on that axis instead of pinning it to an edge.
    view.x = view.w >= full.w ? full.x + (full.w - view.w) / 2 : Math.min(Math.max(view.x, full.x), maxX);
    view.y = view.h >= full.h ? full.y + (full.h - view.h) / 2 : Math.min(Math.max(view.y, full.y), maxY);
  }

  function zoomBy(factor, focalX, focalY) {
    const newW = Math.min(maxViewW, Math.max(MIN_VIEW_M, view.w * factor));
    const newH = newW; // square view
    const fx = focalX === undefined ? 0.5 : (focalX - view.x) / view.w;
    const fy = focalY === undefined ? 0.5 : (focalY - view.y) / view.h;
    view.x = (focalX ?? view.x + view.w / 2) - fx * newW;
    view.y = (focalY ?? view.y + view.h / 2) - fy * newH;
    view.w = newW;
    view.h = newH;
    clampPan();
    apply();
  }

  function reset() {
    view = { ...home };
    clampPan();
    apply();
  }

  function panBy(dx, dy) {
    view.x += dx;
    view.y += dy;
    clampPan();
    apply();
  }

  // Keyboard equivalent of drag-panning (mouse/touch drag has no keyboard
  // analogue otherwise). Step is relative to the current viewport so it stays
  // useful at any zoom level. Listening on the svg root rather than each pin
  // means arrow keys pan regardless of which focusable element inside the map
  // (a pin, or the svg itself) currently has focus.
  function onKeyDown(e) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        panBy(-view.w * KEYBOARD_PAN_FRACTION, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        panBy(view.w * KEYBOARD_PAN_FRACTION, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        panBy(0, -view.h * KEYBOARD_PAN_FRACTION);
        break;
      case 'ArrowDown':
        e.preventDefault();
        panBy(0, view.h * KEYBOARD_PAN_FRACTION);
        break;
    }
  }

  function toSvgPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    return { x: view.x + px * view.w, y: view.y + py * view.h };
  }

  function onPointerDown(e) {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      primaryDown = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now() };
      multiTouch = false;
    } else {
      multiTouch = true;
      pinchStartDist = null;
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      const rect = svg.getBoundingClientRect();
      view.x -= ((e.clientX - prev.x) / rect.width) * view.w;
      view.y -= ((e.clientY - prev.y) / rect.height) * view.h;
      clampPan();
      apply();
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      if (pinchStartDist != null && dist > 0) {
        const focal = toSvgPoint(mid.x, mid.y);
        zoomBy(pinchStartDist / dist, focal.x, focal.y);
      }
      pinchStartDist = dist;
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = null;

    if (multiTouch || !primaryDown || primaryDown.id !== e.pointerId) {
      if (pointers.size === 0) { primaryDown = null; multiTouch = false; }
      return;
    }
    const moved = Math.hypot(e.clientX - primaryDown.x, e.clientY - primaryDown.y);
    const elapsed = performance.now() - primaryDown.time;
    primaryDown = null;
    if (moved > TAP_MOVE_THRESHOLD || elapsed > 600) return;

    // e.target is unreliable here: once setPointerCapture fires (above), the
    // spec redirects event.target on subsequent pointer events to the
    // capturing element (the svg itself), not whatever is under the pointer.
    // elementFromPoint gives the real hit at the release coordinates instead.
    const hitEl = document.elementFromPoint(e.clientX, e.clientY);
    const pinEl = hitEl?.closest?.('.pin');
    if (pinEl) {
      onActivatePin(pinEl);
      lastTap = null;
      return;
    }

    const now = performance.now();
    if (lastTap && now - lastTap.time < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_DIST) {
      const focal = toSvgPoint(e.clientX, e.clientY);
      const nearMaxZoom = view.w <= MIN_VIEW_M * 1.5;
      if (nearMaxZoom) reset();
      else zoomBy(0.5, focal.x, focal.y);
      lastTap = null;
    } else {
      lastTap = { time: now, x: e.clientX, y: e.clientY };
    }
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('keydown', onKeyDown);

  // The SVG ships with the full extent as its viewBox; narrow it to the home
  // view before first paint so the map never flashes fully zoomed out.
  clampPan();
  apply();

  return {
    zoomIn: () => zoomBy(0.7),
    zoomOut: () => zoomBy(1 / 0.7),
    reset,
    destroy() {
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      svg.removeEventListener('keydown', onKeyDown);
    },
  };
}

export async function renderMap(container, content) {
  const youAreHereEnabled = content.settings.you_are_here_enabled === 'true';

  container.innerHTML = `
    <section class="view map-view">
      <!-- Heading is visually hidden by request: the map itself is the title,
           and the space it used to occupy is reserved for a future sponsor
           logo. The h1 stays in the DOM so every route still exposes exactly
           one heading for the route announcer and screen-reader navigation. -->
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
        <!-- Visually hidden by request: the four labelled swatches read as a
             legend without a heading telling you so. Kept in the DOM so the
             list still has an accessible name. -->
        <h2 class="map-legend__title sr-only">Legend</h2>
        <ul class="map-legend__list">
          <li><svg class="legend-icon legend-icon--venue" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon></svg> Venue</li>
          <li><svg class="legend-icon legend-icon--transit" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon></svg> Transit</li>
          <li><svg class="legend-icon legend-icon--sponsor-featured" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon></svg> Featured Destination</li>
          <li><svg class="legend-icon legend-icon--sponsor-generic" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,4 28,16 16,28 4,16"></polygon></svg> Sponsor</li>
        </ul>
      </div>
      ${content.settings.map_attribution ? `<p class="map-attribution">${esc(content.settings.map_attribution)}</p>` : ''}
      <h2 class="view-subtitle">Venues</h2>
      <ol class="venue-key-list" id="venue-key-list"></ol>
    </section>`;

  const wrap = container.querySelector('#map-svg-wrap');
  let svgText;
  let calibration;
  try {
    [svgText, calibration] = await Promise.all([
      fetch('assets/map.svg').then((r) => {
        if (!r.ok) throw new Error('map fetch failed');
        return r.text();
      }),
      fetch('assets/map-calibration.json').then((r) => {
        if (!r.ok) throw new Error('calibration fetch failed');
        return r.json();
      }),
    ]);
  } catch {
    wrap.innerHTML = `<p class="empty-state">The map couldn't be loaded right now. It will be available next time you're online.</p>`;
    return () => {};
  }

  // Transit pins are an informational overlay, not core map infrastructure
  // like the street SVG/calibration above -- a failed or missing fetch just
  // means no transit pins render, not a broken map view.
  let transitStops = [];
  try {
    const r = await fetch('assets/transit.json');
    if (r.ok) transitStops = (await r.json()).stops ?? [];
  } catch {
    // offline/missing transit.json: map still works without the overlay
  }

  // Inserting SVG markup into an <svg>-context element correctly namespaces
  // the children (supported in all evergreen browsers), so this is a plain
  // innerHTML assignment rather than manual createElementNS plumbing.
  wrap.innerHTML = svgText;
  const svg = wrap.querySelector('#circuit-map') || wrap.querySelector('svg');
  if (!svg) {
    wrap.innerHTML = `<p class="empty-state">The map file is invalid.</p>`;
    return () => {};
  }
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.classList.add('circuit-map-svg');
  // Pan/zoom was pointer-only (drag + pinch + the on-screen zoom buttons);
  // this makes the map itself a keyboard-operable control, panned with the
  // arrow keys once focused -- the aria-label doubles as the usage hint.
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Festival map. Use the arrow keys to pan, and the zoom buttons below to zoom in and out.');

  let projector;
  try {
    projector = makeProjector(calibration.control_points);
  } catch {
    wrap.innerHTML = `<p class="empty-state">The map calibration data is invalid.</p>`;
    return () => {};
  }

  // The map extent is anchored on the two downtowns, so its middle is NOT the
  // festival's middle. The generator emits home_center (Hamline Park's
  // projected position) alongside the control points; the viewBox center is
  // only a fallback for an older calibration file. Needed here, before the
  // pins, because transit pins are filtered by distance from it.
  const vb0 = svg.viewBox.baseVal;
  const homeCenter = calibration.home_center ?? { x: vb0.x + vb0.width / 2, y: vb0.y + vb0.height / 2 };

  const venues = content.venues.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  // Sponsor pins exist only for tiers emerald/ruby/sapphire ("Featured
  // Destination") and topaz ("Sponsor") -- quartz never gets a pin -- and
  // only when the sponsor has a location (CONTRACTS.md Map + geo contract).
  const sponsors = content.sponsors.filter(
    (s) => (FEATURED_SPONSOR_TIERS.has(s.tier_slug) || s.tier_slug === 'topaz') && Number.isFinite(s.lat) && Number.isFinite(s.lng)
  );

  // SVG paints in document order, so the array a pin lands in decides what
  // covers what where pins collide. Requested priority, lowest first:
  // transit < featured destination < sponsor < venue (QA, 2026-08-09).
  const transitPins = [];
  const featuredPins = [];
  const genericSponsorPins = [];
  const venuePins = [];

  // Every pin nests a .pin__scale group inside the positioned .pin group. The
  // outer one places the pin; the inner one carries the zoom counter-scale, so
  // resizing all pins is one attribute write per pin and never disturbs their
  // coordinates.
  venues.forEach((v, i) => {
    const { x, y } = projector.project(v.lat, v.lng);
    venuePins.push(`
      <g class="pin pin--venue" data-testid="venue-pin" data-venue-id="${esc(v.id)}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="Venue ${i + 1}: ${esc(v.name)}">
        <g class="pin__scale">
          <polygon class="pin__hit" points="${diamondPoints(VENUE_HIT_R)}"></polygon>
          <polygon class="pin__diamond" points="${diamondPoints(VENUE_PIN_R)}"></polygon>
          <text class="pin__label" x="0" y="0">${i + 1}</text>
        </g>
      </g>`);
  });
  transitStops.forEach((s) => {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || !Array.isArray(s.lines) || s.lines.length === 0) return;
    const { x, y } = projector.project(s.lat, s.lng);
    // Only stops near the festival get a pin — see TRANSIT_PIN_RADIUS_M.
    if (Math.hypot(x - homeCenter.x, y - homeCenter.y) > TRANSIT_PIN_RADIUS_M) return;
    const lineNames = s.lines.map((l) => TRANSIT_LINE_NAME[l] || l).join(', ');
    transitPins.push(`
      <g class="pin pin--transit" data-testid="transit-pin" data-transit-id="${esc(s.id)}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="${esc(s.name)}: ${esc(lineNames)}">
        <g class="pin__scale">
          <polygon class="pin__hit" points="${diamondPoints(TRANSIT_HIT_R)}"></polygon>
          <polygon class="pin__diamond" points="${diamondPoints(TRANSIT_PIN_R)}"></polygon>
          ${transitLabelMarkup(s.lines)}
        </g>
      </g>`);
  });
  sponsors.forEach((s) => {
    const featured = FEATURED_SPONSOR_TIERS.has(s.tier_slug);
    const r = featured ? SPONSOR_FEATURED_R : SPONSOR_GENERIC_R;
    const hitR = featured ? SPONSOR_FEATURED_HIT_R : SPONSOR_GENERIC_HIT_R;
    const kind = featured ? 'Featured Destination' : 'Sponsor';
    const { x, y } = projector.project(s.lat, s.lng);
    (featured ? featuredPins : genericSponsorPins).push(`
      <g class="pin pin--sponsor-${featured ? 'featured' : 'generic'}" data-testid="sponsor-pin" data-sponsor-id="${esc(s.id)}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="${kind}: ${esc(s.name)}">
        <g class="pin__scale">
          <polygon class="pin__hit" points="${diamondPoints(hitR)}"></polygon>
          <polygon class="pin__diamond" points="${diamondPoints(r)}"></polygon>
        </g>
      </g>`);
  });
  svg.insertAdjacentHTML(
    'beforeend',
    [...transitPins, ...featuredPins, ...genericSponsorPins, ...venuePins].join('')
  );

  // The "you are here" dot is created up front (idle, so invisible) rather
  // than on first fix, for two reasons: it lands last in document order so it
  // draws over every pin, and it exists before setupInteraction collects the
  // nodes it counter-scales, so the dot holds a constant on-screen size like
  // everything else instead of ballooning when zoomed in.
  if (youAreHereEnabled) {
    svg.insertAdjacentHTML(
      'beforeend',
      `<g class="you-are-here you-are-here--idle" data-testid="you-are-here">
         <g class="pin__scale">
           <circle class="you-are-here__pulse" r="192"></circle>
           <circle class="you-are-here__core" r="71"></circle>
         </g>
       </g>`
    );
  }

  const transitById = new Map(transitStops.map((s) => [s.id, s]));

  function activatePin(pinEl) {
    if (pinEl.dataset.venueId) openVenueSheet(pinEl.dataset.venueId);
    else if (pinEl.dataset.sponsorId) openSponsorSheet(pinEl.dataset.sponsorId);
    else if (pinEl.dataset.transitId) {
      const stop = transitById.get(pinEl.dataset.transitId);
      if (stop) openTransitSheet(stop, stop.lines.map((l) => TRANSIT_LINE_NAME[l] || l));
    }
  }
  svg.querySelectorAll('.pin').forEach((pinEl) => {
    pinEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activatePin(pinEl);
      }
    });
  });

  const keyList = container.querySelector('#venue-key-list');
  keyList.innerHTML = venues
    // Diamond, not a circle: this numbered badge is the key to the map pins,
    // so it should be the same shape as the thing it refers to (QA, 2026-08-09).
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

  const vb = svg.viewBox.baseVal;
  const full = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  const home = {
    x: homeCenter.x - HOME_VIEW_M / 2,
    y: homeCenter.y - HOME_VIEW_M / 2,
    w: HOME_VIEW_M,
    h: HOME_VIEW_M,
  };

  const interaction = setupInteraction(svg, full, home, activatePin);
  container.querySelector('#zoom-in').addEventListener('click', () => interaction.zoomIn());
  container.querySelector('#zoom-out').addEventListener('click', () => interaction.zoomOut());
  container.querySelector('#zoom-reset').addEventListener('click', () => interaction.reset());

  const locateBtn = container.querySelector('#locate-btn');
  if (locateBtn) {
    locateBtn.addEventListener('click', () => {
      if (!('geolocation' in navigator)) {
        showToast("This device doesn't support location.");
        return;
      }
      locateBtn.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          locateBtn.disabled = false;
          const { latitude, longitude } = pos.coords;
          const { x, y } = projector.project(latitude, longitude);
          if (x < full.x || x > full.x + full.w || y < full.y || y > full.y + full.h) {
            showToast("You're outside the map area.");
            return;
          }
          const dot = svg.querySelector('.you-are-here');
          if (!dot) return;
          dot.setAttribute('transform', `translate(${x} ${y})`);
          dot.classList.remove('you-are-here--idle');
        },
        (err) => {
          locateBtn.disabled = false;
          if (err.code === err.PERMISSION_DENIED) showToast('Location permission denied.');
          else showToast("Couldn't get your location.");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    });
  }

  return () => interaction.destroy();
}
