import { esc } from '../util.js';
import { now as clockNow, parseWall, formatTime, shortDayLabel, dateKey } from '../time.js';
import { navigate } from '../router.js';
import { eventRowHtml } from './event-row.js';

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
  const group = route.params.get('group') === 'venue' ? 'venue' : 'time';

  const dayEvents = content.events.filter((e) => dateKey(parseWall(e.start)) === activeDayKey);
  const bodyHtml = group === 'venue' ? renderByVenue(dayEvents, venuesById) : renderByTime(dayEvents, venuesById);

  container.innerHTML = `
    <section class="view schedule-view">
      <h1 class="view-title">Schedule</h1>
      <div class="schedule-controls">
        <div class="day-switcher" role="tablist" aria-label="Festival day">
          ${days
            .map(
              (d) => `<button type="button" class="day-tab ${d.key === activeDayKey ? 'is-active' : ''}" role="tab" aria-selected="${d.key === activeDayKey}" data-day="${esc(d.key)}">${esc(shortDayLabel(d.date))}</button>`
            )
            .join('')}
        </div>
        <div class="group-toggle" role="group" aria-label="Group by">
          <button type="button" class="toggle-btn ${group === 'time' ? 'is-active' : ''}" data-group="time">By time</button>
          <button type="button" class="toggle-btn ${group === 'venue' ? 'is-active' : ''}" data-group="venue">By venue</button>
        </div>
      </div>
      <div data-testid="schedule-list" class="schedule-list">
        ${bodyHtml || '<p class="empty-state">Nothing scheduled this day.</p>'}
      </div>
    </section>`;

  container.querySelectorAll('.day-tab').forEach((btn) => {
    btn.addEventListener('click', () => navigate(`#/schedule?day=${btn.dataset.day}&group=${group}`));
  });
  container.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigate(`#/schedule?day=${activeDayKey}&group=${btn.dataset.group}`));
  });
}
