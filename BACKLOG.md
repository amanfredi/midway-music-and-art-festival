# Backlog — open work, open decisions, deferred ideas

Everything forward-looking lives here. PROGRESS.md is the state journal: what
happened and why. Nothing should appear in both.

Items are not prioritized against each other. The festival is October 2–4,
2026; nothing here blocks the site working today.

## Decisions that need Anthony

**WebGL2 floor — DECIDED 2026-08-10: accept it, degrade gracefully.** A device
without WebGL2 cannot run MapLibre. Anthony ruled against both alternatives on
the record — reviving the SVG map as a fallback (two implementations, which the
original ledger rejected) and swapping to Leaflet (no per-zoom labels or vector
styling, half of what the audition was for). Shipped instead: the map view
checks for WebGL2 before importing the engine and, when it is missing, replaces
the frame with a short explanation and leaves the venue key list — every venue,
every directions link — in place. Nothing to do; recorded so the next person to
find a mapless phone knows it is a decision rather than a bug.

**Map artwork, if it is ever commissioned.** The spike auditioned a four-corner
`ImageSource` ground against the vector one, and measured three constraints that
belong in any artist brief.

First, **~5 m of drift**: `map.svg` is drawn in a local equirectangular
projection while `ImageSource` places an image by its four corners in Web
Mercator, and over a 16 km sheet those disagree most in the middle. Pins land
correctly; the artwork under them slides. Four corners are not enough
georeferencing at this extent — more control points, or a pre-warped image, or a
tiled source.

Second, a **4096 px ceiling**: MapLibre uploads an `ImageSource` as a single
WebGL texture, and 4096 is the largest size every WebGL2 device is guaranteed to
accept. Over this extent that is 3.9 m per pixel, which reads acceptably at the
home view and goes soft at the closest zoom, so shipped artwork needs tiling
rather than a bigger single image.

Third, and observed rather than measured: **the raster ground was noticeably
slower than the vector one** on a real iPhone (Anthony, 2026-08-10). Not
diagnosed — vector is what ships, so it was not worth chasing — but it points the
same way the resolution ceiling does, toward a tiled raster source rather than
one large texture. The practical consequence for any future artwork work is
sequencing: **validate performance on a real device early**, before art is
commissioned against an approach that turns out to feel worse than what it
replaces. It is also a third reason the raster stays out of the shipped payload,
alongside its 863 KB and the fact that nothing renders it.

Tooling is kept — see the `artwork/` entries in CONTRACTS.md's directory layout.
Nothing ships. The artist-facing constraints are in
`reference/artist-accessibility-rider.md`; the three above are implementation
constraints on whoever wires the artwork up, not on the artist.

**Sponsor presentation, pending real sponsors.** The featured-vs-generic
sponsor pin distinction wants a design review once someone can see it against
real logos. Emerald tier's "special treatment / custom branding" is undefined
because no emerald sponsor exists yet, and the ruby logo-pin map format is
likewise unspecified.

**Map conformance path — DECIDED 2026-08-10: bring the map itself to WCAG
AA.** Anthony ratified the audit's recommendation
(`reviews/2026-08-wcag-aa-audit.md`): nothing it found is expensive or
inherent at the AA bar, and the alternate-path option relocates the work
rather than avoiding it (map pins are today the only way to reach
transit-stop and sponsor sheets). With MapLibre adoption also decided, the
remaining map failures (pan buttons, pin hit-size floor) are requirements on
the migrated map, not fixes to the outgoing SVG one — see the a11y carry-over
list under Map.

**Transit pin green — needs a brand ack, then it lands.** White line letters
on `--pin-transit` `#298d4e` compute 4.19:1. The CSS comment justifies that as
large text, but the letters render 8.4px bold at a 288px frame and 16.4px at
the 560px cap, so the 4.5:1 small-text threshold applies at every width.
Darkening to `#1e7a41` gives 5.36:1 against the letters and 4.60:1 against the
paper, and lifts the pin fill's own non-text contrast from 3.61:1 as a side
effect. The change is one token in `app.css` and the CONTRACTS.md pin-table
row `| Transit | green #298d4e | diamond with the line letter inside |`, with
a numeric contrast test alongside. Deferred 2026-08-10 by Anthony until after
the MapLibre migration — the specified fix targets the outgoing SVG map's
pins; the 4.5:1 requirement itself carries over to however the engine renders
transit pins, so revisit the color there.

