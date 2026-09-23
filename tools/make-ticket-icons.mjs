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
// Sold Out has no brand artwork of its own (organizers never supplied one), so
// it reuses the paid ticket's outline with the "$" glyph dropped — recolored a
// lighter grey than the app's usual muted-text tone, so the ticket itself
// reads as greyed out/unavailable rather than merely dark — and gets its own
// "SOLD OUT" lettering, generated here (not hand-pasted) as plain SVG <text>
// rather than vector letterforms, since there is no source artwork to draw
// real glyph paths from the way FREE_TICKET.svg's "FREE" is. Per
// definitions/ticket-links-and-sold-out.md; Anthony judges legibility on
// device (BACKLOG.md).
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
// Lighter than --color-text-muted (#4b5962, the app's usual de-emphasized
// grey): Anthony's call after reviewing the darker first pass was that the
// ticket itself should read as greyed out/unavailable, not merely dark.
// #6b7680 keeps >=3:1 contrast (WCAG non-text minimum) against every kind
// tint in app.css, including the two lightest — --kind-music (#ddeaf3) and
// --kind-performance (#f9e3e3) — at 3.78:1 each; the previous #4b5962 sat at
// 5.9:1 on the same two. Icon colors are baked into the symbol rather than
// driven by a CSS custom property, so this is restated here rather than
// shared with app.css.
const SOLD_OUT_GREY = '#6b7680';
const PAD = 12; // breathing room around the artwork, in source units

const SOURCES = [
  { file: 'FREE_TICKET.svg', id: 'icon-ticket-free', color: BRAND_RED, glyph: true },
  { file: 'PAID_TICKET.svg', id: 'icon-ticket-paid', color: BRAND_RED, glyph: true },
  // Reuses PAID_TICKET.svg's outline only, recolored grey, with generated
  // "SOLD OUT" lettering in brand red — see the header comment above.
  {
    file: 'PAID_TICKET.svg',
    id: 'icon-ticket-soldout',
    color: SOLD_OUT_GREY,
    glyph: false,
    label: ['SOLD', 'OUT'],
    labelColor: BRAND_RED,
  },
];

/**
 * "SOLD OUT" as plain SVG <text>, stacked two lines (it does not fit legibly
 * on one line at schedule-row size), centered over the ticket's main face —
 * left of the perforated tear line near the right edge (the small dashed
 * circles and the notched top/bottom curves in the outline path, roughly the
 * right third of `box`), the same way PAID's "$" and FREE's lettering sit
 * left-of-center rather than centered on the whole ticket.
 *
 * font-family is the app's own system-ui stack (CLAUDE.md: no CDN fonts), and
 * <text> inside a <symbol> resolves it against the referencing document, not
 * this generator's headless page — same as any other inherited SVG property
 * reached through <use>.
 */
function labelMarkup(lines, box, color) {
  const centerX = box.x + box.w * 0.365;
  const fontSize = box.h * 0.285;
  const lineGap = fontSize * 1.02;
  const blockHeight = lineGap * lines.length;
  const firstBaseline = box.y + (box.h - blockHeight) / 2 + fontSize * 0.8;
  return lines
    .map((line, i) => {
      const y = round(firstBaseline + i * lineGap);
      return (
        `<text x="${round(centerX)}" y="${y}" text-anchor="middle" ` +
        `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-weight="800" ` +
        `font-size="${round(fontSize)}" letter-spacing="${round(fontSize * 0.03)}" fill="${color}">${line}</text>`
      );
    })
    .join('');
}

const START = '<!-- BEGIN generated ticket sprite (tools/make-ticket-icons.mjs) -->';
const END = '<!-- END generated ticket sprite -->';

const browser = await chromium.launch();
const page = await browser.newPage();
const symbols = [];

for (const { file, id, color, glyph, label, labelColor } of SOURCES) {
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
  const text = label ? labelMarkup(label, box, labelColor) : '';

  const vb = [
    round(box.x - PAD),
    round(box.y - PAD),
    round(box.w + PAD * 2),
    round(box.h + PAD * 2),
  ].join(' ');

  symbols.push(`  <symbol id="${id}" viewBox="${vb}">${recolored.trim()}${text}</symbol>`);
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
