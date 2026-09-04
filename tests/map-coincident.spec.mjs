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
import { gotoMap, mapEval, sheet, sourceFeatures, waitForMapIdle, SOURCE_FEATURES_FN } from './map-helpers.mjs';

/**
 * Where the biggest thing in a composite icon sits, in CSS pixels from the
 * anchor the engine places on the feature's coordinate.
 *
 * Both images are read the same way, on both axes: count opaque pixels per
 * column and per row, then take the middle of the band within 2 of the fullest.
 * That band is the diamond in a pin image (its sides fall away 2 px per step,
 * and the dot and the 2 px leader line are far thinner) and the ring in a halo
 * image, and it is symmetric about the shape's centre either way — a plain
 * index-of-maximum would pick whichever of two equal central lines came first.
 *
 * Both axes matter now that a lane can run north–south: reading only columns
 * would call a vertically displaced pin undisplaced.
 */
const IMAGE_PROBE_FN = `(map, id) => {
  const image = map.style.getImage(id);
  const { width, height, data } = image.data;
  const opaque = (x, y) => data[(y * width + x) * 4 + 3] > 8;
  const columns = new Array(width).fill(0);
  const rows = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (opaque(x, y)) { columns[x]++; rows[y]++; }
  }
  const middleOf = (counts) => {
    const peak = Math.max(...counts);
    const band = counts.map((n, i) => i).filter((i) => counts[i] >= peak - 2);
    return (band[0] + band[band.length - 1] + 1) / 2;
  };
  const ax = Math.floor(width / 2);
  const ay = Math.floor(height / 2);
  let opaqueAtAnchor = false;
  for (let y = ay - 1; y <= ay + 1; y++) {
    for (let x = ax - 1; x <= ax + 1; x++) {
      if (x >= 0 && y >= 0 && x < width && y < height && opaque(x, y)) opaqueAtAnchor = true;
    }
  }
  return {
    pixelRatio: image.pixelRatio,
    centreColumn: (middleOf(columns) - width / 2) / image.pixelRatio,
    centreRow: (middleOf(rows) - height / 2) / image.pixelRatio,
    opaqueAtAnchor,
  };
}`;

/** The lane a displaced feature carries, as the pixel pair the pin is drawn at. */
const LANE_OF = `(properties) => ({
  x: typeof properties.offsetX === 'number' ? properties.offsetX : 0,
  y: typeof properties.offsetY === 'number' ? properties.offsetY : 0,
})`;

/** Every venue symbol on screen, at the point it is actually drawn. */
const DRAWN_SYMBOLS_FN = `(map) => {
  const laneOf = ${LANE_OF};
  const out = [];
  for (const layer of ['venue-pin', 'venue-leader-pin', 'venue-cluster']) {
    for (const f of map.queryRenderedFeatures({ layers: [layer] })) {
      const point = map.project(f.geometry.coordinates);
      const lane = layer === 'venue-leader-pin' ? laneOf(f.properties) : { x: 0, y: 0 };
      const key = layer + ':' + (f.properties.cluster_id ?? f.properties.id);
      if (out.some((s) => s.key === key)) continue;
      out.push({
        key,
        layer,
        label: f.properties.label,
        pointCount: f.properties.point_count,
        groupedCount: f.properties.groupedCount,
        x: point.x + lane.x,
        y: point.y + lane.y,
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
          x: rect.left + point.x + f.properties.offsetX,
          y: rect.top + point.y + f.properties.offsetY,
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
    expect(Math.abs(member.offsetX) + Math.abs(member.offsetY), `${member.name} is not displaced`).toBeGreaterThan(0);
  }
  expect(new Set(pair.members.map((m) => m.lane)).size).toBe(2);
  expect(
    await mapEval(page, (map) => map.queryRenderedFeatures({ layers: ['venue-cluster'] }).length),
    'a stack still covers the pins it was replaced by',
  ).toBe(0);

  // The icon states the true position by what it draws at its anchor: a dot in
  // the middle, the numbered diamond a whole offset away from it.
  for (const member of pair.members) {
    const probe = await mapEval(page, IMAGE_PROBE_FN, member.icon);
    expect(probe.centreColumn, `${member.name}: the diamond is not at its lane's x`).toBeCloseTo(member.offsetX, 0);
    expect(probe.centreRow, `${member.name}: the diamond is not at its lane's y`).toBeCloseTo(member.offsetY, 0);
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
  expect(ring.centreColumn, 'the ring sits at the coordinate, not at the diamond').toBeCloseTo(member.offsetX, 0);
  expect(ring.centreRow, 'the ring sits at the coordinate, not at the diamond').toBeCloseTo(member.offsetY, 0);
  expect(ring.centreColumn).toBeCloseTo(pin.centreColumn, 0);
  expect(ring.centreRow).toBeCloseTo(pin.centreRow, 0);
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

