#!/usr/bin/env node
// tools/make-ticket-icons.mjs
//
// One-off generator (NOT part of `npm run build`): converts the supplied brand
// artwork in "MMAF Brand Assets/{FREE,PAID}_TICKET.svg" into the <symbol>
// definitions inlined in site/index.html — one per `tickets` value that gets
// an icon (CONTRACTS.md events.csv): Free, Paid, and Sold Out.
//
// The source files are 1500x1500 with the artwork occupying a small centered
// region, and are drawn black-on-white. Three things have to change before
// they can sit in a list row:
//   1. crop the viewBox to the artwork's real bounding box (measured with
//      getBBox in a real renderer, not estimated from the path data),
//   2. recolor the ticket body from #000000 to the icon's own color, keeping
//      the knocked-out white lettering where the source has any,
//   3. wrap as <symbol> so each row costs one <use> instead of a copy of the
//      glyph paths (~3KB x ~60 rows).
//
// Sold Out has no brand artwork of its own (organizers never supplied one) and
// no organizers-approved wording to render as lettering, so it reuses the paid
// ticket's outline — recolored grey instead of brand red, with the "$" glyph
// dropped rather than replaced — per definitions/ticket-links-and-sold-out.md,
// which pre-approves a plain grey ticket as one of two acceptable outcomes
// (the other being "SOLD OUT" lettering, if it turns out to be legible at
// schedule-row size; nothing here renders lettering that doesn't exist as
// vector artwork). Anthony judges the choice on device against BACKLOG.md.
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
// Same grey the app already uses for de-emphasized text (--color-text-muted in
// app.css) — icon colors are baked into the symbol rather than driven by a CSS
// custom property, so it is restated here rather than shared with that file.
const SOLD_OUT_GREY = '#4b5962';
const PAD = 12; // breathing room around the artwork, in source units

const SOURCES = [
  { file: 'FREE_TICKET.svg', id: 'icon-ticket-free', color: BRAND_RED, glyph: true },
  { file: 'PAID_TICKET.svg', id: 'icon-ticket-paid', color: BRAND_RED, glyph: true },
  // Reuses PAID_TICKET.svg's outline only — see the header comment above for
  // why there is no lettering.
  { file: 'PAID_TICKET.svg', id: 'icon-ticket-soldout', color: SOLD_OUT_GREY, glyph: false },
];

const START = '<!-- BEGIN generated ticket sprite (tools/make-ticket-icons.mjs) -->';
const END = '<!-- END generated ticket sprite -->';

const browser = await chromium.launch();
const page = await browser.newPage();
const symbols = [];

for (const { file, id, color, glyph } of SOURCES) {
  const raw = await readFile(join(ROOT, 'MMAF Brand Assets', file), 'utf8');
  await page.setContent(`<body style="margin:0">${raw}</body>`);
  const box = await page.evaluate((keepGlyph) => {
    const svg = document.querySelector('svg');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const node of [...svg.childNodes]) {
      const tag = node.nodeName.toLowerCase();
      if (tag === 'defs') continue;
      // The lettering (if any) is always a <g>, sitting after the ticket-body
      // outline <path>; dropping it for the glyph-less variant means its box
      // must not stretch to fit lettering that the symbol won't contain.
      if (!keepGlyph && tag !== 'path') continue;
      g.appendChild(node);
    }
    svg.appendChild(g);
    const b = g.getBBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, glyph);

  // Strip the outer <svg> wrapper, keep everything inside (defs included --
  // PAID_TICKET's "$" glyph depends on a clipPath living in <defs>).
  const inner = raw.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  // The glyph-less variant keeps only the ticket-body outline — the first
  // top-level element in both source files — and none of the <defs> the
  // glyph's clipPath needs, since nothing here references it.
  const body = glyph ? inner : (inner.match(/<path fill="#000000"[^>]*\/>/) ?? [])[0];
  if (!body) throw new Error(`${file}: expected a ticket-outline path to reuse for ${id}`);
  const recolored = body.replaceAll('fill="#000000"', `fill="${color}"`);

  const vb = [
    round(box.x - PAD),
    round(box.y - PAD),
    round(box.w + PAD * 2),
    round(box.h + PAD * 2),
  ].join(' ');

  symbols.push(`  <symbol id="${id}" viewBox="${vb}">${recolored.trim()}</symbol>`);
  console.error(`${file} -> ${id}: bbox ${round(box.w)}x${round(box.h)} -> viewBox "${vb}"`);
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
  // Function replacement: a `$&` in the icon source would otherwise be expanded
  // into the sprite by String.replace.
  const next = html.replace(new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`), () => sprite);
  await writeFile(INDEX, next);
  console.error('wrote sprite into site/index.html');
} else {
  console.log(sprite);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
