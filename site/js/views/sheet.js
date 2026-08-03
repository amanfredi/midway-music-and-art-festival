// Bottom-sheet overlay used both by the map view (tap a pin) and event detail
// (tap the venue name) so there is exactly one venue/vendor detail surface.

import { esc } from '../util.js';
import { now as clockNow, parseEventTimes, formatTime, dateKey } from '../time.js';
import { findVenue, findSponsor, eventsForVenue } from '../store.js';

function root() {
  return document.getElementById('sheet-root');
}

function escKeyHandler(ev) {
  if (ev.key === 'Escape') closeSheet();
}

// The element focused right before a sheet opens (the pin/button that
// triggered it), so closeSheet() can return focus there.
let triggerEl = null;

function open(innerHtml) {
  const r = root();
  if (!r) return;
  triggerEl = document.activeElement;
  r.innerHTML = `
    <div class="sheet-overlay" id="sheet-overlay">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
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
  // Focus the dialog itself (not the close button): its aria-labelledby
  // announces the sheet's title first, before a screen reader user tabs into
  // its content.
  r.querySelector('.sheet').focus();
}

export function closeSheet() {
  const r = root();
  const wasOpen = !!(r && r.innerHTML);
  if (r) r.innerHTML = '';
  document.removeEventListener('keydown', escKeyHandler);
  if (wasOpen && triggerEl && typeof triggerEl.focus === 'function' && document.contains(triggerEl)) {
    triggerEl.focus();
  }
  triggerEl = null;
}

export function openVenueSheet(venueId) {
  const venue = findVenue(venueId);
  if (!venue) return;
  const todayKey = dateKey(clockNow());
  const todaysEvents = eventsForVenue(venueId)
    .filter((e) => dateKey(parseEventTimes(e).start) === todayKey)
    .sort((a, b) => a.start.localeCompare(b.start));
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}&travelmode=walking`;

  open(`
    <h2 class="sheet__title" id="sheet-title">${esc(venue.name)}</h2>
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

// iOS Safari has no beforeinstallprompt API, so the install button opens
// this instead: the same steps a person would find under Safari's Share
// button, kept in-page because the site has no external links to send them
// to (offline-first).
export function openInstallInstructionsSheet() {
  open(`
    <h2 class="sheet__title" id="sheet-title">Install this app</h2>
    <p class="sheet__description">Add the Circuit Map to your Home Screen for quicker access and better offline support:</p>
    <ol class="sheet__steps">
      <li>Tap the <strong>Share</strong> button in Safari's toolbar.</li>
      <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
      <li>Tap <strong>Add</strong> in the top-right corner.</li>
    </ol>
  `);
}

export function openSponsorSheet(sponsorId) {
  const sponsor = findSponsor(sponsorId);
  if (!sponsor || !Number.isFinite(sponsor.lat) || !Number.isFinite(sponsor.lng)) return;
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${sponsor.lat},${sponsor.lng}&travelmode=walking`;
  open(`
    <h2 class="sheet__title" id="sheet-title">${esc(sponsor.name)}</h2>
    ${sponsor.blurb ? `<p class="sheet__description">${esc(sponsor.blurb)}</p>` : ''}
    <a class="btn btn--secondary" href="${esc(mapsHref)}" target="_blank" rel="noopener">Open in Google Maps</a>
  `);
}
