import { esc } from '../util.js';
import { getStarred, toggleStar } from '../store.js';
import { now as clockNow } from '../time.js';
import { eventRowHtml } from './event-row.js';

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
          ${events
            .map(
              (e) => `
            <div class="event-row-wrap">
              ${eventRowHtml(e, { venue: venuesById.get(e.venue_id), showVenue: true, relativeTo: clockNow() })}
              <button type="button" class="unstar-btn" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.title)} from starred">&times;</button>
            </div>`
            )
            .join('')}
        </div>
      </section>`;

    container.querySelectorAll('.unstar-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleStar(btn.dataset.id);
        draw();
      });
    });
  }

  draw();
}
