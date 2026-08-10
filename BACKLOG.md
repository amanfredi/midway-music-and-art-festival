# Backlog — open work, open decisions, deferred ideas

Everything forward-looking lives here. PROGRESS.md is the state journal: what
happened and why. Nothing should appear in both.

Items are not prioritized against each other. The festival is October 2–4,
2026; nothing here blocks the site working today.

## Decisions that need Anthony

**Map library — keep hand-rolling, or adopt MapLibre GL JS?** Current answer is
still not yet; the August 2026 review firmed up the numbers (details in
`reviews/2026-08-code-and-test-review.md`). MapLibre 6 is WebGL2-only and
costs ~289 KB gzipped self-hosted all-in (ESM entry + shared chunk + worker +
CSS, measured 2026-08-09); the last WebGL1 line (5.24.0) is no smaller and a
dead end. Whether current iOS Lockdown Mode still disables WebGL is unverified
(iOS-16-era sourcing); low-end phones where a static SVG always works are a
concern regardless. The strongest argument *for*: `ImageSource` accepts four
corner coordinates for a georeferenced raster, so the commissioned hand-drawn
artwork could ride the engine, retiring the overlapping-pin and per-zoom-label
items for free — though it would complicate the georeferencing design
(`geo.js` plus control points) the map strategy is built around. Decide
together with the artwork commission, and only after the on-device lag profile
below.

**`map.svg` weight.** 1.87 MB raw, about 690 KB gzipped, all of it precached
for offline use — by far the largest thing a first-time visitor downloads.
Raising the `simplify()` tolerance from 2 m to 4 m was measured and saved only
19 KB gzipped, so it was reverted: the size is in the sheer number of ways, not
per-way precision. The remaining levers are a smaller extent or dropping
`tertiary` from the fetched highway tags.

**Sponsor presentation, pending real sponsors.** The featured-vs-generic
sponsor pin distinction wants a design review once someone can see it against
real logos. Emerald tier's "special treatment / custom branding" is undefined
because no emerald sponsor exists yet, and the ruby logo-pin map format is
likewise unspecified.

## Code and test review follow-ups (August 2026)

The August review's follow-ups landed 2026-08-09 in three waves — build/CI
integrity, app fixes, test coverage. PROGRESS.md has the summary; the full
report with finding IDs is `reviews/2026-08-code-and-test-review.md`. What
remains:

- [ ] **A `content-updated` message can be dropped by a booting page**
      (hypothesis, surfaced by the SW-update test work): `app.js` attaches its
      service-worker message listener only after `loadContent()` resolves, so
      a revalidation that finishes first posts to no listener and an open page
      stays stale until reload. The symptom was observed in the test; the
      mechanism is unverified. Candidate fix: attach the listener before
      awaiting content. This is the urgent-banner path — confirm before
      festival weekend.
- [ ] Set up Dependabot version updates (`.github/dependabot.yml`) so the
      SHA-pinned actions — and the lone npm devDependency — get bump PRs.
- [ ] Test-hook gaps: the Now view's on-now/up-next lists have no container
      testids (the spec walks sibling headings to tell them apart); the
      schedule specs lean on `.day-tab[data-day]`, `.toggle-btn[data-group]`,
      and `.event-group__title`, which are absent from CONTRACTS.md's
      test-hook list, so nothing stops a rename.
- [ ] `serve.mjs --root` flag, so the SW-update spec can reuse it instead of
      carrying its own ~25-line static server.

Deferred — uncertain or bigger than a follow-up:

