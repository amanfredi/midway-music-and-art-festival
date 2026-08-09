import { getStarred } from '../store.js';
import { now as clockNow } from '../time.js';
import { eventRowHtml, bindEventRowStars } from './event-row.js';
import { installButtonHtml, bindInstallButton, onInstallStateChange } from '../pwa-install.js';

// How long an un-starred row lingers, dimmed, before it actually leaves the
// list. Long enough to notice a mis-tap and undo it, short enough that the
// list still reads as "currently starred" (QA, 2026-08-09).
const UNDO_GRACE_MS = 3000;

// Deliberately not iOS-specific: this view renders on Android and desktop too,
// and eviction-after-disuse is a general browser storage behavior rather than
// an Apple one. The install pitch is the actual mitigation — an installed app's
// storage is exempt from the usual disuse cleanup.
const STORAGE_NOTE =
  "Stars live on this device only, in your browser's storage — not an account. " +
  'A browser may clear them if the site goes unused for a week or so, so don’t count on them after the festival.';
const INSTALL_NOTE = 'Installing this app keeps your stars from being cleared.';

export function renderStarred(container, content) {
  const venuesById = new Map(content.venues.map((v) => [v.id, v]));
  // eventId -> timeout handle for rows waiting out their undo grace period.
  const pendingRemovals = new Map();

  function cancelPending(id) {
    const handle = pendingRemovals.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      pendingRemovals.delete(id);
    }
  }

  function footerHtml() {
    const install = installButtonHtml();
    return `
      <div class="starred-footer">
        <p class="starred-footer__note">${STORAGE_NOTE}</p>
        ${install ? `<p class="starred-footer__note">${INSTALL_NOTE}</p>${install}` : ''}
      </div>`;
  }

  function draw() {
    const starredIds = new Set(getStarred());
    const events = content.events.filter((e) => starredIds.has(e.id)).sort((a, b) => a.start.localeCompare(b.start));

    if (!events.length) {
      container.innerHTML = `
        <section data-testid="starred-list" class="view starred-view">
          <h1 class="view-title">Starred</h1>
          <div class="empty-state">
            <p>Tap the star on any event to save it here for quick reference.</p>
          </div>
          ${footerHtml()}
        </section>`;
      bindInstallButton(container);
      return;
    }

    container.innerHTML = `
      <section data-testid="starred-list" class="view starred-view">
        <h1 class="view-title">Starred</h1>
        <div class="event-list">
          ${events.map((e) => eventRowHtml(e, { venue: venuesById.get(e.venue_id), showVenue: true, relativeTo: clockNow() })).join('')}
        </div>
        ${footerHtml()}
      </section>`;
    bindInstallButton(container);

    // The row's own star button doubles as this view's unstar control (see
    // event-row.js). Un-starring here does eventually remove the row — the
    // whole point of this list is "currently starred" — but not instantly:
    // the row dims and stays put for UNDO_GRACE_MS so a mis-tap can be undone
    // without hunting the event down again in the schedule. Re-starring during
    // the grace period cancels the removal outright.
    //
    // Removing the single row (instead of a full re-draw) keeps scroll
    // position stable for everything below it; a full re-draw only happens
    // once the list empties, to show the empty state.
    bindEventRowStars(container, (id, nowStarred, rowEl) => {
      if (!rowEl) return;
      if (nowStarred) {
        cancelPending(id);
        rowEl.classList.remove('event-row--unstarred');
        return;
      }
      rowEl.classList.add('event-row--unstarred');
      cancelPending(id);
      pendingRemovals.set(
        id,
        setTimeout(() => {
          pendingRemovals.delete(id);
          rowEl.remove();
          if (!container.querySelector('[data-testid="event-row"]')) draw();
        }, UNDO_GRACE_MS)
      );
    });
  }

  draw();

  // The install button can appear (Chromium fires beforeinstallprompt late) or
  // vanish (the user installs mid-visit) while this view is open.
  const unsubscribe = onInstallStateChange(() => draw());

  return () => {
    unsubscribe();
    for (const handle of pendingRemovals.values()) clearTimeout(handle);
    pendingRemovals.clear();
  };
}
