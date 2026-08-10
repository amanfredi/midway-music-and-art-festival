# Screenshot baseline — August 2026 code review

Originally captured 2026-08-09 at commit `4dce690`, before any refactoring
from the code-and-test review; recaptured 2026-08-09 after the review's
follow-up fixes landed (six shots changed — venue sheet website link,
sub-perceptual install-sheet backdrop compositing, a pre-existing 6 px
`map-phone` environment diff; pre-fix images at commit `5ff3399`).
**Recaptured again 2026-08-10 after the WCAG 2.2 AA audit fixes landed**
(see `reviews/2026-08-wcag-aa-audit.md`), so this baseline reflects the
post-audit app. Fifteen shots changed, all attributable to the fixes since
the live-sheet content was byte-identical between captures: all nine `map*`
shots (legend gained METRO Green/Blue Line entries; the unreadable baked-in
attribution text was dropped) and `schedule-*`/`starred-*` at every viewport
(darkened saved-row star, event times allowed to wrap). Pre-WCAG-fix images
are in git history at commit `553fe3d`.

## State at capture

Screenshots were taken against a fresh `npm run build` (build outputs are
gitignored, so the commit hash alone does not pin them):

- `site/data/content.json` — version `d32b9e94e182`, 14 venues / 60 events /
  15 vendors / 11 sponsors,
  sha256 `9f220a62ad53ca977f0d6006ee4b3e5029af0689a44f0e4230cb091c3a2bc19c`
  (unchanged from the 2026-08-09 capture — the sheet did not move between
  captures, so every 2026-08-10 shot diff comes from the fixes)
- `site/sw.js` — version `7da58efd1624`,
  sha256 `3dc80f0e5307cf4d5215afab587dc9091faa68581eacb0677b9bcf4231cef8b4`

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
