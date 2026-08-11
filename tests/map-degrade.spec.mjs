// MapLibre requires WebGL2, and that floor is accepted rather than worked
// around (decided 2026-08-10). What this pins is that accepting it does not mean
// shipping a blank square: on a device that cannot run the engine, the map view
// still has to say so and still has to get someone to a venue.
//
// The no-WebGL2 path is forced by making `getContext('webgl2')` return null
// before any of the app's code runs. That is the exact call the detection makes,
// so the stub reproduces the real condition rather than approximating it — and
// it needs no device, no flag and no separate browser build.
import { test, expect } from '@playwright/test';

const T = '?t=2026-10-03T15:00';

test.describe('without WebGL2', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        // Only WebGL2 is refused; 2d still works, so anything else the page
        // draws behaves normally and the test isolates the one condition.
        if (type === 'webgl2') return null;
        return real.call(this, type, ...rest);
      };
    });
  });

  test('the map view explains itself instead of rendering a blank frame', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));

    await page.goto('/' + T + '#/map');

    const notice = page.locator('[data-testid="map-unsupported"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/can.t display the interactive map/i);

    // No canvas, and no controls steering a map that isn't there.
    await expect(page.locator('#map-gl')).toHaveCount(0);
    await expect(page.locator('.map-controls')).toHaveCount(0);
    await expect(page.locator('.map-pan')).toHaveCount(0);
    // Failing to render a map is not the same as throwing.
    expect(consoleErrors).toEqual([]);
  });

  // The whole value of degrading rather than failing: the list below the frame
  // still names every venue and still opens its sheet, so a phone that cannot
  // draw the map can still find and navigate to a place.
  test('the venue key list still lists every venue and taps through to sheets', async ({ page }) => {
    await page.goto('/' + T + '#/map');
    await expect(page.locator('[data-testid="map-unsupported"]')).toBeVisible();

    const venues = await page.evaluate(
      async () => (await (await fetch('data/content.json')).json()).venues.filter((v) => v.lat != null),
    );
    expect(venues.length).toBeGreaterThan(0);

    const buttons = page.locator('.venue-key-btn');
    await expect(buttons).toHaveCount(venues.length);

    // Matched by id, not by the button's text: the button also contains its
    // numbered pin glyph, so its textContent is "1Midway Saloon".
    const first = buttons.first();
    const id = await first.getAttribute('data-venue-id');
    const name = venues.find((v) => v.id === id).name;
    await first.click();
    const dialog = page.locator('.sheet[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#sheet-title')).toHaveText(name);
    // The sheet is the route to the venue, so the directions link has to be in it.
    await expect(dialog.locator('a[href*="google.com/maps"]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the engine is never fetched when it cannot be used', async ({ page }) => {
    const engineRequests = [];
    page.on('request', (r) => {
      if (/maplibre/.test(r.url())) engineRequests.push(r.url());
    });

    await page.goto('/' + T + '#/map');
    await expect(page.locator('[data-testid="map-unsupported"]')).toBeVisible();
    // Give any stray dynamic import a chance to show up before asserting.
    await page.waitForTimeout(500);

    expect(engineRequests, 'the map engine was requested on a device that cannot run it').toEqual([]);
  });
});
