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
// it reuses the paid ticket's outline with the "$" glyph dropped, and gets its
// own "SOLD OUT" lettering, generated here (not hand-pasted) as plain SVG
// <text> rather than vector letterforms, since there is no source artwork to
// draw real glyph paths from the way FREE_TICKET.svg's "FREE" is.
//
// The body is white with a thin dashed near-black outline (chosen on
// 2026-09-23 over grey-bodied and dark-grey-outlined alternatives; see
// PROGRESS.md). The tear-line perforation holes are filled plain (no stroke of
// their own) rather than stroked along with the outer silhouette — see
// splitTicketPath below for why that split exists.
// Per definitions/ticket-links-and-sold-out.md.
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
// White: ~7.7:1 against BRAND_RED lettering, and never fades into a kind tint
// the way a grey fill can, since it is the row's own near-white surface color
// pushed to its lightest extreme. What white alone cannot do is read as a
// ticket shape against --color-surface/--color-bg (both near-white) or the
// palest kind tints — SOLD_OUT_OUTLINE below carries the silhouette instead.
const SOLD_OUT_BODY = '#ffffff';
// --color-text (app.css), 12–14.7:1 against every kind tint and white alike.
// Dashed rather than solid (Anthony's ask for this variant); width and
// dasharray are in source-path units, chosen for the icon's actual render
// scale (viewBox width 624 -> 34 CSS px, so 1 unit ~= 0.055 px) rather than
// for how a dash looks blown up in this generator's own preview output.
//
// Round 3 shipped width 26 (~1.4 px on screen); Anthony's round-4 ask was "as
// thin as it can reasonably be while still reading as dashed at row size",
// roughly a third to a half of that (~9-13 units), once the ringed-
// perforation "squiggly mess" (fixed by splitTicketPath, below) stopped
// obscuring the dash itself. 13 units (~0.7 px, exactly half of round 3's
// weight) is the top of that range: checked against 11 side by side, both
// read clearly as dashed at 2x/3x device scale — the range these icons are
// actually viewed at, a schedule row being 34x21 CSS px — and 13 held up
// very slightly better at 1x, for no visible cost at the higher densities.
// At true 1x it still antialiases faint regardless of which end of the range
// is picked — expected at this weight, and reported rather than quietly
// thickened back up. Dash/gap length (28/19) keep roughly round 3's
// dash:gap:width proportions, scaled down with the stroke rather than left
// at a size tuned for a 26-unit line.
const SOLD_OUT_OUTLINE = { color: '#1d2a33', width: 13, dasharray: '28 19' };
// The tear-line perforation holes are a separate filled shape from the outer
// silhouette (splitTicketPath, below) — fixed this round after rounds 2-3
// stroked the whole compound path as one shape, ringing every tiny hole with
// the outline color and, on this variant's dashed stroke, turning each hole
// into a different meaningless fraction of one dash cycle ("squiggly mess").
// Filled in the outline's own color: on a white body a hole this small reads
// as a punched dot either way, and matching the outline avoids introducing a
// fourth color into a two-color icon.
const SOLD_OUT_HOLE = SOLD_OUT_OUTLINE.color;
const PAD = 12; // breathing room around the artwork, in source units

// Landmarks in PAID_TICKET.svg's own path coordinate system, read off its
// path data once (both variants and both ticket icons reuse this outline):
// the semicircular notch cut into the left edge reaches its rightmost point
// around x=510, and the dotted perforation line that divides the main face
// from the small right-hand stub sits at x=915. The label centers in the gap
// between them — the ticket's actual open face — not on the ticket as a
// whole, which would drift it under the stub.
const LEFT_NOTCH_RIGHT_EDGE = 510;
const PERFORATION_X = 915;

const SOURCES = [
  { file: 'FREE_TICKET.svg', id: 'icon-ticket-free', color: BRAND_RED, glyph: true },
  { file: 'PAID_TICKET.svg', id: 'icon-ticket-paid', color: BRAND_RED, glyph: true },
  // Reuses PAID_TICKET.svg's outline only, with generated "SOLD OUT"
  // lettering in brand red — see the header comment above for the body
  // treatment, which is the one thing that differs between the two variant
  // branches.
  {
    file: 'PAID_TICKET.svg',
    id: 'icon-ticket-soldout',
    color: SOLD_OUT_BODY,
    outline: SOLD_OUT_OUTLINE,
    holeColor: SOLD_OUT_HOLE,
    glyph: false,
    label: ['SOLD', 'OUT'],
    labelColor: BRAND_RED,
  },
];

const LABEL_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const LABEL_FONT_WEIGHT = 800;

/** Renders `text` off-screen at the given size and returns its tight glyph bbox. */
async function measureText(page, text, fontSize) {
  return page.evaluate(
    ({ text, fontSize, fontFamily, fontWeight, letterSpacing }) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.setAttribute('font-family', fontFamily);
      el.setAttribute('font-weight', String(fontWeight));
      el.setAttribute('font-size', String(fontSize));
      el.setAttribute('letter-spacing', String(letterSpacing));
      el.textContent = text;
      svg.appendChild(el);
      document.body.appendChild(svg);
      const b = el.getBBox();
      svg.remove();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    },
    { text, fontSize, fontFamily: LABEL_FONT_FAMILY, fontWeight: LABEL_FONT_WEIGHT, letterSpacing: round(fontSize * 0.02) }
  );
}

