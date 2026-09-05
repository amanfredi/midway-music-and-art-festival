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
  const state = await mapEval(page, (map, ids) =>
    ids.map((id) => {
      const expr = map.getLayoutProperty(id, 'text-variable-anchor-offset');
      // A constant layer holds ['literal', pairs]; the venue layers hold a match
      // over venue id, whose LAST element is the fallback list. The fallback is
      // the order before any per-venue reshuffling, which is what this pins.
      const pairs = expr[0] === 'literal' ? expr[1] : expr[expr.length - 1][1];
      const anchors = [];
      for (let i = 0; i < pairs.length; i += 2) anchors.push(pairs[i]);
      // Every per-venue list must offer the same positions, whatever the order.
      const branches = [];
      if (expr[0] === 'match') {
        for (let i = 3; i < expr.length - 1; i += 2) {
          const list = [];
          for (let k = 0; k < expr[i][1].length; k += 2) list.push(expr[i][1][k]);
          branches.push(list);
        }
      }
      return [id, anchors, branches];
    }),
    ['venue-name-label', 'sponsor-name-label'],
  );

  for (const [id, order, branches] of state) {
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
    // Per-venue reordering may move a position down the list; it may never drop
    // one, or a crowded venue would end up with fewer places to go than a
    // lonely one.
    for (const branch of branches) {
      expect(branch.slice().sort(), `${id} drops a candidate for one of its venues`).toEqual(order.slice().sort());
    }
  }
});

test('every pin reserves a box, venue pins through a smaller blocker; halos and lines do not', async ({ page }) => {
  await gotoMap(page);
  const placement = await mapEval(page, (map) => {
    const read = (id) => (map.getLayer(id) ? (map.getLayoutProperty(id, 'icon-ignore-placement') ?? false) : null);
    const width = (image) => {
      const img = map.style.getImage(image);
      return img && img.data.width / img.pixelRatio;
    };
    return {
      // Pins that reserve their own image's box.
      direct: ['venue-cluster', 'transit-pin', 'transit-leader-pin', 'sponsor-featured-pin', 'sponsor-generic-pin'].map(
        (id) => [id, read(id)],
      ),
      // Venue pins draw at full size and reserve through a blocker instead.
      delegating: ['venue-pin', 'venue-leader-pin'].map((id) => [id, read(id)]),
      blockers: ['venue-pin-block', 'venue-leader-block'].map((id) => [id, read(id)]),
      // Neither the invisible-until-selected halos nor the leader lines reserve.
      transparent: ['venue-leader-halo', 'transit-leader-halo', 'venue-leader-line', 'transit-leader-line'].map((id) => [
        id,
        read(id),
      ]),
      pinWidth: width('pin-venue'),
      blockWidth: width('pin-venue-block'),
    };
  });

  for (const [id, ignored] of placement.direct) {
    expect(ignored, `${id} does not register its collision box; a name can be placed across it`).toBe(false);
  }
  for (const [id, ignored] of placement.delegating) {
    expect(ignored, `${id} registers its own bounding box instead of delegating to its blocker`).toBe(true);
  }
  for (const [id, ignored] of placement.blockers) {
    expect(ignored, `${id} is missing; nothing is reserving space for the venue pins`).not.toBeNull();
    expect(ignored, `${id} does not reserve anything, so a label can cross a venue diamond`).toBe(false);
  }
  for (const [id, ignored] of placement.transparent) {
    expect(ignored, `${id} reserves label room it should not`).toBe(true);
  }

  // The point of the blocker: a diamond's bounding box is twice the diamond's
  // area, so the box gives up the tips and keeps the body. Anything close to
  // the pin's own width would be the old behaviour by another name.
  expect(placement.blockWidth, 'the blocker reserves as much as the pin draws').toBeLessThan(
    placement.pinWidth / Math.SQRT2 + 1,
  );
  expect(placement.blockWidth, 'the blocker is too small to protect the diamond body').toBeGreaterThan(
    placement.pinWidth / 2,
  );
});

