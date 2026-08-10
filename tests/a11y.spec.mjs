// Accessibility hardening (Wave 2): focus management on route change and
// sheet open/close, and keyboard map panning. Runs against the built site,
// same as offline.spec.mjs.
//
// The map tests drive MapLibre through the `window.__mmafMap` test hook rather
// than the DOM: pins are drawn into a canvas, so there is no element to locate.
// See tests/map-helpers.mjs.
import { test, expect } from '@playwright/test';
import { gotoMap, waitForMapIdle, mapEval, findPin, centreOnPin, findEmptySpot, sheet, SOURCE_FEATURES_FN } from './map-helpers.mjs';

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
  await gotoMap(page);

  const trigger = page.locator('.venue-key-btn').first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = sheet(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog).toHaveAttribute('aria-labelledby', 'sheet-title');
  await expect(page.locator('#sheet-title')).not.toHaveText('');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('a transit pin opens a sheet naming the lines that serve the stop', async ({ page }) => {
  await gotoMap(page);

  // Snelling & University is the transfer point: one pin, two lines, and the
  // case the single-maps-link decision was made for (CONTRACTS.md).
  const point = await centreOnPin(page, 'transit-pin', 'snelling-avenue-and-university-station');
  expect(point, 'the Snelling & University transit pin is not on the map').not.toBeNull();
  await page.mouse.click(point.x, point.y);

  const dialog = sheet(page);
  await expect(dialog).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText('Snelling Avenue & University Station');
  await expect(dialog.locator('.sheet__line-list li')).toHaveText(['METRO Green Line', 'METRO A Line']);
  // Exactly one maps link, not one per line.
  await expect(dialog.locator('a[href*="google.com/maps"]')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

// The SVG map made its hit targets diamonds so the tappable area was the shape
// you could see. Canvas pins have no such geometry: taps resolve against a small
// box around the touch point, nearest pin first. What still has to hold is the
// property that mattered — a tap opens the pin you aimed at, and empty map is
// not a pin.
test('a tap opens the pin under it, and empty map opens nothing', async ({ page }) => {
  await gotoMap(page);

  const pin = await findPin(page, 'venue-pin');
  expect(pin, 'no venue pin found on screen').not.toBeNull();
  await page.mouse.click(pin.x, pin.y);
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText(pin.properties.name);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();

  const empty = await findEmptySpot(page);
  expect(empty, 'no pin-free point found on the map').not.toBeNull();
  await page.mouse.click(empty.x, empty.y);
  await expect(sheet(page)).toBeHidden();
});

test('dragging the map pans it without sweeping a text selection across the labels', async ({ page }) => {
  await gotoMap(page);

  const canvas = page.locator('#map-gl canvas');
  const box = await canvas.boundingBox();
  const startX = box.x + box.width * 0.7;
  const startY = box.y + box.height * 0.7;

  const before = await mapEval(page, (map) => map.getCenter().toArray());
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several steps so the browser sees a real drag, not a jump.
  await page.mouse.move(startX - 120, startY - 90, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // It panned...
  const after = await mapEval(page, (map) => map.getCenter().toArray());
  expect(Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1])).toBeGreaterThan(1e-5);
  // ...and selected nothing on the way.
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
});

// Genuine two-finger pinch is out of scope here (it needs real multi-touch);
// double-click is the other half of the same zoom story and is reachable with a
// mouse, so it is the half worth pinning.
test('double-clicking the map zooms in, and double-clicking at full zoom returns home', async ({ page }) => {
  await gotoMap(page);

  const spot = await findEmptySpot(page);
  expect(spot, 'no pin-free point found on the map to click').not.toBeNull();

  const homeZoom = await mapEval(page, (map) => map.getZoom());
  await page.mouse.dblclick(spot.x, spot.y);
  await page.waitForTimeout(700);
  expect(await mapEval(page, (map) => map.getZoom())).toBeGreaterThan(homeZoom + 0.5);
  // A zoom, not a pin activation.
  await expect(sheet(page)).toBeHidden();

  // Already as close as the map goes, a double-tap is the way back out —
  // otherwise the gesture strands someone zoomed in with no obvious escape.
  await mapEval(page, (map) => map.jumpTo({ zoom: map.getMaxZoom() }));
  await waitForMapIdle(page);
  const centre = await mapEval(page, (map) => {
    const rect = map.getCanvas().getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.dblclick(centre.x, centre.y);
  await page.waitForTimeout(900);
  expect(await mapEval(page, (map) => map.getZoom())).toBeCloseTo(homeZoom, 1);
});

// Regression: this silently stopped working when a variable was renamed during
// a map rework. The failure was a ReferenceError inside the geolocation success
// callback, so nothing rendered and nothing obvious surfaced — exactly the kind
// of break a screenshot pass can't catch, since the button is never pressed.
test('the locate button drops a "you are here" dot at the reported position', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 44.9599, longitude: -93.1667 }); // Hamline Park

  await gotoMap(page);

  const dot = page.locator('[data-testid="you-are-here"]');
  await expect(dot).toHaveCount(0);

  await page.click('#locate-btn');
  await expect(dot).toBeVisible();

  // The marker sits where the map projects the reported position, which at the
  // home view is the festival centre.
  const offset = await page.evaluate(() => {
    const map = window.__mmafMap;
    const el = document.querySelector('[data-testid="you-are-here"]');
    const rect = el.getBoundingClientRect();
    const canvas = map.getCanvas().getBoundingClientRect();
    const expected = map.project([-93.1667, 44.9599]);
    return {
      dx: rect.left + rect.width / 2 - (canvas.left + expected.x),
      dy: rect.top + rect.height / 2 - (canvas.top + expected.y),
    };
  });
  expect(Math.abs(offset.dx)).toBeLessThan(6);
  expect(Math.abs(offset.dy)).toBeLessThan(6);
});

test('a location outside the map area reports it instead of dropping a dot', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 45.5, longitude: -122.6 }); // Portland, OR — far outside

  await gotoMap(page);
  await page.click('#locate-btn');

  await expect(page.locator('#toast-root')).toContainText(/outside the map area/i);
  await expect(page.locator('[data-testid="you-are-here"]')).toHaveCount(0);
});

