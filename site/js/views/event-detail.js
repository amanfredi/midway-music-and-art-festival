import { esc } from '../util.js';
import { parseEventTimes, formatDayLabel, formatTime } from '../time.js';
import { findVenue, isStarred, toggleStar } from '../store.js';
import { navigate, getLastListRoute } from '../router.js';
import { openVenueSheet } from './sheet.js';

export function renderEventDetail(container, content, eventId) {
  const event = content.events.find((e) => e.id === eventId);
  if (!event) {
    container.innerHTML = `
      <section class="view event-detail">
        <p class="empty-state">That event couldn't be found. <a href="#/schedule">Back to schedule</a></p>
      </section>`;
    return;
  }

  const venue = findVenue(event.venue_id);
  const { start, end } = parseEventTimes(event);
  const starred = isStarred(event.id);
  const kind = event.kind || 'music';
  const mapsHref = venue ? `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}` : '';

  container.innerHTML = `
    <section class="view event-detail">
      <button type="button" class="back-link" id="back-btn">&lsaquo; Back</button>
      <span class="badge badge--${esc(kind)}">${esc(kind)}</span>
      <h1 class="event-detail__title">${esc(event.title)}</h1>
      <p class="event-detail__time">${esc(formatDayLabel(start))} &middot; ${esc(formatTime(start))}&ndash;${esc(formatTime(end))}</p>
      <p class="event-detail__venue">
        ${venue ? `<button type="button" class="link-btn" id="venue-link">${esc(venue.name)}</button><br><span class="event-detail__address">${esc(venue.address)}</span>` : '<span>Venue TBA</span>'}
      </p>
      ${event.description ? `<p class="event-detail__description">${esc(event.description)}</p>` : ''}
      <div class="event-detail__actions">
        <button type="button" class="btn btn--star" id="star-toggle" data-testid="star-toggle" aria-pressed="${starred}">
          <span class="star-icon" aria-hidden="true">${starred ? '★' : '☆'}</span>
          <span class="star-label">${starred ? 'Starred' : 'Star this event'}</span>
        </button>
        ${venue ? `<a class="btn btn--secondary" href="${esc(mapsHref)}" target="_blank" rel="noopener">Open in Google Maps</a>` : ''}
      </div>
    </section>`;

  container.querySelector('#back-btn').addEventListener('click', () => navigate(getLastListRoute()));
  if (venue) {
    container.querySelector('#venue-link').addEventListener('click', () => openVenueSheet(venue.id));
  }

  const starBtn = container.querySelector('#star-toggle');
  starBtn.addEventListener('click', () => {
    const nowStarred = toggleStar(event.id);
    starBtn.setAttribute('aria-pressed', String(nowStarred));
    starBtn.querySelector('.star-icon').textContent = nowStarred ? '★' : '☆';
    starBtn.querySelector('.star-label').textContent = nowStarred ? 'Starred' : 'Star this event';
  });
}