**"Zero runtime dependencies" needs rewording.** MapLibre is a runtime
dependency — vendored and self-hosted, never fetched, but a dependency.
`CLAUDE.md` still says "Zero runtime dependencies, zero external page
resources" and `README.md` still says "There are no runtime dependencies", so
both now read as false to anyone who checks. The substance the invariant
protects is unchanged and worth keeping: nothing is fetched from a third party,
everything is self-hosted, offline and \$0/month still hold. This is Anthony's
prose to edit; CONTRACTS.md's own conventions section has been updated already.

## Code and test review follow-ups (August 2026)

The August review's follow-ups all landed 2026-08-09 (four waves — build/CI
integrity, app fixes, test coverage, then the remaining four items including
the content-revalidation fix). PROGRESS.md is the record; the full report with
finding IDs is `reviews/2026-08-code-and-test-review.md`. One new item
surfaced by the final wave:

- [ ] **Narrow the bare `catch` blocks on the content path.**
      `revalidateContent`'s catch exists for offline but swallowed a
      `TypeError` for the feature's whole life (see the 2026-08-09 PROGRESS
      entry); `store.js#refreshContent` has the same shape. Catch network
      failures specifically, or at least don't treat every throw as
      "offline".

Deferred — uncertain or bigger than a follow-up:

- Snapshot fallback so an emergency code deploy can ship while the Google
  Sheet is unreachable (F17's second half); needs a design for marking
  staleness loudly.
- Content-only publish path that reuses the last tested code instead of
  re-running the whole toolchain (F21's second half).
- Genuine multi-touch pinch test (arguably not worth paying for before
  October).
- On-device map profiling, if the map ever feels slow again. The original lag
  report closed unprofiled: the MapLibre migration replaced the SVG renderer
  that was suspected, and the device evaluation reported it smooth.

## Map

Overlapping pins, per-zoom label placement, the SVG's weight and the on-device
pan/zoom lag all closed with the MapLibre migration (2026-08-10) — PROGRESS.md
records what each cost and what replaced it.

The largest open item is now **keyboard and assistive-technology access to
pins**. They are drawn into a canvas, so they are not DOM nodes: the SVG map's
roving tabindex, Enter/Space activation and focus-return-to-pin are all gone.
Venues are still fully reachable through the venue key list below the map, but
**transit and sponsor pins have no keyboard path to their sheets at all**, and
axe cannot see the problem — a canvas gives it nothing to flag. The cheap fix is
a visually-hidden list of buttons, one per transit stop and pinned sponsor,
opening the same sheets. A richer fix is a roving focus ring drawn into the
canvas, which is real work.

Two related interaction gaps: **tapping a pin should highlight it**, and
**tapping a venue card in the key list below the map should highlight its pin
and recenter the map on it**, as though the pin itself had been tapped. Today
the card opens the detail sheet without any connection to the map. Both are
easier now — `easeTo` handles the recentering, and a highlight is a paint
expression keyed on `feature-state` rather than custom rendering.

A further refinement of the venue/map interaction might involve having the venue info card pop up as a map tooltip, rather than a separate card at the bottom of the screen.

**Leader lines for coincident pins.** At close zoom, pins that share (or nearly
share) a position could render as a small dot at the true lat/lng with the label
floating clear of it, joined by a short line — so a label never misrepresents
where something physically is. Raised from the iPhone evaluation, 2026-08-10.
Deferred: the cluster-plus-picker treatment already makes every venue reachable,
and this is a legibility refinement on top of it, not a fix for a broken case.

Smaller: bus routes 67 and 72 could be drawn as **route lines rather than stop
pins** — adding 40-plus stop pins was rejected as clutter, but a line conveys
"the bus goes along here" at a fraction of the visual cost. The GeoJSON
generator makes this cheaper than it was: it is another `kind` and another
layer.

Also small: **the locate button's denial message should say where to fix it.**
On iOS a code-1 geolocation failure looks the same whether the user once tapped
"Don't Allow" for the site or Location Services is off for Safari websites
entirely — the case observed 2026-08-10 on the deployed site: instant
"Location permission denied", no prompt (Settings → Privacy & Security →
Location Services → Safari Websites was set to Never; the home-screen install
prompted and worked because standalone web apps carry their own permission
identity). The current message is a dead end; a one-line hint pointing at
Safari's website location settings turns it into a fixable state. Copy change
only, no permission machinery.

The **map-design pass against the accessibility guide** ran as part of the
August 2026 WCAG audit, and `reference/map-artwork-a11y-constraints.md` now
carries the constraints for the commissioned artwork. The open items below
were specified against the hand-rolled SVG map; with MapLibre adoption
decided (2026-08-10), don't land them there — they are requirements the
migrated map must meet, kept for their measurements and acceptance criteria
(all evidence in `reviews/2026-08-wcag-aa-audit.md`).

- [ ] **MapLibre migration: accessibility carry-over.** Mostly discharged by
      the migration (2026-08-10). Preserved and re-pinned by tests: keyboard
      panning of the canvas; focus handoff into sheets and back to the
      triggering control; the legend naming both rail lines, with its test now
      comparing the swatch against the engine's own paint; the site's own
      attribution text below the frame, with MapLibre's attribution control
      disabled so there is only one; `prefers-reduced-motion` on the
      you-are-here pulse, which stayed a CSS animation by keeping the marker a
      DOM node; and the axe gate plus every map test in `tests/a11y.spec.mjs`
      re-pointed at the new map and green.
      **Still outstanding: the roving pin tabindex and Enter/Space activation**
      — see the keyboard-access item at the top of this section, which is where
      that work now lives.
- [ ] **MapLibre migration: map accessibility re-audit.** After the migration
      lands, re-run the map sections of `reference/wcag-aa-site-profile.md` —
      its re-audit triggers name map rework as exactly this invalidating
      change. The 2026-08 audit's map dispositions describe the SVG map and
      expire with it. Scope is the map view unless the shell changed too.

- [ ] **Pan buttons** (WCAG 2.5.7, finding F9). Panning is drag-only for
      pointer users — zoom and reset change scale, double-tap cannot traverse,
      and arrow keys are keyboard, which the criterion explicitly does not
      accept as the alternative. `map.panBy()` is the engine's equivalent of the
      old helper; the cost is unchanged — fitting four buttons or a d-pad onto a
      288–560px frame beside the zoom stack. W3C's own compliant example for
      this criterion is a map with pan buttons, so the "dragging is essential"
      exception is not available.
- [ ] **Hit-target floor for transit and sponsor pins** (WCAG 2.5.8, F4).
      **Needs re-measuring against the new map** — the old measurement (22.7px
      rendered, closest pair 3.4px apart) described SVG pins whose hit shape
      was the diamond itself. Pins are now 22px canvas symbols, but a tap
      resolves against a ±10px box around the touch point, so the effective
      target is larger than the drawn one and the two no longer coincide. Which
      of them 2.5.8 measures here is the question to settle before deciding
      there is anything to fix; the map re-audit item above is the natural
      place. The coincident-venue half of this is closed: clustering plus the
      picker sheet makes every venue reachable, including the pair that shares
      a coordinate.
- [ ] **Station and arterial label size floors** (guide Part C #4). Advisory
      rather than a WCAG failure — the contrast passes. The old measurement
      (6.0px and 7.4px at a 288px frame) was of `map.svg`'s counter-scaled type
      and no longer applies: label sizes are now zoom-interpolated CSS pixels in
      `map.js`, currently bottoming out at 9.5px for arterials and 11px for
      station names, which clears the guide's 8px floor at every frame width.
      Re-measure on device to confirm, then close.
- [ ] **Legend swatch size** (guide Part C #1). A fixed 20px CSS swatch against
      pins that are now a constant 22–28px at every frame width, since symbol
      layers are sized in screen pixels rather than counter-scaled. That makes
      matching them a fixed-number change rather than the scale-with-the-frame
      problem it used to be — or record an accepted deviation, which is still a
      legitimate answer given shapes and colors already match exactly.
- [ ] **Venue-pin hierarchy** (guide Part C #2). Venue pins are 1.27× the
      others — 28px against 22px, from `VENUE_R` 14 and `SMALL_R` 11, which are
      radii — where the guide wants 2×. The direction has to
      be growing `VENUE_R`, since shrinking the others worsens the hit-target
      item above — so check overlap fallout at the home view before landing.
      Cheaper to judge now: clustering absorbs the crowding that made bigger
      venue pins risky.
- [ ] **Scale bar** (guide Part C #5). A map spanning 120 m to 16 km trips the
      guide's conditional requirement. MapLibre ships a `ScaleControl`, so this
      is now a few lines plus a contrast check on its text rather than
      generator work. The north-arrow half stays closed as unnecessary: the map
      is north-up and rotation is disabled.

## App

The **WCAG 2.2 AA review** ran on 2026-08-10. All 55 A/AA criteria are
dispositioned in `reviews/2026-08-wcag-aa-audit.md`;
`reference/wcag-aa-site-profile.md` is the checklist future audits start from,
and states its own re-audit triggers. The cheap fixes landed with pinned
tests, an axe-core gate covers every route, and the Accessibility contract in
CONTRACTS.md was corrected where the audit found it too narrow. Left open
outside the map (which is above):

- [ ] **Patch the Now view in place instead of replacing it** (WCAG 2.2.2, F10
      — the same defect as the August code review's F14, now at higher
      priority). The 60 s redraw is a no-op unless the on-now/up-next key
      changed, so real updates land only at event boundaries; but when the key
      does change, `paint()` replaces `container.innerHTML` wholesale and
      destroys focus and screen-reader reading position mid-view. The fix is
      patching the two lists, not adding a pause control, which would be
      bizarre for this UI. Test: with a mocked clock crossing an event
      boundary, focus a star button, advance 60 s, assert focus survives.
- [ ] **Forced-colors hardening** (advisory; no criterion requires it). Under
      Windows High Contrast the map survives — SVG keeps its author colors —
      but the active day-tab and group-by state vanishes, because both states
      force to white-on-black and the 7.86:1 fill flip that carried the state
      is erased. A `@media (forced-colors: active)` rule marking `.is-active`
      with `SelectedItem`, or an underline-style marker that survives forcing.
- [ ] **Per-route `document.title`** (2.4.2 improvement, not a failure). One
      title for seven routes passes under the one-document reading the audit
      recorded; per-route titles are cheap (`app.js` already knows each route's
      name) and would satisfy the conservative per-page reading too.
- [ ] **Four small advisory items** the audit recorded without pricing: a
      visible-on-focus skip link (a11yproject asks unconditionally, though
      2.4.1 passes on landmarks and the tab bar follows `<main>`, so it buys
      little here); "opens in a new tab" in the accessible names of the seven
      `target="_blank"` links (AAA territory); the venue's number in the key
      list button's accessible name, so a screen-reader user can cross-
      reference a number a sighted companion mentions (today it is inside an
      `aria-hidden` SVG); and `scroll-padding-top` for the schedule's sticky
      control bar — no failure measured there, but it is the same class of bug
      as the tab-bar one already fixed.

**Web Share API** for sharing a link to anything with a URL: events already
have one (`#/event/<id>`), venues do not yet. Research from 2026-08-02 flagged
this as the strongest candidate from a PWA feature survey — iOS Safari 12.2+,
roughly five lines — and it supersedes the earlier "Web Share button on
event/venue detail" note, which was the same idea.

**QA on Android**, and an **agent review from a user's perspective**, possibly
using Claude for Chrome.

**Consider adding View Transitions for additional polish**, but this is low priority and might not even be an improvement.

## Content and data

Two venue-location facts are **valid data, not sheet errors** (ruled by
Anthony 2026-08-10, after repeated sessions flagged them; also recorded in
CLAUDE.md): **Mosaic on a Stick sits inside Hamline Park** and correctly
carries the park's address and plus code (`1564 Lafond Ave` / `XR5M+X8`), and
**Vig Guitars and Fluid Ink Tattoos are about 14 m apart**. Identical or
near-identical coordinates were a rendering limitation of the retired SVG map
(overlapping pins, one pointer-unreachable). The MapLibre migration fixed it
with clustering plus a picker sheet for pins no zoom can separate — not data
changes or build validation.

Two live venue `url` cells are schemeless (`hamline.edu/sundin-music-hall`,
`blackgarnetbooks.com`). The build completes them to `https://` with a logged
rewrite, so this is cosmetic — worth adding the scheme in the sheet whenever
it's next touched.

Events, vendors, sponsors and settings are still placeholder fixtures. Each
becomes real with a one-line change in `content/config.json` pointing at a
published sheet tab.

- Should we try to translate the content to multiple languages? Limited English Proficiency languages in Saint Paul are Spanish, Hmong, Karen, and Somali.

Two accessibility items from the August 2026 audit need content-side
follow-through:

- [ ] **Add the optional `logo_alt` sponsor-sheet column** (approved by
      Anthony 2026-08-10). The build derives `alt="<name> logo"`; a logo
      whose meaning exceeds the sponsor's name — a tagline, a co-brand —
      needs the override. Coordinate the new column with organizers, then
      wire the build: use `logo_alt` when non-empty, derive otherwise, and
      validate non-empty-if-present so a stray space can't blank the alt.
- [ ] **Editorial check of venue and event descriptions at content freeze**
      for non-English passages needing a `lang` attribute (WCAG 3.1.2). A
      one-time read, not a build rule — the audit concluded validation is not
      worth writing, since proper names are exempt and cover the realistic
      cases.

## Needs a real device

None of these can be checked from the screenshot harness or the test suite.

- [ ] iPhone airplane-mode pass after any service-worker or caching change
      (procedure in README).
- [ ] The detail sheet as a native `<dialog>` on iOS Safari (new 2026-08-09):
      backdrop rendering, the `:has()`-based scroll lock, focus restore.
- [ ] In-place content refresh on a real phone (new 2026-08-09, after the
      revalidation fix): with a tab already open, publish a banner change and
      confirm it appears without touching the tab; then confirm a worker
      version bump still leaves exactly one `circuit-map-*` cache. The
      clone-throw was observed in Chromium only — Safari unverified.
- [ ] Confirm map pan/zoom still feels smooth on a mid-range Android, not
      just the iPhone the migration was evaluated on. WebGL2 is a harder floor
      than SVG was.
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

### VoiceOver and zoom pass (about 15 minutes, from the WCAG audit)

Three criteria stay **pending** in `reviews/2026-08-wcag-aa-audit.md` until
this runs: 1.1.1 (is the text alternative for the map adequate?), 1.4.4
(zoom against map type), and 4.1.3 (does VoiceOver actually speak the live
regions?). Everything else about them is settled mechanically. Step 6 also
confirms the orientation fix on a real installed app. Run it top to bottom,
like the README airplane-mode pass.

1. **Setup:** deploy, or serve on the LAN, and open in iOS Safari. Turn
   VoiceOver on (Settings → Accessibility, or triple-click the side button).
2. **[4.1.3] Route announcements:** swipe through the tab bar and activate
   Schedule, then Map, then Support. Each should announce "<Name> view"
   without focus jumping anywhere. Activate the same tab twice — the
   announcement should repeat, not go silent.
3. **[4.1.3] Banner and toast:** load with an undismissed banner; VoiceOver
   should announce the notice text without focus moving. Then on the Map,
   with Location Services off for Safari, tap "Show my location" — the
   permission-denied toast should be spoken once, not twice.
4. **[1.1.1] Is the map's text alternative adequate?** With VoiceOver on, on
   the Map view: touch the map and you should hear its name and the arrow-key
   hint; swipe through the pins and each venue should announce "Venue N:
   name", each stop its name and lines. Then answer the real question using
   only the venue key list and the sheets, never the map picture: how do I get
   from a Green Line stop to venue 3? If the answer is "yes, comfortably",
   1.1.1 closes as a pass. If you needed the picture, venues need
   transit-relative information in text somewhere.
5. **[1.4.4] Zoom and reflow judgment:** VoiceOver off. Pinch-zoom the *page*
   to 200% on the schedule — everything should reflow or scroll readably. On
   the map, pinch the *map*: street names hold their size by design, so judge
   whether page zoom (pinch outside the map frame, or Safari's Page Zoom
   setting) makes map labels comfortably readable. Then try Settings → Larger
   Text and confirm app text grows while the site stays usable.
6. **[1.3.4] Rotation:** Add to Home Screen, open from the icon, rotate the
   phone. The app should follow into landscape and stay usable.
7. **[2.2.2, optional] Now-view stability:** during a real or simulated
   festival window, leave VoiceOver focus on a Now-view row across a minute
   boundary where the lineup changes, and note whether reading position is
   lost. It will be, until the in-place patch lands — this step is for
   confirming that fix later.