test('the map opens at the home view, not the full extent, and can pan in every direction', async ({ page }) => {
  await gotoMap(page);

  const view = await mapEval(page, (map) => ({
    zoom: map.getZoom(),
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom(),
    centre: map.getCenter().toArray(),
    bounds: map.getBounds().toArray(),
    maxBounds: map.getMaxBounds().toArray(),
  }));

  // The home view sits inside the map's own extent with room to pan in every
  // direction — the point being that the default view is not pinned to an edge.
  expect(view.zoom).toBeGreaterThan(view.minZoom);
  expect(view.zoom).toBeLessThan(view.maxZoom);
  expect(view.bounds[0][0]).toBeGreaterThan(view.maxBounds[0][0]);
  expect(view.bounds[0][1]).toBeGreaterThan(view.maxBounds[0][1]);
  expect(view.bounds[1][0]).toBeLessThan(view.maxBounds[1][0]);
  expect(view.bounds[1][1]).toBeLessThan(view.maxBounds[1][1]);

  await page.locator('#map-gl canvas').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(700);
  expect((await mapEval(page, (map) => map.getCenter().toArray()))[0]).toBeLessThan(view.centre[0]);

  // Zooming out reveals more map than the home view showed.
  await page.locator('#zoom-out').click();
  await page.waitForTimeout(700);
  expect(await mapEval(page, (map) => map.getZoom())).toBeLessThan(view.zoom);
});