// The same check on a phone-width frame. The collision zooms no longer vary
// with frame width, but the walk can only measure what is on screen, and a
// narrow frame crops a different pin set into view at every stop.
test.describe('on a phone-width frame', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('no two venue symbols draw on top of each other from the split zoom inward', async ({ page }) => {
    await expectNoOverlapFromSplitZoom(page);
  });
});

// The band just outside the leader zoom is where the pairs used to render as
// their own numbered two-stacks; the leader treatment now starts a level
// earlier and covers it (ruled 2026-08-23), so below the leader zoom the pair
// is inside SOME stack — with the current venue set, the merged anonymous one,
// since the two groups sit within clusterRadius of each other there. Any
// two-venue stack that does render still carries its members' numbers.
test('below the leader zoom the pair stacks, never as its own numbered pair', async ({ page }) => {
  await gotoMap(page);

  const state = await mapEval(
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
      const source = map.getSource('venues');
      const ids = members.map((f) => f.properties.id);
      const seen = new Set();
      const clusters = [];
      let holder = null;
      for (const f of map.queryRenderedFeatures({ layers: ['venue-cluster'] })) {
        if (seen.has(f.properties.cluster_id)) continue;
        seen.add(f.properties.cluster_id);
        const leaves = await source.getClusterLeaves(f.properties.cluster_id, Infinity, 0);
        const cluster = { properties: f.properties, leafLabels: leaves.map((l) => Number(l.properties.label)) };
        clusters.push(cluster);
        if (ids.every((id) => leaves.some((l) => l.properties.id === id))) holder = cluster;
      }
      return {
        labels: members.map((f) => Number(f.properties.label)).sort((a, b) => a - b),
        leaders: map.queryRenderedFeatures({ layers: ['venue-leader-pin'] }).length,
        holder,
        clusters,
      };
    },
    SOURCE_FEATURES_FN,
  );

  expect(state, 'no two venues share a coordinate; this test has lost its subject').not.toBeNull();
  expect(state.leaders, 'displaced pins reach below the leader zoom').toBe(0);
  expect(state.holder, 'the pair does not stack below the leader zoom').not.toBeNull();
  // The pair as its own stack is the state the leader zoom was moved out to
  // remove; seeing it here means the treatment has retreated a level inward.
  // A property of the current venue set — the groups merge with each other
  // below the leader zoom — not a law for every dataset.
  expect(
    state.holder.properties.point_count,
    'the pair still draws as its own numbered stack outside the leader zoom',
  ).toBeGreaterThan(2);
  // Whatever two-venue stacks do render carry their members' own key-list
  // numbers, in a fixed order: supercluster promises nothing about leaf order.
  for (const cluster of state.clusters.filter((c) => c.properties.point_count === 2)) {
    const numbers = cluster.leafLabels.slice().sort((a, b) => a - b);
    expect([cluster.properties.labelMin, cluster.properties.labelMax]).toEqual(numbers);
  }
});

// Cross-type companion to the venue treatment: a transit stop whose pin cannot
// clear a venue pin from the leader zoom inward draws displaced the same way —
// dot at the stop's coordinate, line, diamond in a lane — while the venue, the
// primary content, never moves. Below the leader zoom the stop draws plain and
// may tuck under the venue pin, as any small pin may at wide zooms.
test('a transit stop that cannot clear a venue pin draws displaced, with its own tap', async ({ page }) => {
  await gotoMap(page);

  const stop = await mapEval(
    page,
    async (map, featuresFn) => {
      const displaced = new Function('return ' + featuresFn)()(map, 'transit')
        .filter((f) => f.properties.grouped)
        .sort((a, b) => (a.properties.id < b.properties.id ? -1 : 1));
      if (!displaced.length) return null;
      const f = displaced[0];
      map.jumpTo({ center: f.geometry.coordinates, zoom: map.getMaxZoom() });
      await new Promise((r) => (map.loaded() ? setTimeout(r, 250) : map.once('idle', () => setTimeout(r, 250))));
      const rect = map.getCanvas().getBoundingClientRect();
      const point = map.project(f.geometry.coordinates);
      const drawnBy = (layer) =>
        map.queryRenderedFeatures({ layers: [layer] }).some((r) => r.properties.id === f.properties.id);
      return {
        ...f.properties,
        x: rect.left + point.x + f.properties.offsetX,
        y: rect.top + point.y + f.properties.offsetY,
        onLeaderLayer: drawnBy('transit-leader-pin'),
        onPlainLayer: drawnBy('transit-pin'),
      };
    },
    SOURCE_FEATURES_FN,
  );
  expect(stop, 'no transit stop is displaced; this test has lost its subject').not.toBeNull();

  expect(stop.onLeaderLayer, 'the displaced stop is not drawn by its leader layer').toBe(true);
  expect(stop.onPlainLayer, 'the stop draws twice, plain and displaced').toBe(false);
  expect(Math.abs(stop.offsetX) + Math.abs(stop.offsetY), 'the stop is not displaced').toBeGreaterThan(0);
  const probe = await mapEval(page, IMAGE_PROBE_FN, stop.icon);
  expect(probe.centreColumn, "the diamond is not at its lane's x").toBeCloseTo(stop.offsetX, 0);
  expect(probe.centreRow, "the diamond is not at its lane's y").toBeCloseTo(stop.offsetY, 0);
  expect(probe.opaqueAtAnchor, "nothing is drawn at the stop's own coordinate").toBe(true);

  // A tap on the displaced diamond opens that stop's sheet — identified by
  // name, read from the hidden keyboard list that shares the pinned subset.
  const label = await page.locator(`.pin-alt-btn[data-kind="transit"][data-id="${stop.id}"]`).textContent();
  await page.mouse.click(stop.x, stop.y);
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText(label.split(' — ')[0]);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
});

