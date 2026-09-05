// Venue and sponsor names label their pins from the leader zoom inward — the
// same threshold as the displaced-pin treatment. The names take none of the
// pins' overlap escape hatches: the engine's collision pass hides a name that
// doesn't fit, and the visible pin layers register their collision boxes so a
// name can never be placed across a diamond, a number or a leader line.
//
// Everything goes through `window.__mmafMap` (CONTRACTS.md, Test hooks): a
// symbol appears in queryRenderedFeatures only once placement has really put
// it on screen, which is exactly the claim these tests need.
import { test, expect } from '@playwright/test';
import { gotoMap, mapEval, SOURCE_FEATURES_FN } from './map-helpers.mjs';

const NAME_LAYERS = ['venue-name-label', 'venue-leader-name-label', 'sponsor-name-label'];

test('name labels exist for venues and sponsors, gated to the leader zoom, without allow-overlap', async ({
  page,
}) => {
  await gotoMap(page);
  const state = await mapEval(page, (map, ids) => ({
    leaderZoom: map.getLayer('venue-leader-pin').minzoom,
    layers: ids.map((id) => {
      const layer = map.getLayer(id);
      return (
        layer && {
          id,
          minzoom: layer.minzoom,
          allowOverlap: map.getLayoutProperty(id, 'text-allow-overlap') ?? false,
          ignorePlacement: map.getLayoutProperty(id, 'text-ignore-placement') ?? false,
        }
      );
    }),
  }), NAME_LAYERS);

  for (const layer of state.layers) {
    expect(layer, 'a name-label layer is missing').toBeTruthy();
    expect(layer.minzoom, `${layer.id} does not start at the leader zoom`).toBe(state.leaderZoom);
    // Names are long; the collision pass hiding the ones that don't fit is the
    // design (BACKLOG ruling, 2026-08-23), and a placed name must register so
    // street labels placed after it move aside.
    expect(layer.allowOverlap, `${layer.id} would pile names on top of each other`).toBe(false);
    expect(layer.ignorePlacement, `${layer.id} would let street labels draw across names`).toBe(false);
  }
});

// The two decisions the name layers now make on purpose, asserted on the
// layers themselves. What they *do* with them is exercised against purpose-built
// geometry in map-collision-decisions.spec.mjs.
test('both venue name layers rank collisions by the venue sort key', async ({ page }) => {
  await gotoMap(page);
  const keys = await mapEval(page, (map, ids) =>
    ids.map((id) => [id, JSON.stringify(map.getLayoutProperty(id, 'symbol-sort-key'))]),
    ['venue-name-label', 'venue-leader-name-label'],
  );
  for (const [id, key] of keys) {
    expect(key, `${id} falls back to feature order, which is sheet row order`).toBe('["get","sortKey"]');
  }
});

test('names try above and below a pin before either side, and the corners after', async ({ page }) => {
  await gotoMap(page);
  const orders = await mapEval(page, (map, ids) =>
    ids.map((id) => {
      const pairs = map.getLayoutProperty(id, 'text-variable-anchor-offset')[1];
      const anchors = [];
      for (let i = 0; i < pairs.length; i += 2) anchors.push(pairs[i]);
      return [id, anchors];
    }),
    ['venue-name-label', 'sponsor-name-label'],
  );
  for (const [id, order] of orders) {
    // `bottom` anchors the label's bottom edge, so the name sits above the pin;
    // `top` puts it below. Horizontal first aimed every name straight along
    // University Avenue at its nearest neighbour. The four corners come last:
    // they are the only candidates left when all four sides are spoken for.
    expect(order, `${id} does not try the sides in the intended order`).toEqual([
      'bottom',
      'top',
      'left',
      'right',
      'bottom-left',
      'bottom-right',
      'top-left',
      'top-right',
    ]);
  }
});

test('pin layers reserve their boxes so labels cannot cross them; invisible halos do not', async ({ page }) => {
  await gotoMap(page);
  const placement = await mapEval(page, (map) => {
    const read = (id) => map.getLayoutProperty(id, 'icon-ignore-placement') ?? false;
    const pins = [
      'venue-pin',
      'venue-leader-pin',
      'venue-cluster',
      'transit-pin',
      'transit-leader-pin',
      'sponsor-featured-pin',
      'sponsor-generic-pin',
    ];
    return {
      pins: pins.map((id) => [id, read(id)]),
      halos: ['venue-leader-halo', 'transit-leader-halo'].map((id) => [id, read(id)]),
    };
  });
  for (const [id, ignored] of placement.pins) {
    expect(ignored, `${id} does not register its collision box; a name can be placed across it`).toBe(false);
  }
  for (const [id, ignored] of placement.halos) {
    expect(ignored, `${id} reserves label room for a ring that is invisible until selected`).toBe(true);
  }
});

