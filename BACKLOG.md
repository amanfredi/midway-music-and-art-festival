# Backlog — open work, open decisions, deferred ideas

Everything forward-looking lives here. PROGRESS.md is the state journal: what
happened and why. Nothing should appear in both.

Items are not prioritized against each other. The festival is October 2–4,
2026; nothing here blocks the site working today.

## Decisions that need Anthony

**Map library — keep hand-rolling, or adopt MapLibre GL JS?** Current answer is
not yet, but the case has grown.
MapLibre requires WebGL, which fails in iOS Lockdown Mode and on low-end
phones where a static SVG always works, and adds roughly 230 KB gzipped.
Against that, zoom-dependent labelling, feature filtering by zoom
and label collision are exactly what an engine gives for free, and the last
round hand-rolled all three — plus the reported iOS lag below is evidence that
a large static SVG has its own cost. This decision should be made together with
the commissioned hand-drawn map, which the current georeferencing design
(`geo.js` plus control points) is built to support and a vector engine would
complicate.

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
diagnosed. The likely cause is the size and node count of the inlined SVG, in
which case it bears directly on the map-library decision above; that hypothesis
is unverified.

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
is in `reference/`.

An **in-depth code and test review** — the codebase has grown through several
fast QA rounds, and no one has read it end to end since. In particular, focus on
whether the key user-facing features have appropriate test coverage, if the code makes appropriate use of reusable components rather than copy/pasting similar patterns, and if adopting any 3rd party libraries or frameworks could reduce the volume of code to maintain in this repository and still keep the desired offline-only functionality (e.g. by bundling the library at build time). The current app state should be documented by screenshots before any refactoring, so that any resulting changes can be easily identified.

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

`content/fixtures/venues.csv` is a few venues behind the live sheet. Harmless —
it is only a snapshot, and the tests build from it deliberately — but worth
refreshing next time the fixtures are touched.

Events, vendors, sponsors and settings are still placeholder fixtures. Each
becomes real with a one-line change in `content/config.json` pointing at a
published sheet tab.

## Needs a real device

None of these can be checked from the screenshot harness or the test suite.

- [ ] iPhone airplane-mode pass after any service-worker or caching change
      (procedure in README).
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