/** Every pin on screen with its drawn point and type, for cross-type spacing checks. */
const TYPED_SYMBOLS_FN = `(map) => {
  const laneOf = ${LANE_OF};
  const out = [];
  const grab = (layer, type) => {
    for (const f of map.queryRenderedFeatures({ layers: [layer] })) {
      const point = map.project(f.geometry.coordinates);
      const lane = layer.includes('-leader-') ? laneOf(f.properties) : { x: 0, y: 0 };
      const key = type + ':' + f.properties.id;
      if (out.some((s) => s.key === key)) continue;
      out.push({ key, type, x: point.x + lane.x, y: point.y + lane.y });
    }
  };
  grab('venue-pin', 'venue');
  grab('venue-leader-pin', 'venue');
  grab('transit-pin', 'transit');
  grab('transit-leader-pin', 'transit');
  grab('sponsor-featured-pin', 'sponsor');
  grab('sponsor-generic-pin', 'sponsor');
  return out;
}`;

async function expectNoCrossTypeOverlapFromLeaderZoom(page) {
  await gotoMap(page);

  // Centred on each displaced stop in turn: the walk can only measure what is
  // on screen, and the displaced sites are where the mechanism under test does
  // its work. Spacing away from them is enforced analytically at runtime by
  // displacedStopOffsets, which checks every pin pair before assigning a lane.
  const { worst, sites, needed } = await page.evaluate(
    async ([symbolsFn, featuresFn]) => {
      const map = window.__mmafMap;
      const start = map.getLayer('transit-leader-pin').minzoom;
      const centres = new Function('return ' + featuresFn)()(map, 'transit')
        .filter((f) => f.properties.grouped)
        .map((f) => f.geometry.coordinates);
      const radius = (id) => {
        const image = map.style.getImage(id);
        return (image.data.width / image.pixelRatio - 4) / 2;
      };
      const radii = { venue: radius('pin-venue'), transit: radius('pin-transit'), sponsor: radius('pin-transit') };
      const settle = () =>
        new Promise((r) => (map.loaded() ? setTimeout(r, 150) : map.once('idle', () => setTimeout(r, 150))));
      let worst = null;
      for (const centre of centres) {
        for (let zoom = start; zoom <= map.getMaxZoom() + 0.001; zoom += 0.5) {
          map.jumpTo({ center: centre, zoom: Math.min(zoom, map.getMaxZoom()) });
          await settle();
          const pins = new Function('return ' + symbolsFn)()(map);
          for (let i = 0; i < pins.length; i++) {
            for (let j = i + 1; j < pins.length; j++) {
              if (pins[i].type === pins[j].type) continue;
              const distance = Math.abs(pins[i].x - pins[j].x) + Math.abs(pins[i].y - pins[j].y);
              const margin = distance - (radii[pins[i].type] + radii[pins[j].type]);
              if (!worst || margin < worst.margin) {
                worst = { margin, zoom: map.getZoom(), pair: [pins[i].key, pins[j].key] };
              }
            }
          }
        }
      }
      return { worst, sites: centres.length, needed: radii };
    },
    [TYPED_SYMBOLS_FN, SOURCE_FEATURES_FN],
  );

  expect(sites, 'no transit stop is displaced; this test has lost its subject').toBeGreaterThan(0);
  expect(worst, 'no cross-type pin pair was ever on screen; the check proves nothing').not.toBeNull();
  expect(
    worst.margin,
    `${worst.pair?.join(' and ')} overlap at zoom ${worst.zoom?.toFixed(2)} (radii ${JSON.stringify(needed)})`,
  ).toBeGreaterThanOrEqual(0);
}

