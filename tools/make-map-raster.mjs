#!/usr/bin/env node
// tools/make-map-raster.mjs
//
// SPIKE (maplibre-spike branch). Rasterizes site/assets/map.svg to
// site/assets/map-raster.webp, the stand-in "artwork" for the audition's Mode B
// (ImageSource ground). Uses Playwright's chromium, already a dev dependency,
// the same way tools/make-icons.mjs does.
//
// Usage: node tools/make-map-raster.mjs [--size 4096] [--quality 0.9]
//
// WebP, not PNG: the same 4096px raster is 3.5 MB as PNG and ~0.4 MB as WebP,
// and every byte here is precached onto an attendee's phone. Safari has
// supported WebP since 14, well below this PWA's floor.
//
// 4096 x 4096 is the default for a reason: MapLibre uploads an ImageSource as a
// SINGLE WebGL texture, and 4096 is the largest size every WebGL2 device in
// circulation is guaranteed to accept. Over the map's 16.09 km square that is
// 3.93 m per pixel, which reads fine at the home view and goes soft at the
// closest zoom -- a resolution ceiling real commissioned artwork would have to
// answer with tiles, not a bigger single image. Worth knowing before anyone
// commissions anything.
//
// The SVG's own level-of-detail rules are keyed off data-lod on the root, which
// the hand-rolled UI sets as you zoom. A flat raster has no zoom, so it is shot
// at data-lod="2": the labels a mid-zoom reader would see, without the full
// 400-name wall the widest level carries.

import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG_IN = path.join(ROOT, 'site/assets/map.svg');
const OUT = path.join(ROOT, 'site/assets/map-raster.webp');

const sizeFlag = process.argv.indexOf('--size');
const SIZE = sizeFlag === -1 ? 4096 : Number(process.argv[sizeFlag + 1]);
const qualityFlag = process.argv.indexOf('--quality');
const QUALITY = qualityFlag === -1 ? 0.9 : Number(process.argv[qualityFlag + 1]);

const svg = await readFile(SVG_IN, 'utf8');
const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
if (!viewBox) throw new Error('map.svg has no viewBox — cannot georeference the raster');
const [, , vbW, vbH] = viewBox.split(/\s+/).map(Number);
if (Math.abs(vbW - vbH) > 1) {
  console.warn(`map.svg is not square (${vbW} x ${vbH}); the raster will be squashed to ${SIZE} x ${SIZE}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
await page.setContent(
  `<!DOCTYPE html><html><head><style>
     html,body{margin:0;padding:0;background:transparent}
     svg{display:block;width:${SIZE}px;height:${SIZE}px}
   </style></head><body>${svg}</body></html>`,
  { waitUntil: 'load' }
);
await page.evaluate(() => {
  const root = document.querySelector('#circuit-map') || document.querySelector('svg');
  root.setAttribute('data-lod', '2');
  root.setAttribute('preserveAspectRatio', 'none');
});
const png = await page.screenshot({ omitBackground: false });

// Re-encode through a canvas in the same browser: Playwright screenshots are
// PNG or JPEG only, and JPEG's ringing around the street labels is exactly the
// artifact this map cannot afford.
const dataUrl = await page.evaluate(
  async ([b64, size, quality]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').drawImage(img, 0, 0, size, size);
    return canvas.toDataURL('image/webp', quality);
  },
  [png.toString('base64'), SIZE, QUALITY]
);
await browser.close();

if (!dataUrl.startsWith('data:image/webp')) throw new Error('browser did not produce WebP');
const webp = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
await writeFile(OUT, webp);

console.log(`Wrote ${path.relative(ROOT, OUT)} — ${SIZE}x${SIZE} WebP q${QUALITY}, ${(webp.length / 1e6).toFixed(2)} MB`);
console.log(`  (${(png.length / 1e6).toFixed(2)} MB as PNG)`);
console.log(`  ${(vbW / SIZE).toFixed(2)} m per pixel over the map's ${(vbW / 1000).toFixed(2)} km extent`);
