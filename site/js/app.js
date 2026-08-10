import { esc } from './util.js';
import * as store from './store.js';
import { startRouter, parseHash, recordListRoute } from './router.js';
import { closeSheet } from './views/sheet.js';
import { renderNow } from './views/now.js';
import { renderSchedule } from './views/schedule.js';
import { renderEventDetail } from './views/event-detail.js';
import { renderMap } from './views/map.js';
import { renderStarred } from './views/starred.js';
import { renderVendors } from './views/vendors.js';
import { renderSponsors } from './views/sponsors.js';
import { requestPersistentStorage } from './persist-storage.js';
import { initInstallPrompt } from './pwa-install.js';

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
};

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

function renderBanner() {
  const content = store.getContent();
  bannerRegion.innerHTML = '';
  if (!content) return;
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
  setActiveTab(name === 'event' ? '' : name);
  if (name !== 'event') recordListRoute(location.hash || '#/now');

  let cleanup;
  switch (name) {
    case 'schedule':
      cleanup = renderSchedule(viewEl, content, route);
      break;
    case 'event':
      cleanup = renderEventDetail(viewEl, content, route.parts[1]);
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

  announceRoute(name);
  // Move focus to the view container on every route change so keyboard/screen
  // reader users land on the new content instead of wherever they were on the
  // previous view (e.g. the nav link or a now-removed element). preventScroll
  // matters more now that the page scrolls: without it, focusing #view scrolls
  // the logo header off on every navigation.
  viewEl.focus({ preventScroll: true });
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
  renderSplash();
  try {
    const content = await store.loadContent();
    if (festivalNameEl && content.settings.festival_name) {
      festivalNameEl.textContent = content.settings.festival_name;
      document.title = content.settings.festival_name;
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