test('a venue is named at close zoom and nothing is named below the leader zoom', async ({ page }) => {
  await gotoMap(page);
  const state = await mapEval(
    page,
    async (map, featuresFn) => {
      const settle = () =>
        new Promise((r) => (map.loaded() ? setTimeout(r, 250) : map.once('idle', () => setTimeout(r, 250))));
      // Either venue layer may own it: a venue in a coincident group is drawn
      // (and named) by the displaced layers instead of the plain ones.
      const venue = new Function('return ' + featuresFn)()(map, 'venues')[0];
      map.jumpTo({ center: venue.geometry.coordinates, zoom: map.getMaxZoom() });
      await settle();
      const close = map
        .queryRenderedFeatures({ layers: ['venue-name-label', 'venue-leader-name-label'] })
        .map((f) => f.properties.name);
      map.jumpTo({ zoom: map.getLayer('venue-leader-pin').minzoom - 0.5 });
      await settle();
      const wide = map.queryRenderedFeatures({
        layers: ['venue-name-label', 'venue-leader-name-label', 'sponsor-name-label'],
      }).length;
      return { name: venue.properties.name, close, wide };
    },
    SOURCE_FEATURES_FN,
  );
  expect(state.close, `"${state.name}" is not named at the closest zoom`).toContain(state.name);
  expect(state.wide, 'names render below the leader zoom').toBe(0);
});

test('a sponsor is named at close zoom', async ({ page }) => {
  await gotoMap(page);
  const state = await mapEval(
    page,
    async (map, featuresFn) => {
      const sponsor = new Function('return ' + featuresFn)()(map, 'sponsors')[0];
      if (!sponsor) return null;
      map.jumpTo({ center: sponsor.geometry.coordinates, zoom: map.getMaxZoom() });
      await new Promise((r) => (map.loaded() ? setTimeout(r, 250) : map.once('idle', () => setTimeout(r, 250))));
      return {
        name: sponsor.properties.name,
        drawn: map.queryRenderedFeatures({ layers: ['sponsor-name-label'] }).map((f) => f.properties.name),
      };
    },
    SOURCE_FEATURES_FN,
  );
  expect(state, 'no sponsor carries a pin; this test has lost its subject').not.toBeNull();
  expect(state.drawn).toContain(state.name);
});

// A label at the true coordinate instead of the drawn diamond has two failure
// modes, and this exercises both at once: it points at the empty paper beside
// the leader line, and — for the exactly coincident pair — both names want the
// identical box, so without allow-overlap the collision pass keeps only one.
// Both names rendering together is therefore proof the labels ride the lanes.
test("displaced venues' names ride their lanes: the coincident pair is named twice", async ({ page }) => {
  await gotoMap(page);
  const pair = await mapEval(
    page,
    async (map, featuresFn) => {
      const features = new Function('return ' + featuresFn)()(map, 'venue-groups');
      const byPosition = new Map();
      for (const f of features) {
        const key = f.geometry.coordinates.join(',');
        byPosition.set(key, [...(byPosition.get(key) ?? []), f]);
      }
      const entry = [...byPosition.entries()].find(([, list]) => list.length > 1);
      if (!entry) return null;
      map.jumpTo({ center: entry[0].split(',').map(Number), zoom: map.getMaxZoom() });
      await new Promise((r) => (map.loaded() ? setTimeout(r, 250) : map.once('idle', () => setTimeout(r, 250))));
      return {
        names: entry[1].map((f) => f.properties.name),
        drawn: map.queryRenderedFeatures({ layers: ['venue-leader-name-label'] }).map((f) => f.properties.name),
      };
    },
    SOURCE_FEATURES_FN,
  );
  expect(pair, 'no two venues share a coordinate; this test has lost its subject').not.toBeNull();
  for (const name of pair.names) {
    expect(pair.drawn, `"${name}" lost its label to its coincident neighbour`).toContain(name);
  }
});

// A pin whose four sides are all spoken for still has its corners, and on this
// map that is common. Corners only work with an offset per anchor: a single
// radial distance puts a diagonal candidate at radius/sqrt(2) on each axis,
// which is INSIDE the square collision box it is meant to clear, so the
// placement pass rejects it and the candidate is decoration. Measured before
// the offsets were split out: adding corners changed nothing at all.
test('every name layer offers the four corners, cleared to the box corner', async ({ page }) => {
  await gotoMap(page);
  const layers = await mapEval(page, (map, ids) =>
    ids.map((id) => {
      const expr = map.getLayoutProperty(id, 'text-variable-anchor-offset');
      // Constant layers hold ['literal', pairs]; the displaced layer holds a
      // match, whose first branch value is what a lane resolves to.
      const pairs = expr[0] === 'literal' ? expr[1] : expr[3][1];
      const at = {};
      for (let i = 0; i < pairs.length; i += 2) at[pairs[i]] = pairs[i + 1];
      return [id, at];
    }),
    ['venue-name-label', 'sponsor-name-label', 'venue-leader-name-label'],
  );

  for (const [id, at] of layers) {
    for (const anchor of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) {
      expect(at[anchor], `${id} offers no ${anchor} candidate`).toBeTruthy();
    }
    // `left` puts the name east of the pin and `bottom` puts it above, so the
    // corner that does both must carry the full sideways clearance AND the full
    // upward one — not a diagonal share of one radius.
    const east = at['left'][0];
    const above = at['bottom'][1];
    expect(at['bottom-left'], `${id}'s upper-right corner is closer in than its sides`).toEqual([east, above]);
    expect(at['top-right'], `${id}'s lower-left corner is closer in than its sides`).toEqual([at['right'][0], at['top'][1]]);
  }
});
