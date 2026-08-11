// Map interaction items landed 2026-08-10/11: keyboard/AT path to transit and
// sponsor pins, tap highlight + venue-card→map link, pan buttons (WCAG 2.5.7),
// the scale bar, the locate denial copy, and "Venue N" in the key list's
// accessible names.
//
// Everything about pins goes through `window.__mmafMap` (CONTRACTS.md, Test
// hooks): pins are canvas symbols, so the engine is the only witness.
import { test, expect } from '@playwright/test';
import { gotoMap, mapEval, findPin, findEmptySpot, sheet, sourceFeatures } from './map-helpers.mjs';

const T = '?t=2026-10-03T15:00';

// --- Item: keyboard/AT path to transit and sponsor pin sheets ---------------

test('the hidden pin list has one button per pinned transit stop and sponsor', async ({ page }) => {
  await gotoMap(page);

  // The button list and the pin layers are built from the same subsets, so the
  // engine's own sources are the expected counts.
  const stops = await sourceFeatures(page, 'transit');
  const sponsors = await sourceFeatures(page, 'sponsors');
  expect(stops.length).toBeGreaterThan(0);
  expect(sponsors.length).toBeGreaterThan(0);

  await expect(page.locator('.pin-alt-btn[data-kind="transit"]')).toHaveCount(stops.length);
  await expect(page.locator('.pin-alt-btn[data-kind="sponsor"]')).toHaveCount(sponsors.length);

  // Visually hidden until focused, then revealed (skip-link style) so a
  // sighted keyboard user can see where focus is.
  const btn = page.locator('.pin-alt-btn').first();
  expect((await btn.boundingBox()).width).toBeLessThanOrEqual(1);
  await btn.focus();
  expect((await btn.boundingBox()).width).toBeGreaterThan(100);
});

test('keyboard activation of a transit button opens that stop sheet; focus returns on close', async ({ page }) => {
  await gotoMap(page);

  const btn = page.locator('.pin-alt-btn[data-id="snelling-avenue-and-university-station"]');
  // The accessible name carries the stop name plus its lines.
  await expect(btn).toHaveAccessibleName(/Snelling Avenue & University Station.*Green Line.*A Line/);

  await btn.focus();
  await page.keyboard.press('Enter');

  const dialog = sheet(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(page.locator('#sheet-title')).toHaveText('Snelling Avenue & University Station');
  await expect(dialog.locator('.sheet__line-list li')).toHaveText(['METRO Green Line', 'METRO A Line']);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(btn).toBeFocused();
});

test('keyboard activation of a sponsor button opens that sponsor sheet; focus returns on close', async ({ page }) => {
  await gotoMap(page);

  const btn = page.locator('.pin-alt-btn[data-kind="sponsor"][data-id="shortline-credit-union"]');
  await expect(btn).toHaveAccessibleName(/Shortline Credit Union/);

  await btn.focus();
  await page.keyboard.press('Enter');

  const dialog = sheet(page);
  await expect(dialog).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText('Shortline Credit Union');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(btn).toBeFocused();
});

// --- Item: pin tap highlight + venue-card→map link --------------------------

test('tapping a venue pin sets its feature-state highlight; empty map clears it', async ({ page }) => {
  await gotoMap(page);

  // The highlight is a paint expression keyed on feature-state, not a second
  // set of features: assert the mechanism, then drive it.
  const opacity = await mapEval(page, (map) => map.getPaintProperty('venue-highlight', 'circle-opacity'));
  expect(JSON.stringify(opacity)).toContain('feature-state');

  const pin = await findPin(page, 'venue-pin');
  expect(pin, 'no venue pin found on screen').not.toBeNull();
  const featureId = Number(pin.properties.label) - 1; // features are id'd by index; labels are index + 1

  await page.mouse.click(pin.x, pin.y);
  await expect(sheet(page)).toBeVisible();
  expect(
    await mapEval(page, (map, id) => map.getFeatureState({ source: 'venues', id }).selected, featureId),
  ).toBe(true);
  await page.keyboard.press('Escape');

  const empty = await findEmptySpot(page);
  expect(empty, 'no pin-free point found on the map').not.toBeNull();
  await page.mouse.click(empty.x, empty.y);
  await expect
    .poll(() => mapEval(page, (map, id) => map.getFeatureState({ source: 'venues', id }).selected, featureId))
    .toBeFalsy();
});

test('a transit pin tap sets the transit highlight state', async ({ page }) => {
  await gotoMap(page);

  const pin = await findPin(page, 'transit-pin');
  expect(pin, 'no transit pin found on screen').not.toBeNull();
  await page.mouse.click(pin.x, pin.y);
  await expect(sheet(page)).toBeVisible();

  const stops = await sourceFeatures(page, 'transit');
  const featureId = stops.findIndex((f) => f.properties.id === pin.properties.id);
  expect(
    await mapEval(page, (map, id) => map.getFeatureState({ source: 'transit', id }).selected, featureId),
  ).toBe(true);
});

/** The venue farthest from the current centre: the card→map link needs a target the recentre visibly moves to. */
async function farthestVenue(page) {
  const centre = await mapEval(page, (map) => map.getCenter().toArray());
  const venues = await sourceFeatures(page, 'venues');
  return venues
    .map((f) => ({
      id: f.properties.id,
      featureId: f.id,
      coords: f.geometry.coordinates,
      d: Math.hypot(f.geometry.coordinates[0] - centre[0], f.geometry.coordinates[1] - centre[1]),
    }))
    .sort((a, b) => b.d - a.d)[0];
}

test('tapping a venue card recenters the map on its pin and highlights it', async ({ page }) => {
  await gotoMap(page);

  const target = await farthestVenue(page);
  expect(target.d, 'every venue is already at the centre; nothing to recentre to').toBeGreaterThan(1e-4);

  await page.locator(`.venue-key-btn[data-venue-id="${target.id}"]`).click();
  // The sheet still opens, as it did before the map link existed.
  await expect(sheet(page)).toBeVisible();

  await expect
    .poll(() => mapEval(page, (map) => map.getCenter().toArray()), { timeout: 3000 })
    .toEqual([expect.closeTo(target.coords[0], 4), expect.closeTo(target.coords[1], 4)]);
  expect(
    await mapEval(page, (map, id) => map.getFeatureState({ source: 'venues', id }).selected, target.featureId),
  ).toBe(true);
});

test('under prefers-reduced-motion the venue-card recentre jumps instead of animating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoMap(page);

  const target = await farthestVenue(page);
  await page.locator(`.venue-key-btn[data-venue-id="${target.id}"]`).click();

  // A 450 ms ease could not be at the target this soon; a jump is there in one
  // frame. (A stalled machine can only make this pass falsely, not fail.)
  await expect
    .poll(() => mapEval(page, (map) => map.getCenter().toArray()), { timeout: 300, intervals: [50] })
    .toEqual([expect.closeTo(target.coords[0], 4), expect.closeTo(target.coords[1], 4)]);
});

