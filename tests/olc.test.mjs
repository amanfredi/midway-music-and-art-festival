// Runs the official Open Location Code spec test vectors (tests/data/olc/,
// from github.com/google/open-location-code test_data) against scripts/olc.mjs,
// plus the location-column parser used by the content build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encode, decode, recoverNearest } from '../scripts/olc.mjs';
import { parseLocation, FESTIVAL_CENTER } from '../scripts/location.mjs';

function vectors(file) {
  return readFileSync(new URL(`data/olc/${file}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(','));
}

test('spec vectors: decoding.csv', () => {
  for (const [code, , latLo, lngLo, latHi, lngHi] of vectors('olc-decoding.csv')) {
    const cell = decode(code);
    for (const [got, want] of [
      [cell.latLo, latLo], [cell.lngLo, lngLo], [cell.latHi, latHi], [cell.lngHi, lngHi],
    ]) {
      assert.ok(Math.abs(got - Number(want)) < 1e-10, `${code}: got ${got}, want ${want}`);
    }
  }
});

test('spec vectors: encoding.csv (from degrees)', () => {
  for (const [lat, lng, , , len, expected] of vectors('olc-encoding.csv')) {
    if (!expected) continue; // error-input rows exercise a stricter API surface than we expose
    assert.equal(encode(Number(lat), Number(lng), Number(len)), expected, `encode(${lat}, ${lng}, ${len})`);
  }
});

test('spec vectors: shortCodeTests.csv (recovery)', () => {
  for (const [full, lat, lng, short, type] of vectors('olc-short.csv')) {
    if (type !== 'R' && type !== 'B') continue;
    assert.equal(recoverNearest(short, Number(lat), Number(lng)), full, `recover ${short} near ${lat},${lng}`);
  }
});

test('corridor round trip: Snelling & University', () => {
  const code = encode(44.9557, -93.1668);
  assert.match(code, /^86P8/); // Twin Cities area code
  const cell = decode(code);
  assert.ok(Math.abs(cell.latCenter - 44.9557) < 0.0002);
  assert.ok(Math.abs(cell.lngCenter - -93.1668) < 0.0002);
});

test('parseLocation accepts every coordinator format', () => {
  const decimal = parseLocation('44.9616, -93.1672');
  assert.deepEqual(decimal, { lat: 44.9616, lng: -93.1672 });

  const full = encode(44.9616, -93.1672); // e.g. 86P8XR6M+R4
  const short = full.slice(4);
  for (const input of [
    full,
    short,
    `${short} St. Paul, Minnesota`,
    `${short.toLowerCase()} st paul`,
    `St. Paul ${short}`,
  ]) {
    const got = parseLocation(input);
    assert.ok(!got.error, `${input}: ${got.error}`);
    assert.ok(Math.abs(got.lat - 44.9616) < 0.001 && Math.abs(got.lng - -93.1672) < 0.001, input);
  }
});

test('parseLocation rejects garbage readably', () => {
  for (const bad of ['', 'by the big tree', 'XR3M+X', '44.9616 -93.1672', '86P80000+']) {
    const got = parseLocation(bad);
    assert.ok(got.error, `expected error for "${bad}"`);
  }
});

test('short-code recovery is stable across the whole corridor', () => {
  // Every venue-ish point in the bbox must recover correctly from its short form.
  for (let lat = 44.95; lat <= 44.966; lat += 0.003) {
    for (let lng = -93.181; lng <= -93.151; lng += 0.005) {
      const full = encode(lat, lng);
      assert.equal(recoverNearest(full.slice(4), FESTIVAL_CENTER.lat, FESTIVAL_CENTER.lng), full);
    }
  }
});
