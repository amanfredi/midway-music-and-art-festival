#!/usr/bin/env node
// tools/make-ticket-icons.mjs
//
// One-off generator (NOT part of `npm run build`): converts the supplied brand
// artwork in "MMAF Brand Assets/{FREE,PAID}_TICKET.svg" into the two <symbol>
// definitions inlined in site/index.html.
//
// The source files are 1500x1500 with the artwork occupying a small centered
// region, and are drawn black-on-white. Three things have to change before
// they can sit in a list row:
//   1. crop the viewBox to the artwork's real bounding box (measured with
//      getBBox in a real renderer, not estimated from the path data),
//   2. recolor the ticket body from #000000 to the brand red, keeping the
//      knocked-out white lettering,
//   3. wrap as <symbol> so each row costs one <use> instead of a copy of the
//      glyph paths (~3KB x ~60 rows).
//
// The brand assets themselves are never modified.
//
// Usage: node tools/make-ticket-icons.mjs [--write]
//   without --write, prints the markup for review.

import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INDEX = join(ROOT, 'site/index.html');
const BRAND_RED = '#a11f22';
const PAD = 12; // breathing room around the artwork, in source units

const SOURCES = [
  { file: 'FREE_TICKET.svg', id: 'icon-ticket-free' },
  { file: 'PAID_TICKET.svg', id: 'icon-ticket-paid' },
];

const START = '<!-- BEGIN generated ticket sprite (tools/make-ticket-icons.mjs) -->';
const END = '<!-- END generated ticket sprite -->';

const browser = await chromium.launch();
const page = await browser.newPage();
const symbols = [];

for (const { file, id } of SOURCES) {
  const raw = await readFile(join(ROOT, 'MMAF Brand Assets', file), 'utf8');
  await page.setContent(`<body style="margin:0">${raw}</body>`);
  const box = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const node of [...svg.childNodes]) {
      if (node.nodeName.toLowerCase() !== 'defs') g.appendChild(node);
    }
    svg.appendChild(g);
    const b = g.getBBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });

  // Strip the outer <svg> wrapper, keep everything inside (defs included --
  // PAID_TICKET's "$" glyph depends on a clipPath living in <defs>).
  const inner = raw.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const recolored = inner.replaceAll('fill="#000000"', `fill="${BRAND_RED}"`);

  const vb = [
    round(box.x - PAD),
    round(box.y - PAD),
    round(box.w + PAD * 2),
    round(box.h + PAD * 2),
  ].join(' ');

  symbols.push(`  <symbol id="${id}" viewBox="${vb}">${recolored.trim()}</symbol>`);
  console.error(`${file}: bbox ${round(box.w)}x${round(box.h)} -> viewBox "${vb}"`);
}

function round(v) {
  return Math.round(v * 10) / 10;
}

const sprite = [
  START,
  '<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">',
  ...symbols,
  '</svg>',
  END,
].join('\n');

await browser.close();

if (process.argv.includes('--write')) {
  const html = await readFile(INDEX, 'utf8');
  if (!html.includes(START)) {
    throw new Error(`marker ${START} not found in site/index.html — add it first`);
  }
  const next = html.replace(new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`), sprite);
  await writeFile(INDEX, next);
  console.error('wrote sprite into site/index.html');
} else {
  console.log(sprite);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
