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
