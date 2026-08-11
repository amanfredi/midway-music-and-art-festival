// Bottom-sheet overlay used both by the map view (tap a pin) and event detail
// (tap the venue name) so there is exactly one venue/vendor detail surface.

import { esc, mapsDirectionsHref, safeHref, NEW_TAB_HINT } from '../util.js';
import { now as clockNow, parseEventTimes, formatTime, dateKey } from '../time.js';
import { findVenue, findSponsor, eventsForVenue } from '../store.js';

function root() {
  return document.getElementById('sheet-root');
}

function currentDialog() {
  const r = root();
  return r ? r.querySelector('dialog.sheet') : null;
}

// A modal <dialog>'s ::backdrop reports the dialog itself as the event target,
// so a target check alone would also close on clicks in the sheet's own
// padding; the coordinates are what tell backdrop and sheet apart.
function onBackdropClick(ev) {
  const dialog = ev.currentTarget;
  if (ev.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  const outside =
    ev.clientX < box.left || ev.clientX > box.right || ev.clientY < box.top || ev.clientY > box.bottom;
  if (outside) dialog.close();
}

// showModal() is what supplies the focus trap, background inertness, scroll
// lock and Escape-to-close; all four were previously missing or hand-rolled.
function open(innerHtml) {
  const r = root();
  if (!r) return;
  closeSheet();
  // The pin/button that opened the sheet, so focus can return there on close.
  const trigger = document.activeElement;
  r.innerHTML = `
    <dialog class="sheet" role="dialog" aria-labelledby="sheet-title" tabindex="-1">
      <button type="button" class="sheet__close" id="sheet-close" aria-label="Close">&times;</button>
      ${innerHtml}
    </dialog>`;
  const dialog = r.querySelector('dialog.sheet');
  dialog.addEventListener('click', onBackdropClick);
  dialog.addEventListener('close', () => {
    dialog.remove();
    // The browser's own focus restore doesn't fire for an opener that a route
    // change has since removed; handleRoute() focuses #view in that case.
    if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) trigger.focus();
  });
  r.querySelector('#sheet-close').addEventListener('click', () => dialog.close());
  r.querySelectorAll('[data-close-sheet]').forEach((el) => el.addEventListener('click', () => dialog.close()));
  dialog.showModal();
  // Focus the dialog itself (not the close button showModal would pick): its
  // aria-labelledby announces the sheet's title first, before a screen reader
  // user tabs into its content.
  dialog.focus();
}

export function closeSheet() {
  const dialog = currentDialog();
  if (!dialog) return;
  // close() fires its event asynchronously; the sheet leaves the DOM now so
  // the next render never sees a stale one.
  dialog.close();
  dialog.remove();
}

export function openVenueSheet(venueId) {
  const venue = findVenue(venueId);
  if (!venue) return;
  const todayKey = dateKey(clockNow());
  const todaysEvents = eventsForVenue(venueId)
    .filter((e) => dateKey(parseEventTimes(e).start) === todayKey)
    .sort((a, b) => a.start.localeCompare(b.start));
  const mapsHref = mapsDirectionsHref(venue.lat, venue.lng);
  const websiteHref = safeHref(venue.url);

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
    <div class="sheet__actions">
      ${mapsHref ? `<a class="btn btn--secondary" href="${esc(mapsHref)}" target="_blank" rel="noopener">Open in Google Maps${NEW_TAB_HINT}</a>` : ''}
      ${websiteHref ? `<a class="btn btn--secondary" href="${esc(websiteHref)}" target="_blank" rel="noopener">Visit venue website${NEW_TAB_HINT}</a>` : ''}
    </div>
  `);
}

// SPIKE (maplibre-spike branch). Disambiguation for pins that no amount of
// zooming can pull apart. Clustering separates venues that are merely close --
// tap the cluster, the map zooms until they're distinct -- but two venues in
// the sheet share identical coordinates (Hamline Park and Mosaic on a Stick),
// and coincident points have no expansion zoom. Without this the pin
// underneath stays unreachable on the map, which is the exact gap the engine
// was auditioned to close.
export function openPickerSheet(title, items, onPick) {
  if (!items.length) return;
  open(`
    <h2 class="sheet__title" id="sheet-title">${esc(title)}</h2>
    <p class="sheet__address">These are at the same spot on the map. Pick one:</p>
    <ul class="sheet__event-list">
      ${items
        .map(
          (it, i) =>
            `<li><button type="button" class="sheet__event-link sheet__picker-btn" data-pick="${i}">${esc(it.label)}</button></li>`
        )
        .join('')}
    </ul>
  `);
  const dialog = currentDialog();
  if (!dialog) return;
  dialog.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const picked = items[Number(btn.dataset.pick)];
      // The chosen item's own sheet replaces this one; open() closes the
      // current dialog first, so there is never a sheet stacked on a sheet.
      if (picked) onPick(picked);
    });
  });
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
  if (!stop) return;
  const mapsHref = mapsDirectionsHref(stop.lat, stop.lng);
  if (!mapsHref) return;
  open(`
    <h2 class="sheet__title" id="sheet-title">${esc(stop.name)}</h2>
    <h3 class="sheet__subtitle">${lineNames.length > 1 ? 'Lines served' : 'Line served'}</h3>
    <ul class="sheet__line-list">
      ${lineNames.map((n) => `<li>${esc(n)}</li>`).join('')}
    </ul>
    <a class="btn btn--secondary" href="${esc(mapsHref)}" target="_blank" rel="noopener">Open in Google Maps${NEW_TAB_HINT}</a>
  `);
}

export function openSponsorSheet(sponsorId) {
  const sponsor = findSponsor(sponsorId);
  if (!sponsor) return;
  const mapsHref = mapsDirectionsHref(sponsor.lat, sponsor.lng);
  if (!mapsHref) return;
  open(`
    <h2 class="sheet__title" id="sheet-title">${esc(sponsor.name)}</h2>
    ${sponsor.blurb ? `<p class="sheet__description">${esc(sponsor.blurb)}</p>` : ''}
    <a class="btn btn--secondary" href="${esc(mapsHref)}" target="_blank" rel="noopener">Open in Google Maps${NEW_TAB_HINT}</a>
  `);
}