/**
 * "SOLD OUT" as plain SVG <text>, stacked two lines (it does not fit legibly
 * on one line at schedule-row size), centered horizontally in the gap between
 * LEFT_NOTCH_RIGHT_EDGE and PERFORATION_X — the ticket's actual open face —
 * and vertically centered on the ticket as a whole. Sized from `box.h`, then
 * measured with a real render and shrunk only if the wider line ("SOLD")
 * would not fit that gap, so the two lines share one font size and true glyph
 * bounds (not font-metric guesses) drive every offset.
 *
 * font-family is the app's own system-ui stack (CLAUDE.md: no CDN fonts), and
 * <text> inside a <symbol> resolves it against the referencing document, not
 * this generator's headless page — same as any other inherited SVG property
 * reached through <use>.
 */
async function labelMarkup(page, lines, box, color) {
  const centerX = (LEFT_NOTCH_RIGHT_EDGE + PERFORATION_X) / 2;
  const maxWidth = (PERFORATION_X - LEFT_NOTCH_RIGHT_EDGE) * 0.9;

  let fontSize = box.h * 0.34;
  const measurements = await Promise.all(lines.map((line) => measureText(page, line, fontSize)));
  const widest = Math.max(...measurements.map((m) => m.width));
  if (widest > maxWidth) fontSize *= maxWidth / widest;

  const lineGap = fontSize * 1.05;
  const blockHeight = lineGap * (lines.length - 1);
  const firstCenterY = box.y + box.h / 2 - blockHeight / 2;

  const parts = [];
  for (let i = 0; i < lines.length; i++) {
    const lineCenterY = firstCenterY + i * lineGap;
    // Re-measure at the final size: getBBox's y/height describe the glyphs'
    // extent relative to the baseline (y=0), which is what lets the block —
    // not the baseline — land exactly on lineCenterY regardless of font.
    const m = await measureText(page, lines[i], fontSize);
    const baselineY = lineCenterY - m.y - m.height / 2;
    parts.push(
      `<text x="${round(centerX)}" y="${round(baselineY)}" text-anchor="middle" ` +
        `font-family="${LABEL_FONT_FAMILY}" font-weight="${LABEL_FONT_WEIGHT}" ` +
        `font-size="${round(fontSize)}" letter-spacing="${round(fontSize * 0.02)}" fill="${color}">${lines[i]}</text>`
    );
  }
  return parts.join('');
}

/** `stroke`/`stroke-width`/`stroke-dasharray` as a markup fragment, or ''. */
function outlineAttrs(outline) {
  if (!outline) return '';
  const attrs = [`stroke="${outline.color}"`, `stroke-width="${outline.width}"`];
  if (outline.dasharray) attrs.push(`stroke-dasharray="${outline.dasharray}"`, 'stroke-linecap="butt"');
  return ' ' + attrs.join(' ');
}

/**
 * PAID_TICKET.svg's outline is one compound path: the ticket's own silhouette
 * (the outer boundary, including the notch bump on the left edge and the
 * stub's rounded corner on the right), followed by five small circles that
 * punch the tear-line perforation near the right edge. They are two visually
 * different things sharing one `d` — the silhouette wants an outline stroke,
 * the holes want a plain contrasting fill and no stroke of their own (a
 * stroke there rings every tiny hole, and on a dashed stroke each hole's own
 * path length does not divide evenly into the dash pattern, which is what
 * produced the "squiggly mess" round 3 shipped). Splitting them is what lets
 * each get its own treatment.
 *
 * The split point is the first `Z`: every source file here draws the outer
 * boundary first and closes it before starting the next subpath, so slicing
 * there is exact rather than a heuristic.
 */
function splitTicketPath(d) {
  const firstZ = d.indexOf('Z');
  return { boundary: d.slice(0, firstZ + 1).trim(), holes: d.slice(firstZ + 1).trim() };
}

function pathTag(d, fill, extraAttrs = '') {
  return `<path d="${d}" fill="${fill}" fill-opacity="1" fill-rule="nonzero"${extraAttrs}/>`;
}

const START = '<!-- BEGIN generated ticket sprite (tools/make-ticket-icons.mjs) -->';
const END = '<!-- END generated ticket sprite -->';

const browser = await chromium.launch();
const page = await browser.newPage();
const symbols = [];

for (const { file, id, color, outline, holeColor, glyph, label, labelColor } of SOURCES) {
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
  let recolored;
  if (glyph) {
    recolored = inner.replaceAll('fill="#000000"', `fill="${color}"`);
  } else {
    // The glyph-less variant keeps only the ticket-body outline — the first
    // top-level element in both source files — and none of the <defs> the
    // glyph's clipPath needs, since nothing here references it. Split into
    // silhouette + holes (see splitTicketPath) so the outline stroke lands on
    // the silhouette only.
    const sourceTag = (inner.match(/<path fill="#000000"[^>]*\/>/) ?? [])[0];
    if (!sourceTag) throw new Error(`${file}: expected a ticket-outline path to reuse for ${id}`);
    const d = (sourceTag.match(/d="([^"]+)"/) ?? [])[1];
    if (!d) throw new Error(`${file}: expected a d attribute on the ticket-outline path for ${id}`);
    const { boundary, holes } = splitTicketPath(d);
    recolored =
      pathTag(boundary, color, outlineAttrs(outline)) + (holes && holeColor ? pathTag(holes, holeColor) : '');
  }
  const text = label ? await labelMarkup(page, label, box, labelColor) : '';

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
