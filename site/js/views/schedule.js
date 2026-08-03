import { esc } from '../util.js';
import { now as clockNow, parseWall, formatTime, shortDayLabel, dateKey } from '../time.js';
import { navigate } from '../router.js';
import { eventRowHtml, bindEventRowStars } from './event-row.js';

// Canonical kind order (matches scripts/build.mjs VALID_KINDS) — used for both
// the filter chip order and the "by category" group order.
const KINDS = ['music', 'art', 'performance', 'literary', 'vendor', 'other'];
const GROUPS = ['time', 'venue', 'category'];

function kindLabel(kind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function uniqueDays(events) {
  const seen = new Map();
  for (const e of events) {
    const d = parseWall(e.start);
    const key = dateKey(d);
    if (!seen.has(key)) seen.set(key, d);
  }
  return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, date]) => ({ key, date }));
}

function renderByTime(events, venuesById) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const groups = [];
  let lastStart = null;
  for (const e of sorted) {
    if (e.start !== lastStart) {
      groups.push({ start: e.start, events: [] });
      lastStart = e.start;
    }
    groups[groups.length - 1].events.push(e);
  }
  return groups
    .map(
      (g) => `
      <div class="time-group">
        <h3 class="time-group__title">${esc(formatTime(parseWall(g.start)))}</h3>
        <div class="event-list">${g.events.map((e) => eventRowHtml(e, { venue: venuesById.get(e.venue_id), showVenue: true })).join('')}</div>
      </div>`
    )
    .join('');
}

function renderByVenue(events, venuesById) {
  const groups = new Map();
  for (const e of events) {
    if (!groups.has(e.venue_id)) groups.set(e.venue_id, []);
    groups.get(e.venue_id).push(e);
  }
  return [...groups.entries()]
    .map(([venueId, evs]) => ({ venue: venuesById.get(venueId), events: evs.sort((a, b) => a.start.localeCompare(b.start)) }))
    .sort((a, b) => (a.venue?.name ?? '').localeCompare(b.venue?.name ?? ''))
    .map(
      (g) => `
      <div class="venue-group">
        <h3 class="venue-group__title">${esc(g.venue?.name ?? 'Venue')}</h3>
        <div class="event-list">${g.events.map((e) => eventRowHtml(e, { venue: g.venue, showVenue: false })).join('')}</div>
      </div>`
    )
    .join('');
}

function renderByCategory(events, venuesById) {
  const groups = new Map();
  for (const e of events) {
    const kind = e.kind || 'music';
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(e);
  }
  return KINDS.filter((kind) => groups.has(kind))
    .map((kind) => ({ kind, events: groups.get(kind).sort((a, b) => a.start.localeCompare(b.start)) }))
    .map(
      (g) => `
      <div class="category-group">
        <h3 class="category-group__title">${esc(kindLabel(g.kind))}</h3>
        <div class="event-list">${g.events.map((e) => eventRowHtml(e, { venue: venuesById.get(e.venue_id), showVenue: true })).join('')}</div>
      </div>`
    )
    .join('');
}

export function renderSchedule(container, content, route) {
  const days = uniqueDays(content.events);
  if (!days.length) {
    container.innerHTML = `<section class="view"><p class="empty-state">No schedule published yet.</p></section>`;
    return;
  }

  const venuesById = new Map(content.venues.map((v) => [v.id, v]));
  const todayKey = dateKey(clockNow());
  const requestedDay = route.params.get('day');
  const activeDayKey = days.some((d) => d.key === requestedDay)
    ? requestedDay
    : days.some((d) => d.key === todayKey)
      ? todayKey
      : days[0].key;
  const group = GROUPS.includes(route.params.get('group')) ? route.params.get('group') : 'time';
  const kindFilter = KINDS.includes(route.params.get('kind')) ? route.params.get('kind') : 'all';

  const dayEvents = content.events.filter((e) => dateKey(parseWall(e.start)) === activeDayKey);
  const filteredEvents = kindFilter === 'all' ? dayEvents : dayEvents.filter((e) => (e.kind || 'music') === kindFilter);
  const bodyHtml =
    group === 'venue'
      ? renderByVenue(filteredEvents, venuesById)
      : group === 'category'
        ? renderByCategory(filteredEvents, venuesById)
        : renderByTime(filteredEvents, venuesById);

  const hashFor = (overrides) => {
    const day = overrides.day ?? activeDayKey;
    const g = overrides.group ?? group;
    const kind = overrides.kind ?? kindFilter;
    return `#/schedule?day=${day}&group=${g}&kind=${kind}`;
  };

  container.innerHTML = `
    <section class="view schedule-view">
      <h1 class="view-title">Schedule</h1>
      <div class="schedule-controls">
        <!-- Plain button group with aria-pressed, not role="tablist": day,
             group-by, and kind-filter below all compose to determine the
             schedule list's contents, so no one of them owns an independent
             set of exclusive panels the way real tabs do. A full ARIA tabs
             pattern (tabpanel + aria-controls + roving tabindex) would claim
             a relationship that isn't there; this matches the sibling
             group-toggle/kind-filter controls instead (CONTRACTS.md). -->
        <div class="day-switcher" role="group" aria-label="Festival day">
          ${days
            .map(
              (d) => `<button type="button" class="day-tab ${d.key === activeDayKey ? 'is-active' : ''}" aria-pressed="${d.key === activeDayKey}" data-day="${esc(d.key)}">${esc(shortDayLabel(d.date))}</button>`
            )
            .join('')}
        </div>
        <div class="group-toggle" role="group" aria-label="Group by">
          <button type="button" class="toggle-btn ${group === 'time' ? 'is-active' : ''}" data-group="time">By time</button>
          <button type="button" class="toggle-btn ${group === 'venue' ? 'is-active' : ''}" data-group="venue">By venue</button>
          <button type="button" class="toggle-btn ${group === 'category' ? 'is-active' : ''}" data-group="category">By category</button>
        </div>
        <div class="kind-filter" data-testid="kind-filter" role="group" aria-label="Filter by kind">
          <button type="button" class="chip ${kindFilter === 'all' ? 'is-active' : ''}" data-kind="all" aria-pressed="${kindFilter === 'all'}">All</button>
          ${KINDS.map(
            (k) => `<button type="button" class="chip ${kindFilter === k ? 'is-active' : ''}" data-kind="${k}" aria-pressed="${kindFilter === k}">${esc(kindLabel(k))}</button>`
          ).join('')}
        </div>
      </div>
      <div data-testid="schedule-list" class="schedule-list">
        ${bodyHtml || '<p class="empty-state">Nothing scheduled this day.</p>'}
      </div>
    </section>`;

  container.querySelectorAll('.day-tab').forEach((btn) => {
    btn.addEventListener('click', () => navigate(hashFor({ day: btn.dataset.day })));
  });
  container.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigate(hashFor({ group: btn.dataset.group })));
  });
  container.querySelectorAll('.kind-filter .chip').forEach((btn) => {
    btn.addEventListener('click', () => navigate(hashFor({ kind: btn.dataset.kind })));
  });
  bindEventRowStars(container);
}
