// Reflow at the 320 px floor (WCAG 1.4.10), which CONTRACTS.md also states
// outright: no two-dimensional scrolling, and the six-tab bar still fits.
// Every route is checked, not just the one that broke — the defect this
// pins was a single `align-self` on one control bar, and any view can grow
// the same way.
import { test, expect } from '@playwright/test';

const T = '?t=2026-10-03T15:00';

const ROUTES = [
  { name: 'Now', url: '/' + T, ready: '[data-testid="now-view"]' },
  { name: 'Schedule', url: '/' + T + '#/schedule', ready: '[data-testid="schedule-list"]' },
  { name: 'Map', url: '/' + T + '#/map', ready: '#circuit-map' },
  { name: 'Starred', url: '/' + T + '#/starred', ready: '[data-testid="starred-list"]' },
  { name: 'Vendors', url: '/' + T + '#/vendors', ready: '[data-testid="vendor-list"]' },
  { name: 'Support', url: '/' + T + '#/sponsors', ready: '[data-testid="sponsor-list"]' },
];

const overflow = (page) =>
  page.evaluate(() => {
    const el = document.scrollingElement;
    return el.scrollWidth - el.clientWidth;
  });

test.describe('at a 320 px viewport', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  for (const route of ROUTES) {
    test(`the ${route.name} view scrolls in one dimension only`, async ({ page }) => {
      await page.goto(route.url);
      await expect(page.locator(route.ready)).toBeVisible();
      expect(await overflow(page), `${route.name} overflows the document horizontally`).toBeLessThanOrEqual(0);
    });
  }

  test('the schedule grouped by venue scrolls in one dimension only', async ({ page }) => {
    await page.goto('/' + T + '#/schedule');
    await page.locator('.group-toggle .toggle-btn[data-group="venue"]').click();
    await expect(page.locator('.group-toggle .toggle-btn[data-group="venue"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  // The group toggle is wider than 320 px on purpose; it is allowed to scroll
  // inside itself, but not to widen the document the way it did when it
  // shrink-wrapped its buttons instead of stretching.
  test('the schedule group toggle absorbs its own overflow', async ({ page }) => {
    await page.goto('/' + T + '#/schedule');
    await expect(page.locator('[data-testid="schedule-list"]')).toBeVisible();

    const toggle = page.locator('.group-toggle');
    expect(await toggle.evaluate((el) => el.clientWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.scrollingElement.clientWidth),
    );
  });
});
