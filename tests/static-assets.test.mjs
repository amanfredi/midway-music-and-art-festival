// node --test tests/static-assets.test.mjs
//
// Accessibility properties of hand-edited shipped assets that no runtime test
// can reach: the web app manifest applies only to an installed PWA, and the
// map SVG's own text is authored in tools/make-map.mjs rather than the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the manifest leaves the installed app free to follow the device orientation', () => {
  const manifest = JSON.parse(read('site/manifest.webmanifest'));
  assert.ok(
    !('orientation' in manifest),
    `manifest pins "orientation": ${JSON.stringify(manifest.orientation)}; an installed app must follow the device (WCAG 1.3.4)`,
  );
});