// The tips may be grazed; the number may not. It sits at the centre, so the
// blocker has to be wider than the number it is protecting — at two digits,
// which is the widest the key list produces for this sheet.
test("a venue pin's number stays inside what the pin reserves", async ({ page }) => {
  await gotoMap(page);
  const fit = await mapEval(page, (map) => {
    const img = map.style.getImage('pin-venue-block');
    const size = map.getLayoutProperty('venue-pin', 'text-size');
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `700 ${size}px system-ui, Helvetica Neue, Helvetica, Arial`;
    return {
      blockHalf: img.data.width / img.pixelRatio / 2 + 2,
      numberHalf: ctx.measureText('88').width / 2 + 2,
    };
  });
  expect(fit.numberHalf, 'a two-digit pin number reaches outside the box that protects it').toBeLessThan(fit.blockHalf);
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
// map that is the common case. Two things have to hold for them to be usable.
//
// They need an offset per anchor: a single `text-radial-offset` places a
// diagonal candidate at radius/sqrt(2) on each axis, inside the square box it is
// meant to clear, so the placement pass rejects it and the candidate is
// decoration. Measured before the offsets were split out, adding corner anchors
// changed nothing at all.
//
// And they are measured to what the pin RESERVES, not to its bounding box. A
// venue pin reserves a square of the diamond's own area (PIN_BLOCK_HALF), so the
// corner clearance is smaller than the cardinal one -- a corner name sits as
// close as a side name looks, instead of standing off at the bounding box's
// corner, 1.41R out where the ink stopped at 0.71R.
test('every name layer offers the four corners, and diagonals clear the ink not the box', async ({ page }) => {
  await gotoMap(page);
  const layers = await mapEval(page, (map, ids) =>
    ids.map((id) => {
      const expr = map.getLayoutProperty(id, 'text-variable-anchor-offset');
      // The fallback branch: no lane offset folded in, so the numbers are the
      // clearances themselves.
      const pairs = expr[0] === 'literal' ? expr[1] : expr[expr.length - 1][1];
      const at = {};
      for (let i = 0; i < pairs.length; i += 2) at[pairs[i]] = pairs[i + 1];
      const image = (name) => {
        const img = map.style.getImage(name);
        return img && img.data.width / img.pixelRatio;
      };
      // The sponsor layer serves both sponsor shapes and is measured to the
      // wider box, the featured square's: its image rect plus the engine's own
      // 2 px icon padding.
      const boxHalf =
        id === 'sponsor-name-label' ? image('pin-sponsor-featured') / 2 + 2 : image('pin-venue-block') / 2 + 2;
      return [id, at, boxHalf, image('pin-venue') / 2 - 2];
    }),
    ['venue-name-label', 'sponsor-name-label', 'venue-leader-name-label'],
  );

  for (const [id, at, blockHalf, pinRadius] of layers) {
    for (const anchor of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) {
      expect(at[anchor], `${id} offers no ${anchor} candidate`).toBeTruthy();
    }
    // `left` puts the name east of the pin, `bottom` puts it above. The corner
    // that does both carries a full clearance on each axis — never a diagonal
    // share of one radius, which is what would put it back inside the box.
    const cornerX = Math.abs(at['bottom-left'][0]);
    const cornerY = Math.abs(at['bottom-left'][1]);
    expect(cornerX, `${id}'s corner offset is a diagonal share of one radius`).toBeCloseTo(cornerY, 3);
    expect(at['top-right'][0], `${id}'s corners are not symmetric`).toBeCloseTo(-cornerX, 3);
    expect(at['top-right'][1], `${id}'s corners are not symmetric`).toBeCloseTo(cornerY, 3);

    const textPx = id === 'sponsor-name-label' ? 11 : 12;
    // It still has to clear what the pin reserves, or the pin's own box rejects
    // its own name — the failure that made corners inert before they had their
    // own offsets. The sponsor layer is in this check now (2026-09-05): a
    // square's ink runs all the way to its corner, so a corner offset that a
    // diamond of the same ink could afford to pull in lands inside the square.
    expect(cornerX * textPx - 2, `${id}'s corner candidate is inside the pin's own box`).toBeGreaterThan(blockHalf);
  }

  // The venue layers measure a diagonal to the INK, not to the reserved box: a
  // diamond's edge crosses the 45-degree ray at R/2 per axis, and the gap past
  // it is the same NAME_CLEAR_PX a side gets. Measuring to the box corner
  // instead left 0.2R of visible emptiness (Anthony, 2026-09-04).
  const [venue] = layers;
  const pinRadius = venue[3];
  const sideClear = Math.abs(venue[1]['left'][0]) * 12 - pinRadius;
  expect(
    Math.abs(venue[1]['bottom-left'][0]) * 12,
    'venue corners are measured to the reserved box rather than to the diamond edge',
  ).toBeCloseTo(pinRadius / 2 + sideClear, 1);
});
