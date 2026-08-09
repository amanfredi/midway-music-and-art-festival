// Accessibility hardening (Wave 2): focus management on route change and
// sheet open/close, and keyboard map panning. Runs against the built site,
// same as offline.spec.mjs.
import { test, expect } from '@playwright/test';

const T = '?t=2026-10-03T15:00';

test('route change moves focus to the view container and announces the destination', async ({ page }) => {
  await page.goto('/' + T);
  await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
  await expect(page.locator('#view')).toBeFocused();
  await expect(page.locator('#route-announcer')).toHaveText(/Now/);

  await page.locator('.tab-bar a[data-route="schedule"]').click();
  await expect(page.locator('[data-testid="schedule-list"]')).toBeVisible();
  await expect(page.locator('#view')).toBeFocused();
  await expect(page.locator('#route-announcer')).toHaveText(/Schedule/);
});

test('opening the venue sheet moves focus into the dialog; closing it restores focus to the trigger', async ({ page }) => {
  await page.goto('/' + T + '#/map');
  await expect(page.locator('#circuit-map')).toBeVisible();

  const trigger = page.locator('.venue-key-btn').first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.locator('.sheet[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog).toHaveAttribute('aria-labelledby', 'sheet-title');
  await expect(page.locator('#sheet-title')).not.toHaveText('');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('a transit pin opens a sheet naming the lines that serve the stop', async ({ page }) => {
  await page.goto('/' + T + '#/map');
  await expect(page.locator('#circuit-map')).toBeVisible();

  // Snelling & University is the transfer point: one pin, two lines, and the
  // case the single-maps-link decision was made for (CONTRACTS.md).
  const pin = page.locator('[data-transit-id="snelling-avenue-and-university-station"]');
  await expect(pin).toBeVisible();
  await pin.press('Enter');

  const dialog = page.locator('.sheet[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText('Snelling Avenue & University Station');
  await expect(dialog.locator('.sheet__line-list li')).toHaveText([
    'METRO Green Line',
    'METRO A Line',
  ]);
  // Exactly one maps link, not one per line.
  await expect(dialog.locator('a[href*="google.com/maps"]')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(pin).toBeFocused();
});

test('the map opens at the home view, not the full extent, and can pan in every direction', async ({ page }) => {
  await page.goto('/' + T + '#/map');
  const svg = page.locator('#circuit-map');
  await expect(svg).toBeVisible();

  const parseVb = async () => (await svg.getAttribute('viewBox')).split(/\s+/).map(Number);
  const [x0, y0, w0, h0] = await parseVb();

  // Home view is a ~3km square well inside the ~9.7 x 6.4 km map, and is not
  // pinned to any edge — the point of the change is that there is somewhere to
  // drag to in all four directions from the default view.
  expect(w0).toBeCloseTo(h0, 0);
  expect(w0).toBeLessThan(4000);
  expect(x0).toBeGreaterThan(0);
  expect(y0).toBeGreaterThan(0);

  await svg.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await parseVb())[0]).toBeLessThan(x0);
  await page.keyboard.press('ArrowUp');
  expect((await parseVb())[1]).toBeLessThan(y0);

  // Zooming out reveals more map than the home view showed.
  await page.click('#zoom-out');
  expect((await parseVb())[2]).toBeGreaterThan(w0);
});

test('map canvas is keyboard-focusable and arrow keys pan it once zoomed in', async ({ page }) => {
  await page.goto('/' + T + '#/map');
  const svg = page.locator('#circuit-map');
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute('tabindex', '0');
  expect(await svg.getAttribute('aria-label')).toMatch(/arrow keys/i);

  // Fully zoomed out, the view already fills the whole map -- there's no
  // room to pan (same clamping as drag-panning), so zoom in first.
  await page.locator('#zoom-in').click();
  await page.locator('#zoom-in').click();
  const viewBoxBefore = await svg.getAttribute('viewBox');

  await svg.focus();
  await expect(svg).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const viewBoxAfter = await svg.getAttribute('viewBox');
  expect(viewBoxAfter).not.toBe(viewBoxBefore);
});
