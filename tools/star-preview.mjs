#!/usr/bin/env node
// tools/star-preview.mjs — dev-only. Renders the event row's star control in
// several treatments side by side so the choice can be made by looking rather
// than by describing. Uses the real site/css/app.css so the comparison is
// honest; writes .screenshots/star-options.png.
//
// Not part of the site or the build. Delete once the star design is settled.
//
// Usage: node tools/star-preview.mjs

import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '.screenshots');
const css = await readFile(join(ROOT, 'site/css/app.css'), 'utf8');

const VARIANTS = [
  {
    id: 'a',
    name: 'A — Current (boxed)',
    note: 'Today’s control. The box reads as a second card competing with the row.',
    css: '',
  },
  {
    id: 'b',
    name: 'B — Borderless, larger',
    note: 'Box removed, glyph up from 1.2rem to 1.75rem. Tap target still 48px. Colour alone carries on/off.',
    css: `
      .v-b .event-row__star-btn { border: none; background: none; width: 48px; font-size: 1.75rem; color: #9aa6ad; }
      .v-b .event-row__star-btn[aria-pressed="true"] { background: none; color: var(--color-accent); }
    `,
  },
  {
    id: 'c',
    name: 'C — Borderless + hairline divider',
    note: 'As B, plus a single rule separating the star from the row’s tap area — the boundary without the box.',
    css: `
      .v-c .event-row__star-btn { border: none; border-left: 1px solid var(--color-border); border-radius: 0;
        background: none; width: 52px; font-size: 1.75rem; color: #9aa6ad; margin-left: 0; align-self: stretch; }
      .v-c .event-row__star-btn[aria-pressed="true"] { background: none; color: var(--color-accent); }
      .v-c .event-row { gap: 0; }
      .v-c .event-row__link { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    `,
  },
  {
    id: 'd',
    name: 'D — Borderless, tinted disc when starred',
    note: 'No container when off; a soft disc appears behind the star when on, so “saved” has weight.',
    css: `
      .v-d .event-row__star-btn { border: none; background: none; width: 48px; font-size: 1.75rem; color: #9aa6ad; }
      .v-d .event-row__star-btn[aria-pressed="true"] { color: var(--color-accent-dark);
        background: radial-gradient(circle at 50% 50%, var(--badge-art-bg) 58%, transparent 60%); }
    `,
  },
];

function row(variantId, starred, title, venue) {
  const glyph = starred ? '★' : '☆';
  return `
    <div class="event-row" data-testid="event-row">
      <a class="event-row__link" href="#">
        <span class="event-row__top">
          <span class="event-row__time">5:00 PM&ndash;5:45 PM</span>
          <span class="event-row__meta"><span class="badge badge--music">music</span></span>
        </span>
        <span class="event-row__main">
          <span class="event-row__title">${title}</span>
          <span class="event-row__venue">${venue}</span>
        </span>
      </a>
      <button type="button" class="event-row__star-btn" aria-pressed="${starred}" aria-label="Star">
        <span class="event-row__star-glyph" aria-hidden="true">${glyph}</span>
      </button>
    </div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${css}
${VARIANTS.map((v) => v.css).join('\n')}
body { display: block; min-height: 0; padding: 16px; background: var(--color-bg); }
.variant { margin-bottom: 22px; }
.variant h2 { font-size: 0.95rem; color: var(--color-primary-dark); margin: 0 0 2px; }
.variant p { font-size: 0.75rem; color: var(--color-text-muted); margin: 0 0 8px; }
.event-list { display: flex; flex-direction: column; gap: 0.5rem; }
</style></head><body>
${VARIANTS.map(
  (v) => `
  <div class="variant v-${v.id}">
    <h2>${v.name}</h2>
    <p>${v.note}</p>
    <div class="event-list">
      ${row(v.id, true, 'The Midway Strays', 'Midway Saloon')}
      ${row(v.id, false, 'Somali Jazz Fusion', 'Hamline Park')}
    </div>
  </div>`
).join('')}
</body></html>`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 900 } });
await page.setContent(html);
await page.screenshot({ path: join(OUT, 'star-options.png'), fullPage: true });
await browser.close();
console.log('.screenshots/star-options.png');
