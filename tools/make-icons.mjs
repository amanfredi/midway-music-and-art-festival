// One-off: rasterizes site/icons/icon.svg to the PNG set the manifest needs.
// Uses Playwright's chromium (already a dev dependency) instead of adding an
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
await browser.close();
