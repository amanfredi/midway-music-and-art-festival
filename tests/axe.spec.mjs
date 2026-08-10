// Automated WCAG 2.2 A/AA gate: axe-core over every UI route in CONTRACTS.md,
// plus the states a route-only scan never reaches — an open sheet, a visible
// toast, the schedule's other grouping, a starred list with rows in it.
// The August 2026 audit (reviews/2026-08-wcag-aa-audit.md) found zero
// violations across these scans, so the gate carries no exclusions: any
// violation here is a regression introduced since.
//
// axe covers a minority of the AA criteria. The rest are pinned by
// tests/a11y.spec.mjs, by computation in the audit, or by the human device
// checklist in BACKLOG.md — a clean run here is not a conformance claim.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoMap, waitForMapIdle } from './map-helpers.mjs';

const T = '?t=2026-10-03T15:00';

// axe's tags for WCAG 2.0/2.1/2.2 Level A and AA. Its best-practice and AAA
// rules are deliberately out: they are advisory, and failing the build on
// them would make the gate something other than an AA gate.
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
  const readable = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n      ${v.nodes.map((n) => n.target.join(' ')).join('\n      ')}`,
  );
  expect(readable, `axe violations — ${label}`).toEqual([]);
}

// The notice banner is present in every scan: the fixtures ship a banner_id
// and nothing here dismisses it.
const ROUTES = [
  { name: 'Now', url: '/' + T, ready: '[data-testid="now-view"]' },
  { name: 'Schedule', url: '/' + T + '#/schedule', ready: '[data-testid="schedule-list"]' },
    // The map is a canvas: 'ready' has to mean the engine finished drawing, not
  // that an element exists. See mapReady below.
  { name: 'Map', url: '/' + T + '#/map', ready: '[data-testid="map-canvas"]', map: true },
  { name: 'Starred', url: '/' + T + '#/starred', ready: '[data-testid="starred-list"]' },
  { name: 'Vendors', url: '/' + T + '#/vendors', ready: '[data-testid="vendor-list"]' },
  { name: 'Support', url: '/' + T + '#/sponsors', ready: '[data-testid="sponsor-list"]' },
];

for (const route of ROUTES) {
  test(`${route.name} view has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(route.url);
    await expect(page.locator(route.ready)).toBeVisible();
    if (route.map) await waitForMapIdle(page);
    await expectNoViolations(page, route.name);
  });
}

test('event detail has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/' + T + '#/schedule');
  await expect(page.locator('[data-testid="schedule-list"]')).toBeVisible();
  await page.locator('[data-testid="event-row"] a').first().click();

  await expect(page.locator('[data-testid="star-toggle"]')).toBeVisible();
  await expectNoViolations(page, 'event detail');
});

test('the schedule grouped by venue has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/' + T + '#/schedule');
  await page.locator('.group-toggle .toggle-btn[data-group="venue"]').click();
  await expect(page.locator('.group-toggle .toggle-btn[data-group="venue"]')).toHaveAttribute('aria-pressed', 'true');
  await expectNoViolations(page, 'schedule grouped by venue');
});

test('an open venue sheet has no WCAG A/AA violations', async ({ page }) => {
  await gotoMap(page);
  await page.locator('.venue-key-btn').first().click();

  await expect(page.locator('.sheet[role="dialog"]')).toBeVisible();
  await expectNoViolations(page, 'venue sheet open');
});

test('a visible toast has no WCAG A/AA violations', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 45.5, longitude: -122.6 }); // Portland, OR — outside the map
  await gotoMap(page);
  await page.click('#locate-btn');

  await expect(page.locator('#toast-root')).toContainText(/outside the map area/i);
  // Scanning mid-fade measures the toast's text blended with whatever is
  // behind it, which axe reports as a contrast failure that does not exist
  // once the transition settles.
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.toast')).opacity === '1');
  await expectNoViolations(page, 'toast visible');
});

test('the starred view with rows in it has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/' + T + '#/schedule');
  await page.locator('[data-testid="row-star-toggle"]').first().click();
  await page.locator('.tab-bar a[data-route="starred"]').click();

  await expect(page.locator('[data-testid="starred-list"] [data-testid="event-row"]').first()).toBeVisible();
  await expectNoViolations(page, 'starred with rows');
});
