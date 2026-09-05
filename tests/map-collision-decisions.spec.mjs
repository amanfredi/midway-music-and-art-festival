// The three collision decisions the map used to make by accident: which venue
// keeps its name, which way a coincident group spreads, and which side a name
// is placed on. Each is now a rule, and each is tested here against a venue set
// built for the purpose rather than against the committed fixtures — the real
// venue neighbourhoods are crowded enough that a group's own axis is sometimes
// blocked (see map-coincident.spec.mjs), which is correct behaviour and useless
// for showing what the rule is.
//
// The venue set arrives by intercepting `data/content.json`, the same technique
// the embed specs use, so nothing here touches the network or the fixtures.
import { test, expect } from '@playwright/test';
import { gotoMap, mapEval, sourceFeatures, SOURCE_FEATURES_FN } from './map-helpers.mjs';

// Without this the service worker registered by the first load answers
// data/content.json out of its cache on every load after it, and the
// interception below silently stops applying.
test.use({ serviceWorkers: 'block' });

/** A quiet corner of the map's extent, well away from the fixture venues. */
const NORTH_PAIR = { lat: 44.97, lng: -93.19 };
const SOUTH_PAIR = { lat: 44.965, lng: -93.195 };

const venue = (id, name, lat, lng) => ({
  id,
  name,
  address: `${name}, St. Paul, MN`,
  lat,
  lng,
  description: '',
  url: '',
});

const event = (id, venueId) => ({
  id,
  title: id,
  venue_id: venueId,
  start: '2026-10-03T15:00',
  end: '2026-10-03T16:00',
  kind: 'music',
  tickets: 'General Admission',
  age_limit: '',
  description: '',
  url: '',
});

/** Serves `venues`/`events` in place of the built content, keeping its settings. */
async function withVenues(page, venues, events = []) {
  await page.route('**/data/content.json', async (route) => {
    const built = await (await route.fetch()).json();
    await route.fulfill({
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ...built, venues, events, vendors: [], sponsors: [] }),
    });
  });
}

/** Every displaced venue's lane, keyed by venue id. */
async function lanes(page) {
  const features = await sourceFeatures(page, 'venue-groups');
  return Object.fromEntries(features.map((f) => [f.properties.id, f.properties.lane]));
}

test('a group that varies only in latitude spreads north to south', async ({ page }) => {
  // 13 m apart, same longitude — the Vig Guitars / Fluid Ink Tattoos shape,
  // which the old fixed east-west lanes pushed sideways along the one axis
  // these venues do not differ in.
  await withVenues(page, [
    venue('northerly', 'Northerly Hall', NORTH_PAIR.lat + 0.00012, NORTH_PAIR.lng),
    venue('southerly', 'Southerly Hall', NORTH_PAIR.lat, NORTH_PAIR.lng),
  ]);
  await gotoMap(page);

  // Negative y is up: the northern venue takes the northern lane, so each pin
  // still sits on the side of the group its venue is really on.
  expect(await lanes(page)).toEqual({ northerly: 'ns:0,-32', southerly: 'ns:0,32' });
});

test('a group that varies only in longitude spreads east to west', async ({ page }) => {
  await withVenues(page, [
    venue('westerly', 'Westerly Hall', SOUTH_PAIR.lat, SOUTH_PAIR.lng - 0.00014),
    venue('easterly', 'Easterly Hall', SOUTH_PAIR.lat, SOUTH_PAIR.lng),
  ]);
  await gotoMap(page);

  expect(await lanes(page)).toEqual({ westerly: 'ew:-32,0', easterly: 'ew:32,0' });
});

test('two groups in one venue set each pick their own axis', async ({ page }) => {
  await withVenues(page, [
    venue('northerly', 'Northerly Hall', NORTH_PAIR.lat + 0.00012, NORTH_PAIR.lng),
    venue('southerly', 'Southerly Hall', NORTH_PAIR.lat, NORTH_PAIR.lng),
    venue('westerly', 'Westerly Hall', SOUTH_PAIR.lat, SOUTH_PAIR.lng - 0.00014),
    venue('easterly', 'Easterly Hall', SOUTH_PAIR.lat, SOUTH_PAIR.lng),
  ]);
  await gotoMap(page);

  expect(await lanes(page)).toEqual({
    northerly: 'ns:0,-32',
    southerly: 'ns:0,32',
    westerly: 'ew:-32,0',
    easterly: 'ew:32,0',
  });
});

