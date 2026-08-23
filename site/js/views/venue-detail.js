import { esc, groupBy, wireShareButton } from '../util.js';
import { parseEventTimes, formatDayLabel, formatTime, dateKey } from '../time.js';
import { findVenue, eventsForVenue } from '../store.js';
import { navigate, getLastListRoute } from '../router.js';
import { buildVenueDetailHtml } from './sheet.js';
import { kindTintClass } from './event-row.js';

// Deliberate divergence from openVenueSheet (CONTRACTS.md): a link recipient
// may open this days before the festival, so it lists every day's events
// grouped by day rather than only today's.
function allDaysEventsHtml(venueId) {
  const events = eventsForVenue(venueId).slice().sort((a, b) => a.start.localeCompare(b.start));
  if (!events.length) return '<p class="empty-state">No events scheduled at this venue.</p>';
  return [...groupBy(events, (e) => dateKey(parseEventTimes(e).start))]
    .map(
      ([, dayEvents]) => `
        <h3 class="event-group__title">${esc(formatDayLabel(parseEventTimes(dayEvents[0]).start))}</h3>
        <ul class="sheet__event-list">${dayEvents
          .map(
            (e) =>
              `<li><a class="sheet__event-link ${kindTintClass(e.kind)}" href="#/event/${esc(e.id)}">${esc(formatTime(parseEventTimes(e).start))} &mdash; ${esc(e.title)}</a></li>`
          )
          .join('')}</ul>`
    )
    .join('');
}

export function renderVenueDetail(container, content, venueId) {
  const venue = findVenue(venueId);
  if (!venue) {
    container.innerHTML = `
      <section class="view venue-detail" data-testid="venue-view">
        <h1 class="sr-only">Venue detail</h1>
        <p class="empty-state">That venue couldn't be found. <a href="#/map">Back to map</a></p>
      </section>`;
    return;
  }

  container.innerHTML = `
    <section class="view venue-detail" data-testid="venue-view">
      <button type="button" class="back-link" id="back-btn">&lsaquo; Back</button>
      ${buildVenueDetailHtml(venue, { headingTag: 'h1', headingId: 'venue-title', eventsSectionHtml: allDaysEventsHtml(venueId) })}
    </section>`;

  container.querySelector('#back-btn').addEventListener('click', () => navigate(getLastListRoute()));
  wireShareButton(container, venue.name, `#/venue/${venue.id}`);
}
