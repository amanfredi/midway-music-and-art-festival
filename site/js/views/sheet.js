// Bottom-sheet overlay used both by the map view (tap a pin) and event detail
// (tap the venue name) so there is exactly one venue/vendor detail surface.

import { esc } from '../util.js';
import { now as clockNow, parseEventTimes, formatTime, dateKey } from '../time.js';
import { findVenue, findVendor, eventsForVenue } from '../store.js';

function root() {
  return document.getElementById('sheet-root');
}

function escKeyHandler(ev) {
  if (ev.key === 'Escape') closeSheet();
}

function open(innerHtml) {
  const r = root();
  if (!r) return;
  r.innerHTML = `
    <div class="sheet-overlay" id="sheet-overlay">
      <div class="sheet" role="dialog" aria-modal="true">
        <button type="button" class="sheet__close" id="sheet-close" aria-label="Close">&times;</button>
        ${innerHtml}
      </div>
    </div>`;
  r.querySelector('#sheet-overlay').addEventListener('click', (ev) => {
    if (ev.target.id === 'sheet-overlay') closeSheet();
  });
  r.querySelector('#sheet-close').addEventListener('click', closeSheet);
  document.addEventListener('keydown', escKeyHandler);
  r.querySelectorAll('[data-close-sheet]').forEach((el) => el.addEventListener('click', closeSheet));
}

export function closeSheet() {
  const r = root();
  if (r) r.innerHTML = '';
  document.removeEventListener('keydown', escKeyHandler);
}

export function openVenueSheet(venueId) {
  const venue = findVenue(venueId);
  if (!venue) return;
  const todayKey = dateKey(clockNow());
  const todaysEvents = eventsForVenue(venueId)
    .filter((e) => dateKey(parseEventTimes(e).start) === todayKey)
    .sort((a, b) => a.start.localeCompare(b.start));
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`;

  open(`
    <h2 class="sheet__title">${esc(venue.name)}</h2>
    <p class="sheet__address">${esc(venue.address)}</p>
    ${venue.description ? `<p class="sheet__description">${esc(venue.description)}</p>` : ''}
    <h3 class="sheet__subtitle">Today at this venue</h3>
    ${todaysEvents.length
      ? `<ul class="sheet__event-list">${todaysEvents
          .map((e) => `<li><a class="sheet__event-link" data-close-sheet href="#/event/${esc(e.id)}">${esc(formatTime(parseEventTimes(e).start))} &mdash; ${esc(e.title)}</a></li>`)
          .join('')}</ul>`
      : '<p class="empty-state">Nothing scheduled here today.</p>'}
    <a class="btn btn--secondary" href="${esc(mapsHref)}" target="_blank" rel="noopener">Open in Google Maps</a>
  `);
}

export function openVendorSheet(vendorId) {
  const vendor = findVendor(vendorId);
  if (!vendor) return;
  open(`
    <h2 class="sheet__title">${esc(vendor.name)}</h2>
    <span class="badge badge--vendor-${esc(vendor.type)}">${esc(vendor.type)}</span>
    ${vendor.description ? `<p class="sheet__description">${esc(vendor.description)}</p>` : ''}
  `);
}
