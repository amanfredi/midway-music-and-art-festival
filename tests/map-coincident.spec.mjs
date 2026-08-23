// Venues that share a location (Mosaic on a Stick inside Hamline Park, and Vig
// Guitars ~14 m from Fluid Ink — valid data, see CLAUDE.md). From the split
// zoom inward each draws as its own numbered diamond, displaced east or west of
// the coordinate it shares, with a dot at that coordinate and a line joining
// the two. Below the split they stay a cluster glyph, which now carries the two
// member numbers.
//
// Everything here goes through `window.__mmafMap` (CONTRACTS.md, Test hooks):
// pins are canvas symbols, so the engine is the only witness. The composite
// icons are read back pixel by pixel, because where the diamond sits inside its
// image is the whole of what "displaced" means.
import { test, expect } from '@playwright/test';
import { gotoMap, mapEval, sheet, sourceFeatures, SOURCE_FEATURES_FN } from './map-helpers.mjs';

/**
 * Where the biggest thing in a composite icon sits, in CSS pixels from the
 * anchor the engine places on the feature's coordinate.
 *
 * Both images are read the same way: count opaque rows per column, then take
 * the middle of the columns within 2 rows of the tallest. That is the diamond in
 * a pin image (its sides fall away 2 rows per column, and the dot and line are
 * far shorter) and the ring in a halo image, and it is symmetric about the
 * shape's centre either way — a plain column-of-maximum would pick whichever of
 * the two central columns came first.
 */
const IMAGE_PROBE_FN = `(map, id) => {
  const image = map.style.getImage(id);
  const { width, height, data } = image.data;
  const columns = new Array(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 8) columns[x]++;
  }
  const plateau = columns.map((n, x) => x).filter((x) => columns[x] >= Math.max(...columns) - 2);
  const centre = width / 2;
  const middle = (plateau[0] + plateau[plateau.length - 1] + 1) / 2;
  return {
    pixelRatio: image.pixelRatio,
    centreColumn: (middle - centre) / image.pixelRatio,
    opaqueAtAnchor: columns[centre] > 0 || columns[centre - 1] > 0,
  };
}`;

/** Every venue symbol on screen, at the point it is actually drawn. */
const DRAWN_SYMBOLS_FN = `(map) => {
  const out = [];
  for (const layer of ['venue-pin', 'venue-leader-pin', 'venue-cluster']) {
    for (const f of map.queryRenderedFeatures({ layers: [layer] })) {
      const point = map.project(f.geometry.coordinates);
      const offset = f.properties.offset;
      const key = layer + ':' + (f.properties.cluster_id ?? f.properties.id);
      if (out.some((s) => s.key === key)) continue;
      out.push({
        key,
        layer,
        label: f.properties.label,
        pointCount: f.properties.point_count,
        groupedCount: f.properties.groupedCount,
        x: point.x + (typeof offset === 'number' ? offset : 0),
        y: point.y,
      });
    }
  }
  return out;
}`;

/** The displaced members that share one exact coordinate, centred at max zoom. */
async function centreOnCoincidentPair(page) {
  return mapEval(
    page,
    async (map, featuresFn) => {
      const features = new Function('return ' + featuresFn)()(map, 'venue-groups');
      const byPosition = new Map();
      for (const f of features) {
        const key = f.geometry.coordinates.join(',');
        byPosition.set(key, [...(byPosition.get(key) ?? []), f]);
      }
      const [key, members] = [...byPosition.entries()].find(([, list]) => list.length > 1) ?? [];
      if (!key) return null;
      const centre = key.split(',').map(Number);
      map.jumpTo({ center: centre, zoom: map.getMaxZoom() });
      await new Promise((r) => (map.loaded() ? setTimeout(r, 250) : map.once('idle', () => setTimeout(r, 250))));
      const rect = map.getCanvas().getBoundingClientRect();
      const point = map.project(centre);
      return {
        members: members.map((f) => ({
          ...f.properties,
          x: rect.left + point.x + f.properties.offset,
          y: rect.top + point.y,
        })),
      };
    },
    SOURCE_FEATURES_FN,
  );
}

