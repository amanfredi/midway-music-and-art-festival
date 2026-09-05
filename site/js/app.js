import { esc } from './util.js';
import * as store from './store.js';
import { startRouter, parseHash, recordListRoute } from './router.js';
import { closeSheet } from './views/sheet.js';
import { renderNow } from './views/now.js';
import { renderSchedule } from './views/schedule.js';
import { renderEventDetail } from './views/event-detail.js';
import { renderVenueDetail } from './views/venue-detail.js';
import { renderMap } from './views/map.js';
import { renderStarred } from './views/starred.js';
import { renderVendors } from './views/vendors.js';
import { renderSponsors } from './views/sponsors.js';
import { requestPersistentStorage } from './persist-storage.js';
import { initInstallPrompt } from './pwa-install.js';
import { embedRoute, fullAppUrl, isEmbed, reportHeightToParent } from './embed.js';

const viewEl = document.getElementById('view');
const bannerRegion = document.getElementById('banner-region');
const festivalNameEl = document.getElementById('festival-name');
const routeAnnouncer = document.getElementById('route-announcer');
const navLinks = [...document.querySelectorAll('.tab-bar a')];

let currentCleanup = null;
let routeGeneration = 0;

// Human-readable names for the route-change live-region announcement below.
// Matches the nav labels (CONTRACTS.md: "Support" is the #/sponsors route
// relabeled in the nav only) rather than the route/hash names themselves.
const ROUTE_NAMES = {
  now: 'Now',
  schedule: 'Schedule',
  map: 'Map',
  starred: 'Starred',
  vendors: 'Vendors',
  sponsors: 'Support',
  event: 'Event detail',
  venue: 'Venue detail',
};

// WCAG 2.4.2: each route titles the tab "<Route name> — <site name>", using
// the same nav-label names as the announcement below. The site name is the
// sheet's festival_name, falling back to index.html's own <title> (captured
// here, before any route overwrites it).
const BASE_TITLE = document.title;

function setRouteTitle(routeName) {
  const label = ROUTE_NAMES[routeName] || routeName;
  const content = store.getContent();
  const site = (content && content.settings.festival_name) || BASE_TITLE;
  document.title = `${label} — ${site}`;
}

function announceRoute(routeName) {
  if (!routeAnnouncer) return;
  const label = ROUTE_NAMES[routeName] || routeName;
  // Clear first, then set on the next frame: an unchanged aria-live value
  // (e.g. navigating to the same view twice) wouldn't otherwise re-announce.
  routeAnnouncer.textContent = '';
  requestAnimationFrame(() => {
    routeAnnouncer.textContent = `${label} view`;
  });
}

/**
 * The organizers' notice bar, above everything.
 *
 * Never in an embed. When the embed was built this went the other way — the
 * banner is organizer content, and a same-day change should reach the people
 * reading the map on the organizers' own site too — but seeing it on the live
 * page settled it the other way round (Anthony, 2026-09-05): inside somebody
 * else's page a dismissible bar reads as the embed malfunctioning rather than
 * as the festival announcing something, and anything urgent can be said in the
 * Squarespace page itself, where it will look like it belongs.
 *
 * Not rendered rather than hidden, so the embed carries no dismiss button in
 * the tab order and never writes a dismissal to storage.
 */
function renderBanner() {
  const content = store.getContent();
  bannerRegion.innerHTML = '';
  if (!content || isEmbed()) return;
  const { banner_id: bannerId, banner_text: bannerText } = content.settings;
  if (!bannerText || store.isBannerDismissed(bannerId)) return;

  bannerRegion.innerHTML = `
    <div class="notice-banner" data-testid="notice-banner" role="status">
      <p class="notice-banner__text">${esc(bannerText)}</p>
      <button type="button" class="notice-banner__dismiss" data-testid="banner-dismiss" aria-label="Dismiss notice">&times;</button>
    </div>`;
  bannerRegion.querySelector('[data-testid="banner-dismiss"]').addEventListener('click', () => {
    store.dismissBanner(bannerId);
    renderBanner();
  });
}

