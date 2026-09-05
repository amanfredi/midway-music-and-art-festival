// Web Share (CONTRACTS.md "Share button" / definitions/web-share.md):
// navigator.share where present, clipboard + toast fallback otherwise, and
// the standalone #/venue/<id> route that gives a venue a URL to share.
import { test, expect } from '@playwright/test';

const T = '?t=2026-10-03T15:00';

// The test port is per-checkout (playwright.config.mjs), so the expected
// share URLs must come from baseURL rather than a hardcoded origin.
let ORIGIN;
test.beforeEach(({ baseURL }) => {
  ORIGIN = baseURL + '/';
});

async function stubShare(page, rejectName) {
  await page.addInitScript((name) => {
    window.__shareCalls = [];
    navigator.share = (data) => {
      window.__shareCalls.push(data);
      if (name) {
        const err = new Error(name);
        err.name = name;
        return Promise.reject(err);
      }
      return Promise.resolve();
    };
  }, rejectName);
}

test('sharing an event calls navigator.share with the event title and a URL ending at its route', async ({ page }) => {
  await stubShare(page);
  await page.goto('/' + T + '#/event/pottery-showcase');
  await page.locator('[data-testid="share-btn"]').click();

  const calls = await page.evaluate(() => window.__shareCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].title).toBe('Pottery Showcase');
  expect(calls[0].url).toBe(ORIGIN + '#/event/pottery-showcase');
  expect(calls[0]).not.toHaveProperty('text');
});

// The venue sheet shares the same builder as the route (sheet.js), so this is
// the one place the payload needs pinning for venues too — separate sheet
// coverage would be redundant.
test('sharing a venue calls navigator.share with the venue name and a URL ending at its route', async ({ page }) => {
  await stubShare(page);
  await page.goto('/' + T + '#/venue/creativewritinghouse');
  await page.locator('[data-testid="share-btn"]').click();

  const calls = await page.evaluate(() => window.__shareCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].title).toBe('Creative Writing House');
  expect(calls[0].url).toBe(ORIGIN + '#/venue/creativewritinghouse');
});

test('a shared URL strips the demo-clock param', async ({ page }) => {
  await stubShare(page);
  await page.goto('/' + T + '#/event/pottery-showcase');
  await page.locator('[data-testid="share-btn"]').click();

  const [call] = await page.evaluate(() => window.__shareCalls);
  expect(call.url).not.toContain('t=');
  expect(call.url).toBe(ORIGIN + '#/event/pottery-showcase');
});

test('cancelling the OS share sheet (AbortError) shows no toast and surfaces no error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubShare(page, 'AbortError');
  await page.goto('/' + T + '#/event/pottery-showcase');
  await page.locator('[data-testid="share-btn"]').click();
  await page.waitForTimeout(300);

  await expect(page.locator('.toast')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with no Web Share API, Share copies the link and shows a toast', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => { delete navigator.share; });
  await page.goto('/' + T + '#/event/pottery-showcase');
  await page.locator('[data-testid="share-btn"]').click();

  await expect(page.locator('#toast-root')).toContainText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ORIGIN + '#/event/pottery-showcase');
});

// creativewritinghouse has events on Oct 3 and Oct 4 only (no Oct 2) — at the
// Oct 3 demo clock, the sheet's "today" filter would show just the Oct 3 set;
// the route's all-days list is the one deliberate divergence from the sheet.
test('#/venue/<id> renders standalone with every festival day, grouped by day', async ({ page }) => {
  await page.goto('/' + T + '#/venue/creativewritinghouse');
  const view = page.locator('[data-testid="venue-view"]');

  await expect(view).toBeVisible();
  await expect(view.locator('h1')).toHaveText('Creative Writing House');
  await expect(view).toContainText('1500 Englewood Ave');
  await expect(view).toContainText('Pottery Showcase'); // Oct 3
  await expect(view).toContainText('Street Art Showcase'); // Oct 4 — not in "today"
  await expect(view.locator('.event-group__title')).toHaveCount(2);
  await expect(view.locator('[data-testid="share-btn"]')).toBeVisible();
});

test('#/venue/<id> for an unknown id degrades to the not-found state with a way back', async ({ page }) => {
  await page.goto('/' + T + '#/venue/no-such-venue');
  const view = page.locator('[data-testid="venue-view"]');

  await expect(view).toBeVisible();
  await expect(view).toContainText("couldn't be found");
  await expect(view.locator('a[href="#/map"]')).toBeVisible();
});
