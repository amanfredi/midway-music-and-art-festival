import { esc, showToast } from '../util.js';
import { makeProjector } from '../geo.js';
import { openVenueSheet, openVendorSheet } from './sheet.js';

// Pin sizes are in map units (1 unit = 1 meter, per CONTRACTS.md), not CSS
// pixels. Like any real map, symbols are drawn deliberately larger than true
// scale so they stay visible/tappable at the full zoomed-out view; the
// pinch/double-tap/button zoom controls exist precisely so a precise tap is
// always one zoom-in away.
const VENUE_PIN_R = 42;
const VENUE_HIT_R = 110;
const VENDOR_SIZE = 26;
const VENDOR_HIT_R = 80;
const MIN_ZOOM_FRACTION = 0.08; // how far in a user may zoom, relative to full view
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DIST = 24;
const TAP_MOVE_THRESHOLD = 10;

function vendorShapeMarkup(type) {
  if (type === 'food') return `<circle class="pin__vendor-shape" r="${VENDOR_SIZE}"></circle>`;
  if (type === 'art') return `<polygon class="pin__vendor-shape" points="0,-${VENDOR_SIZE} ${VENDOR_SIZE},${VENDOR_SIZE} ${-VENDOR_SIZE},${VENDOR_SIZE}"></polygon>`;
  return `<rect class="pin__vendor-shape" x="${-VENDOR_SIZE}" y="${-VENDOR_SIZE}" width="${VENDOR_SIZE * 2}" height="${VENDOR_SIZE * 2}"></rect>`; // retail
}

/** Wires pan (drag) + pinch-zoom + double-tap-zoom + pin/background tap dispatch onto an inlined <svg>. */
function setupInteraction(svg, original, onActivatePin) {
  let view = { ...original };
  const pointers = new Map();
  let pinchStartDist = null;
  let primaryDown = null; // {id, x, y, time} of the first pointer in a gesture
  let multiTouch = false;
  let lastTap = null; // {time, x, y}

  function apply() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  }

  function clampPan() {
    const maxX = original.x + original.w - view.w;
    const maxY = original.y + original.h - view.h;
    view.x = view.w >= original.w ? original.x : Math.min(Math.max(view.x, original.x), maxX);
    view.y = view.h >= original.h ? original.y : Math.min(Math.max(view.y, original.y), maxY);
  }

  function zoomBy(factor, focalX, focalY) {
    const aspect = original.h / original.w;
    const minW = original.w * MIN_ZOOM_FRACTION;
    const newW = Math.min(original.w, Math.max(minW, view.w * factor));
    const newH = newW * aspect;
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
    view = { ...original };
    apply();
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
      const nearMaxZoom = view.w <= original.w * MIN_ZOOM_FRACTION * 1.5;
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

  return {
    zoomIn: () => zoomBy(0.7),
    zoomOut: () => zoomBy(1 / 0.7),
    reset,
    destroy() {
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
    },
  };
}

export async function renderMap(container, content) {
  const youAreHereEnabled = content.settings.you_are_here_enabled === 'true';

  container.innerHTML = `
    <section class="view map-view">
      <h1 class="view-title">Circuit Map</h1>
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
        <h2 class="map-legend__title">Legend</h2>
        <ul class="map-legend__list">
          <li><span class="legend-swatch legend-swatch--venue">1</span> Venue</li>
          <li><span class="legend-swatch legend-swatch--food"></span> Food vendor</li>
          <li><span class="legend-swatch legend-swatch--art"></span> Art vendor</li>
          <li><span class="legend-swatch legend-swatch--retail"></span> Retail vendor</li>
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

  let projector;
  try {
    projector = makeProjector(calibration.control_points);
  } catch {
    wrap.innerHTML = `<p class="empty-state">The map calibration data is invalid.</p>`;
    return () => {};
  }

  const venues = content.venues.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  const vendors = content.vendors.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));

  const pinsMarkup = [];
  venues.forEach((v, i) => {
    const { x, y } = projector.project(v.lat, v.lng);
    pinsMarkup.push(`
      <g class="pin pin--venue" data-testid="venue-pin" data-venue-id="${esc(v.id)}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="Venue ${i + 1}: ${esc(v.name)}">
        <circle class="pin__hit" r="${VENUE_HIT_R}"></circle>
        <circle class="pin__circle" r="${VENUE_PIN_R}"></circle>
        <text class="pin__label" text-anchor="middle" dy="0.35em">${i + 1}</text>
      </g>`);
  });
  vendors.forEach((v) => {
    const { x, y } = projector.project(v.lat, v.lng);
    pinsMarkup.push(`
      <g class="pin pin--vendor pin--vendor-${esc(v.type)}" data-testid="vendor-pin" data-vendor-id="${esc(v.id)}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="${esc(v.type)} vendor: ${esc(v.name)}">
        <circle class="pin__hit" r="${VENDOR_HIT_R}"></circle>
        ${vendorShapeMarkup(v.type)}
      </g>`);
  });
  svg.insertAdjacentHTML('beforeend', pinsMarkup.join(''));

  function activatePin(pinEl) {
    if (pinEl.dataset.venueId) openVenueSheet(pinEl.dataset.venueId);
    else if (pinEl.dataset.vendorId) openVendorSheet(pinEl.dataset.vendorId);
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
  const original = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  wrap.style.aspectRatio = `${original.w} / ${original.h}`;

  const interaction = setupInteraction(svg, original, activatePin);
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
            svg.insertAdjacentHTML('beforeend', `<g class="you-are-here"><circle class="you-are-here__pulse" r="70"></circle><circle class="you-are-here__core" r="26"></circle></g>`);
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
