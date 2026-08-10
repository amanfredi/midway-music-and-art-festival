// node --test tests/vendor-maplibre.test.mjs
//
// The map engine ships from site/assets/maplibre/, copied out of node_modules
// by tools/vendor-maplibre.mjs. Nothing at runtime or deploy time re-derives
// those files, so without this they are four committed blobs that a version
// bump would silently leave stale — the deployed site would keep running the
// old engine while package.json claimed the new one.
//
// This asserts the committed copy is exactly what the pinned dependency
// produces, which is what makes "vendored" reproducible rather than manual.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VENDORED_FILES, stripSourceMappingUrl } from '../tools/vendor-maplibre.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = path.join(ROOT, 'site/assets/maplibre');
const DIST = path.join(ROOT, 'node_modules/maplibre-gl/dist');

const pinned = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies['maplibre-gl'];

test('maplibre-gl is pinned to an exact version', () => {
  // A caret here would let `npm install` move the engine under a vendored copy
  // that no longer matches it.
  assert.match(pinned, /^\d+\.\d+\.\d+$/, `maplibre-gl must be pinned exactly, got "${pinned}"`);
});

test('the vendored VERSION file records the version actually installed', () => {
  const installed = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/maplibre-gl/package.json'), 'utf8')).version;
  assert.equal(installed, pinned, 'installed maplibre-gl does not match the pin — run `npm ci`');
  const stamp = readFileSync(path.join(VENDOR_DIR, 'VERSION'), 'utf8').trim();
  assert.equal(stamp, `maplibre-gl ${installed}`, 'run `npm run vendor:maplibre` to refresh the vendored engine');
});

for (const name of VENDORED_FILES) {
  test(`site/assets/maplibre/${name} matches the pinned dependency byte for byte`, () => {
    const vendored = path.join(VENDOR_DIR, name);
    assert.ok(existsSync(vendored), `${name} is missing — run \`npm run vendor:maplibre\``);
    const expected = stripSourceMappingUrl(readFileSync(path.join(DIST, name), 'utf8'));
    assert.equal(
      readFileSync(vendored, 'utf8'),
      expected,
      `${name} differs from node_modules — run \`npm run vendor:maplibre\` and commit the result`,
    );
  });
}

test('the vendored engine references nothing outside its own directory', () => {
  // The whole point of self-hosting: no CDN, no external page resources. The
  // worker is resolved relatively against import.meta.url, and the shared chunk
  // by a relative import, so any absolute http(s) URL in a module's own import
  // or worker-construction path would be a regression.
  for (const name of VENDORED_FILES.filter((f) => f.endsWith('.mjs'))) {
    const src = readFileSync(path.join(VENDOR_DIR, name), 'utf8');
    const imports = [...src.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(spec.startsWith('./'), `${name} imports "${spec}"; vendored modules may only import their siblings`);
    }
    assert.ok(!/new Worker\(\s*["']https?:/.test(src), `${name} constructs a worker from an absolute URL`);
  }
});
