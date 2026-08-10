// The two localStorage-backed bits of state (site/js/store.js): starred events
// and the dismissed notice banner.
//
// Both key names are a contract with every phone that has already used the
// site — a rename orphans real attendees' data, and nothing else in the suite
// would notice. So the keys are spelled out literally here rather than
// imported from the app, and each test seeds or reads storage directly.
import { test, expect } from '@playwright/test';

const T = '?t=2026-10-03T15:00';

const currentBannerId = async (request) => (await (await request.get('/data/content.json')).json()).settings.banner_id;

test('a new banner_id re-shows the notice to someone who dismissed the previous one', async ({ page, request }) => {
  // The banner is the day-of update channel: "main stage running 30 min late".
  // Dismissal stores the id that was dismissed rather than a boolean, so a new
  // id has to bring the banner back — otherwise the people who used the site
  // earliest, and dismissed the earlier notice, are exactly the people who
  // never see the new one.
  const staleId = (await currentBannerId(request)) + '-previous';
  await page.addInitScript((id) => {
    localStorage.setItem('mfc:dismissed-banner', id);
  }, staleId);

  await page.goto('/' + T);
  await expect(page.locator('[data-testid="notice-banner"]')).toBeVisible();
});

test('a banner dismissed by its own id stays hidden on a later visit', async ({ page, request }) => {
  // The counterpart, and what makes the test above meaningful: seeding the
  // *current* id keeps the banner away with no interaction, which pins the
  // check to the id rather than to "something was dismissed once".
  await page.addInitScript((id) => {
    localStorage.setItem('mfc:dismissed-banner', id);
  }, await currentBannerId(request));

  await page.goto('/' + T);
  await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="notice-banner"]')).toHaveCount(0);
});

test('starring an event stores it under the mfc:starred key', async ({ page }) => {
  await page.goto('/' + T + '#/schedule');
  const star = page.locator('[data-testid="row-star-toggle"]').first();
  await expect(star).toBeVisible();
  const eventId = await star.getAttribute('data-event-id');

  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  const stored = await page.evaluate(() => localStorage.getItem('mfc:starred'));
  expect(stored, 'stars must live under the literal key mfc:starred').not.toBeNull();
  expect(JSON.parse(stored)).toEqual([eventId]);
});
