// One-off: rasterizes site/icons/icon.svg to the PNG set the manifest needs,
// plus the apple-touch-startup-image splash set index.html links to. Uses
// Playwright's chromium (already a dev dependency) instead of adding an
// image toolchain. Run: node tools/make-icons.mjs
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ICONS = join(ROOT, 'site', 'icons');
const svg = await readFile(join(ICONS, 'icon.svg'), 'utf8');

// maskable: full-bleed square background, artwork scaled into the ~80% safe zone
const targets = [
  { file: 'icon-192.png', size: 192, scale: 1, bleed: false },
  { file: 'icon-512.png', size: 512, scale: 1, bleed: false },
  { file: 'maskable-512.png', size: 512, scale: 0.8, bleed: true },
  { file: 'apple-touch-icon.png', size: 180, scale: 1, bleed: true },
];

// apple-touch-startup-image set: festival background with the centered
// emblem, current-generation iPhone portrait sizes only (the manifest is
// portrait-locked). iOS matches a splash image by exact physical device
// pixels (CSS device-width/height * -webkit-device-pixel-ratio), so these
// three cover the current 6.1"/6.7"/6.9" iPhone size classes; other devices
// just skip the (harmless) apple-touch-startup-image lookup. Figures are the
// devices' CSS-pixel viewport, verified 2026-08 against device-spec
// references (iPhone 16: 393x852, 16 Plus: 430x932, 16 Pro Max: 440x956; all
// @3x).
const SPLASH_BG = '#fdf8ee';
const EMBLEM_FRACTION = 0.36; // emblem width as a fraction of the shorter screen dimension
const splashTargets = [
  { file: 'splash-1179x2556.png', width: 1179, height: 2556 }, // iPhone 16 / 16 Pro (393x852 @3x)
  { file: 'splash-1290x2796.png', width: 1290, height: 2796 }, // iPhone 16 Plus (430x932 @3x)
  { file: 'splash-1320x2868.png', width: 1320, height: 2868 }, // iPhone 16 Pro Max (440x956 @3x)
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  const inner = Math.round(t.size * t.scale);
  const pad = Math.round((t.size - inner) / 2);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<!doctype html><style>
    * { margin: 0 }
    body { width:${t.size}px; height:${t.size}px; background:${t.bleed ? '#fdf8ee' : 'transparent'} }
    img { width:${inner}px; height:${inner}px; margin:${pad}px; display:block }
  </style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
  await page.screenshot({
    path: join(ICONS, t.file),
    omitBackground: !t.bleed,
    clip: { x: 0, y: 0, width: t.size, height: t.size },
  });
  console.log(`${t.file} (${t.size}x${t.size})`);
}
for (const t of splashTargets) {
  const inner = Math.round(Math.min(t.width, t.height) * EMBLEM_FRACTION);
  await page.setViewportSize({ width: t.width, height: t.height });
  await page.setContent(`<!doctype html><style>
    * { margin: 0 }
    body { width:${t.width}px; height:${t.height}px; background:${SPLASH_BG};
      display:flex; align-items:center; justify-content:center }
    img { width:${inner}px; height:${inner}px; display:block }
  </style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
  await page.screenshot({
    path: join(ICONS, t.file),
    clip: { x: 0, y: 0, width: t.width, height: t.height },
  });
  console.log(`${t.file} (${t.width}x${t.height})`);
}
await browser.close();