// --- Item: pan buttons (WCAG 2.5.7) -----------------------------------------

test('the pan buttons pan the map in each direction without dragging', async ({ page }) => {
  await gotoMap(page);

  const centre = () => mapEval(page, (map) => map.getCenter().toArray());
  const press = async (id) => {
    await page.locator(id).click();
    await page.waitForTimeout(500); // ease duration 300 ms + settle
    return centre();
  };

  const c0 = await centre();
  const up = await press('#pan-up');
  expect(up[1], 'pan up should move the centre north').toBeGreaterThan(c0[1]);
  const down = await press('#pan-down');
  expect(down[1], 'pan down should move the centre south').toBeLessThan(up[1]);
  const left = await press('#pan-left');
  expect(left[0], 'pan left should move the centre west').toBeLessThan(down[0]);
  const right = await press('#pan-right');
  expect(right[0], 'pan right should move the centre east').toBeGreaterThan(left[0]);
});

// --- Item: scale bar --------------------------------------------------------

// WCAG relative luminance (same helper as a11y.spec.mjs).
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

test('the scale bar is present, readable, and fetches nothing', async ({ page }) => {
  const offOrigin = [];
  page.on('request', (r) => {
    const url = r.url();
    if (/^https?:/.test(url) && !url.startsWith('http://localhost')) offOrigin.push(url);
  });

  await gotoMap(page);

  const scale = page.locator('.maplibregl-ctrl-scale');
  await expect(scale).toBeVisible();
  await expect(scale).toHaveText(/\d+\s*(ft|mi)/);

  // The control is DOM + arithmetic; a scale bar must not cost a request.
  expect(offOrigin).toEqual([]);

  // Its text over its own background, with the translucent background blended
  // over the darkest ground it can sit on (the map's water), still clears the
  // 4.5:1 the Accessibility contract requires for map-sized type.
  const { text, bg, alpha, water } = await scale.evaluate((el) => {
    const parse = (c) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const cs = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.color = 'var(--map-water)';
    document.body.appendChild(probe);
    const water = parse(getComputedStyle(probe).color).slice(0, 3);
    probe.remove();
    const bgRaw = parse(cs.backgroundColor);
    return { text: parse(cs.color).slice(0, 3), bg: bgRaw.slice(0, 3), alpha: bgRaw[3] ?? 1, water };
  });
  const blended = bg.map((c, i) => Math.round(c * alpha + water[i] * (1 - alpha)));
  expect(contrastRatio(text, blended)).toBeGreaterThanOrEqual(4.5);
});

// --- Item: locate denial copy -----------------------------------------------

// No grantPermissions: Playwright's default is to deny, which surfaces as the
// same code-1 error iOS produces both for a remembered "Don't Allow" and for
// Location Services being off for Safari websites entirely.
test('a denied location request points at the Safari setting that fixes it', async ({ page }) => {
  await gotoMap(page);
  await page.click('#locate-btn');

  const toast = page.locator('#toast-root');
  await expect(toast).toContainText(/Location permission denied/);
  await expect(toast).toContainText(/Location Services/);
  await expect(toast).toContainText(/Safari Websites/);
});

// --- Item: venue number in the key-list accessible name ---------------------

test('every key-list button carries "Venue N" in its accessible name', async ({ page }) => {
  await page.goto('/' + T + '#/map');
  const buttons = page.locator('.venue-key-btn');
  await expect(buttons.first()).toBeVisible();

  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    // The number was previously only inside an aria-hidden SVG, so a
    // screen-reader user couldn't cross-reference "venue 3" from a sighted
    // companion. The name still ends with the venue's own name.
    await expect(buttons.nth(i)).toHaveAccessibleName(new RegExp(`^Venue ${i + 1}: .+`));
  }
});