// Five venues in a row ~340 m apart: far enough to draw as five separate pins,
// close enough that their names cannot all be placed. Two venues alone never
// contest — the anchor order puts one name above its pin and the other below —
// so it takes a row to make the engine drop anything.
//
// Each name is a single unbroken word, which is the part that looks odd and is
// load-bearing. MapLibre wraps at `text-max-width` (10 em), and a wrapped name
// is short and tall enough that what blocks it is the neighbouring *pins*, not
// the neighbouring names — at which point no ranking can help it and the test
// would be measuring the wrong thing. One long word stays on one line, so the
// only things competing for the space are the names themselves.
const ROW_STEP_LNG = 0.0043;
const ROW = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((word, i) =>
  venue(
    `${word.toLowerCase()}-hall`,
    `${word}hallconservatoryandballroom`,
    SOUTH_PAIR.lat,
    SOUTH_PAIR.lng + i * ROW_STEP_LNG
  )
);
// The venue the row squeezes out when nothing distinguishes it: mid-row, and
// ranked behind its two neighbours on the id tiebreak alone.
const SQUEEZED = 'Charliehallconservatoryandballroom';
const busiest = (id) => [...Array(9)].map((_, k) => event(`${id}-${k}`, id));

/** Which of the row's names are drawn, with the camera centred on it. */
async function rowNames(page) {
  return mapEval(
    page,
    async (map, featuresFn) => {
      const venues = new Function('return ' + featuresFn)()(map, 'venues');
      const centre = venues
        .reduce((a, f) => [a[0] + f.geometry.coordinates[0], a[1] + f.geometry.coordinates[1]], [0, 0])
        .map((v) => v / venues.length);
      map.jumpTo({ center: centre, zoom: map.getLayer('venue-leader-pin').minzoom });
      await new Promise((r) => (map.loaded() ? setTimeout(r, 350) : map.once('idle', () => setTimeout(r, 350))));
      const of = (layer) => [...new Set(map.queryRenderedFeatures({ layers: [layer] }).map((f) => f.properties.name))];
      return { named: of('venue-name-label').sort(), pinned: of('venue-pin').sort() };
    },
    SOURCE_FEATURES_FN,
  );
}

test('the busiest venue keeps its name where a quiet one in the same spot loses it', async ({ page }) => {
  // Same five venues, same five positions, same order in the sheet. The only
  // difference between the two runs is where the events are.
  await withVenues(page, ROW);
  await gotoMap(page);
  const quiet = await rowNames(page);

  expect(quiet.pinned, 'the row did not draw as five separate pins').toHaveLength(ROW.length);
  expect(quiet.named.length, 'every name fits; this row contests nothing and proves nothing').toBeLessThan(
    quiet.pinned.length
  );
  expect(quiet.named, `${SQUEEZED} is not the name this row squeezes out`).not.toContain(SQUEEZED);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await withVenues(page, ROW, busiest('charlie-hall'));
  await page.reload();
  await gotoMap(page);
  const busy = await rowNames(page);

  expect(busy.named, 'the busiest venue still lost its name').toContain(SQUEEZED);
  // Identical geometry, so a different set of survivors can only have come from
  // the ranking.
  expect(busy.named, 'moving the events changed nothing; the ranking is not being used').not.toEqual(quiet.named);
});

test('venues with equal event counts are ranked by id, and identically on every load', async ({ page }) => {
  // No events at all, so every venue ties at zero and only the id separates
  // them. Alpha is both the first row in the sheet and the first id, so this
  // says less about which one won than that the answer never wobbles.
  await withVenues(page, ROW);
  await gotoMap(page);
  const first = await rowNames(page);

  expect(first.named, 'the alphabetically first id did not win the tie').toContain(
    'Alphahallconservatoryandballroom'
  );

  await page.reload();
  await gotoMap(page);
  expect((await rowNames(page)).named, 'the tiebreak is not stable across loads').toEqual(first.named);
});

