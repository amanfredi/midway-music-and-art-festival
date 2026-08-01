// node --test tests/geo.test.mjs
//
// Affine transform accuracy for site/js/geo.js. Calibration control points
// are read straight from the shipped site/assets/map-calibration.json so
// this test always exercises the real, committed calibration -- not a copy
// that could drift from it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeProjector } from '../site/js/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calibration = JSON.parse(
  readFileSync(path.join(__dirname, '../site/assets/map-calibration.json'), 'utf8')
);
const { control_points: controlPoints, svg_viewbox: viewBox } = calibration;

test('round-trips every control point to within 1e-6 m', () => {
  const { project } = makeProjector(controlPoints);
  for (const p of controlPoints) {
    const { x, y } = project(p.lat, p.lng);
    assert.ok(Math.abs(x - p.x) < 1e-6, `x mismatch at (${p.lat}, ${p.lng}): got ${x}, want ${p.x}`);
    assert.ok(Math.abs(y - p.y) < 1e-6, `y mismatch at (${p.lat}, ${p.lng}): got ${y}, want ${p.y}`);
  }
});

test('Snelling & University intersection projects inside the viewBox and matches the raw projection formula', () => {
  const { project } = makeProjector(controlPoints);
  const lat = 44.9557;
  const lng = -93.1668;
  const { x, y } = project(lat, lng);

  const [vx0, vy0, vw, vh] = viewBox;
  assert.ok(x >= vx0 && x <= vx0 + vw, `x=${x} falls outside viewBox width ${vw}`);
  assert.ok(y >= vy0 && y <= vy0 + vh, `y=${y} falls outside viewBox height ${vh}`);

  // Independently recompute via the raw equirectangular formula the
  // calibration's bbox-corner control points were themselves derived from,
  // so this checks the fitted transform against ground truth, not itself.
  const BBOX = { south: 44.95, west: -93.181, north: 44.966, east: -93.151 };
  const lat0 = (BBOX.south + BBOX.north) / 2;
  const mPerDegLat = 111320;
  const mPerDegLng = mPerDegLat * Math.cos((lat0 * Math.PI) / 180);
  const expectedX = (lng - BBOX.west) * mPerDegLng;
  const expectedY = (BBOX.north - lat) * mPerDegLat;

  assert.ok(Math.abs(x - expectedX) < 30, `x=${x} not within 30m of raw-formula x=${expectedX}`);
  assert.ok(Math.abs(y - expectedY) < 30, `y=${y} not within 30m of raw-formula y=${expectedY}`);
});

test('unproject(project(p)) round-trips an arbitrary point', () => {
  const { project, unproject } = makeProjector(controlPoints);
  const lat = 44.9557;
  const lng = -93.1668;
  const { x, y } = project(lat, lng);
  const back = unproject(x, y);
  assert.ok(Math.abs(back.lat - lat) < 1e-9, `lat round-trip off by ${Math.abs(back.lat - lat)}`);
  assert.ok(Math.abs(back.lng - lng) < 1e-9, `lng round-trip off by ${Math.abs(back.lng - lng)}`);
});

test('throws a clear error for fewer than 3 control points', () => {
  assert.throws(() => makeProjector(controlPoints.slice(0, 2)), /at least 3/);
  assert.throws(() => makeProjector([]), /at least 3/);
});

test('throws a clear error for collinear control points', () => {
  const collinear = [
    { lat: 44.95, lng: -93.18, x: 0, y: 0 },
    { lat: 44.96, lng: -93.17, x: 100, y: 100 },
    { lat: 44.97, lng: -93.16, x: 200, y: 200 },
  ];
  assert.throws(() => makeProjector(collinear), /collinear|degenerate/);
});
