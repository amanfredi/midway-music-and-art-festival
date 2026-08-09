# Screenshot baseline — August 2026 code review

Captured 2026-08-09 at commit `4dce690`, before any refactoring from the
code-and-test review (definitions/code-and-test-review.md). Purpose: a visual
reference so changes landed after this date are identifiable by diffing
screenshots.

## State at capture

Screenshots were taken against a fresh `npm run build` (build outputs are
gitignored, so the commit hash alone does not pin them):

- `site/data/content.json` — version `d32b9e94e182`, 14 venues / 60 events /
  15 vendors / 11 sponsors,
  sha256 `6e3f8de2145bee615f04511c6b770ef26f81fafa67d86550e7ec64a5fe210429`
- `site/sw.js` — version `ea2244cf7eec`,
  sha256 `8283f384a0c3ae621bad20a5c24e1c13cfcbcf64b21d855330fb0c5b29309749`

Venues come from the live Google Sheet, so a later `npm run build` may produce
different content (and therefore different screenshots) as the sheet evolves.
Beware: running `npm test` leaves `site/data/content.json` rebuilt from the
committed fixtures (9 venues), not the live sheet — run `npm run build` before
capturing screenshots meant to match the deployed site.

All shots use the demo clock `?t=2026-10-03T15:00` (festival Saturday, 3 PM).
Viewports: phone 393×852 (touch), desktop 1440×900, narrow 320×700 (touch).

## Reproduction commands

Prerequisites: `npm install` and `npx playwright install chromium`, plus build
outputs present in `site/` (run `npm run build` if starting clean — but see
the live-sheet caveat above).

All six routes plus the event-detail route, three viewports, two events
starred so `#/starred` has content (files `{route}-{viewport}.png`):

```sh
node tools/shoot.mjs \
  --routes '#/now,#/schedule,#/map,#/starred,#/vendors,#/sponsors,#/event/blue-note-st-paul' \
  --viewports phone,desktop,narrow \
  --stars 'blue-note-st-paul,somali-stars' \
  --out .screenshots/baseline-base
```

Map zoom states (files `map-zoom-{in,out}-x3-{viewport}.png` — rename from
the run's `map-{viewport}.png`):

```sh
node tools/shoot.mjs --routes '#/map' --viewports phone,desktop,narrow \
  --click '#zoom-in x3' --out .screenshots/baseline-map-zoom-in
node tools/shoot.mjs --routes '#/map' --viewports phone,desktop,narrow \
  --click '#zoom-out x3' --out .screenshots/baseline-map-zoom-out
```

Two states `tools/shoot.mjs` cannot reach, captured by the helper scripts
committed alongside this file (run from the repo root):

```sh
node reviews/2026-08-baseline/shoot-install-state.mjs
node reviews/2026-08-baseline/shoot-map-sheet-state.mjs
```

- `now-install-button-{phone,desktop}.png`, `install-sheet-{phone,desktop}.png`
  — the install button and its instruction sheet. Stock headless Chromium
  neither fires `beforeinstallprompt` nor defines `navigator.standalone`, so
  `pwa-install.js` renders no button at all; the script fakes
  `navigator.standalone = false` to put the app on its Safari path (iOS
  flavor on the touch context, macOS on desktop).
- `map-sheet-open-{phone,desktop,narrow}.png` — venue detail sheet open over
  the map. `shoot.mjs --click` on `[data-testid="venue-pin"]` times out
  silently (Playwright can't complete a pointer click on the SVG pin `<g>`;
  the app dispatches pin taps from the svg root via `elementFromPoint`), so
  the script activates the first venue pin with Enter, the same path
  `tests/a11y.spec.mjs` uses.

## Known capture limitations

- The Chromium-native install prompt (`beforeinstallprompt` flow) is not
  represented — only the Safari-path instruction sheets. Capturing the
  Chromium flow headlessly is not supported by Playwright.
- `shoot.mjs` swallows `--click` failures (`.catch(() => {})`), so a state
  shot can silently capture the wrong state; both zoom runs were verified by
  eye against the home view before committing.
