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
