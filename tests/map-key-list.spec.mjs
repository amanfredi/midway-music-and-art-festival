// The key list below the map: its three sections, and its link to the map —
// tapping a venue's card puts that venue's own pin on screen, highlighted.
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

// --- The three sections ------------------------------------------------------

// The list is a map KEY: it holds what the map draws, in the order the map's
// own hierarchy puts things — Featured Destinations, Venues, Sponsors — under
// visible headings, because a heading only a screen reader gets is a heading
// only some readers get.
test('the key list is three headed sections, in map order, holding only pinned sponsors', async ({ page }) => {
  await gotoMap(page);

  const headings = page.locator('#map-key .view-subtitle');
  await expect(headings).toHaveText(['Featured Destinations', 'Venues', 'Sponsors']);

  // Against the engine's own source, so the list and the pins cannot disagree.
  const sponsors = await sourceFeatures(page, 'sponsors');
  const featured = sponsors.filter((f) => f.properties.featured).map((f) => f.properties.id);
  const generic = sponsors.filter((f) => !f.properties.featured).map((f) => f.properties.id);
  expect(featured.length, 'no featured sponsor is pinned; this proves nothing').toBeGreaterThan(0);
  expect(generic.length, 'no generic sponsor is pinned; this proves nothing').toBeGreaterThan(0);

  const ids = (selector) => page.locator(selector).evaluateAll((els) => els.map((e) => e.dataset.sponsorId));
  expect(await ids('#featured-key-list .sponsor-key-btn[data-featured="true"]')).toEqual(featured);
  expect(await ids('#sponsor-key-list .sponsor-key-btn[data-featured="false"]')).toEqual(generic);

  // A sponsor with a visible card must not also have a hidden one: two buttons
  // for one pin is two stops for a screen reader.
  await expect(page.locator('.pin-alt-btn[data-kind="sponsor"]')).toHaveCount(0);

  // Venue cards and their numbering are untouched by the sections around them.
  await expect(page.locator('#venue-key-list')).toHaveJSProperty('tagName', 'OL');
  await expect(page.locator('#venue-key-list .venue-key-btn').first()).toHaveAccessibleName(/^Venue 1: /);

  // Every featured card shows the mark its pin carries.
  const marks = await page.locator('#featured-key-list .sponsor-key-btn__mark').evaluateAll((els) =>
    els.map((e) => ({ src: e.getAttribute('src'), alt: e.getAttribute('alt'), loaded: e.naturalWidth > 0 })),
  );
  expect(marks.length).toBe(featured.length);
  for (const mark of marks) {
    expect(mark.src, 'a featured card is not showing a bundled mark').toMatch(/^assets\/sponsors\/.+-pin\.(svg|png)$/);
    // Decorative: the sponsor's name is beside it in text, so a second reading
    // of the same name is noise.
    expect(mark.alt).toBe('');
    expect(mark.loaded, `${mark.src} did not load`).toBe(true);
  }
});

// An empty section is a claim there is nothing under a heading there is a
// heading for. Rendering nothing at all is the only honest answer.
test('a section with nothing in it renders nothing, heading included', async ({ page }) => {
  await page.route('**/data/content.json', async (route) => {
    const built = await (await route.fetch()).json();
    await route.fulfill({
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ...built, sponsors: [] }),
    });
  });
  await gotoMap(page);

  await expect(page.locator('#map-key .view-subtitle')).toHaveText(['Venues']);
  await expect(page.locator('#featured-key-list')).toHaveCount(0);
  await expect(page.locator('#sponsor-key-list')).toHaveCount(0);
  await expect(page.locator('.sponsor-key-btn')).toHaveCount(0);
  // The venue section is untouched by its neighbours going away.
  await expect(page.locator('#venue-key-list .venue-key-btn').first()).toBeVisible();
});

// A sponsor card behaves exactly like a venue card and like its own pin:
// highlight, recentre, open the sheet.
test('tapping a sponsor card highlights its pin, recentres on it, and opens its sheet', async ({ page }) => {
  await gotoMap(page);

  const sponsors = await sourceFeatures(page, 'sponsors');
  const index = sponsors.findIndex((f) => f.properties.id === 'shortline-credit-union');
  expect(index, 'the fixture sponsor this test taps has no pin').toBeGreaterThanOrEqual(0);

  /** Whether the sponsor's pin is drawn inside the frame right now. */
  const onScreen = () =>
    mapEval(
      page,
      (map, id) => {
        const feature = map
          .queryRenderedFeatures({ layers: ['sponsor-featured-pin', 'sponsor-generic-pin'] })
          .find((f) => f.properties.id === id);
        if (!feature) return false;
        const point = map.project(feature.geometry.coordinates);
        const canvas = map.getCanvas();
        return point.x >= 0 && point.y >= 0 && point.x <= canvas.clientWidth && point.y <= canvas.clientHeight;
      },
      'shortline-credit-union',
    );

  // Somewhere else entirely, so recentring is something that had to happen.
  // Asserted rather than assumed: if the pin were already on screen the check
  // below would pass without the card having done anything.
  await mapEval(page, (map) => map.jumpTo({ center: [-93.21, 44.98], zoom: map.getMaxZoom() - 2 }));
  await waitForMapIdle(page);
  expect(await onScreen(), 'the sponsor pin is already on screen; the recentre would prove nothing').toBe(false);

  await page.locator('.sponsor-key-btn[data-sponsor-id="shortline-credit-union"]').click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText('Shortline Credit Union');

  expect(
    await mapEval(page, (map, i) => !!map.getFeatureState({ source: 'sponsors', id: i }).selected, index),
    'the sponsor pin is not highlighted',
  ).toBe(true);

  // The property, not the camera position: the point of the recentre is that
  // the pin the card names is somewhere a visitor can see it. Asserting the
  // centre instead would fail on any sponsor near the edge of `maxBounds`,
  // where the engine clamps the camera and is right to.
  await waitForMapIdle(page);
  await expect
    .poll(onScreen, { timeout: 5000, message: 'the card left the sponsor pin off screen' })
    .toBe(true);
});

// Never outward: a card is a request to look at one thing, not to reframe the
// map. Same rule the venue cards follow.
test('a sponsor card never zooms the map back out', async ({ page }) => {
  await gotoMap(page);

  await mapEval(page, (map) => map.zoomTo(map.getMaxZoom(), { duration: 0 }));
  await waitForMapIdle(page);
  const before = await mapEval(page, (map) => map.getZoom());

  await page.locator('.sponsor-key-btn').first().click();
  await expect(sheet(page)).toBeVisible();
  await waitForMapIdle(page);
  expect(await mapEval(page, (map) => map.getZoom())).toBeCloseTo(before, 2);
});
