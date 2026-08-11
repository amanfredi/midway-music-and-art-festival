// Shared row markup for now/schedule/starred so time formatting, kind badges,
// ticket icons, and the star control stay in one place.
//
// Markup shape (CONTRACTS.md UI contract): a row container `[data-testid="event-row"]`
// holding the event `<a>` link plus a *sibling* star `<button>` — never a button
// nested inside a link, which is broken for screen readers and touch.

import { esc, groupBy } from '../util.js';
import { parseEventTimes, formatTime, shortDayName, dateKey } from '../time.js';
import { isStarred, toggleStar } from '../store.js';

// Two of the four `tickets` values get a ticket icon next to the kind badge in
// list rows (CONTRACTS.md events.csv). Artwork is the organizers' own brand
// ticket, defined once as a <symbol> in index.html and referenced here — see
// tools/make-ticket-icons.mjs. Labelled (role="img" + aria-label) rather than
// aria-hidden: the icon carries information no other part of the row does.
const TICKET_ICONS = {
  'Free Ticket Required': { id: 'icon-ticket-free', label: 'Free ticket required' },
  'Paid Ticket Required': { id: 'icon-ticket-paid', label: 'Paid ticket required' },
};

export function ticketIconHtml(tickets) {
  const info = TICKET_ICONS[tickets];
  if (!info) return '';
  return `<svg class="ticket-icon" role="img" aria-label="${esc(info.label)}" focusable="false"><use href="#${info.id}"></use></svg>`;
}

// events.csv `age_limit` is blank for the overwhelming majority of events;
// only "18+"/"21+" render. Announced as a phrase rather than leaving a screen
// reader to interpret "21+".
export function ageBadgeHtml(ageLimit) {
  if (ageLimit !== '18+' && ageLimit !== '21+') return '';
  const years = ageLimit.slice(0, 2);
  return `<span class="badge badge--age" role="img" aria-label="Ages ${years} and up">${esc(ageLimit)}</span>`;
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
        <span class="event-row__body">
          <span class="event-row__time">${dayPrefix}${esc(formatTime(start))}&ndash;${esc(formatTime(end))}</span>
          <span class="event-row__title">${title}</span>
          ${showVenue && venue ? `<span class="event-row__venue">${esc(venue.name)}</span>` : ''}
        </span>
        <span class="event-row__meta">
          <span class="badge badge--${esc(kind)}">${esc(kind)}</span>
          ${ticketIconHtml(event.tickets)}
          ${ageBadgeHtml(event.age_limit)}
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
 * One titled group of event rows. The schedule's three groupings and the Now
 * view's per-venue lists are all this shape, and share its styling.
 */
export function eventGroupHtml(title, rowsHtml) {
  return `
    <div class="event-group">
      <h3 class="event-group__title">${esc(title)}</h3>
      <div class="event-list">${rowsHtml}</div>
    </div>`;
}

/** Rows grouped by venue: venues alphabetical, rows chronological within each. */
export function venueGroupsHtml(events, venuesById, { relativeTo = null } = {}) {
  return [...groupBy(events, (e) => e.venue_id)]
    .map(([venueId, venueEvents]) => ({
      venue: venuesById.get(venueId),
      events: venueEvents.sort((a, b) => a.start.localeCompare(b.start)),
    }))
    .sort((a, b) => (a.venue?.name ?? '').localeCompare(b.venue?.name ?? ''))
    .map((group) =>
      eventGroupHtml(
        group.venue?.name ?? 'Venue',
        group.events.map((e) => eventRowHtml(e, { venue: group.venue, showVenue: false, relativeTo })).join('')
      )
    )
    .join('');
}

/**
 * Wires up every row star button within `container`. Updates that button's
 * own state in place (no re-render) so toggling a star never disturbs scroll
 * position. Pass `onToggle(eventId, nowStarred, rowEl)` for view-specific
 * follow-up (e.g. the starred list removes the row on unstar).
 */
// Buttons already wired, so a re-bind of a container whose rows were patched
// in place (the Now view's 60s tick) can't attach a second listener — doubled
// listeners would toggle the star twice per click, a net no-op.
const boundStarButtons = new WeakSet();

export function bindEventRowStars(container, onToggle) {
  container.querySelectorAll('[data-testid="row-star-toggle"]').forEach((btn) => {
    if (boundStarButtons.has(btn)) return;
    boundStarButtons.add(btn);
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
