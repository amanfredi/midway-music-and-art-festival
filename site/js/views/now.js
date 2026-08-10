import { esc } from '../util.js';
import { now as clockNow, parseEventTimes, formatDayLabel, dateKey } from '../time.js';
import { eventRowHtml, venueGroupsHtml, bindEventRowStars } from './event-row.js';
import { installButtonHtml, bindInstallButton, onInstallStateChange } from '../pwa-install.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const REFRESH_MS = 60 * 1000;

export function renderNow(container, content) {
  const venuesById = new Map(content.venues.map((v) => [v.id, v]));
  let lastKey = null;

  // Replacing the whole view destroys focus and reading position inside it, so
  // a tick that would render the same thing doesn't render at all. Star state
  // is deliberately absent from the key — rows patch their own star in place.
  function paint(key, html) {
    if (key === lastKey) return;
    lastKey = key;
    container.innerHTML = html;
    bindEventRowStars(container);
    bindInstallButton(container);
  }

  function draw() {
    const install = installButtonHtml();
    const events = content.events;
    if (!events.length) {
      paint(
        `empty|${install}`,
        `<section data-testid="now-view" class="view now-view">
          <h1 class="sr-only">Now</h1>
          <p class="empty-state">No events scheduled yet — check back once the schedule is published.</p>
          ${install}
        </section>`
      );
      return;
    }

    const times = events.map((e) => ({ e, ...parseEventTimes(e) }));
    const festivalStart = times.reduce((min, x) => (x.start < min ? x.start : min), times[0].start);
    const festivalEnd = times.reduce((max, x) => (x.end > max ? x.end : max), times[0].end);
    const t = clockNow();

    if (t < festivalStart) {
      paint(`not-started|${install}`, notStartedHtml(festivalStart, times, install));
      return;
    }
    if (t >= festivalEnd) {
      paint(`ended|${install}`, endedHtml(install));
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

    // The calendar day is part of the key because rows carry a day prefix
    // whenever they fall on a different day than the reference time.
    const ids = (list) => list.map((e) => e.id).join(',');
    paint(`live|${dateKey(t)}|${ids(onNow)}|${ids(upNext)}|${install}`, liveHtml(onNow, upNext, t, install));
  }

  function liveHtml(onNow, upNext, t, install) {
    return `
      <section data-testid="now-view" class="view now-view">
        <h1 class="view-title">On now</h1>
        ${onNow.length
          ? venueGroupsHtml(onNow, venuesById, { relativeTo: t })
          : '<p class="empty-state">Nothing on right now &mdash; see Up next below.</p>'}
        <h2 class="view-subtitle">Up next</h2>
        ${upNext.length
          ? venueGroupsHtml(upNext, venuesById, { relativeTo: t })
          : '<p class="empty-state">That is a wrap for now &mdash; browse the full Schedule.</p>'}
        ${install}
      </section>`;
  }

  function notStartedHtml(festivalStart, times, install) {
    const firstDayKey = dateKey(festivalStart);
    const firstDayEvents = times
      .filter((x) => dateKey(x.start) === firstDayKey)
      .sort((a, b) => a.start - b.start)
      .map((x) => x.e);
    return `
      <section data-testid="now-view" class="view now-view">
        <div class="empty-state empty-state--hero">
          <h1>${esc(content.settings.festival_name || 'The festival')} hasn't started yet</h1>
          <p>${esc(content.settings.festival_dates_label || '')}</p>
        </div>
        <h2 class="view-subtitle">Opening lineup &mdash; ${esc(formatDayLabel(festivalStart))}</h2>
        <div class="event-list">${firstDayEvents.map((e) => eventRowHtml(e, { venue: venuesById.get(e.venue_id), showVenue: true })).join('')}</div>
        ${install}
      </section>`;
  }

  function endedHtml(install) {
    return `
      <section data-testid="now-view" class="view now-view">
        <div class="empty-state empty-state--hero">
          <h1>Thanks for coming!</h1>
          <p>${esc(content.settings.festival_name || 'The festival')} has wrapped for this year.</p>
          <p>${esc(content.settings.festival_dates_label || '')}</p>
          <a class="btn btn--primary" href="#/schedule">Browse the full schedule</a>
        </div>
        ${install}
      </section>`;
  }

  draw();
  const timer = setInterval(draw, REFRESH_MS);
  // Redraw on install-state changes (e.g. beforeinstallprompt firing after
  // this view already rendered) so the button appears without a reload.
  const unsubscribeInstall = onInstallStateChange(draw);
  return () => {
    clearInterval(timer);
    unsubscribeInstall();
  };
}
