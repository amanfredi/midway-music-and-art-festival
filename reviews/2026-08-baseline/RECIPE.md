# Screenshot baseline — August 2026 code review

Originally captured 2026-08-09 at commit `4dce690`, before any refactoring
from the code-and-test review; **recaptured 2026-08-09 after the review's
follow-up fixes landed** (see PROGRESS.md), so this baseline reflects the
post-fix app. Only six shots changed in the recapture: the venue detail sheet
gained a website link (`map-sheet-open-*`), the install sheet's dialog-backdrop
compositing moved sub-perceptually (`install-sheet-*`), and `map-phone` carries
a pre-existing 6 px environment diff. The pre-fix images are in git history at
commit `5ff3399`.

## State at capture

Screenshots were taken against a fresh `npm run build` (build outputs are
gitignored, so the commit hash alone does not pin them):

- `site/data/content.json` — version `d32b9e94e182`, 14 venues / 60 events /
  15 vendors / 11 sponsors,
  sha256 `9f220a62ad53ca977f0d6006ee4b3e5029af0689a44f0e4230cb091c3a2bc19c`
- `site/sw.js` — version `4ecf10850a43`,
  sha256 `62e1fb1c85a7bc0b1ecc0af72452a431c672b0f23d4822cb9409556c9b70af64`

Venues come from the live Google Sheet, so a later `npm run build` may produce
different content (and therefore different screenshots) as the sheet evolves.
Beware: running `npm test` leaves `site/` rebuilt from the committed fixtures,
not the live sheet — run `npm run build` before capturing screenshots meant to
match the deployed site.

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
