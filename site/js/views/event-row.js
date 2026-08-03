// Shared row markup for now/schedule/starred so time formatting, kind badges,
// ticket icons, and the star control stay in one place.
//
// Markup shape (CONTRACTS.md UI contract): a row container `[data-testid="event-row"]`
// holding the event `<a>` link plus a *sibling* star `<button>` — never a button
// nested inside a link, which is broken for screen readers and touch.

import { esc } from '../util.js';
import { parseEventTimes, formatTime, shortDayName, dateKey } from '../time.js';
import { isStarred, toggleStar } from '../store.js';

// Two of the four `tickets` values get a small ticket-stub icon next to the
// kind badge in list rows (CONTRACTS.md events.csv / BACKLOG.md). The icon is
// a labelled SVG (role="img" + aria-label), not aria-hidden, so screen readers
// perceive it — the visible "FREE"/"$" stub text is decorative sugar on top.
const TICKET_ICONS = {
  'Free Ticket Required': { code: 'FREE', label: 'Free ticket required', variant: 'free' },
  'Paid Ticket Required': { code: '$', label: 'Paid ticket required', variant: 'paid' },
};

function ticketIconHtml(tickets) {
  const info = TICKET_ICONS[tickets];
  if (!info) return '';
  return `
    <svg class="ticket-icon ticket-icon--${info.variant}" viewBox="0 0 36 20" width="34" height="19" role="img" aria-label="${esc(info.label)}" focusable="false">
      <rect class="ticket-icon__body" x="1" y="1" width="34" height="18" rx="3" ry="3" />
      <circle class="ticket-icon__notch" cx="14" cy="1" r="3" />
      <circle class="ticket-icon__notch" cx="14" cy="19" r="3" />
      <line class="ticket-icon__perf" x1="14" y1="5" x2="14" y2="15" />
      <text class="ticket-icon__text" x="25" y="14" text-anchor="middle">${esc(info.code)}</text>
    </svg>`;
}

export function eventRowHtml(event, { venue, showVenue = true, relativeTo = null } = {}) {
  const { start, end } = parseEventTimes(event);
  const kind = event.kind || 'music';
  const starred = isStarred(event.id);
  const title = esc(event.title);
  // In cross-day lists (up next, starred), a bare time on another day reads as
  // a past time today — label the day whenever it differs from the reference.
  const dayPrefix = relativeTo && dateKey(start) !== dateKey(relativeTo)
    ? `<span class="event-row__day">${esc(shortDayName(start))}</span> `
    : '';
  return `
    <div class="event-row" data-testid="event-row">
      <a class="event-row__link" href="#/event/${esc(event.id)}">
        <span class="event-row__top">
          <span class="event-row__time">${dayPrefix}${esc(formatTime(start))}&ndash;${esc(formatTime(end))}</span>
          <span class="event-row__meta">
            <span class="badge badge--${esc(kind)}">${esc(kind)}</span>
            ${ticketIconHtml(event.tickets)}
          </span>
        </span>
        <span class="event-row__main">
          <span class="event-row__title">${title}</span>
          ${showVenue && venue ? `<span class="event-row__venue">${esc(venue.name)}</span>` : ''}
        </span>
      </a>
      <button
        type="button"
        class="event-row__star-btn"
        data-testid="row-star-toggle"
        data-event-id="${esc(event.id)}"
        data-event-title="${title}"
        aria-pressed="${starred}"
        aria-label="${starred ? 'Unstar' : 'Star'} ${title}"
      ><span class="event-row__star-glyph" aria-hidden="true">${starred ? '★' : '☆'}</span></button>
    </div>`;
}

/**
 * Wires up every row star button within `container`. Updates that button's
 * own state in place (no re-render) so toggling a star never disturbs scroll
 * position. Pass `onToggle(eventId, nowStarred, rowEl)` for view-specific
 * follow-up (e.g. the starred list removes the row on unstar).
 */
export function bindEventRowStars(container, onToggle) {
  container.querySelectorAll('[data-testid="row-star-toggle"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.eventId;
      const nowStarred = toggleStar(id);
      applyStarState(btn, nowStarred);
      if (onToggle) onToggle(id, nowStarred, btn.closest('[data-testid="event-row"]'));
    });
  });
}

function applyStarState(btn, starred) {
  btn.setAttribute('aria-pressed', String(starred));
  btn.setAttribute('aria-label', `${starred ? 'Unstar' : 'Star'} ${btn.dataset.eventTitle}`);
  const glyph = btn.querySelector('.event-row__star-glyph');
  if (glyph) glyph.textContent = starred ? '★' : '☆';
}
