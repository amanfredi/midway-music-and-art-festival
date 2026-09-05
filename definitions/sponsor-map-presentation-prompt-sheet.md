# Dispatch: sponsor sheet swaps directions for a website link

Target: Sonnet, high effort, autonomous, in its own git worktree branched from `main` at or after `e1ca33e`.

## Context

The Midway Music & Arts Fest map/schedule PWA at `/Users/amanfredi/midway-music-and-art-festival` (offline-capable static site, zero runtime dependencies, deployed from `main` by CI) opens a bottom sheet when an attendee taps a sponsor's map pin. Today that sheet offers "Open in Google Maps" directions. The decision, recorded in `definitions/sponsor-map-presentation.md` under "Sponsor sheet", is that a sponsor's sheet should send people to the sponsor's website instead. Read that section and `CLAUDE.md` first. A sibling agent is restyling sponsor pins and the key list in `site/js/views/map.js` and `scripts/build.mjs` on another branch; stay out of those files.

Setup: run `npm install` in the worktree first (fresh worktrees have no `node_modules`; without it the MapLibre vendoring test fails with ENOENT). If Playwright reports missing browsers, run `npx playwright install chromium`.

## The task

1. In `site/js/views/sheet.js`, `openSponsorSheet`: remove the Google Maps button. Render a button labeled `Sponsor website` from `safeHref(sponsor.url)` with `target="_blank"`, `rel="noopener"` and `NEW_TAB_HINT`, the exact pattern the venue sheet uses for "Visit venue website" a few lines above, so the two sheets stay consistent and the new-tab hint keeps the link named for screen readers. When the sponsor has no `url`, render no link at all; the sheet is the name and blurb. Replace the early return on a missing maps href with a return on a missing location, so the sheet still opens only for sponsors that have a pin. Leave `mapsDirectionsHref` and the venue and transit sheets as they are.
2. In `CONTRACTS.md`, the line "Venue/sponsor detail includes an 'Open in Google Maps' link" becomes venue and transit only, and the sponsor sheet's website link is stated beside it with the no-url behavior.
3. Tests. No fixture sponsor carries a `url` today. In `content/fixtures/sponsors.csv` (hand-committed; feeds only the offline tests), give `shortline-credit-union` an `https://` url and leave `daily-trim-barbershop` without one; both have locations. Add assertions that the sponsor sheet for the first shows exactly one website link and zero `google.com/maps` links, and that the second shows no link. The existing maps-link assertions (`tests/a11y.spec.mjs` transit sheet, `tests/map-degrade.spec.mjs` venue sheet) must keep passing untouched. `tests/a11y.spec.mjs` already opens the sponsor sheet through `openSponsorSheet('shortline-credit-union')` and checks that new-tab links are named; extend from there.
4. Do not edit `PROGRESS.md` or `BACKLOG.md`; put the journal entry text in your report, because the merger applies it centrally to avoid conflicts with the sibling branch.

Commit on your branch with a plain descriptive message (no ticket IDs). Do not push or merge.

## Verification before claiming done

`npm test` passes in full; paste the summary lines, and any failure verbatim with whether it predates your change. Nothing in the report may describe a result you did not observe.

## Report

If you were spawned as a subagent, deliver the report with the SendMessage tool; otherwise print it. Include: branch name and commit; the test summary; the PROGRESS.md entry text; anything you deviated from and why.