// A plus code's last two digits name a cell 1/8000 of a degree on a side, so a
// group spread less than that along its lane axis is spread by rounding: which
// end of it a venue sits at is noise. The lanes then go by name rank instead.
const CELL = 1 / 8000;

/** Lane per venue id, and which venues draw at their own coordinate. */
async function laneReport(page) {
  const features = await sourceFeatures(page, 'venue-groups');
  return {
    lanes: Object.fromEntries(features.map((f) => [f.properties.id, f.properties.lane])),
    tetherless: features
      .filter((f) => f.properties.offsetX === 0 && f.properties.offsetY === 0)
      .map((f) => f.properties.id),
  };
}

test('a spread of one plus-code cell is treated as rounding, and rank orders the lanes', async ({ page }) => {
  // One cell of latitude between them — the shape the Urban Lights row has,
  // where the delta is which cell somebody clicked rather than where the doors
  // are. The BUSY one is the southern one, so geography and rank disagree about
  // who takes the northern lane.
  //
  // The small longitude difference is load-bearing. Rank order can send two
  // members past each other, and lane offsets are static while true positions
  // spread with zoom, so a crossed pair with nothing between them converges and
  // the clearance search vetoes the whole axis (which is correct, and which is
  // what an earlier version of this test hit). A few metres sideways keeps them
  // apart at every zoom, exactly as the real trio's east–west spread does.
  await withVenues(
    page,
    [
      venue('quiet-north', 'Quiet North Hall', SOUTH_PAIR.lat + CELL, SOUTH_PAIR.lng),
      venue('busy-south', 'Busy South Hall', SOUTH_PAIR.lat, SOUTH_PAIR.lng + 0.0001),
    ],
    [...Array(6)].map((_, k) => event(`b${k}`, 'busy-south')),
  );
  await gotoMap(page);

  const { lanes } = await laneReport(page);
  // Negative y is north. Geography would have put the northern venue there.
  expect(lanes['busy-south'], 'geography ordered a spread that was only rounding').toBe('ns:0,-32');
  expect(lanes['quiet-north']).toBe('ns:0,32');
});

test('a spread of several cells is real, and geography still orders the lanes', async ({ page }) => {
  // The same two venues and the same ranks, eight cells apart instead of one.
  await withVenues(
    page,
    [
      venue('quiet-north', 'Quiet North Hall', SOUTH_PAIR.lat + 8 * CELL, SOUTH_PAIR.lng),
      venue('busy-south', 'Busy South Hall', SOUTH_PAIR.lat, SOUTH_PAIR.lng),
    ],
    [...Array(6)].map((_, k) => event(`b${k}`, 'busy-south')),
  );
  await gotoMap(page);

  const { lanes } = await laneReport(page);
  expect(lanes['quiet-north'], 'rank overrode a spread that was real').toBe('ns:0,-32');
  expect(lanes['busy-south']).toBe('ns:0,32');
});

test('where every member would bury a neighbour dot, nobody is left tetherless', async ({ page }) => {
  // Three venues inside one plus-code cell. Whoever draws at their own
  // coordinate puts their diamond on both of the other dots, so the group gives
  // up its middle lane entirely and shifts half a lane: everybody tethered,
  // nobody parked on a dot.
  await withVenues(page, [
    venue('cell-a', 'Cell A Hall', SOUTH_PAIR.lat, SOUTH_PAIR.lng),
    venue('cell-b', 'Cell B Hall', SOUTH_PAIR.lat + CELL / 3, SOUTH_PAIR.lng + 0.00005),
    venue('cell-c', 'Cell C Hall', SOUTH_PAIR.lat + (2 * CELL) / 3, SOUTH_PAIR.lng + 0.0001),
  ]);
  await gotoMap(page);

  const { lanes, tetherless } = await laneReport(page);
  expect(Object.keys(lanes)).toHaveLength(3);
  expect(tetherless, 'a diamond is parked on a neighbour dot').toEqual([]);
  // Half a lane off centre, so the three sit at -32, +32, +96 rather than
  // -64, 0, +64.
  expect(Object.values(lanes).sort(), 'the group did not shift off its own centre').toEqual([
    'ns:0,-32',
    'ns:0,32',
    'ns:0,96',
  ]);
});
