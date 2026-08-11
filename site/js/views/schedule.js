import { esc, groupBy } from '../util.js';
import { now as clockNow, parseWall, formatTime, shortDayLabel, dateKey } from '../time.js';
import { navigate } from '../router.js';
import { eventRowHtml, eventGroupHtml, venueGroupsHtml, bindEventRowStars } from './event-row.js';

// Canonical kind order (matches scripts/build.mjs VALID_KINDS) — the "by
// category" group order. There is deliberately no kind *filter*: grouping by
// category already answers "show me just the music" without hiding anything
// (QA, 2026-08-08).
const KINDS = ['music', 'art', 'performance', 'literary', 'vendor', 'other'];
const GROUPS = ['time', 'venue', 'category'];
const GROUP_LABELS = { time: 'By time', venue: 'By venue', category: 'By category' };

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

function rowsHtml(events, venuesById) {
  return events.map((e) => eventRowHtml(e, { venue: venuesById.get(e.venue_id), showVenue: true })).join('');
}

function renderByTime(events, venuesById) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return [...groupBy(sorted, (e) => e.start)]
    .map(([start, startEvents]) => eventGroupHtml(formatTime(parseWall(start)), rowsHtml(startEvents, venuesById)))
    .join('');
}

function renderByCategory(events, venuesById) {
  const groups = groupBy(events, (e) => e.kind || 'music');
  return KINDS.filter((kind) => groups.has(kind))
    .map((kind) =>
      eventGroupHtml(
        kindLabel(kind),
        rowsHtml(groups.get(kind).sort((a, b) => a.start.localeCompare(b.start)), venuesById)
      )
    )
    .join('');
}

export function renderSchedule(container, content, route) {
  const days = uniqueDays(content.events);
  if (!days.length) {
    container.innerHTML = `<section class="view"><h1 class="sr-only">Schedule</h1><p class="empty-state">No schedule published yet.</p></section>`;
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

  const dayEvents = content.events.filter((e) => dateKey(parseWall(e.start)) === activeDayKey);
  const bodyHtml =
    group === 'venue'
      ? venueGroupsHtml(dayEvents, venuesById)
      : group === 'category'
        ? renderByCategory(dayEvents, venuesById)
        : renderByTime(dayEvents, venuesById);

  const hashFor = (overrides) => {
    const day = overrides.day ?? activeDayKey;
    const g = overrides.group ?? group;
    return `#/schedule?day=${day}&group=${g}`;
  };

  container.innerHTML = `
    <section class="view schedule-view">
      <h1 class="view-title">Schedule</h1>
      <div class="schedule-controls">
        <!-- Plain button group with aria-pressed, not role="tablist": day and
             group-by compose to determine the schedule list's contents, so
             neither one owns an independent set of exclusive panels the way
             real tabs do. A full ARIA tabs pattern (tabpanel + aria-controls
             + roving tabindex) would claim a relationship that isn't there;
             this matches the sibling group-toggle control instead
             (CONTRACTS.md). -->
        <div class="day-switcher" role="group" aria-label="Festival day">
          ${days
            .map(
              (d) => `<button type="button" class="day-tab ${d.key === activeDayKey ? 'is-active' : ''}" aria-pressed="${d.key === activeDayKey}" data-day="${esc(d.key)}">${esc(shortDayLabel(d.date))}</button>`
            )
            .join('')}
        </div>
        <div class="group-toggle" role="group" aria-label="Group by">
          ${GROUPS.map(
            (mode) =>
              `<button type="button" class="toggle-btn ${group === mode ? 'is-active' : ''}" aria-pressed="${group === mode}" data-group="${mode}">${GROUP_LABELS[mode]}</button>`
          ).join('')}
        </div>
      </div>
      <div data-testid="schedule-list" class="schedule-list">
        ${bodyHtml || '<p class="empty-state">Nothing scheduled this day.</p>'}
      </div>
    </section>`;

  // Two-tier sticky stack: the control bar pins to the top of the window, and
  // the time/venue/category group headings pin directly beneath it rather than
  // sliding underneath. The offset is the control bar's real height, which
  // depends on how many day buttons wrap, so it's measured rather than guessed.
  let disconnectStackObserver = null;
  const controls = container.querySelector('.schedule-controls');
  const section = container.querySelector('.schedule-view');
  if (controls && section && typeof ResizeObserver === 'function') {
    const setStackTop = () => {
      section.style.setProperty('--sticky-stack-top', `calc(var(--safe-top) + ${controls.offsetHeight}px)`);
      // Publish the sticky stack's full height as the document's top scroll
      // padding (see the html rule in app.css), so scroll-into-view on focus
      // can't park a control under the pinned bar — the mirror of the tab
      // bar's scroll-padding-bottom. A row's own group heading pins directly
      // below the bar, so its height is part of the clearance.
      const heading = section.querySelector('.event-group__title');
      const stackHeight = controls.offsetHeight + (heading ? heading.offsetHeight : 0);
      document.documentElement.style.setProperty(
        '--scroll-padding-top',
        `calc(var(--safe-top) + ${stackHeight + 8}px)`
      );
    };
    setStackTop();
    // Re-measure on resize/rotate, where wrapping can change the bar's height.
    const observer = new ResizeObserver(setStackTop);
    observer.observe(controls);
    disconnectStackObserver = () => observer.disconnect();
  }

  container.querySelectorAll('.day-tab').forEach((btn) => {
    btn.addEventListener('click', () => navigate(hashFor({ day: btn.dataset.day })));
  });
  container.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigate(hashFor({ group: btn.dataset.group })));
  });
  bindEventRowStars(container);

  return () => {
    if (disconnectStackObserver) disconnectStackObserver();
    // The padding is schedule-specific; leaving it set would push every other
    // view's upward scroll-into-view down by a stale bar height.
    document.documentElement.style.removeProperty('--scroll-padding-top');
  };
}