function setActiveTab(routeName) {
  navLinks.forEach((a) => {
    const match = a.dataset.route === routeName;
    a.classList.toggle('is-active', match);
    if (match) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function handleRoute(route) {
  const generation = ++routeGeneration;
  const content = store.getContent();
  closeSheet();
  if (currentCleanup) {
    try { currentCleanup(); } catch { /* view cleanup is best-effort */ }
    currentCleanup = null;
  }
  viewEl.innerHTML = '';
  // The window is the scroll container now (see app.css "body"), so resetting
  // viewEl.scrollTop would be a no-op.
  window.scrollTo(0, 0);

  const name = route.parts[0] || 'now';
  const isDetailRoute = name === 'event' || name === 'venue';
  setActiveTab(isDetailRoute ? '' : name);
  if (!isDetailRoute) recordListRoute(location.hash || '#/now');

  let cleanup;
  switch (name) {
    case 'schedule':
      cleanup = renderSchedule(viewEl, content, route);
      break;
    case 'event':
      cleanup = renderEventDetail(viewEl, content, route.parts[1]);
      break;
    case 'venue':
      cleanup = renderVenueDetail(viewEl, content, route.parts[1]);
      break;
    case 'map':
      cleanup = await renderMap(viewEl, content);
      break;
    case 'starred':
      cleanup = renderStarred(viewEl, content);
      break;
    case 'vendors':
      cleanup = renderVendors(viewEl, content);
      break;
    case 'sponsors':
      cleanup = renderSponsors(viewEl, content);
      break;
    case 'now':
    default:
      cleanup = renderNow(viewEl, content);
  }

  // The map renders asynchronously, so another route can have taken over while
  // it loaded. Its cleanup still has to run — that is what unbinds the map's
  // listeners — but it must not replace the cleanup of the view now on screen.
  if (generation !== routeGeneration) {
    if (cleanup) {
      try { cleanup(); } catch { /* view cleanup is best-effort */ }
    }
    return;
  }
  currentCleanup = cleanup;

  setRouteTitle(name);
  announceRoute(name);
  // Move focus to the view container on every route change so keyboard/screen
  // reader users land on the new content instead of wherever they were on the
  // previous view (e.g. the nav link or a now-removed element). preventScroll
  // matters more now that the page scrolls: without it, focusing #view scrolls
  // the logo header off on every navigation.
  viewEl.focus({ preventScroll: true });
}

/**
 * Puts the page into embed presentation: no app header, no tab bar, pinned to
 * the embedded view.
 *
 * The pin is what makes the embed URL a single thing to paste — `?embed=map`
 * with no hash still opens the map — and it is only ever needed once, because
 * nothing inside the embed changes the hash afterwards. Links that would have
 * are caught below: with no tab bar, following one leaves the visitor on a
 * chrome-less page with no way back, so they open the full app in a new tab
 * instead. Today that is the venue sheet's per-event links, which is exactly
 * the path a visitor takes (tap a pin, read the venue, tap one of its events).
 *
 * Capture phase, so this runs before the handlers that close the sheet or
 * follow the link. Modified clicks are left alone: the browser's own
 * open-in-new-tab already does the right thing with the href.
 */
function startEmbed() {
  const route = embedRoute();
  document.body.classList.add('is-embed');
  // replaceState, not location.hash: an iframe's history entries land in the
  // top-level history, so assigning the hash would put a step between the
  // Squarespace page and wherever the visitor came from. The router reads
  // location.hash when it starts, moments from now, so no event is needed.
  if (!location.hash.startsWith(route)) history.replaceState(null, '', route);

  reportHeightToParent();

  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const link = event.target.closest?.('a[href^="#/"]');
      if (!link) return;
      const hash = link.getAttribute('href');
      if (hash.startsWith(route)) return;
      event.preventDefault();
      event.stopPropagation();
      window.open(fullAppUrl(hash), '_blank', 'noopener');
    },
    true
  );
}

function renderSplash() {
  viewEl.innerHTML = '<p class="splash">Loading festival info&hellip;</p>';
}

function renderOfflineError(retry) {
  viewEl.innerHTML = `
    <div class="empty-state empty-state--hero">
      <h1>Couldn't load the festival guide</h1>
      <p>We need one successful connection to download the map and schedule. After that, everything works offline.</p>
      <button type="button" class="btn btn--primary" id="retry-load">Try again</button>
    </div>`;
  viewEl.querySelector('#retry-load').addEventListener('click', retry);
}

// Resolves once boot has content to re-render and a router to re-render it
// with. A content-updated message that lands mid-boot waits on this rather than
// repainting a view that has no content yet.
let bootComplete;
const booted = new Promise((resolve) => { bootComplete = resolve; });

async function boot() {
  if (isEmbed()) startEmbed();
  renderSplash();
  try {
    const content = await store.loadContent();
    if (festivalNameEl && content.settings.festival_name) {
      festivalNameEl.textContent = content.settings.festival_name;
      // document.title is owned by setRouteTitle, which the router calls on
      // every route change — including the initial one, moments from now.
    }
  } catch {
    renderOfflineError(boot);
    return;
  }

  renderBanner();
  startRouter(handleRoute);
  bootComplete();
}

// Guarded so the app works identically with no service worker at all. Attached
// at module evaluation, not at the end of boot(): the worker revalidates
// content.json while the page is still loading it, and navigator.serviceWorker
// drops a message posted before any listener exists rather than queueing it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'content-updated') return;
    booted
      .then(() => store.refreshContent())
      .then(() => {
        renderBanner();
        handleRoute(parseHash());
      });
  });
}

initInstallPrompt();
requestPersistentStorage();
boot();
