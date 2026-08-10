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

test('a pin\'s tappable area is the diamond itself, not a circle or box around it', async ({ page }) => {
  await page.goto('/' + T + '#/map');
  await expect(page.locator('#circuit-map')).toBeVisible();

  const pin = page.locator('[data-testid="venue-pin"]').first();
  const box = await pin.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Half-width of the pin's bounding box == the diamond's half-diagonal.
  const r = box.width / 2;

  // Dead centre opens the sheet.
  await page.mouse.click(cx, cy);
  await expect(page.locator('.sheet[role="dialog"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet[role="dialog"]')).toBeHidden();

  // A point on the 45° diagonal at 0.85r from centre: inside the old circular
  // hit area (which reached r in every direction), outside the diamond (whose
  // edge is only r/√2 ≈ 0.707r away diagonally). Nothing should open.
  const diag = (0.85 * r) / Math.SQRT2;
  await page.mouse.click(cx + diag, cy - diag);
  await expect(page.locator('.sheet[role="dialog"]')).toBeHidden();
});

test('dragging the map pans it without sweeping a text selection across the labels', async ({ page }) => {
  await page.goto('/' + T + '#/map');
  const svg = page.locator('#circuit-map');
  await expect(svg).toBeVisible();

  const box = await svg.boundingBox();
  const startX = box.x + box.width * 0.7;
  const startY = box.y + box.height * 0.7;

  const before = await svg.getAttribute('viewBox');
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several steps so the browser sees a real drag, not a jump.
  await page.mouse.move(startX - 120, startY - 90, { steps: 12 });
  await page.mouse.up();

  // It panned...
  expect(await svg.getAttribute('viewBox')).not.toBe(before);
  // ...and selected nothing on the way.
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
});

// Genuine two-finger pinch is out of scope here (it needs real multi-touch);
// double-tap is the other half of the same gesture handler and is reachable
// with a mouse, so it is the half worth pinning.
test('double-tapping the map zooms in, and double-tapping again at full zoom returns home', async ({ page }) => {
  await page.goto('/' + T + '#/map');
  const svg = page.locator('#circuit-map');
  await expect(svg).toBeVisible();

  const viewWidth = async () => Number((await svg.getAttribute('viewBox')).split(/\s+/)[2]);

  // A pin under the tap opens its sheet instead of zooming, so the tap point is
  // found rather than hardcoded — the map's artwork and pin set both change.
  const spot = await page.evaluate(() => {
    const rect = document.querySelector('#circuit-map').getBoundingClientRect();
    for (let fy = 0.1; fy < 0.95; fy += 0.1) {
      for (let fx = 0.1; fx < 0.95; fx += 0.1) {
        const x = rect.left + rect.width * fx;
        const y = rect.top + rect.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el?.closest('#circuit-map') && !el.closest('.pin')) return { x, y };
      }
    }
    return null;
  });
  expect(spot, 'no pin-free point found on the map to tap').not.toBeNull();

  const homeWidth = await viewWidth();
  await page.mouse.click(spot.x, spot.y);
  await page.mouse.click(spot.x, spot.y);
  expect(await viewWidth()).toBeCloseTo(homeWidth / 2, 0);
  // A zoom, not a pin activation.
  await expect(page.locator('.sheet[role="dialog"]')).toBeHidden();

  // Already as close as the map goes, a double-tap is the way back out —
  // otherwise the gesture strands someone zoomed in with no obvious escape.
  for (let i = 0; i < 5; i++) await page.locator('#zoom-in').click();
  expect(await viewWidth()).toBeLessThan(homeWidth);
  await page.mouse.click(spot.x, spot.y);
  await page.mouse.click(spot.x, spot.y);
  expect(await viewWidth()).toBeCloseTo(homeWidth, 0);
});