- Snapshot fallback so an emergency code deploy can ship while the Google
  Sheet is unreachable (F17's second half); needs a design for marking
  staleness loudly.
- Content-only publish path that reuses the last tested code instead of
  re-running the whole toolchain (F21's second half).
- Genuine multi-touch pinch test (arguably not worth paying for before
  October).
- On-device iOS Safari map profile, then — only if rasterization is the wall —
  a MapLibre `ImageSource` prototype (see the map-library decision above).

## Map

The largest open item is **overlapping pins**. With 14 venues, several within
about 15 m of each other, pins stack and the one underneath cannot be reached.
Paint order is defined (transit, then featured destination, then sponsor, then
venue) but that only decides which pin wins, not how to reach the loser. Needs
an offset or a cluster-and-expand-on-zoom treatment; the venue key list below
the map is the workaround meanwhile.

Two related interaction gaps: **clicking a pin should highlight it**, and
**clicking a venue card in the key list below the map should highlight its pin
and recenter the map on it**, as though the pin itself had been tapped. Today
the card opens the detail sheet without any connection to the map.

A further refinement of the venue/map interaction might involve having the venue info card pop up as a map tooltip, rather than a separate card at the bottom of the screen.

**Scroll and zoom lag noticeably on a recent iPhone.** Observed, not yet
diagnosed. The August 2026 review bounded it by reading: `map.svg` is only
1,416 elements, so the node-count half of the old hypothesis is unsupported —
the weight sits in ten very large path `d` attributes, and the likely
aggravators are unthrottled per-pointer-event `viewBox` writes and a full
re-fetch/re-parse of the 1.87 MB SVG on every visit to `#/map` (both fixed as
review follow-ups). What remains is an **on-device iOS Safari profile**: if it
shows SVG rasterization itself is the wall, the MapLibre `ImageSource` path
becomes the serious option and the map-library decision above flips.

**Street labels are placed once for the whole map**, with collision detection,
then counter-scaled and hidden by level of detail as the view widens. Placement
itself is not zoom-dependent — positions are fixed — so a close view can land
between labels. A real map engine re-places labels per zoom.

Smaller: the OSM station dots and names baked into `map.svg` sit underneath the
transit pins, a mild redundancy that could be suppressed in `make-map.mjs` or
left as a zoomed-in detail. And bus routes 67 and 72 could be drawn as **route
lines rather than stop pins** — adding 40-plus stop pins was rejected as
clutter, but a line conveys "the bus goes along here" at a fraction of the
visual cost.

Finally, a **map-design pass against the accessibility guide** in `reference/`
(`Accessibility - map-design-guide (updated)_tcm38-565153.pdf`). Scale, density
and labelling have been retuned by eye across two QA rounds; the guide covers
contrast, symbol size and legend conventions systematically. Worth doing before
commissioning hand-drawn artwork.

## App

An **accessibility review against WCAG 2.2** is outstanding, updating the
Accessibility contract in CONTRACTS.md if it turns up gaps. The reference copy
is in `reference/`. Sequence it after the August 2026 review's a11y fixes (the
group-by `aria-pressed`, the native-`<dialog>` sheet) have landed, so it audits
a surface that isn't mid-change; that review's a11y findings and hand-rolled
surface inventory (`reviews/2026-08-code-and-test-review.md`) are the audit's
input, not its replacement.

**Web Share API** for sharing a link to anything with a URL: events already
have one (`#/event/<id>`), venues do not yet. Research from 2026-08-02 flagged
this as the strongest candidate from a PWA feature survey — iOS Safari 12.2+,
roughly five lines — and it supersedes the earlier "Web Share button on
event/venue detail" note, which was the same idea.

**QA on Android**, and an **agent review from a user's perspective**, possibly
using Claude for Chrome.

**Consider adding View Transitions for additional polish**, but this is low priority and might not even be an improvement.

## Content and data

There are two data quirks in the venues sheet that expose limitations with the current map implementation:
**Mosaic on a Stick carries Hamline Park's address and plus code verbatim** (`1564 Lafond Ave` /
`XR5M+X8`), so its pin lands exactly on the park's and hides it. The store is actually located within the park, so the addresses are accurate.
**Vig Guitars and Fluid Ink Tattoos are about 14 m apart**,
This also causes overlapping pins.

Two live venue `url` cells are schemeless (`hamline.edu/sundin-music-hall`,
`blackgarnetbooks.com`). The build completes them to `https://` with a logged
rewrite, so this is cosmetic — worth adding the scheme in the sheet whenever
it's next touched.

Events, vendors, sponsors and settings are still placeholder fixtures. Each
becomes real with a one-line change in `content/config.json` pointing at a
published sheet tab.

## Needs a real device

None of these can be checked from the screenshot harness or the test suite.

- [ ] iPhone airplane-mode pass after any service-worker or caching change
      (procedure in README).
- [ ] The detail sheet as a native `<dialog>` on iOS Safari (new 2026-08-09):
      backdrop rendering, the `:has()`-based scroll lock, focus restore.
- [ ] Re-measure the reported map scroll/zoom lag now that pan writes are
      rAF-batched and the SVG parse is cached (see the profile item under
      Map).
- [ ] Header scroll behavior on a phone. The page is now the scroll container;
      momentum scrolling, rubber-banding and the pinned control bar under real
      browser chrome need eyes on a device.
- [ ] Sticky control bar against the iOS status bar when installed.
      `.schedule-controls` pins at `top: var(--safe-top)`, which *should*
      evaluate to 0 given `apple-mobile-web-app-status-bar-style: default`.
      Unverified; if it does tuck under, the fix is an opaque fixed filler of
      height `var(--safe-top)`.
- [ ] Transit letter missing on iOS. Selby & Dale rendered without its "B" on
      iPhone while showing correctly in macOS Safari. Overlap was ruled out
      (nearest pin 652 m away) and the `<text>` markup has since been hardened,
      but the cause was never reproduced — and that stop now falls outside the
      1.5-mile pin radius, so it no longer renders at all. Check a different
      single-letter pin, such as Hamline Avenue.
- [ ] Install button on a real iPhone (instruction sheet) and Android Chrome
      (native prompt).
- [ ] Splash screens render on iOS launch.
- [ ] Nav fits and reads at 320 px with six tabs.
- [ ] Transit stop names and positions verified against Metro Transit's
      published Green Line / A Line / B Line stop lists.
