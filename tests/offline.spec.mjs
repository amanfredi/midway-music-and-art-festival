// The acceptance criterion (DEFINITION.md): after one online visit, the site
// must work fully offline — schedule, map, starred events — across reloads.
// Run against the built site (`npm run build` first; `npm test` does both).
import { test, expect } from '@playwright/test';
import { waitForMapIdle, mapEval, sourceFeatures } from './map-helpers.mjs';

// Demo clock inside the festival weekend so "on now" has content.
const T = '?t=2026-10-03T15:00';

async function waitForServiceWorker(page) {
  await page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.controller !== null,
    { timeout: 30_000 },
  );
}

test('full offline reload: schedule, map, and stars survive airplane mode', async ({ page, context }) => {
  // --- online first visit: let the service worker install and precache
  await page.goto('/' + T);
  await waitForServiceWorker(page);
  await expect(page.locator('[data-testid="now-view"]')).toBeVisible();

  // star an event from the schedule
  await page.goto('/' + T + '#/schedule');
  const firstRow = page.locator('[data-testid="event-row"]').first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  const star = page.locator('[data-testid="star-toggle"]');
  await expect(star).toBeVisible();
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  // --- go offline and hard-reload the tab (the iOS-eviction analogue)
  await context.setOffline(true);
  await page.reload();

  // app shell + content render offline
  await expect(page.locator('[data-testid="star-toggle"]')).toBeVisible();

  // a fresh offline navigation (new URL, not just reload) also works
  await page.goto('/' + T + '#/schedule');
  await expect(page.locator('[data-testid="schedule-list"]')).toBeVisible();
  expect(await page.locator('[data-testid="event-row"]').count()).toBeGreaterThan(10);

  // The map renders offline: the engine's four modules, the street GeoJSON and
  // the calibration all come from precache. This is the heaviest thing the
  // service worker carries, so it is the part most worth asserting offline.
  await page.goto('/' + T + '#/map');
  await waitForMapIdle(page);
  const venueCount = await page.evaluate(async () => (await (await fetch('data/content.json')).json()).venues.length);
  expect(venueCount).toBeGreaterThan(0);

  // The venue count is checked against the source the map draws from, not
  // against symbols on screen: pins close together combine into a cluster at
  // the home view, so the number drawn is deliberately not the number of
  // venues. What the render has to show is that both the ground and the pins
  // came back from cache.
  expect((await sourceFeatures(page, 'venues')).length).toBe(venueCount);
  const drawn = await mapEval(page, (map) => ({
    streets: map.queryRenderedFeatures({ layers: ['arterial-fill', 'spine-fill'] }).length,
    symbols:
      map.queryRenderedFeatures({ layers: ['venue-pin'] }).length +
      map.queryRenderedFeatures({ layers: ['venue-cluster'] }).length,
  }));
  expect(drawn.streets, 'street geometry did not render offline').toBeGreaterThan(0);
  expect(drawn.symbols, 'no venue pins or clusters rendered offline').toBeGreaterThan(0);

  // Transit pins are a *subset* of the committed transit.json (offline: served
  // from precache): the map now spans both downtowns, so only stops within
  // TRANSIT_PIN_RADIUS_M of the festival get a pin. Asserted while still on
  // the map view. What matters offline is that the file was cached and pins
  // rendered from it — not the exact count.
  const transitStopCount = await page.evaluate(async () => (await (await fetch('assets/transit.json')).json()).stops.length);
  expect(transitStopCount).toBeGreaterThan(0);
  const transitPinCount = (await sourceFeatures(page, 'transit')).length;
  expect(transitPinCount).toBeGreaterThan(0);
  expect(transitPinCount).toBeLessThanOrEqual(transitStopCount);

  // vendors render offline
  await page.goto('/' + T + '#/vendors');
  await expect(page.locator('[data-testid="vendor-list"]')).toBeVisible();

  // sponsors render offline with bundled logos, and the donate link is present
  await page.goto('/' + T + '#/sponsors');
  await expect(page.locator('[data-testid="sponsor-list"]')).toBeVisible();
  await expect(page.locator('[data-testid="donate-link"]')).toBeVisible();
  const logoOk = await page
    .locator('[data-testid="sponsor-list"] img')
    .first()
    .evaluate((img) => img.complete && img.naturalWidth > 0);
  expect(logoOk).toBe(true);

  // the star persisted through the offline reload
  await page.goto('/' + T + '#/starred');
  await expect(page.locator('[data-testid="starred-list"]')).toBeVisible();
  expect(await page.locator('[data-testid="starred-list"] [data-testid="event-row"]').count()).toBe(1);
});

test('notice banner shows and dismissal persists offline', async ({ page, context }) => {
  await page.goto('/' + T);
  await waitForServiceWorker(page);
  const banner = page.locator('[data-testid="notice-banner"]');
  await expect(banner).toBeVisible();
  await page.locator('[data-testid="banner-dismiss"]').click();
  await expect(banner).toBeHidden();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="notice-banner"]')).toHaveCount(0);
});

test('row star toggle updates immediately without scroll jump, and survives an offline reload', async ({ page, context }) => {
  await page.goto('/' + T);
  await waitForServiceWorker(page);
  await page.goto('/' + T + '#/schedule');

  const rows = page.locator('[data-testid="event-row"]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  // A row further down the list, so bringing it into view requires an actual
  // scroll — proving the assertion below isn't vacuously true at scrollTop 0.
  const targetRow = rows.nth(Math.min(6, count - 1));
  const star = targetRow.locator('[data-testid="row-star-toggle"]');
  const eventId = await star.getAttribute('data-event-id');
  await expect(star).toHaveAttribute('aria-pressed', 'false');

  // Scroll the target row into view *before* recording scrollBefore — a raw
  // star.click() would auto-scroll to reach an off-screen element first,
  // which would falsely look like "the toggle changed the scroll position".
  // The page itself is the scroll container (app.css "body"), not #view.
  await star.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);

  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // --- go offline and reload: the star (localStorage) survives
  await context.setOffline(true);
  await page.reload();
  const sameStar = page.locator(`[data-testid="row-star-toggle"][data-event-id="${eventId}"]`);
  await expect(sameStar).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/' + T + '#/starred');
  await expect(page.locator('[data-testid="starred-list"]')).toBeVisible();
  expect(await page.locator('[data-testid="starred-list"] [data-testid="event-row"]').count()).toBe(1);
});

test('PWA installability basics: manifest, icons, service worker scope', async ({ page, request }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('manifest.webmanifest');
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const res = await request.get('/' + icon.src);
    expect(res.status(), icon.src).toBe(200);
  }
  await waitForServiceWorker(page);
  const swInfo = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { scope: reg.scope, active: !!reg.active };
  });
  expect(swInfo.active).toBe(true);
});