test('no pin of one type draws on a pin of another from the leader zoom inward', async ({ page }) => {
  await expectNoCrossTypeOverlapFromLeaderZoom(page);
});

test.describe('cross-type spacing on a phone-width frame', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('no pin of one type draws on a pin of another from the leader zoom inward', async ({ page }) => {
    await expectNoCrossTypeOverlapFromLeaderZoom(page);
  });
});

// The regression that shipped 2026-08-23: collision zooms derived from the
// live frame width gave a 560 px desktop frame a different leader zoom — and
// different group membership — than every phone, so desktops kept the stacks
// the leader treatment was supposed to replace. Pins are constant CSS pixels
// at a given zoom on every device; the treatment must not depend on the screen.
test('the leader treatment is identical at desktop and phone frame widths', async ({ page }) => {
  const snapshot = () =>
    mapEval(
      page,
      (map, featuresFn) => ({
        leaderZoom: map.getLayer('venue-leader-pin').minzoom,
        displacedVenues: new Function('return ' + featuresFn)()(map, 'venue-groups')
          .map((f) => `${f.properties.id}@${f.properties.lane}`)
          .sort(),
        displacedStops: [
          ...new Set(
            new Function('return ' + featuresFn)()(map, 'transit')
              .filter((f) => f.properties.grouped)
              .map((f) => `${f.properties.id}@${f.properties.lane}`)
          ),
        ].sort(),
      }),
      SOURCE_FEATURES_FN,
    );

  await gotoMap(page);
  const desktop = await snapshot();
  await page.setViewportSize({ width: 375, height: 667 });
  await page.reload();
  await waitForMapIdle(page);
  const phone = await snapshot();

  expect(desktop.displacedVenues.length).toBeGreaterThan(0);
  expect(phone).toEqual(desktop);
});

// A group's lanes run on one axis, and along that axis each member stays on the
// side of the group its venue is really on. Which axis a group ends up on is a
// decision about the whole neighbourhood — a group whose own axis is blocked
// gives it up (see coincidentGroups), and the committed fixtures are crowded
// enough that this happens — so the axis choice itself is tested against
// purpose-built geometry in map-collision-decisions.spec.mjs. What must hold
// for every venue set is the two properties below.
test('a coincident group lanes on one axis, with every member on its own side of it', async ({ page }) => {
  await gotoMap(page);
  const displaced = await sourceFeatures(page, 'venue-groups');
  expect(displaced.length).toBeGreaterThan(1);

  // Group members are the displaced venues that share a lane axis and a lane
  // ladder: same axis, offsets a whole LEADER_LANE_PX apart, and — since a
  // group is decided by coordinates being nearly identical — coordinates within
  // a few metres of each other on the axis they do not spread along.
  const byGroup = new Map();
  for (const feature of displaced) {
    const [axis] = feature.properties.lane.split(':');
    const [lng, lat] = feature.geometry.coordinates;
    const across = axis === 'ew' ? lat.toFixed(3) : lng.toFixed(3);
    const key = `${axis}|${across}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), { ...feature.properties, lat, lng }]);
  }

  let checked = 0;
  for (const [key, members] of byGroup) {
    if (members.length < 2) continue;
    checked++;
    const axis = key.split('|')[0];
    // Exactly one of the two offsets is ever non-zero, and it is the one the
    // axis names — nothing is displaced diagonally.
    for (const member of members) {
      const off = axis === 'ew' ? member.offsetY : member.offsetX;
      expect(off, `${member.name} is displaced across its group's ${axis} axis`).toBe(0);
    }
    // Sorted by where each member is drawn, the members come out in the order
    // of their true positions: west to east, or north to south.
    const drawn = [...members].sort((a, b) =>
      axis === 'ew' ? a.offsetX - b.offsetX : a.offsetY - b.offsetY
    );
    const truth = [...members].sort((a, b) => (axis === 'ew' ? a.lng - b.lng : b.lat - a.lat));
    expect(
      drawn.map((m) => m.name),
      `a ${axis} group's pins are not in the order of the venues they stand for`,
    ).toEqual(truth.map((m) => m.name));
  }
  expect(checked, 'no group of two or more was found; this test proves nothing').toBeGreaterThan(0);
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