// Regression: this silently stopped working when a variable was renamed during
// a map rework. The failure was a ReferenceError inside the geolocation success
// callback, so nothing rendered and nothing obvious surfaced — exactly the kind
// of break a screenshot pass can't catch, since the button is never pressed.
test('the locate button drops a "you are here" dot at the reported position', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 44.9599, longitude: -93.1667 }); // Hamline Park

  await page.goto('/' + T + '#/map');
  await expect(page.locator('#circuit-map')).toBeVisible();

  const dot = page.locator('[data-testid="you-are-here"]');
  await expect(dot).toBeHidden();

  await page.click('#locate-btn');
  await expect(dot).toBeVisible();

  // Positioned at the festival center, which is where the home view is centered.
  const transform = await dot.getAttribute('transform');
  const [x, y] = transform.match(/-?[\d.]+/g).map(Number);
  const home = await page.evaluate(async () => (await (await fetch('assets/map-calibration.json')).json()).home_center);
  expect(Math.abs(x - home.x)).toBeLessThan(50);
  expect(Math.abs(y - home.y)).toBeLessThan(50);
});

test('a location outside the map area reports it instead of dropping a dot', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 45.5, longitude: -122.6 }); // Portland, OR — far outside

  await page.goto('/' + T + '#/map');
  await expect(page.locator('#circuit-map')).toBeVisible();
  await page.click('#locate-btn');

  await expect(page.locator('#toast-root')).toContainText(/outside the map area/i);
  await expect(page.locator('[data-testid="you-are-here"]')).toBeHidden();
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

// The two rail lines draw at identical weight and differ only in hue, so the
// legend is the only thing that can name them — and the Blue Line has no
// station pins in range either, so without it nothing on the page identifies
// it at all.
test('the legend names both rail lines in the colors the map draws them', async ({ page }) => {
  await page.goto('/' + T + '#/map');
  await expect(page.locator('#circuit-map')).toBeVisible();

  const legend = page.locator('.map-legend__list');
  await expect(legend).toContainText('METRO Green Line');
  await expect(legend).toContainText('METRO Blue Line');

  for (const line of ['green', 'blue']) {
    const swatch = await page.locator(`.legend-icon--rail-${line} line`).evaluate((el) => getComputedStyle(el).stroke);
    const rail = await page.locator(`#circuit-map .rail-${line}`).evaluate((el) => getComputedStyle(el).stroke);
    expect(swatch, `${line} line swatch does not match the rail it stands for`).toBe(rail);
  }
});

// WCAG relative luminance, so the assertion below states the ratio the
// criterion names rather than pinning a hex value that says nothing about
// whether the star is actually visible.
function contrastRatio(a, b) {
  const luminance = (rgb) => {
    const [r, g, b2] = rgb.map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The star's own background is transparent, so the ground it is read against
// is whichever ancestor actually paints one.
const starColors = (page) =>
  page.locator('[data-testid="row-star-toggle"]').first().evaluate((el) => {
    const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    let ground = el;
    while (ground && getComputedStyle(ground).backgroundColor.startsWith('rgba(0, 0, 0, 0')) ground = ground.parentElement;
    return { star: parse(getComputedStyle(el).color), ground: parse(getComputedStyle(ground).backgroundColor) };
  });

test('the star reads against its card whether the event is saved or not', async ({ page }) => {
  await page.goto('/' + T + '#/schedule');
  await expect(page.locator('[data-testid="schedule-list"]')).toBeVisible();
  const star = page.locator('[data-testid="row-star-toggle"]').first();

  await expect(star).toHaveAttribute('aria-pressed', 'false');
  const unsaved = await starColors(page);
  expect(contrastRatio(unsaved.star, unsaved.ground), 'unsaved star').toBeGreaterThanOrEqual(3);

  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  const saved = await starColors(page);
  // The saved state is the one the eye has to find on a screenful of rows.
  expect(contrastRatio(saved.star, saved.ground), 'saved star').toBeGreaterThanOrEqual(3);
});

// The map view is where this reproduces — its venue key list is the longest
// run of focusables below the fold — but the mechanism is generic: the tab
// bar is fixed over the bottom of every route.
test('tabbing down the map view never parks focus behind the fixed tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/' + T + '#/map');
  await expect(page.locator('#circuit-map')).toBeVisible();

  const obscured = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const covered = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && (hit === el || el.contains(hit))) return null;
      return `${el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40) || el.tagName} (covered by ${hit ? hit.tagName + '.' + hit.className : 'nothing — off screen'})`;
    });
    if (covered) obscured.push(covered);
  }

  expect(obscured).toEqual([]);
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
