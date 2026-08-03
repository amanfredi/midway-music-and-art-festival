import { getStarred } from '../store.js';
import { now as clockNow } from '../time.js';
import { eventRowHtml, bindEventRowStars } from './event-row.js';

export function renderStarred(container, content) {
  const venuesById = new Map(content.venues.map((v) => [v.id, v]));

  function draw() {
    const starredIds = new Set(getStarred());
    const events = content.events.filter((e) => starredIds.has(e.id)).sort((a, b) => a.start.localeCompare(b.start));

    if (!events.length) {
      container.innerHTML = `
        <section data-testid="starred-list" class="view starred-view">
          <h1 class="view-title">Starred</h1>
          <div class="empty-state">
            <p>Tap the star on any event to save it here for quick reference.</p>
            <p class="empty-state__note">Stars live on this device only, in the browser's local storage — not an account. iOS may clear them if this site sits unused for about a week, so don't count on them after the festival.</p>
          </div>
        </section>`;
      return;
    }

    container.innerHTML = `
      <section data-testid="starred-list" class="view starred-view">
        <h1 class="view-title">Starred</h1>
        <div class="event-list">
          ${events.map((e) => eventRowHtml(e, { venue: venuesById.get(e.venue_id), showVenue: true, relativeTo: clockNow() })).join('')}
        </div>
      </section>`;

    // The row's own star button doubles as this view's unstar control (see
    // event-row.js) — un-starring here removes the row rather than just
    // flipping its visual state, since the whole point of this list is
    // "currently starred". Removing the single row (instead of a full
    // re-`draw()`) keeps scroll position stable for everything below it;
    // a full re-draw only happens once the list is empty, to show the
    // empty state.
    bindEventRowStars(container, (_id, nowStarred, rowEl) => {
      if (!nowStarred) {
        rowEl?.remove();
        if (!container.querySelector('[data-testid="event-row"]')) draw();
      }
    });
  }

  draw();
}
