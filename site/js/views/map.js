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

// Pin sizes are in map units (1 unit = 1 meter, per CONTRACTS.md), not CSS
// pixels, so their on-screen size depends on how much map is in view. These
// are tuned for the home view on a phone, where the pins were previously too
// small to read or tap; they share the SCALE factor used for street widths and
// labels in tools/make-map.mjs.
//
// All three pin types (CONTRACTS.md pin table) are diamonds, sized per type:
// venue and "Featured Destination" sponsors are the visually dominant pins;
// transit and generic sponsors are a step down. Vendor pins are gone
// entirely -- vendors moved to the #/vendors list view.
const VENUE_PIN_R = 115;
const VENUE_HIT_R = 190;
const TRANSIT_PIN_R = 92;
const TRANSIT_HIT_R = 155;
const SPONSOR_FEATURED_R = 130;
const SPONSOR_FEATURED_HIT_R = 210;
const SPONSOR_GENERIC_R = 92;
const SPONSOR_GENERIC_HIT_R = 155;
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
 */
function transitLabelMarkup(lines) {
  if (lines.length === 1) {
    return `<text class="pin__label" dy="0.35em">${TRANSIT_LINE_LETTER[lines[0]]}</text>`;
  }
  const lineHeightEm = 1.05;
  const tspans = lines
    .map((l, i) => `<tspan x="0" dy="${i === 0 ? -((lines.length - 1) * lineHeightEm) / 2 + 0.32 : lineHeightEm}em">${TRANSIT_LINE_LETTER[l]}</tspan>`)
    .join('');
  return `<text class="pin__label pin__label--stacked">${tspans}</text>`;
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

  // The view is square (the map frame is square, so this avoids letterboxing);
  // zooming out therefore stops when the square would exceed the shorter side
  // of the map. Panning east-west covers the rest of the 6-mile width.
  const maxViewW = Math.min(full.w, full.h);

  function apply() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  }

  function clampPan() {
    const maxX = full.x + full.w - view.w;
    const maxY = full.y + full.h - view.h;
    view.x = view.w >= full.w ? full.x : Math.min(Math.max(view.x, full.x), maxX);
    view.y = view.h >= full.h ? full.y : Math.min(Math.max(view.y, full.y), maxY);
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

  // The SVG ships with the full 6x4-mile viewBox; narrow it to the home view
  // before first paint so the map never flashes fully zoomed out.
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
          <li><svg class="legend-icon legend-icon--venue" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,2 30,16 16,30 2,16"></polygon><text x="16" y="16" dy="0.35em" text-anchor="middle">1</text></svg> Venue</li>
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

  const venues = content.venues.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  // Sponsor pins exist only for tiers emerald/ruby/sapphire ("Featured
  // Destination") and topaz ("Sponsor") -- quartz never gets a pin -- and
  // only when the sponsor has a location (CONTRACTS.md Map + geo contract).
  const sponsors = content.sponsors.filter(
    (s) => (FEATURED_SPONSOR_TIERS.has(s.tier_slug) || s.tier_slug === 'topaz') && Number.isFinite(s.lat) && Number.isFinite(s.lng)
  );

  const pinsMarkup = [];
  venues.forEach((v, i) => {
    const { x, y } = projector.project(v.lat, v.lng);
    pinsMarkup.push(`
      <g class="pin pin--venue" data-testid="venue-pin" data-venue-id="${esc(v.id)}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="Venue ${i + 1}: ${esc(v.name)}">
        <circle class="pin__hit" r="${VENUE_HIT_R}"></circle>
        <polygon class="pin__diamond" points="${diamondPoints(VENUE_PIN_R)}"></polygon>
        <text class="pin__label" dy="0.35em">${i + 1}</text>
      </g>`);
  });
  transitStops.forEach((s) => {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || !Array.isArray(s.lines) || s.lines.length === 0) return;
    const { x, y } = projector.project(s.lat, s.lng);
    const lineNames = s.lines.map((l) => TRANSIT_LINE_NAME[l] || l).join(', ');
    pinsMarkup.push(`
      <g class="pin pin--transit" data-testid="transit-pin" data-transit-id="${esc(s.id)}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="${esc(s.name)}: ${esc(lineNames)}">
        <circle class="pin__hit" r="${TRANSIT_HIT_R}"></circle>
        <polygon class="pin__diamond" points="${diamondPoints(TRANSIT_PIN_R)}"></polygon>
        ${transitLabelMarkup(s.lines)}
      </g>`);
  });
  sponsors.forEach((s) => {
    const featured = FEATURED_SPONSOR_TIERS.has(s.tier_slug);
    const r = featured ? SPONSOR_FEATURED_R : SPONSOR_GENERIC_R;
    const hitR = featured ? SPONSOR_FEATURED_HIT_R : SPONSOR_GENERIC_HIT_R;
    const kind = featured ? 'Featured Destination' : 'Sponsor';
    const { x, y } = projector.project(s.lat, s.lng);
    pinsMarkup.push(`
      <g class="pin pin--sponsor-${featured ? 'featured' : 'generic'}" data-testid="sponsor-pin" data-sponsor-id="${esc(s.id)}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="${kind}: ${esc(s.name)}">
        <circle class="pin__hit" r="${hitR}"></circle>
        <polygon class="pin__diamond" points="${diamondPoints(r)}"></polygon>
      </g>`);
  });
  svg.insertAdjacentHTML('beforeend', pinsMarkup.join(''));

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
    .map((v, i) => `<li class="venue-key-item"><button type="button" class="venue-key-btn" data-venue-id="${esc(v.id)}"><span class="venue-key-btn__num">${i + 1}</span> ${esc(v.name)}</button></li>`)
    .join('');
  keyList.querySelectorAll('.venue-key-btn').forEach((btn) => {
    btn.addEventListener('click', () => openVenueSheet(btn.dataset.venueId));
  });

  const vb = svg.viewBox.baseVal;
  const full = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  // The bbox is built symmetrically around Hamline Park (tools/make-map.mjs),
  // so the SVG's own center is the festival's center; the home view is a
  // square of HOME_VIEW_M around it. The frame's aspect ratio is fixed square
  // in CSS, so no aspectRatio is set from the SVG here.
  const home = {
    x: full.x + full.w / 2 - HOME_VIEW_M / 2,
    y: full.y + full.h / 2 - HOME_VIEW_M / 2,
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
          if (x < original.x || x > original.x + original.w || y < original.y || y > original.y + original.h) {
            showToast("You're outside the map area.");
            return;
          }
          let dot = svg.querySelector('.you-are-here');
          if (!dot) {
            svg.insertAdjacentHTML('beforeend', `<g class="you-are-here"><circle class="you-are-here__pulse" r="192"></circle><circle class="you-are-here__core" r="71"></circle></g>`);
            dot = svg.querySelector('.you-are-here');
          }
          dot.setAttribute('transform', `translate(${x} ${y})`);
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
