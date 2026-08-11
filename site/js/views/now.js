import { esc } from '../util.js';
import { now as clockNow, parseEventTimes, formatDayLabel, dateKey } from '../time.js';
import { eventRowHtml, venueGroupsHtml, bindEventRowStars } from './event-row.js';
import { installButtonHtml, bindInstallButton, onInstallStateChange } from '../pwa-install.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const REFRESH_MS = 60 * 1000;

export function renderNow(container, content) {
  const venuesById = new Map(content.venues.map((v) => [v.id, v]));
  let lastKey = null;

  // Replacing the whole view destroys focus and screen-reader reading position
  // inside it (WCAG 2.2.2 — the 60s tick is an auto-update the user can't
  // pause), so a tick renders as little as it can: an unchanged key renders
  // nothing at all, a changed key within the live state patches the two lists
  // row by row, and only a change of *state* (empty/not-started/ended/live)
  // replaces the view wholesale — those transitions swap the whole layout, so
  // there is nothing to preserve across them. Star state is deliberately
  // absent from the key — rows patch their own star in place.
  const stateOf = (key) => key.slice(0, key.indexOf('|'));

  function paint(key, html) {
    if (key === lastKey) return;
    const patchable = lastKey !== null && stateOf(lastKey) === 'live' && stateOf(key) === 'live';
    lastKey = key;
    if (patchable) {
      patchLiveView(html);
      return;
    }
    container.innerHTML = html;
    bindEventRowStars(container);
    bindInstallButton(container);
  }

  // Rebuilds the live view's two lists (and the install footer) against fresh
  // markup without touching the section, headings, or any row that persists.
  function patchLiveView(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    for (const testid of ['on-now-list', 'up-next-list']) {
      const selector = `[data-testid="${testid}"]`;
      const current = container.querySelector(selector);
      const next = tpl.content.querySelector(selector);
      if (current && next) syncChildren(current, next);
    }
    syncInstallPrompt(tpl.content);
    // Binds only rows the patch inserted — bindEventRowStars skips buttons it
    // has already wired, so surviving rows don't get a second listener.
    bindEventRowStars(container);
  }

  function syncInstallPrompt(nextRoot) {
    const current = container.querySelector('.install-prompt');
    const next = nextRoot.querySelector('.install-prompt');
    if (!next) {
      if (current) current.remove();
    } else if (!current) {
      container.querySelector('[data-testid="now-view"]').appendChild(next);
      bindInstallButton(container);
    } else if (current.outerHTML !== next.outerHTML) {
      current.replaceWith(next);
      bindInstallButton(container);
    }
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
        <div data-testid="on-now-list">
          ${onNow.length
            ? venueGroupsHtml(onNow, venuesById, { relativeTo: t })
            : '<p class="empty-state">Nothing on right now &mdash; see Up next below.</p>'}
        </div>
        <h2 class="view-subtitle">Up next</h2>
        <div data-testid="up-next-list">
          ${upNext.length
            ? venueGroupsHtml(upNext, venuesById, { relativeTo: t })
            : '<p class="empty-state">That is a wrap for now &mdash; browse the full Schedule.</p>'}
        </div>
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

// -- keyed child sync for the 60s live patch --

// Identity for keyed patching: a venue group is its heading, a row is its
// event id, anything else (an empty-state paragraph) is its own markup.
function childKey(el) {
  if (el.classList.contains('event-group')) {
    const title = el.querySelector('.event-group__title');
    return `group:${title ? title.textContent : ''}`;
  }
  if (el.classList.contains('event-row')) {
    const star = el.querySelector('[data-testid="row-star-toggle"]');
    if (star) return `row:${star.dataset.eventId}`;
  }
  return `html:${el.outerHTML}`;
}

// Adds/removes/updates `parent`'s children to match `next`'s. Departed nodes
// are removed *before* survivors are matched, so a survivor is matched in
// place rather than moved — re-inserting a DOM node blurs any focus inside
// it, which is the exact defect this patching exists to avoid. (A genuine
// reorder of survivors would still rebuild one of them, but the lists here
// are alphabetical by venue and chronological within, so a reorder implies a
// membership change anyway.)
function syncChildren(parent, next) {
  const incoming = [...next.children];
  const incomingKeys = new Set(incoming.map(childKey));
  let cursor = parent.firstElementChild;
  for (const child of incoming) {
    while (cursor && !incomingKeys.has(childKey(cursor))) {
      const departed = cursor;
      cursor = cursor.nextElementSibling;
      departed.remove();
    }
    if (cursor && childKey(cursor) === childKey(child)) {
      updateChild(cursor, child);
      cursor = cursor.nextElementSibling;
    } else {
      parent.insertBefore(child, cursor);
    }
  }
  while (cursor) {
    const departed = cursor;
    cursor = cursor.nextElementSibling;
    departed.remove();
  }
}

function updateChild(current, next) {
  if (current.classList.contains('event-group')) {
    syncChildren(current.querySelector('.event-list'), next.querySelector('.event-list'));
    return;
  }
  // A surviving row's only tick-mutable content is its time span — the day
  // prefix appears when the clock crosses midnight (event-row.js). The star
  // is left alone: it patches its own state in place on click.
  const currentTime = current.querySelector('.event-row__time');
  const nextTime = next.querySelector('.event-row__time');
  if (currentTime && nextTime && currentTime.innerHTML !== nextTime.innerHTML) {
    currentTime.innerHTML = nextTime.innerHTML;
  }
}
