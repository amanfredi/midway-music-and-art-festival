#!/usr/bin/env node
// tools/vendor-maplibre.mjs
//
// SPIKE (maplibre-spike branch). Copies the MapLibre GL JS dist files out of
// node_modules into site/assets/maplibre/ so the engine ships self-hosted --
// the project loads nothing from a CDN at runtime, on a branch or otherwise.
//
// Usage: node tools/vendor-maplibre.mjs
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
// sourceMappingURL comment is stripped: build-sw.mjs precaches every byte
// under site/, so shipping 7 MB of source maps to every attendee's phone to
// serve a devtools session nobody will open is the wrong trade.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules/maplibre-gl/dist');
const OUT = path.join(ROOT, 'site/assets/maplibre');

const FILES = ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css'];

const version = JSON.parse(await readFile(path.join(ROOT, 'node_modules/maplibre-gl/package.json'), 'utf8')).version;

await mkdir(OUT, { recursive: true });
for (const name of FILES) {
  const text = await readFile(path.join(SRC, name), 'utf8');
  const stripped = text.replace(/\n?\/[/*][#@]\s*sourceMappingURL=.*?(\*\/)?\s*$/, '\n');
  await writeFile(path.join(OUT, name), stripped, 'utf8');
  console.log(`  ${name}: ${Buffer.byteLength(stripped, 'utf8')} bytes`);
}
await writeFile(path.join(OUT, 'VERSION'), `maplibre-gl ${version}\n`, 'utf8');
console.log(`Vendored maplibre-gl ${version} into ${path.relative(ROOT, OUT)}/`);
