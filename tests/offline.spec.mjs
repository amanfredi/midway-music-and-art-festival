// The acceptance criterion (DEFINITION.md): after one online visit, the site
// must work fully offline — schedule, map, starred events — across reloads.
// Run against the built site (`npm run build` first; `npm test` does both).
import { test, expect } from '@playwright/test';

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

  // map renders offline with venue pins
  await page.goto('/' + T + '#/map');
  await expect(page.locator('#circuit-map')).toBeVisible();
  expect(await page.locator('[data-testid="venue-pin"]').count()).toBe(8);

  // sponsors render offline with bundled logos
  await page.goto('/' + T + '#/sponsors');
  await expect(page.locator('[data-testid="sponsor-list"]')).toBeVisible();
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
