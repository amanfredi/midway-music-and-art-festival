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

// Safari has no beforeinstallprompt API, so the install button opens this
// instead: the same steps a person would find under Safari's Share button,
// kept in-page because the site has no external links to send them to
// (offline-first).
//
// Drawn, not linked: Apple's share glyph is what the toolbar actually shows,
// and "tap the Share button" is much easier to follow next to the icon. It's
// inline SVG because the site ships no external assets at all.
const SHARE_GLYPH = `
  <svg class="inline-glyph" viewBox="0 0 24 24" width="18" height="18" role="img" aria-label="Share" focusable="false">
    <path d="M8.5 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10h-2"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M12 14.5V3.5M8.5 7 12 3.5 15.5 7"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

// macOS Safari installs to the Dock, iOS to the Home Screen — different menu
// item, different verb. See pwa-install.js#safariFlavor for how they're told
// apart.
const INSTALL_STEPS = {
  ios: {
    lead: 'Add Midway Music &amp; Arts Fest to your Home Screen for quicker access and better offline support:',
    steps: [
      `Tap the ${SHARE_GLYPH} <strong>Share</strong> button in Safari's toolbar.`,
      'Scroll down and tap <strong>Add to Home Screen</strong>.',
      'Tap <strong>Add</strong> in the top-right corner.',
    ],
  },
  macos: {
    lead: 'Add Midway Music &amp; Arts Fest to your Dock for quicker access and better offline support:',
    steps: [
      `Click the ${SHARE_GLYPH} <strong>Share</strong> button in Safari's toolbar.`,
      'Choose <strong>Add to Dock</strong>.',
      'Click <strong>Add</strong>.',
    ],
  },
};

export function openInstallInstructionsSheet(flavor = 'ios') {
  const copy = INSTALL_STEPS[flavor] ?? INSTALL_STEPS.ios;
  open(`
    <h2 class="sheet__title" id="sheet-title">Install this app</h2>
    <p class="sheet__description">${copy.lead}</p>
    <ol class="sheet__steps">
      ${copy.steps.map((s) => `<li>${s}</li>`).join('')}
    </ol>
  `);
}

/**
 * Transit stops used to be informational pins with no detail view. They now
 * open a sheet like venues and sponsors do (QA, 2026-08-08).
 *
 * The only fact transit.json carries beyond position is which lines serve the
 * stop, so that is what the sheet says — no invented blurbs. One maps link,
 * not one per line: a transfer point like Snelling & University is four
 * separate stop records in Google Maps, and four links to the same
 * intersection would be worse than one.
 */
export function openTransitSheet(stop, lineNames) {
  if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=walking`;
  open(`
    <h2 class="sheet__title" id="sheet-title">${esc(stop.name)}</h2>
    <h3 class="sheet__subtitle">${lineNames.length > 1 ? 'Lines served' : 'Line served'}</h3>
    <ul class="sheet__line-list">
      ${lineNames.map((n) => `<li>${esc(n)}</li>`).join('')}
    </ul>
    <a class="btn btn--secondary" href="${esc(mapsHref)}" target="_blank" rel="noopener">Open in Google Maps</a>
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
