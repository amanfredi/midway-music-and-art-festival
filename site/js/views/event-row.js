// Shared row markup for now/schedule/starred so time formatting, kind badges,
// and the star indicator stay in one place.

import { esc } from '../util.js';
import { parseEventTimes, formatTime } from '../time.js';
import { isStarred } from '../store.js';

export function eventRowHtml(event, { venue, showVenue = true } = {}) {
  const { start, end } = parseEventTimes(event);
  const kind = event.kind || 'music';
  const starred = isStarred(event.id);
  return `
    <a class="event-row" data-testid="event-row" href="#/event/${esc(event.id)}">
      <span class="event-row__time">${esc(formatTime(start))}&ndash;${esc(formatTime(end))}</span>
      <span class="event-row__main">
        <span class="event-row__title">${esc(event.title)}</span>
        ${showVenue && venue ? `<span class="event-row__venue">${esc(venue.name)}</span>` : ''}
      </span>
      <span class="badge badge--${esc(kind)}">${esc(kind)}</span>
      <span class="event-row__star" aria-hidden="true">${starred ? '★' : ''}</span>
    </a>`;
}
