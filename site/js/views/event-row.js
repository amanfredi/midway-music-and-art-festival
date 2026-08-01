// Shared row markup for now/schedule/starred so time formatting, kind badges,
// and the star indicator stay in one place.

import { esc } from '../util.js';
import { parseEventTimes, formatTime, shortDayName, dateKey } from '../time.js';
import { isStarred } from '../store.js';

export function eventRowHtml(event, { venue, showVenue = true, relativeTo = null } = {}) {
  const { start, end } = parseEventTimes(event);
  const kind = event.kind || 'music';
  const starred = isStarred(event.id);
  // In cross-day lists (up next, starred), a bare time on another day reads as
  // a past time today — label the day whenever it differs from the reference.
  const dayPrefix = relativeTo && dateKey(start) !== dateKey(relativeTo)
    ? `<span class="event-row__day">${esc(shortDayName(start))}</span> `
    : '';
  return `
    <a class="event-row" data-testid="event-row" href="#/event/${esc(event.id)}">
      <span class="event-row__time">${dayPrefix}${esc(formatTime(start))}&ndash;${esc(formatTime(end))}</span>
      <span class="event-row__main">
        <span class="event-row__title">${esc(event.title)}</span>
        ${showVenue && venue ? `<span class="event-row__venue">${esc(venue.name)}</span>` : ''}
      </span>
      <span class="badge badge--${esc(kind)}">${esc(kind)}</span>
      <span class="event-row__star" aria-hidden="true">${starred ? '★' : ''}</span>
    </a>`;
}