// The two rail lines draw at identical weight and differ only in hue, so the
// legend is the only thing that can name them — and the Blue Line has no
// station pins in range either, so without it nothing on the page identifies
// it at all.
test('the legend names both rail lines in the colors the map draws them', async ({ page }) => {
  await gotoMap(page);

  const legend = page.locator('.map-legend__list');
  await expect(legend).toContainText('METRO Green Line');
  await expect(legend).toContainText('METRO Blue Line');

  for (const line of ['green', 'blue']) {
    const swatch = await page.locator(`.legend-icon--rail-${line} line`).evaluate((el) => getComputedStyle(el).stroke);
    // The engine's own paint for that layer, which map.js resolved from the
    // same custom property the swatch uses. Both sides are read back so a
    // future edit to either one has to keep them agreeing.
    const rail = await mapEval(page, (map, id) => map.getPaintProperty(id, 'line-color'), `rail-${line}`);
    expect(swatch, `${line} line swatch does not match the rail it stands for`).toBe(rail);
  }
});

// A count on a cluster reads as a venue number — venue pins carry exactly that,
// from the key list — so clusters carry no text at all (Anthony, 2026-08-10).
test('clustered venue pins show no number that could be mistaken for a venue', async ({ page }) => {
  await gotoMap(page);

  const clusterLayout = await mapEval(page, (map) => {
    const layer = map.getStyle().layers.find((l) => l.id === 'venue-cluster');
    return layer ? layer.layout ?? {} : null;
  });
  expect(clusterLayout, 'the venue-cluster layer is missing').not.toBeNull();
  expect(clusterLayout['text-field'], 'clusters must not render a count').toBeUndefined();

  // And the venue pins that are not clusters still carry their key-list number.
  const pin = await findPin(page, 'venue-pin');
  expect(pin).not.toBeNull();
  expect(pin.properties.label).toMatch(/^\d+$/);
});

// Every venue must be reachable even when zoom cannot separate its pin from a
// neighbour's. Two venues share a coordinate (Mosaic on a Stick sits inside
// Hamline Park — valid data, see CLAUDE.md), so a cluster that cannot expand
// opens a picker listing what is under it.
test('a cluster that no zoom can split opens a picker instead of a dead tap', async ({ page }) => {
  await gotoMap(page);

  const coincident = await mapEval(page, async (map, featuresFn) => {
    const byPosition = new Map();
    for (const f of new Function('return ' + featuresFn)()(map, 'venues')) {
      const key = f.geometry.coordinates.join(',');
      byPosition.set(key, [...(byPosition.get(key) ?? []), f.properties.name]);
    }
    const [key, names] = [...byPosition.entries()].find(([, list]) => list.length > 1) ?? [];
    if (!key) return null;
    map.jumpTo({ center: key.split(',').map(Number), zoom: map.getMaxZoom() - 3 });
    await new Promise((r) => map.once('idle', () => setTimeout(r, 300)));
    const rect = map.getCanvas().getBoundingClientRect();
    const point = map.project(key.split(',').map(Number));
    return { names, x: rect.left + point.x, y: rect.top + point.y };
  }, SOURCE_FEATURES_FN);
  expect(coincident, 'no two venues share a coordinate; this test has lost its subject').not.toBeNull();

  await page.mouse.click(coincident.x, coincident.y);
  const dialog = sheet(page);
  await expect(dialog).toBeVisible();
  for (const name of coincident.names) {
    await expect(dialog).toContainText(name);
  }

  // Picking one opens that venue's own sheet.
  await dialog.locator('.sheet__picker-btn').first().click();
  await expect(page.locator('#sheet-title')).toHaveText(coincident.names[0]);
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
  await gotoMap(page);

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
  await gotoMap(page);
  const canvas = page.locator('#map-gl canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('tabindex', '0');
  expect(await canvas.getAttribute('aria-label')).toMatch(/arrow keys/i);

  const before = await mapEval(page, (map) => map.getCenter().toArray());

  await canvas.focus();
  await expect(canvas).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);

  const after = await mapEval(page, (map) => map.getCenter().toArray());
  expect(after[0]).toBeGreaterThan(before[0]);
});