test('coincident venues draw as separate numbered pins tethered to their true point', async ({ page }) => {
  await gotoMap(page);
  const pair = await centreOnCoincidentPair(page);
  expect(pair, 'no two venues share a coordinate; this test has lost its subject').not.toBeNull();
  expect(pair.members.length).toBe(2);

  const drawn = await mapEval(page, (map) =>
    map.queryRenderedFeatures({ layers: ['venue-leader-pin'] }).map((f) => f.properties),
  );
  // Both members on the map, each carrying its own key-list number, and neither
  // still hiding inside a stack.
  for (const member of pair.members) {
    expect(drawn.find((p) => p.id === member.id), `${member.name} is not drawn`).toBeTruthy();
    expect(member.label).toMatch(/^\d+$/);
    expect(member.offset).not.toBe(0);
  }
  expect(new Set(pair.members.map((m) => m.offset)).size).toBe(2);
  expect(
    await mapEval(page, (map) => map.queryRenderedFeatures({ layers: ['venue-cluster'] }).length),
    'a stack still covers the pins it was replaced by',
  ).toBe(0);

  // The icon states the true position by what it draws at its anchor: a dot in
  // the middle, the numbered diamond a whole offset away from it.
  for (const member of pair.members) {
    const probe = await mapEval(page, IMAGE_PROBE_FN, member.icon);
    expect(probe.centreColumn, `${member.name}: the diamond is not at its offset`).toBeCloseTo(member.offset, 0);
    expect(probe.opaqueAtAnchor, `${member.name}: nothing is drawn at the venue's own coordinate`).toBe(true);
  }
});

// The hazard this treatment introduces, and the reason for the offset in
// wirePinTaps: both features carry the same coordinate, so a tap measured
// against the coordinate ties and resolves by enumeration order — one of the two
// venues could never be opened.
test('a tap on a displaced diamond opens that venue, not its neighbour', async ({ page }) => {
  await gotoMap(page);
  const pair = await centreOnCoincidentPair(page);
  expect(pair).not.toBeNull();

  for (const member of pair.members) {
    await page.mouse.click(member.x, member.y);
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('#sheet-title'), `the tap on venue ${member.label} opened the wrong sheet`).toHaveText(
      member.name,
    );
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
  }
});

test('the tap highlight rings the displaced diamond, not the point it points at', async ({ page }) => {
  await gotoMap(page);
  const pair = await centreOnCoincidentPair(page);
  expect(pair).not.toBeNull();
  const member = pair.members[0];

  const opacity = await mapEval(page, (map) => map.getPaintProperty('venue-leader-halo', 'icon-opacity'));
  expect(JSON.stringify(opacity)).toContain('feature-state');

  await page.mouse.click(member.x, member.y);
  await expect(sheet(page)).toBeVisible();
  const state = await mapEval(page, (map, id) => {
    const feature = new Function(
      'return (map, id) => map.querySourceFeatures("venue-groups").find((f) => f.properties.id === id)',
    )()(map, id);
    return feature ? map.getFeatureState({ source: 'venue-groups', id: feature.id }).selected : null;
  }, member.id);
  expect(state, 'the displaced pin was not marked selected').toBe(true);

  // The ring and the diamond are placed from one offset in two images, so the
  // check is that both land on the same column: a ring at the image centre
  // would be the failure this layer exists to avoid.
  const ring = await mapEval(page, IMAGE_PROBE_FN, member.halo);
  const pin = await mapEval(page, IMAGE_PROBE_FN, member.icon);
  expect(ring.centreColumn, 'the ring sits at the coordinate, not at the diamond').toBeCloseTo(member.offset, 0);
  expect(ring.centreColumn).toBeCloseTo(pin.centreColumn, 0);
  expect(
    await mapEval(page, (map) => map.queryRenderedFeatures({ layers: ['venue-leader-halo'] }).length),
    'the halo layer draws nothing to ring the pin with',
  ).toBeGreaterThan(0);
});

async function expectNoOverlapFromSplitZoom(page) {
  await gotoMap(page);
  const pair = await centreOnCoincidentPair(page);
  expect(pair).not.toBeNull();

  const { pinWidth, worst, doubled } = await page.evaluate(
    async ([drawnFn]) => {
      const map = window.__mmafMap;
      const split = map.getLayer('venue-leader-pin').minzoom;
      const image = map.style.getImage('pin-venue');
      const pinWidth = image.data.width / image.pixelRatio - 4;
      const settle = () =>
        new Promise((r) => (map.loaded() ? setTimeout(r, 150) : map.once('idle', () => setTimeout(r, 150))));
      let worst = { distance: Infinity };
      for (let zoom = split; zoom <= map.getMaxZoom() + 0.001; zoom += 0.25) {
        map.jumpTo({ zoom: Math.min(zoom, map.getMaxZoom()) });
        await settle();
        const symbols = new Function('return ' + drawnFn)()(map);
        // Diamonds with half-diagonal R overlap when their centres are nearer
        // than 2R measured |dx| + |dy| — the measure VENUE_R was sized against.
        // Stack glyphs are left out: a stack and an ordinary pin are held apart
        // by clusterRadius alone, which is 26 px, and that predates this.
        const pins = symbols.filter((s) => s.layer !== 'venue-cluster');
        for (let i = 0; i < pins.length; i++) {
          for (let j = i + 1; j < pins.length; j++) {
            const distance = Math.abs(pins[i].x - pins[j].x) + Math.abs(pins[i].y - pins[j].y);
            if (distance < worst.distance) {
              worst = { distance, zoom: map.getZoom(), pair: [pins[i].label, pins[j].label] };
            }
          }
        }
        // A stack of nothing but displaced venues would be drawing over the pins
        // that replaced it; a mixed one would draw a member twice.
        const doubled = symbols.find((s) => s.layer === 'venue-cluster' && s.groupedCount > 0);
        if (doubled) return { pinWidth, worst, doubled: { ...doubled, zoom: map.getZoom() } };
      }
      return { pinWidth, worst };
    },
    [DRAWN_SYMBOLS_FN],
  );

  expect(
    doubled,
    `a stack of displaced venues still draws at zoom ${doubled?.zoom?.toFixed(2)}`,
  ).toBeUndefined();
  expect(worst.distance, 'fewer than two venue symbols drawn; the check proves nothing').toBeLessThan(Infinity);
  expect(
    worst.distance,
    `venue symbols ${worst.pair?.join(' and ')} overlap at zoom ${worst.zoom?.toFixed(2)}`,
  ).toBeGreaterThanOrEqual(pinWidth);
}

