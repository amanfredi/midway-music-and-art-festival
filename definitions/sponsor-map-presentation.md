# Sponsor map presentation: featured squares with marks, key-list sections

Status: defined 2026-09-04, updated 2026-09-05 | Overall confidence: high

Restyle the two sponsor pin types on the map view and give sponsors a place in
the key list below the map. Featured Destinations (emerald, ruby, sapphire)
become a red-outlined square the size of the venue diamond, carrying a
hand-made square brand mark. Generic Sponsors (topaz) become a solid red
diamond at the small size. The key list gains a Featured Destinations section
above the venues and a Sponsors section below them. Separately, the sponsor
detail sheet swaps its Open in Google Maps button for a Sponsor website link. This is the "sponsor
presentation, pending real sponsors" backlog item, now that real logos exist.

## Problem & motivation

The tier-to-pin mapping already exists and is unchanged: emerald/ruby/sapphire
render as Featured Destination, topaz as generic Sponsor, quartz never
(CONTRACTS.md, Map contract, "Sponsor pins exist only for tiers
emerald–topaz"). What the live map fails to deliver is presence for the
sponsors who bought the featured tier:

- A featured pin is the same small diamond as a topaz pin (`SMALL_R` 11, 22 px
  on screen), differing only in fill versus outline. Nothing about it says
  which sponsor it is until the leader zoom, where names appear.
- No sponsor appears in the key list under the map. The key list is the only
  place a name shows at the home view, and it is the part of the map view the
  Squarespace map embed (`definitions/squarespace-map-embed.md`) will surface
  at desktop widths.
- The current fill convention is inverted relative to weight: featured is
  solid, generic is outlined, and neither reads as more important.

Live data as of the 2026-09-04 build: three sapphire sponsors (Platform, Old
National Bank, Wellington Management) and three topaz (Cadenza Music, Ideal
Printers, Bewick Cafe), all six with a location, so all six have pins today
and the restyle is immediately visible.

## Success criteria

- On the map, a featured sponsor renders as a 27 px red-outlined square (axis
  aligned) with its mark inside; a topaz sponsor renders as a solid red diamond
  at the existing small size. Legend swatches match the drawn pins in shape
  and size (existing a11y rule: a legend symbol at another size reads as a
  different symbol).
- The key list below the map shows, in order: Featured Destinations, Venues,
  Sponsors. Venue numbering is unchanged. Tapping a featured or sponsor card
  behaves exactly like tapping a venue card: highlight the pin, recenter with
  `easeTo` (jump under `prefers-reduced-motion`), open the sheet.
- The sponsor sheet opened from a pin (or its key-list card) has no Open in
  Google Maps button. It has a "Sponsor website" button when the sponsor has a
  `url`, and no link row at all when it does not.
- A featured-tier sponsor with a location and no mark file fails the build
  with an error naming the path looked for, same shape as the missing-logo
  error.
- Unchanged sources still produce byte-identical `content.json`; the mark
  bundling is a file copy, not image processing.
- `npm test` green, including the existing sponsor pin, legend, name-label,
  a11y and offline suites updated for the new shapes and list sections. The
  iPhone airplane-mode pass in README passes, since the precache list changes.
- Failure would be recognized as: a mark that is a smudge at pin size on a
  real phone; a featured square colliding with a venue at the home view; a
  deploy blocked by a missing mark for a sponsor the organizers added.

## Non-goals

- No build-time image derivation. Marks are hand-made committed files. No
  image library enters the build (the build has zero npm dependencies and must
  deploy with NPM down).
- No change to the sheet schema or `sponsors.csv` columns. The mark, like the
  logo, is a file keyed by sponsor id, not a cell.
- No change to the tier-to-pin mapping, the Support view (`#/sponsors`), the
  venue and transit sheets, or the two Squarespace embed scripts
  (`site/js/*-embed.js`). The sponsor sheet changes only as described below.
- No emerald-specific "special treatment" or ruby-specific format. Emerald and
  ruby get the identical featured treatment; anything beyond that stays on the
  backlog until such a sponsor exists.
- No sponsor pin lanes or leader treatment. Sponsors keep `NO_LANE`; only the
  clearance check against venues changes to the new shape.
- No listing of sponsors without a location. The key list is a map key and
  mirrors the drawn pins.

## Constraints

- **Sequencing.** The map-collisions / label work (`definitions/squarespace-map-embed.md`,
  `reviews/2026-09-map-collisions/`) rewrote the same pin and label code; it
  landed on `main` by 2026-09-05 (`e1ca33e`). Branch from there. Worktree
  agents need `npm install`.
- **Marks first.** All three sapphire marks must be committed in the same
  change as the hard-error rule, or the next live build fails.
- **Offline.** Marks are precached like logos; `scripts/build-sw.mjs` walks
  the whole `site/` tree, so a file under `site/assets/sponsors/` is picked up
  without further wiring. Any change here still needs the manual iPhone pass.
- **Determinism.** Copying a file is deterministic; nothing else is allowed to
  vary between builds of unchanged sources.
- **Collision geometry.** The contract's clearance math is diamond-specific
  (two diamonds clear at |dx| + |dy| >= 2R). A 27 px axis-aligned square has
  the same area as the venue diamond but a different clearance rule
  (max(|dx|, |dy|) >= 27 against another square; mixed cases need their own
  inequality). Re-derive the featured-vs-venue and featured-vs-small clearance
  used by the sponsor clearance check in `map.js` (`clear: 2 * SMALL_R` today)
  and by the name-label offsets, which are measured to the pin's collision box.
  With live data every featured pin is >= 443 m from any other pin and the
  nearest topaz pair is 278 m, so nothing collides today; the contract's
  "re-measure if the sheet changes" caveat extends to sponsors.
- **Canvas pins.** Pins are canvas images registered with `map.addImage`,
  built synchronously today. A featured pin now embeds a per-sponsor raster
  or SVG, so image loading becomes asynchronous and one image is registered
  per featured sponsor (`icon-image` becomes data-driven for that layer).
  SVG drawn into a canvas on Safari needs explicit `width`/`height`
  attributes on the root element; the mark validator should require them for
  SVG marks, or the build should reject SVGs without them.
- **Pin size on screen.** 27 px side, `VENUE_R * sqrt(2)` rounded, unrotated.
  The mark gets roughly 22 CSS px after a 2 px red outline and a 1 px paper
  inset. Registered at device pixel ratio like the other pins.

## Approach sketch

**Content.** A featured sponsor supplies two files in `content/logos/`:
the existing `<id>.<ext>` logo and a new `<id>-pin.<ext>` mark, `<ext>` in
`svg | png` only (dimensions are checkable from an SVG viewBox or a PNG IHDR
header with no library; JPEG has no alpha channel and WebP would need real
parsing for no gain). The mark may be any aspect ratio: the pin and the card
render it contain-fit and centered, so a wide mark simply uses less of the
square. The build reports (does not fail on) an aspect beyond 2:1, since a
very wide mark is back to wordmark legibility. At most 64 KB, and subject to
the same script-rejection rule as logos. Raster marks should be at least 128 px on a side and 256 px is the
recommended target: the pin draws the mark at ~22 CSS px, which is 66 device
px on a 3x iPhone, and the key-list card thumbnail is larger. The build
reports (does not fail on) a raster mark under 128 px. Crop tight to the
sub-mark's bounding box with a transparent background so the pin controls
the inset uniformly; keep a colored background only when it is part of the
mark. SVG marks need explicit `width`/`height` attributes on the root
(Safari draws nothing into a canvas without them); the aspect rule above
applies to SVG too. Required when the sponsor is featured-tier and has a location; missing
is a build error naming the path; two marks differing only by extension is an
error like logos. A mark for a topaz or quartz sponsor, or for a featured
sponsor without a location, is ignored with a report line (it will matter the
day the sheet changes). Bundled to `site/assets/sponsors/<id>-pin.<ext>`.

**Content JSON.** Each sponsor gains `"mark": "assets/sponsors/…-pin.png"`
or `null`, following the `logo` field's conventions. `tests/fixtures-good`
gains marks for its featured fixtures and `tests/fixture-sets.mjs` gains the
broken cases (missing mark, duplicate extension, scripted SVG mark, over-cap
mark). The three live sapphire marks are committed alongside.

**Map pins.** In `map.js`: `pin-sponsor-generic` becomes
`diamondImage(SMALL_R, { fill: colors.sponsor })`; `pin-sponsor-featured` is
replaced by one `squareMarkImage(side, markImage, { stroke: colors.sponsor })`
per featured sponsor (mark drawn contain-fit, centered, inside the outline), registered after the mark images load (offline-safe
because they are precached). The featured layer's `icon-image` selects by
sponsor id. Highlight halo (`sponsor-highlight`, `haloPaint`) sized for the
square. Name-label radial offset for featured pins re-measured to the square's
collision box. Paint order and tap resolution unchanged: transit, featured,
sponsor, venue.

**Legend.** Featured swatch becomes a red-outlined square at the venue
swatch's ink size, no mark; generic swatch becomes a solid small red diamond.
Order unchanged: venue, featured destination, sponsor, then transit.

**Key list.** `#venue-key-list` becomes three headed sections or three sibling
lists under one container: Featured Destinations (mark thumbnail + name),
Venues (unchanged numbered cards), Sponsors (small red diamond + name). Only
sponsors with a pin appear. Section headings are visible text so the list
reads correctly to screen readers. Sponsors leave `#map-pin-alt`, which now
holds transit only, since they have visible buttons. New test hooks alongside
`.venue-key-btn[data-venue-id]`, e.g. `.sponsor-key-btn[data-sponsor-id]`
with a `data-featured` attribute, to be named in CONTRACTS.md.

**Sponsor sheet.** `openSponsorSheet` (`site/js/views/sheet.js:239`) drops the
Open in Google Maps button and renders `Sponsor website` from
`safeHref(sponsor.url)` with `target="_blank"`, `rel="noopener"` and
`NEW_TAB_HINT`, the exact pattern of the venue sheet's website link
(`sheet.js:119`). No `url`: no button; the sheet is name and blurb. The early
return on a missing maps href becomes a return on a missing location, so the
sheet still opens only for pinned sponsors. `mapsDirectionsHref` stays for
venues and transit. Contract line "Venue/sponsor detail includes an Open in
Google Maps link" (CONTRACTS.md ~923) becomes venue and transit only. Tests:
the existing maps-link assertions cover the transit sheet
(`tests/a11y.spec.mjs:84`) and the venue sheet (`tests/map-degrade.spec.mjs:70`),
so nothing breaks; add an assertion that the sponsor sheet has one website
link and zero maps links. No fixture sponsor carries a `url` today: add one to
`shortline-credit-union` (the pinned sponsor `tests/a11y.spec.mjs:444` opens)
for the button case, and use `daily-trim-barbershop` (pinned, no url) for the
no-button case. This piece touches only `sheet.js`, the contract and tests, and can be a
separate small dispatch from the pin work.

**Contract and journal.** CONTRACTS.md: sponsors.csv section (mark file
rule), content.json shape (`mark`), Map contract pin table and size
paragraph (the "venues are the largest pin" sentence becomes "venue and
featured pins share the largest size; the venue diamond is the featured
square rotated"), legend, key list, `#map-pin-alt`, test hooks. PROGRESS.md
entry; BACKLOG.md item narrowed to what remains (emerald treatment).

**Assumption that would invalidate this.** That a sub-mark extracted from a
wordmark is recognizable at ~22 CSS px. If it is not, the square goes to 32 px
(1.4× venue ink) or the mark leaves the pin for the card only. Test before
pin code is written.

## Risks & unknowns

- **Mark legibility at 22 px.** Medium confidence it works: favicons are
  designed for 16–32 px and the sapphire logos each contain a square-ish
  sub-mark. Cheapest test: composite one real extracted mark at 22 px onto an
  iPhone screenshot of the current map and look at it on the phone.
- **Async pin images.** Low risk, known pattern: load marks with `Image`,
  register on load, add the featured layer once all are registered. Must not
  block the rest of the map from rendering and must work with the precache
  as the only source.
- **Safari SVG-in-canvas.** Medium confidence the width/height requirement is
  the only trap. Cheapest test: draw one SVG mark into a canvas in iOS Safari.
- **Square-vs-diamond clearance.** Low risk with current data (>= 278 m
  separations); the risk is a future sheet edit placing a sponsor at a venue.
  The clearance check already exists for sponsors and only needs the new
  inequality.
- **Duplicate-button a11y.** Low risk. Removing sponsors from `#map-pin-alt`
  avoids two buttons per sponsor; the a11y and map-a11y suites reference
  sponsors and need updating.
- **Coordinator adds a sapphire sponsor before a mark exists.** Accepted by
  decision: hard build error, consistent with the logo rule. Mitigation is
  procedural (README note: a featured sponsor needs a mark file).

## Deferred questions

- Mark size cap (64 KB assumed). Decide when a real mark exceeds it.
- Whether featured cards carry anything beyond mark and name (a blurb line, a
  tier label). Decide after seeing the list with three real sponsors; must be
  decided before the Squarespace map embed ships, since that is where the list
  is largest.
- Emerald "special treatment" and any ruby-specific format. Decide when such a
  sponsor exists (BACKLOG.md item remains).
- Whether the Support view should reuse the mark anywhere. Not needed now.

## Ledger

Decisions:
1. Tier-to-pin mapping unchanged. Verified already in CONTRACTS.md; the first
   and third stated requirements restate it.
2. The square image is a hand-made committed file per featured sponsor, not a
   build derivation. All 15 existing logos are 2:1 to 4:1 wordmarks; the three
   sapphire logos each contain an extractable square-ish sub-mark; the build
   has no image library and must run with NPM down. Files made
   2026-09-04: `oldnationalbank-pin.png` 160x160, `platform-pin.png` 256x256,
   `wellingtonmanagement-pin.png` 318x144 (a building silhouette, contain-fit
   gives it ~22x10 px in the pin; the first one to check on a phone).
3. Missing mark for a sponsor that would draw a featured pin is a hard build
   error, same as the missing-logo rule. Chosen over a fallback render for
   consistency with "silently degrading a sponsor's presence is worse than
   telling someone". Assumed scope: featured tier AND location present.
4. Featured square is the venue diamond unrotated: 27 px side, equal ink.
   Chosen over the 38 px bounding-box reading, which doubles the ink and puts
   sponsors above venues in the hierarchy.
5. Generic sponsor is a solid red diamond at `SMALL_R`. Fill convention swaps.
6. Key list order: Featured Destinations, Venues, Sponsors; only pinned
   sponsors; card tap mirrors venue card tap.
7. Sponsor sheet: Open in Google Maps out, "Sponsor website" (from `url`) in;
   no button when `url` is blank. Anthony's call, 2026-09-05; reason not
   stated. The venue sheet's parallel button reads "Visit venue website", so
   "Visit sponsor website" is the phrasing-consistent alternative if wanted.

Assumptions (correctable at build-prompt time):
- Mark path `content/logos/<id>-pin.<ext>`, `svg | png`, any aspect ratio
  rendered contain-fit, <= 64 KB, report line below 128 px or beyond 2:1.
- `mark` field in content.json, null when absent.
- Emerald and ruby identical to sapphire.
- Sponsors move from `#map-pin-alt` to the visible key list.
- Legend swatches follow the new shapes; legend order unchanged.
- Work sequences after the uncommitted map-collisions diff is committed.

Facts verified during definition (2026-09-04):
- `FEATURED_SPONSOR_TIERS = {emerald, ruby, sapphire}` at `site/js/views/map.js:54`;
  `VENUE_R` 19, `SMALL_R` 11 at `:174–175`; pin images at `:1428–1457`; legend
  markup at `:1024–1025`; key list render at `:1309–1322`; sponsor layers at
  `:1689–1700`; sponsor name offset at `:1807`.
- Live build: 3 sapphire + 3 topaz sponsors, all with locations; nearest
  featured-to-anything 443 m, nearest topaz-to-anything 278 m; 21 live venues.
- `scripts/build-sw.mjs` precaches by walking `site/`.
- The build matches a logo by the exact name `<id>.<ext>` (`scripts/build.mjs:1269`),
  so the `-pin` files are inert until the build learns the convention.
- `package.json` has no runtime dependencies; build is zero-dependency by
  design.
