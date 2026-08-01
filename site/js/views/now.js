import { esc } from '../util.js';
import { now as clockNow, parseEventTimes, formatDayLabel, dateKey } from '../time.js';
import { eventRowHtml } from './event-row.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const REFRESH_MS = 60 * 1000;

function groupByVenue(events, venuesById) {
  const groups = new Map();
  for (const e of events) {
    if (!groups.has(e.venue_id)) groups.set(e.venue_id, []);
    groups.get(e.venue_id).push(e);
  }
  return [...groups.entries()]
    .map(([venueId, evs]) => ({
      venue: venuesById.get(venueId),
      events: evs.sort((a, b) => a.start.localeCompare(b.start)),
    }))
    .sort((a, b) => (a.venue?.name ?? '').localeCompare(b.venue?.name ?? ''));
}

function venueGroupHtml(group) {
  return `
    <div class="venue-group">
      <h3 class="venue-group__title">${esc(group.venue?.name ?? 'Venue')}</h3>
      <div class="event-list">${group.events.map((e) => eventRowHtml(e, { venue: group.venue, showVenue: false })).join('')}</div>
    </div>`;
}

export function renderNow(container, content) {
  const venuesById = new Map(content.venues.map((v) => [v.id, v]));

  function draw() {
    const events = content.events;
    if (!events.length) {
      container.innerHTML = `
        <section data-testid="now-view" class="view now-view">
          <p class="empty-state">No events scheduled yet — check back once the schedule is published.</p>
        </section>`;
      return;
    }

    const times = events.map((e) => ({ e, ...parseEventTimes(e) }));
    const festivalStart = times.reduce((min, x) => (x.start < min ? x.start : min), times[0].start);
    const festivalEnd = times.reduce((max, x) => (x.end > max ? x.end : max), times[0].end);
    const t = clockNow();

    if (t < festivalStart) {
      drawNotStarted(t, festivalStart, times);
      return;
    }
    if (t >= festivalEnd) {
      drawEnded();
      return;
    }

    const onNow = times.filter((x) => x.start <= t && t < x.end).map((x) => x.e);
    const within2h = times.filter((x) => x.start > t && x.start.getTime() <= t.getTime() + TWO_HOURS_MS).map((x) => x.e);

    let upNext;
    if (within2h.length) {
      upNext = within2h;
    } else {
      // Nothing starts soon festival-wide (e.g. an overnight gap) — guarantee
      // something useful shows by falling back to each venue's next event.
      const nextByVenue = new Map();
      for (const x of times) {
        if (x.start > t) {
          const cur = nextByVenue.get(x.e.venue_id);
          if (!cur || x.start < cur.start) nextByVenue.set(x.e.venue_id, x);
        }
      }
      upNext = [...nextByVenue.values()].sort((a, b) => a.start - b.start).map((x) => x.e);
    }

    const onNowGroups = groupByVenue(onNow, venuesById);
    const upNextGroups = groupByVenue(upNext, venuesById);

    container.innerHTML = `
      <section data-testid="now-view" class="view now-view">
        <h1 class="view-title">On now</h1>
        ${onNowGroups.length ? onNowGroups.map(venueGroupHtml).join('') : '<p class="empty-state">Nothing on right now &mdash; see Up next below.</p>'}
        <h2 class="view-subtitle">Up next</h2>
        ${upNextGroups.length ? upNextGroups.map(venueGroupHtml).join('') : '<p class="empty-state">That is a wrap for now &mdash; browse the full Schedule.</p>'}
      </section>`;
  }

  function drawNotStarted(t, festivalStart, times) {
    const firstDayKey = dateKey(festivalStart);
    const firstDayEvents = times
      .filter((x) => dateKey(x.start) === firstDayKey)
      .sort((a, b) => a.start - b.start)
      .map((x) => x.e);
    container.innerHTML = `
      <section data-testid="now-view" class="view now-view">
        <div class="empty-state empty-state--hero">
          <h1>${esc(content.settings.festival_name || 'The festival')} hasn't started yet</h1>
          <p>${esc(content.settings.festival_dates_label || '')}</p>
        </div>
        <h2 class="view-subtitle">Opening lineup &mdash; ${esc(formatDayLabel(festivalStart))}</h2>
        <div class="event-list">${firstDayEvents.map((e) => eventRowHtml(e, { venue: venuesById.get(e.venue_id), showVenue: true })).join('')}</div>
      </section>`;
  }

  function drawEnded() {
    container.innerHTML = `
      <section data-testid="now-view" class="view now-view">
        <div class="empty-state empty-state--hero">
          <h1>Thanks for coming!</h1>
          <p>${esc(content.settings.festival_name || 'The festival')} has wrapped for this year.</p>
          <p>${esc(content.settings.festival_dates_label || '')}</p>
          <a class="btn btn--primary" href="#/schedule">Browse the full schedule</a>
        </div>
      </section>`;
  }

  draw();
  const timer = setInterval(draw, REFRESH_MS);
  return () => clearInterval(timer);
}
