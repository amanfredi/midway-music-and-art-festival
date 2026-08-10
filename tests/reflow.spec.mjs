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

// WCAG 1.4.12's four overrides, the values the criterion names. A reader
// applying them with a browser extension or user stylesheet must not lose
// content — nothing may be clipped or pushed off the side.
const TEXT_SPACING_OVERRIDES = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

// Elements that opt into scrolling (the schedule's two control bars) hold
// more than fits by design; anything else overflowing its own box is text
// painting over its neighbour. Elements are keyed by document order so the
// same element can be compared before and after the overrides land — the
// criterion asks that *applying* the spacing loses nothing, so a box that
// already bleeds by design (the full-width control bar) is not the subject.
const spills = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#view *')].flatMap((el, i) => {
      if (el.scrollWidth - el.clientWidth <= 1 || getComputedStyle(el).overflowX !== 'visible') return [];
      const cls = typeof el.className === 'string' ? el.className : el.className.baseVal || '';
      return [`${i} ${el.tagName.toLowerCase()}.${cls.split(' ').filter(Boolean).join('.')} — "${(el.textContent || '').trim().slice(0, 40)}"`];
    }),
  );

test.describe('under the text-spacing overrides at 320 px', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  for (const route of ROUTES) {
    test(`the ${route.name} view loses no content to the text-spacing overrides`, async ({ page }) => {
      await page.goto(route.url);
      await expect(page.locator(route.ready)).toBeVisible();
      const before = await spills(page);

      await page.addStyleTag({ content: TEXT_SPACING_OVERRIDES });

      expect(await overflow(page), `${route.name} overflows the document once text spacing grows`).toBeLessThanOrEqual(0);
      const introduced = (await spills(page)).filter((s) => !before.includes(s));
      expect(introduced, `${route.name} spills content out of its boxes`).toEqual([]);
    });
  }
});
