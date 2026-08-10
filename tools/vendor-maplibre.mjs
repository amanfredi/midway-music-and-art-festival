#!/usr/bin/env node
// tools/vendor-maplibre.mjs
//
// Copies the MapLibre GL JS dist files out of node_modules into
// site/assets/maplibre/, so the engine ships self-hosted: the site loads nothing
// from a CDN at runtime, which is what lets it work offline and cost nothing.
//
// Usage: npm run vendor:maplibre
//
// The output is committed, because site/ is the deploy root and the deploy job
// publishes that tree as it stands. tests/vendor-maplibre.test.mjs asserts the
// committed bytes still match the pinned dependency, so bumping maplibre-gl
// without re-running this is a test failure rather than a silently stale engine.
//
// Four files are the whole runtime:
//   maplibre-gl.mjs         ESM entry, imports ./maplibre-gl-shared.mjs
//   maplibre-gl-shared.mjs  the shared chunk (also imported by the worker)
//   maplibre-gl-worker.mjs  module worker; the entry resolves it as
//                           new URL('./maplibre-gl-worker.mjs', import.meta.url),
//                           so it only has to sit next to the entry
//   maplibre-gl.css         control/attribution styling
//
// The .map files are deliberately NOT copied, and each file's trailing
// sourceMappingURL comment is stripped: build-sw.mjs precaches every byte under
// site/, so shipping 7 MB of source maps to every attendee's phone to serve a
// devtools session nobody will open is the wrong trade.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VENDORED_FILES = [
  'maplibre-gl.mjs',
  'maplibre-gl-shared.mjs',
  'maplibre-gl-worker.mjs',
  'maplibre-gl.css',
];

/** Drops the trailing `//# sourceMappingURL=…` comment; the .map files don't ship. */
export function stripSourceMappingUrl(text) {
  return text.replace(/\n?\/[/*][#@]\s*sourceMappingURL=.*?(\*\/)?\s*$/, '\n');
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules/maplibre-gl/dist');
const OUT = path.join(ROOT, 'site/assets/maplibre');

// Importing this module (the test does, for the two exports above) must not
// rewrite the tree, so the copying only runs when it is the entry point.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const version = JSON.parse(await readFile(path.join(ROOT, 'node_modules/maplibre-gl/package.json'), 'utf8')).version;
  await mkdir(OUT, { recursive: true });
  for (const name of VENDORED_FILES) {
    const stripped = stripSourceMappingUrl(await readFile(path.join(SRC, name), 'utf8'));
    await writeFile(path.join(OUT, name), stripped, 'utf8');
    console.log(`  ${name}: ${Buffer.byteLength(stripped, 'utf8')} bytes`);
  }
  await writeFile(path.join(OUT, 'VERSION'), `maplibre-gl ${version}\n`, 'utf8');
  console.log(`Vendored maplibre-gl ${version} into ${path.relative(ROOT, OUT)}/`);
}
