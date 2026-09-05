# Dispatch: sponsor pin restyle, marks, and key-list sections

Target: Opus, high effort, autonomous, in its own git worktree branched from `main` at or after `e1ca33e`.

## Context

You are implementing a defined change to the Midway Music & Arts Fest map/schedule PWA at `/Users/amanfredi/midway-music-and-art-festival` (an offline-capable, zero-dependency static site deployed from `main` by CI). Sponsors who bought the "Featured Destination" tier currently get a pin indistinguishable in size from a lower-tier sponsor and no presence in the key list under the map. The organizers now have real sponsors with logos, so the map is getting its sponsor presentation pass.

The binding specification is `definitions/sponsor-map-presentation.md`. Read it in full first, then `CLAUDE.md`, and these parts of `CONTRACTS.md`: the `sponsors.csv` section, the content.json shape, and in the Map contract the pin table and size paragraph, the legend, the key list, `#map-pin-alt`, sponsor pin rules, and the test hooks list. The definition's `map.js` line numbers predate a large merge; navigate by symbol name (`FEATURED_SPONSOR_TIERS`, `VENUE_R`, `SMALL_R`, `diamondImage`, `pin-sponsor-featured`, `sponsor-highlight`, `NO_LANE`, `sponsor-name-label`, `#venue-key-list`, `#map-pin-alt`).

A sibling agent is changing the sponsor detail sheet in `site/js/views/sheet.js` on another branch. Do not touch that file or the sheet contract line; your key-list cards call the existing `openSponsorSheet` and nothing more.

Setup: run `npm install` in the worktree first (fresh worktrees have no `node_modules`; without it the MapLibre vendoring test fails with ENOENT). If Playwright reports missing browsers, run `npx playwright install chromium`.

## The task

Deliver all of the following on your branch, committed with plain descriptive messages (no ticket IDs; do not push, do not merge).

**1. Build: mark files.** In `scripts/build.mjs`, add a second per-sponsor file beside the logo: `content/logos/<id>-pin.<ext>`, `<ext>` in `svg` or `png` only. Rules, each with the reason it exists:
- Required exactly when the sponsor's tier is emerald, ruby or sapphire and its `location` resolves. Missing is a build error naming the path looked for, in the same shape as the missing-logo error, because a featured pin with no mark would silently degrade a paying sponsor's presence.
- Two `-pin` files differing only by extension is an error, as for logos, because choosing would be a guess.
- Over 64 KB is an error: the file is precached onto every phone.
- Apply the same script-rejection rule as logos to SVG marks (rejected, never sanitized).
- An SVG mark whose root lacks explicit `width` and `height` attributes is an error, because Safari draws nothing into a canvas from such an SVG and the pin would be blank only on iPhones.
- Read dimensions without a library: PNG width and height from the IHDR chunk, SVG from the root's `viewBox` or width/height. Report, without failing: a raster mark under 128 px on its longer side (it will blur at 3× device pixel ratio), an aspect ratio beyond 2:1 either way (a very wide mark is back to wordmark legibility inside a square), and a `-pin` file present for a sponsor that will not draw a featured pin (it will matter the day the sheet changes).
- Copy the file to `site/assets/sponsors/<id>-pin.<ext>` and add `"mark": "<that path>"` to the sponsor's content.json record, `null` when there is none, following the `logo` field's conventions. Copying is the only transformation: no resizing, no re-encoding, so unchanged sources keep producing a byte-identical `content.json`.

**2. Fixtures and validation tests.** The fixture build reads `content/fixtures/sponsors.csv` against the shared `content/logos/` directory. Three fixture sponsors are featured-tier with a location (`shortline-credit-union`, `twin-cities-harvest-coop`, `midway-spur-brewing`); give each a small square `-pin.svg` in the style of the existing fixture logos, with explicit width and height. Add broken cases to `tests/fixture-sets.mjs` and `tests/validation.test.mjs` for: missing mark (promote a pinned topaz fixture such as `daily-trim-barbershop` to sapphire with `setCell`), duplicate extension, over-cap size, scripted SVG, SVG without width/height, and the three report-only conditions. The three live sapphire marks (`oldnationalbank-pin.png`, `platform-pin.png`, `wellingtonmanagement-pin.png`) are already committed in `content/logos/`; run `npm run build` once to confirm the live sheet passes under the new rule, and if the network is unavailable say so in the report rather than inferring the result.

