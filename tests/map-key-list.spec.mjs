// The venue key list's link to the map: tapping a venue's card puts that
// venue's own pin on screen, highlighted.
//
// Tested as a property of what the engine drew, not as a camera position. The
// old test asserted the centre and the feature state, both of which were
// already right while the tap produced nothing a visitor could see: below the
// leader zoom a stacked venue has no pin of its own, so the map obediently
// centred on a numbered cluster bubble and highlighted a feature that wasn't
// being drawn. Measured 2026-09-05, phone, home view: 17 of 21 venues.
import { test, expect } from '@playwright/test';
import { gotoMap, mapEval, sourceFeatures, sheet, waitForMapIdle } from './map-helpers.mjs';

// The synthetic-content test below intercepts data/content.json, which the
// service worker would otherwise answer from its cache.
test.use({ serviceWorkers: 'block' });

/** How `venueId` is on screen right now: its own pin and whether it is lit. */
const pinState = (page, venueId) =>
  mapEval(
    page,
    (map, id) => {
      for (const layer of ['venue-pin', 'venue-leader-pin']) {
        if (!map.getLayer(layer)) continue;
        for (const f of map.queryRenderedFeatures({ layers: [layer] })) {
          if (f.properties.id !== id) continue;
          return { layer, selected: !!map.getFeatureState({ source: f.source, id: f.id }).selected };
        }
      }
      return null;
    },
    venueId,
  );

/** Fails informatively when the venue never gets a pin of its own. */
async function expectRevealed(page, venueId) {
  await expect
    .poll(async () => (await pinState(page, venueId)) ?? { layer: 'no pin of its own on screen', selected: false }, {
      timeout: 8000,
      message: `${venueId}: the key-list tap left nothing on screen to have tapped`,
    })
    .toEqual({ layer: expect.stringMatching(/^venue-(leader-)?pin$/), selected: true });
}

const keyListIds = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.venue-key-btn')].map((b) => b.dataset.venueId));

test('every venue in the key list zooms in far enough to show its own pin', async ({ page }) => {
  test.slow();
  await gotoMap(page);

  const home = await mapEval(page, (map) => ({ center: map.getCenter().toArray(), zoom: map.getZoom() }));
  const displaced = (await sourceFeatures(page, 'venue-groups')).map((f) => f.properties.id);
  expect(
    displaced.length,
    'no venue in the fixtures shares a location with another, so nothing here has a stack to break',
  ).toBeGreaterThan(0);

  const ids = await keyListIds(page);
  const hiddenAtHome = [];
  for (const id of ids) {
    // From the view the page opens at every time: the previous venue's tap must
    // not be what did the zooming.
    await mapEval(page, (map, h) => map.jumpTo(h), home);
    await waitForMapIdle(page);
    if (!(await pinState(page, id))) hiddenAtHome.push(id);

    await page.locator(`.venue-key-btn[data-venue-id="${id}"]`).click();
    await expect(sheet(page)).toBeVisible();
    await expectRevealed(page, id);
    await page.keyboard.press('Escape');
  }

  // Without this the suite would still pass on a venue set spread widely enough
  // that every pin is drawn at the home view, having tested nothing.
  expect(
    hiddenAtHome.length,
    'every venue already had its own pin at the home view, so this would pass without zooming at all',
  ).toBeGreaterThan(0);
  expect(displaced.some((id) => hiddenAtHome.includes(id))).toBe(true);
});

test('a venue card never zooms the map back out', async ({ page }) => {
  await gotoMap(page);
  const ids = await keyListIds(page);

  // Well past any floor the tap could want.
  await mapEval(page, (map) => map.zoomTo(map.getMaxZoom(), { duration: 0 }));
  await waitForMapIdle(page);
  const before = await mapEval(page, (map) => map.getZoom());

  await page.locator(`.venue-key-btn[data-venue-id="${ids[0]}"]`).click();
  await expect(sheet(page)).toBeVisible();
  await expectRevealed(page, ids[0]);
  expect(await mapEval(page, (map) => map.getZoom())).toBeCloseTo(before, 2);
});

// The leader zoom clears every stack in the sheet as it stands, but only as
// arithmetic about this data: a pair too far apart to be a coincident group can
// still share a cluster bubble there, because clustering releases on its own
// 26 px radius. This is that pair, and it is why the camera checks its work
// rather than trusting the floor.
test('a pair that only supercluster stacked still gets zoomed apart', async ({ page }) => {
  const at = { lat: 44.97, lng: -93.19 };
  // ~150 m apart, which at the split zoom's 3.4 m/px is 44 px: past the 38 px
  // (2 * VENUE_R) that makes a coincident group, and inside the 52 px that
  // still leaves them within supercluster's 26 px radius a zoom level out.
  const venues = [
    ['north', 'Northerly Hall', at.lat + 0.00135],
    ['south', 'Southerly Hall', at.lat],
  ].map(([id, name, lat]) => ({
    id,
    name,
    address: `${name}, St. Paul, MN`,
    lat,
    lng: at.lng,
    description: '',
    url: '',
  }));
  await page.route('**/data/content.json', async (route) => {
    const built = await (await route.fetch()).json();
    await route.fulfill({
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ...built, venues, events: [], vendors: [], sponsors: [] }),
    });
  });
  await gotoMap(page);

  // The premise, asserted rather than assumed: not a coincident group, and not
  // separately drawn at the zoom the tap would otherwise stop at.
  expect((await sourceFeatures(page, 'venue-groups')).length, 'the pair is close enough to be a group').toBe(0);
  const leaderZoom = await mapEval(page, (map) => map.getLayer('venue-leader-pin').minzoom);
  await mapEval(page, (map, z) => map.jumpTo({ center: [-93.19, 44.9705], zoom: z }), leaderZoom);
  await waitForMapIdle(page);
  expect(await pinState(page, 'north'), 'the pair is already apart at the leader zoom; no correction to test').toBeNull();

  await page.locator('.venue-key-btn[data-venue-id="north"]').click();
  await expect(sheet(page)).toBeVisible();
  await expectRevealed(page, 'north');
  expect(await mapEval(page, (map) => map.getZoom())).toBeGreaterThan(leaderZoom);
});