test('no two venue symbols draw on top of each other from the split zoom inward', async ({ page }) => {
  await expectNoOverlapFromSplitZoom(page);
});

// The same check on a phone-width frame, because the split is derived from the
// frame width and lands a whole zoom level lower there — which puts the two
// groups closer together in pixels than any wider frame does. The band where
// these pins would overlap "varies sharply and unpredictably with frame width",
// so one viewport does not settle it.
test.describe('on a phone-width frame', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('no two venue symbols draw on top of each other from the split zoom inward', async ({ page }) => {
    await expectNoOverlapFromSplitZoom(page);
  });
});

test('below the split zoom the pair is one stack carrying both member numbers', async ({ page }) => {
  await gotoMap(page);

  const stack = await mapEval(
    page,
    async (map, featuresFn) => {
      const features = new Function('return ' + featuresFn)()(map, 'venue-groups');
      const byPosition = new Map();
      for (const f of features) {
        const key = f.geometry.coordinates.join(',');
        byPosition.set(key, [...(byPosition.get(key) ?? []), f]);
      }
      const [key, members] = [...byPosition.entries()].find(([, list]) => list.length > 1) ?? [];
      if (!key) return null;
      map.jumpTo({ center: key.split(',').map(Number), zoom: map.getLayer('venue-leader-pin').minzoom - 0.5 });
      await new Promise((r) => (map.loaded() ? setTimeout(r, 250) : map.once('idle', () => setTimeout(r, 250))));
      // A stack's icon is wide enough that a box query at this point also
      // catches the neighbouring group's, so the one standing for these venues
      // is the nearest: two coincident points reduce to a cluster centred on
      // them, give or take the tile grid the coordinates come back quantised to.
      const point = map.project(key.split(',').map(Number));
      const near = (f) => {
        const p = map.project(f.geometry.coordinates);
        return Math.hypot(p.x - point.x, p.y - point.y);
      };
      const stack = map
        .queryRenderedFeatures({ layers: ['venue-cluster'] })
        .filter((f) => near(f) < 4)
        .sort((a, b) => near(a) - near(b))[0];
      return {
        labels: members.map((f) => Number(f.properties.label)).sort((a, b) => a - b),
        leaders: map.queryRenderedFeatures({ layers: ['venue-leader-pin'] }).length,
        cluster: stack ? stack.properties : null,
      };
    },
    SOURCE_FEATURES_FN,
  );

  expect(stack, 'no two venues share a coordinate; this test has lost its subject').not.toBeNull();
  expect(stack.leaders, 'displaced pins reach below the split zoom').toBe(0);
  expect(stack.cluster, 'the pair does not stack below the split zoom').not.toBeNull();
  expect(stack.cluster.point_count).toBe(2);
  // The digits on the glyph are the members' own key-list numbers, in a fixed
  // order: supercluster promises nothing about the order it reduces leaves in.
  expect([stack.cluster.labelMin, stack.cluster.labelMax]).toEqual(stack.labels);
});

test('every displaced venue is one of the venues the key list numbers', async ({ page }) => {
  await gotoMap(page);
  const venues = await sourceFeatures(page, 'venues');
  const displaced = await sourceFeatures(page, 'venue-groups');

  expect(displaced.length).toBeGreaterThan(1);
  for (const feature of displaced) {
    const venue = venues.find((v) => v.properties.id === feature.properties.id);
    expect(venue, `${feature.properties.id} is displaced but is not a venue`).toBeTruthy();
    expect(feature.properties.label).toBe(venue.properties.label);
    expect(feature.geometry.coordinates).toEqual(venue.geometry.coordinates);
    // Membership is derived from coordinates, so the clustered source has to
    // agree about which venues are displaced or a pin draws twice or not at all.
    expect(venue.properties.grouped).toBe(true);
  }
  const groupedInSource = venues.filter((v) => v.properties.grouped).length;
  expect(groupedInSource).toBe(displaced.length);
});