**3. Map pins** in `site/js/views/map.js`:
- Generic (topaz) pin: solid `colors.sponsor` diamond at `SMALL_R`, replacing the outlined one.
- Featured pin: an axis-aligned square with side `FEATURED_SIDE = Math.round(VENUE_R * Math.SQRT2)` (27 px), named as a constant with a comment saying it is the venue diamond unrotated, so it has the venue pin's ink and stays one constant to change. 2 px `colors.sponsor` outline, paper fill, the sponsor's mark drawn contain-fit and centered inside with a 1 px inset. One canvas image per featured sponsor, registered at device pixel ratio like the other pins, after that mark's `Image` loads from its precached path. The featured layer's `icon-image` selects the image by sponsor id. The rest of the map must render without waiting on marks; a mark that fails to load draws the outlined square with nothing inside and logs a console warning, so one bad asset never empties the layer.
- Size the `sponsor-highlight` halo for the square. Re-measure the featured name-label radial offset against the square's collision box (image rect plus the engine's 2 px padding), because a label offset measured to a diamond's tip lands inside a square of the same ink.
- Re-derive the sponsor clearance check (currently `clear: 2 * SMALL_R`) for square-vs-diamond and square-vs-square: two diamonds clear at |dx| + |dy| ≥ 2R, two axis-aligned squares at max(|dx|, |dy|) ≥ side, and the mixed case needs its own inequality. Write the derivation in the code comment. Sponsors keep `NO_LANE`; paint order and tap resolution stay transit, featured, sponsor, venue.

**4. Legend.** Featured swatch becomes a red-outlined square whose ink matches the venue swatch's diamond, with no mark; generic swatch becomes a solid small red diamond. Order unchanged. The legend rule in CONTRACTS.md (a legend symbol at another size reads as a different symbol) is why sizes must match the drawn pins.

**5. Key list.** The list under the map becomes three sections with visible headings, in this order: Featured Destinations, Venues, Sponsors. Only sponsors that draw a pin appear; an empty section renders nothing, heading included. Featured cards show the mark thumbnail (contain-fit) and the name; sponsor cards show the small red diamond and the name; venue cards and their numbering are unchanged. Tapping a sponsor card runs the same path as tapping its pin and the venue cards: highlight, recenter with `easeTo` (a jump under `prefers-reduced-motion`), open the sponsor sheet. Keep `#venue-key-list` and `.venue-key-btn[data-venue-id]` working as today; add `.sponsor-key-btn[data-sponsor-id]` with `data-featured="true"|"false"`. Remove sponsors from `#map-pin-alt`, which now holds transit stops only, because a sponsor with a visible button and a hidden one is two stops for a screen reader; update any label text that names sponsors.

**6. Contract, README, and tests.** Update CONTRACTS.md in the sections named above, including the pin table, the size paragraph (venue and featured pins now share the largest size; the venue diamond is the featured square rotated), the content.json shape, the key list, `#map-pin-alt`, and the test hooks. In README.md, add the mark procedure to "Content updates" (file naming, formats, the 64 KB cap, 256 px target and 128 px floor, tight crop on a transparent background, the hard error) and update the `content/logos/` row of "Repository map". Update every test that asserts sponsor pin shapes, legend markup, `#map-pin-alt` contents, or sponsor a11y paths, and add tests for the key-list sections (order, hooks, tap behavior) and the legend. Do not edit `PROGRESS.md` or `BACKLOG.md`: put the journal entry and the narrowed backlog text in your report, because the merger applies those centrally to avoid conflicts with the sibling branch.

**7. Screenshots.** Run `node tools/shoot.mjs --routes '#/map' --viewports phone` (and once more with `--scroll` to capture the key list) after the fixture build, copy the two most useful PNGs to `reviews/2026-09-sponsor-presentation/`, commit them, and look at them yourself.

## Verification before claiming done

- `npm test` passes in full. Paste the summary lines; if anything fails, paste the failure output verbatim and say whether it predates your change.
- Determinism: run `npm run build:fixtures` twice and confirm `site/data/content.json` and `site/sw.js` are byte-identical between runs.
- `npm run build` against the live sheet succeeds with the three live marks (or report that the network was unavailable).
- Audit your own claims against tool output: nothing in the report may describe a result you did not observe.

## Boundaries

Do not change the tier-to-pin mapping, the Support view, `site/js/views/sheet.js`, the two Squarespace embed scripts, or the sheet schema. Add no npm dependency and no build-time image processing. If the 27 px square collides with a venue pin at the home view with fixture or live data, do not resize it; report the pair and the measured distance, because the size was a deliberate decision and the live data was measured clear. Deviate from the definition only where following it would break something; name each deviation and its reason.

## Report

If you were spawned as a subagent, deliver the report with the SendMessage tool; otherwise print it. Include: branch name and commit list; the test summary and any failures verbatim; the determinism result; the live build result; the screenshot paths and your own read of whether each of the three marks is distinguishable at pin size, Wellington Management's especially; the PROGRESS.md entry text and the replacement BACKLOG.md text; the CONTRACTS.md sections changed; deviations and open questions.
