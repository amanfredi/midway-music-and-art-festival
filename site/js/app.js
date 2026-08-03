import { esc } from './util.js';
import * as store from './store.js';
import { startRouter, parseHash, recordListRoute } from './router.js';
import { closeSheet } from './views/sheet.js';
import { renderNow } from './views/now.js';
import { renderSchedule } from './views/schedule.js';
import { renderEventDetail } from './views/event-detail.js';
import { renderMap } from './views/map.js';
import { renderStarred } from './views/starred.js';
import { renderSponsors } from './views/sponsors.js';
import { requestPersistentStorage } from './persist-storage.js';
import { initInstallPrompt } from './pwa-install.js';

const viewEl = document.getElementById('view');
const bannerRegion = document.getElementById('banner-region');
const festivalNameEl = document.getElementById('festival-name');
const navLinks = [...document.querySelectorAll('.tab-bar a')];

let currentCleanup = null;

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
  const content = store.getContent();
  closeSheet();
  if (currentCleanup) {
    try { currentCleanup(); } catch { /* view cleanup is best-effort */ }
    currentCleanup = null;
  }
  viewEl.innerHTML = '';
  viewEl.scrollTop = 0;

  const name = route.parts[0] || 'now';
  setActiveTab(name === 'event' ? '' : name);
  if (name !== 'event') recordListRoute(location.hash || '#/now');

  switch (name) {
    case 'schedule':
      currentCleanup = renderSchedule(viewEl, content, route);
      break;
    case 'event':
      currentCleanup = renderEventDetail(viewEl, content, route.parts[1]);
      break;
    case 'map':
      currentCleanup = await renderMap(viewEl, content);
      break;
    case 'starred':
      currentCleanup = renderStarred(viewEl, content);
      break;
    case 'sponsors':
      currentCleanup = renderSponsors(viewEl, content);
      break;
    case 'now':
    default:
      currentCleanup = renderNow(viewEl, content);
  }
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

  // Guarded so the app works identically with no service worker at all.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'content-updated') {
        store.refreshContent().then(() => {
          renderBanner();
          handleRoute(parseHash());
        });
      }
    });
  }
}

initInstallPrompt();
requestPersistentStorage();
boot();
