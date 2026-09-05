# Build progress — Midway Music & Arts Fest site

State journal. Read the Status section to know where things stand, then the log
for why the current design is what it is. Open work lives in BACKLOG.md;
binding interfaces in CONTRACTS.md; scope and non-goals in DEFINITION.md.

## Status

Live and working at https://go.midwaymusicandart.org/ (the github.io URL 301s
to it). Every push to `main` deploys; the full suite is green. `npm test` runs
offline from fixtures; only the deploy workflow builds from the live sheet.

The map is **MapLibre GL JS**, vendored into `site/assets/maplibre/` and served
from the primary origin like everything else — the invariant in CLAUDE.md is now
stated in those terms. It requires WebGL2, an accepted floor (decided
2026-08-10): a device without it gets a short explanation plus the venue key
list instead of the map.

**Venues, events and sponsors are live from the organizers' Google Sheet**
(URLs in `content/config.json`); `settings` is the only remaining fixture. As of
the 2026-08-31 deploy the site carries 21 venues, 34 events across Oct 2–4 at
11 venues, and 6 sponsors (3 sapphire, 3 topaz) carrying their real logos. All six
sponsors carry `location`s in the sheet as of 2026-09-04, so each gets a map
pin: a sponsor may sit anywhere inside the map's calibration frame, not just
the festival box (ruled 2026-09-04 — see the log). Vendors is deliberately empty (`"vendors": null`), so that tab reads
"Vendor list coming soon."; the organizers have not named vendors yet.
`content/fixtures/venues.csv` remains a hand-committed copy feeding the offline
tests (refreshed 2026-08-09), and the emergency-build copies under
`content/snapshot/sources/` — one per remote source, so three of them now — are
written by successful builds.

The organizers' Squarespace site carries two pages rendered from this same
pipeline — **Performers** and **Venues** (midwaymusicandart.org/performers,
/venues), live since 2026-09-04 — via the twin embed scripts in `site/js/`
(binding interface: the Squarespace embed contract in CONTRACTS.md; operator
procedure in README). A third is live at midwaymusicandart.org/map: the **map
embed**, `https://go.midwaymusicandart.org/?embed=map`, the Map view without app
chrome, in an iframe that sizes itself from a height the embed posts to it (Map
embed contract in CONTRACTS.md; iframe snippet and verification walk-through in
README).

The POC is complete — content pipeline, UI, OSM-derived map, PWA shell,
service worker and CI all landed and were audited in earlier rounds.

## Log

Newest first.

### 2026-09-05 — the toast climbs out from under the sheet

The venue sheet's share button is the app's main way to share a venue, and its
"Link copied" has never been visible. A modal `<dialog>` and its `::backdrop`
paint in the **top layer**, above every `z-index` on the page, so `#toast-root`
at 60 was drawn underneath the sheet that raised it — every time rather than
sometimes, since the sheet always reaches the bottom of the window and the toast
always sits just above it. The app's bug, not the embed's, dating from the sheet
becoming a modal dialog. Found while anchoring the embed's overlays, held back a
round because fixing it changes the app, then authorised.

`#toast-root` now joins the top layer as `popover="manual"` while it has
something to say. Three details carry weight and each has a test: the attribute
is set from JS and only where `showPopover` exists (the UA hides a `[popover]`
that is not open, so marking it up unconditionally would cost an older browser
its toasts entirely); the root is shown **before** the message is appended,
because it is the `aria-live` region and one that is `display: none` when its
text arrives may never be announced; and it leaves the top layer when the last
toast goes, since the layer stacks in entry order and a root left showing would
sit above the next sheet.

A trap for whoever tests this next: `elementFromPoint` cannot answer it.
`showModal()` makes everything outside the dialog inert, and inert content is
not hit-testable, so a hit test names the sheet whether the toast is above it or
below — which made the fix look like it had failed when it had not. Confirmed
against captured pixels instead, in Chromium and WebKit and in both surfaces;
the tests assert the mechanism.

What is **not** verified: that VoiceOver actually speaks a live region hosted in
a popover. The ordering that makes it possible is pinned by a test, but
sufficiency needs a real device, and it is now the first item in the
accessibility QA list.

### 2026-09-05 — an embed overlay opens where the tap was

Anchoring the embed's overlays to the map frame (two entries down) was half an
answer. It holds while the visitor is looking at the map, and a venue-card tap
at the end of a scrolled venue key is the case where it does not: measured, the
sheet opened at y=16 in a 1359 px iframe while the visitor was looking at
y=864..1359 — the same fault as the original bug, wearing a different hat.

The rationale already contained the fix. The map frame was chosen because a tap
on a pin proves the map is on screen; by the same argument a tap on a venue card
proves the *card* is. The tap is the evidence, so the anchor follows it: a pin's
sheet sits on the map frame's bottom edge as before, a card's sheet is centred on
the card, and a toast an open sheet raises follows the sheet. Centred rather than
aligned to an edge because the ignorance is symmetric — the card is one point
known to be on screen, the screen may extend either way from it, and centring
maximises the expected visible fraction without guessing which way.

Found along the way and deliberately left alone: **a toast raised while a sheet
is open is painted underneath it**, in the app as much as in the embed. A modal
`<dialog>` and its `::backdrop` are in the top layer, above every `z-index` on
the page, so the venue sheet's share button has never managed to show its "Link
copied". It is in BACKLOG rather than in this commit because fixing it changes
the app's presentation, which this work was scoped not to do. The embed's toasts
are anchored correctly meanwhile, which keeps that a small change rather than
two problems at once.

*Corrected by the entry above, which fixed it.* The evidence originally cited
here was `elementFromPoint` naming a link inside the sheet at the toast's own
centre. The conclusion was right and that reasoning was not: a modal dialog
makes everything outside it inert, and inert content is not hit-testable, so
the probe answers a different question. Do not reuse it.

Evidence: the `frame-` and `tap-` prefixes in `reviews/2026-09-embed-sheet/`.

### 2026-09-05 — a venue card zooms until that venue has a pin of its own

Reported as a regression: clicking a venue in the key list no longer reaches a
view where the highlighted pin is visible. **It is not a regression.** The same
17 of 21 venues fail at `94187a0`, the commit before any of this month's map
work, as at current `main` — same venues, and the same four that work. The
camera code has not been touched since 2026-08-23, and it never set a zoom at
all: it was written on 2026-08-11, the day after clustering shipped, and has
never been able to break a stack.

What it did instead was centre on a venue that had no pin and light a feature
the map wasn't drawing. Those two things are exactly what the existing test
asserted, which is how this stayed quiet for a month. The new test asserts the
property — the venue ends up drawn, as its own pin, highlighted — and sweeps
every venue in the fixtures.

The tap now zooms to the leader zoom as a floor, and never outward. That is
where the displaced treatment switches on, so every coincident group has broken
into individual pins by then; measured across the whole sheet, it is also
exactly the deepest floor any of the 21 venues needs. The second fact is
arithmetic about this data rather than a guarantee — clustering releases on its
own 26 px radius, so a pair 150 m apart is too far apart to be a coincident
group and still close enough to share a bubble at the leader zoom. So the camera
checks what the engine actually drew and steps in another whole level if it has
to. There is a test for that pair, built to sit in the gap on purpose.

### 2026-09-05 — the embed's overlays move to the map frame

Reported from the live page: tapping a venue pin in the embedded map scrolled
the host page down to the bottom of the iframe instead of popping the sheet up
in place.

The sheet is `position: fixed` to the bottom of the viewport, and the embed's
viewport is the whole iframe — which the height work above deliberately made as
tall as the embed's content. So the two changes are the same change seen twice:
in a 1661 px iframe the sheet opened at y=1122 while the visitor was looking at
y=40..704. Measured on the live page, so the numbers are the real ones.

Neither headless Chromium nor headless WebKit performs the scroll (0 px in both,
against the live page and against a local host harness), so the fix is aimed at
the cause rather than the symptom: the sheet now opens inside the map frame,
where there is nothing off-screen for any browser to scroll to.
`dialog.focus({ preventScroll: true })` covers the engines that cannot be tested
here. The same fault had a second victim — toasts, including the "Link copied"
the sheet's own share button raises — and they are anchored the same way.

Anchoring to the map frame rather than to the visitor's screen is a compromise,
and the two ways to do better were tried and rejected. A cross-origin
`IntersectionObserver` does report which band of itself an iframe can see, but
only redelivers on a threshold crossing: a fixed-height band sliding down a
taller iframe never changes the ratio, and WebKit duly reported the same stale
band at three different host scroll positions where Chromium tracked it. Having
the host page post its scroll position would work, and would put every future
fix behind another paste into somebody else's CMS.

Evidence in `reviews/2026-09-embed-sheet/`; the phone pair is the clearest —
before, the entire screen is dimmed with no sheet anywhere on it.

Also checked while reading the live page: the Squarespace block carries the
snippet's `<script>` half and the deploy carries `reportHeightToParent`, so the
re-paste the previous entry was waiting on has happened and that backlog item is
closed.

### 2026-09-05 — the live embed: no demo banner, no banner at all, and it sizes itself

The map embed is pasted and live on the Squarespace site. Three things from
Anthony's review of it.

**The "Demo Preview" bar on production was ours.** `settings` is still the
placeholder fixture, so `content/fixtures/settings.csv` *is* the content path —
`content/config.json` points at it — and its `banner_text` said "Demo preview."
Cleared, along with `banner_id`. It was not a demo-clock leak: nothing renders
on `?t=`. The banner's behaviour is still covered by a test-only settings
fixture under `tests/fixtures-good/`, which the offline, stored-state and
sw-update suites read through the test config.

**The banner is now suppressed in the embed**, reversing the call recorded when
the embed was built. The reasoning then was that a banner is organizer content
and a same-day notice should reach people reading the map on the organizers'
own site too. Live, it reads as the embed malfunctioning — a dismissible bar
inside somebody else's page — and anything urgent can be said in the Squarespace
page itself. Decided on the evidence, not flipped silently.

**The iframe sizes itself now.** The fixed-height ruling did not survive
contact: the venue key lays out in as many columns as the iframe is wide enough
for, so the content steps from ~1060 px at four columns to ~1780 at one, and a
stylesheet in the host page can only branch on the host's viewport while the
column count follows the iframe's width, which Squarespace decides. Any
breakpoint can land on the wrong step. The embed posts its height and the
snippet's listener applies it; the old heights stay as a no-JS fallback.
Measured across fourteen widths from 1440 to 320: no internal scrollbar
anywhere, and zero blank space.

Getting that measurement to be possible turned up two real bugs, neither of them
embed plumbing. `body { min-height: 100dvh }` makes the document at least as
tall as its frame, so a height reported from inside an iframe could only ever
grow it. And every visually-hidden pin-alt button was a 44 px absolutely
positioned box: the sr-only rule set `height: 1px` while the base rule kept
`min-height: 44px`, and a min-height beats a height. That left ~19 px of
scrollable overflow at the bottom of the map view that nothing draws in — on the
app's own pages as much as in the embed.

### 2026-09-04 — the Playwright port is per-checkout, so concurrent suites stop fighting

`playwright.config.mjs` pinned the test server to 4173 with
`reuseExistingServer` outside CI, so two sessions running suites at once either
had one silently reuse the other checkout's server (testing the wrong tree) or,
under `CI=1`, refuse to start and wait. The port is now derived from a hash of
the checkout's path: stable for a given checkout, different across worktrees.
Deterministic rather than a random free port because Playwright re-evaluates
the config in each worker process, and every process must agree on the port.
`PW_PORT` overrides it in the unlikely event two checkouts hash together.
`share.spec.mjs` was the one spec that hardcoded the origin; its expected share
URLs now come from the `baseURL` fixture. Concurrent suites in the *same*
checkout remain unsupported — they'd fight over the `site/` build output, not
the port. Full suite green under `CI=1` (174 unit + 148 Playwright).

### 2026-09-04 — every content view is a 560px column

The Support cap (below) made that one page fixed-width while the rest of the
site stayed fluid; Anthony ruled the cap should be site-wide. `.view` now caps
every content view at 560px centered — the same number the map frame caps
itself at — and the map view widens with its frame rather than opting out.
The first cut opted the map view out entirely (`max-width: none`), which let
the venue key and legend spill to the window edges under a frame capped at
1100px (Anthony caught it on a laptop); the map view now caps at 1100px
inside the same 860px media query that widens the frame, so view, frame and
venue key hold one width at every window size (measured: 343/560/960/1100).
The sponsors-specific cap is gone, subsumed by the shared rule. Suite green
at 144.

Housekeeping in the same push: the venues-header deploy blocker recorded
earlier today is cleared — cell A1 reads `id` again and `npm run build`
succeeds against the live sheet — so its Status paragraph and BACKLOG section
are gone.

### 2026-09-04 — cap the sponsors view, and let cards fill their row

The two-up sapphire grid exposed that `#view` has no desktop width cap — the
map caps itself (`.map-frame`) and every other view had stayed narrow only by
accident of its content — so sapphire cards grew to half a desktop window.
The sponsors view now caps at 560px, the map frame's own cap. Separately, the
card grid's `auto-fill` kept minting empty 150px tracks as the window
widened, so a tier with fewer cards than tracks snapped *smaller* at every
breakpoint while resizing — Anthony watched topaz stutter and shrink as he
widened the window. `auto-fit` collapses the empty tracks so the cards
stretch to fill their row instead. Measured after the fix: from ~600px of
window width up the tab no longer changes at all — sapphire cards hold 274px,
topaz 179px — and the phone layout is untouched.

### 2026-09-04 — names aim at their own pin, and diagonals come in to the ink

Anthony's read of the corner placements: "much better, still not perfect."

**A name now knows which pin it looks like it belongs to.** MapLibre's placement
pass is ambiguity-blind — it takes the first candidate whose box is free, and a
box can be perfectly free while sitting directly over a neighbouring pin. That
is how "Anderson Center" ended up on top of the Creative Writing House pin with
open paper to its own left. Each venue's candidate order is now worked out at
render time from what is actually around that pin, and a candidate is ambiguous
when any other mark — diamond, location dot, transit or sponsor pin — is nearer
to the label than the label's own pin is. That is the question the reader is
answering, so there is no threshold to tune. Ambiguous candidates are demoted,
never dropped: on a crowded map an ambiguous place still beats no name.

**Diagonals measure their gap from the ink.** A corner clearance had been
measured to the reserved box's corner, 0.71 R out per axis, while the diamond's
edge crosses the 45° ray at R/2 — 0.2 R of reserved emptiness you could see. It
now starts from the edge with the same gap a side gets. No ownership exception
was needed, which is worth recording since one was on the table: the label's own
padded corner still lands ~2 px outside the reserved box, so a name is never
rejected by the pin it belongs to.

Anderson Center sits left of its own pin, which was the acceptance case. Fluid
Ink below, Mosaic upper-left and Black Hart top-right are unchanged. Black
Garnet Books moved from below its pin to its right — a change from the list this
round was measured against, and a return to what Anthony asked for originally;
the transit stop beside it makes both above and below ambiguous under the new
rule, and east is genuinely the clear side.

Fill is unchanged at 12 of 14 on a phone and 19 of 20 on desktop, on both
contents. This round changes where names go, not how many fit. Captures under
`after-aim-`, with `before-aim-labels-desktop.png` shot from the previous commit
in the same session — necessary because CSS font fallback resolves differently
between browser launches, so the legend renders at a different size in earlier
prefixes and only same-session captures compare cleanly.

### 2026-09-04 — pins reserve the diamond's area rather than its bounding box

Anthony's read of the corner placements, and he had the geometry right: a
collision box is axis-aligned, and the bounding box of a 45° square is twice its
area. The error is worst exactly where it showed — on the diagonals, where the
ink stops at 0.71 R and the box corner sits at 1.41 R — so a corner-placed name
stood off twice as far as it looked like it should.

Venue pins now reserve a square of the diamond's own area, side R √2, giving up
the four tips and keeping the body. The pin layer draws and a transparent
blocker layer beside it reserves, because MapLibre takes a symbol's collision
box from its image rect and `icon-padding` cannot go negative — the same
decoupling the tether already used. Corner clearances are measured to that box;
cardinals still clear the tip, which is real ink.

**His hypothesis about Fluid Ink Tattoos was right to the pixel.** Its "below"
candidate was blocked by Vig Guitars' box overlapping it by 9 px horizontally
and **2 px vertically** — pure bounding-box overhang, with the ink nowhere near.
The shrink frees it, and Fluid Ink is now named below its pin, where he placed
it by hand. Mosaic on a Stick is to its left and Black Hart top-right, also as
placed.

Counting venue pins in frame that carry a name, at the leader zoom: phone 10 of
14 → **12**, desktop 18 of 20 → **19** on the content the captures use; phone 9
→ 12 and desktop 17 → 19 on shipping content. The two contents now agree,
nothing was lost, and Black Hart of Saint Paul — the one loss from making dots
block — is recovered. No tip overlaps in the captures; names sit closer to their
pins and read as belonging to them. Captures under the `after-box-` prefix.

Still unnamed at the leader zoom: Sundin Music Hall and Elsa's House of Sleep on
the phone, Soeffker Gallery on desktop — in each case the lower-ranked half of a
pair whose members want the same space, which is the ranking working rather than
failing.

### 2026-09-04 — dots earn their own collision box, and names get the corners

Two refinements to the entry below, from Anthony reading
`after-fill-urban-lights-desktop.png`. Both are his rulings.

**A leader line may be crossed; a location dot may not.** Taking the whole
tether out of the collision index went one step too far: with nothing reserved
along it, Black Hart of Saint Paul's name was placed straight across the dots of
the two venues either side of it, leaving three tethers pointing at ink you
could not see. Dot and line are now separate symbols. The line still reserves
nothing — that was the whole point of the split — and the dot reserves a box the
size of a dot, about 15 px square against the 110 × 46 the composite used to
take. The ruling in full: a label may cross a leader line; it may not cover a
diamond, its number, or a location dot.

**Names can now use the corners.** A pin whose four sides are spoken for still
has its corners, and on this map that is the common case. The reason they
measured inert in the diagnosis was not crowding: a single `text-radial-offset`
puts a diagonal candidate at radius/√2 on each axis, which is *inside* the
square collision box it is meant to clear, so the placement pass rejects it
before crowding is even consulted. With an offset per anchor they carry the full
clearance on both axes and become real candidates, so every name layer moved to
`text-variable-anchor-offset`.

On desktop the corners recover exactly the venue the dot rule costs, and put it
where Anthony placed it by hand: Black Hart top-right of its pin, Mosaic on a
Stick upper-left. Measured at the leader zoom on the content the captures use,
nothing is lost and desktop gains one — phone holds at 11 of 14, desktop goes
17 to 18. On today's shipping content, which differs only in the sponsors tab,
the phone loses Black Hart (11 to 10) and desktop holds at 17 of 20.

That phone loss is the camera, not the rule. At the home view Black Hart sits
26 px from the frame's right edge; west is where both neighbours' dots now are,
its own group's diamonds hold north and south, and its only unblocked candidates
are past the edge — where MapLibre will still place a label, invisibly, because
off-screen placements are legal. Centred on Black Hart it is named. Captures
under the `after-dots-` prefix.

### 2026-09-04 — the displaced-pin treatment stops eating the map's label space

Follow-on from the entry below, and a correction to it. Anthony read the
before/after phone captures and found the fix hadn't moved what he cared about:
the same venue names were missing, three of them with visible free space around
them. He was right. That work made the sacrifice *order* deliberate and left the
*fill rate* where it was — 8 of 14 venue names on a phone frame at the leader
zoom.

The diagnosis (`reviews/2026-09-map-collisions/diag-*.png`, with
`showCollisionBoxes` on) is that the free paper was not free. A symbol's
collision box is its whole image rect, and dot, line and diamond were one image,
so a pin displaced 32 px reserved 110 × 46 px to protect a 46 × 46 diamond — a
displaced transit stop reserved 116 × 30. Most of every one of those boxes was
the blank paper beside the leader line, and on a phone frame they covered the
middle of the map. Blockers were named by taking one layer at a time out of the
collision index rather than by eye.

Anthony's ruling, four parts, now landed. Fill went **8 of 14 to 11 of 14** on
the phone and 17 of 20 on desktop, one behaviour at a time:

- **The composite is split** (+1, Ginkgo Coffeehouse). Dot and line are their
  own layer and reserve nothing; the diamond is the ordinary pin image moved by
  `icon-offset` and still reserves its box. The 2026-08 ruling that baking the
  line into the icon made it untrespassable is **reversed for the line and kept
  for the diamond**: a label may cross a leader line, and may not cross a
  diamond or its number.
- **Displaced names got fallback positions** (+1, Urban Lights). The lane's side
  is still the first choice, so the name still says which way the tether points,
  but blocked there it now works round the diamond instead of vanishing. This
  needed `text-variable-anchor-offset`, which pairs an offset with each anchor
  and is data-driven; plain `text-variable-anchor` measures one radial distance
  from the feature, which for these pins is the dot, a whole lane from the
  diamond.
- **Nothing may park a diamond on a dot** (+1, Black Hart of Saint Paul). The
  dot is the only thing claiming where a venue really is. "Most of the dot still
  visible" turned out to need no calibration at all: a chord through a circle's
  centre halves it, so majority-visible is exactly "the dot's centre is outside
  the diamond", and the threshold is the diamond.
- **Lanes go by name rank where geography is rounding.** A 10-digit plus code
  names a cell 1/8000° across, and the Urban Lights row differs by exactly one
  cell of latitude — three buildings on one sidewalk, entrances on University
  Avenue, the delta being which cell somebody clicked. Groups inside a cell hand
  their lanes out by rank, middle lane first, since it draws at its own
  coordinate and is the worst place for a name. Sundin and Soeffker, three cells
  apart, keep geographic order.

Two things worth knowing before touching this again. Name offsets are in **ems
of the layer's text size**, so changing the size without dividing the offsets by
the new one walks every name into its own pin's box: measured, 12 px → 11 px cut
the phone frame from 8 names to 4, and 10 px to none. And rank ordering can send
two members past each other; lane offsets are static while true positions spread
with zoom, so a crossed pair converges and the clearance search vetoes that axis
— the rank regime survives in the real trio only because it is 108 m wide on its
*other* axis.

Still unnamed on the phone: Mosaic on a Stick and Fluid Ink Tattoos, whose one
free side is inside a neighbour's diamond rather than inside empty paper, and
Elsa's House of Sleep, which is the lowest-ranked of its trio. Captures under
the `after-fill-` prefix.

### 2026-09-04 — deliberate label collisions, a desktop map frame, and a map embed

`definitions/squarespace-map-embed.md`, in three stages. The suite is green at
144 tests and `content.json` is byte-identical across repeated builds; the phone
map is byte-identical for every capture except the two collision behaviours that
were the point. Before/after captures at 393 px and 1440 px are in
`reviews/2026-09-map-collisions/`, with the harness that reproduces them.

**Reproduced first.** Both reported symptoms show up against named venues on a
build from the last-good snapshot. At the leader zoom on a desktop frame, Sundin
Music Hall (3 events) lost its name to Soeffker Gallery (0 events) and Urban
Lights (2) lost its to Elsa's House of Sleep (0) — in both cases to a venue that
happened to sit lower in the sheet. And Vig Guitars and Fluid Ink Tattoos, which
share a longitude exactly and differ only in latitude, were displaced east and
west along the one axis they do not vary in.

**Which name survives is now ranked** — event count descending, tiebroken by
venue id, as `symbol-sort-key` on both venue name layers. With no sort key at
all, MapLibre had been falling back to source feature order, which is sheet row
order. The ranking moves when the organizers edit the lineup, which is the
point; the build is untouched, since the count is derived at render time from
content the view already holds.

**A coincident group now lanes along the axis it actually spreads on**, and
gives that axis up only where laying out on it would put a diamond on another
pin. Two things forced more than the definition sketched. First, the give-way
decision cannot be made a group at a time: in the committed fixtures the Hamline
Park pair's east–west lanes are blocked by the Vig Guitars pair's north–south
ones and vice versa, so settling either first locks in an overlap that the
existing no-overlap test catches. It is now one decision over all groups at
once, walked in preference order — fewest groups moved off their own axis first
— which is a few dozen layouts at this scale. Second, `pxAtZoom` returned
north-up y while every consumer of a lane offset counts y downward; that cost
nothing while lanes only ran east–west and inverts a north–south lane's sign the
moment they don't.

On the live sheet the visible result is Sundin/Soeffker stacking vertically, the
Urban Lights trio giving up its east–west lanes — computed at the split zoom,
those lanes put Black Hart of Saint Paul 36 px from Black Garnet Books, under
the 38 px two-diamonds-clear floor, which is what the deployed code does with
today's sheet — and Vig/Fluid keeping east–west because nothing else fits
there, a new backlog note.

**Name anchors try above and below before either side.** The venues are strung
along University Avenue, so horizontal-first aimed every name down the row at
its neighbour. Measured across five zooms this is a wash on how many names get
placed (43 either way); it was chosen on what the label points at, not on count.

**The Map view has a desktop frame.** From 860 px up the frame is 1100 px wide
with its height still capped at 560 px, instead of a 560 px square adrift in a
1440 px window. The cap is not lifted, it is turned on its side: both of its
documented reasons are about height, so view zooms now come from the frame's
shorter side and the on-screen scale is identical to the square frame's — no
readability argument has to be redone. The square home view had been cropping
the venue set, which spans ~3.4 km east to west against a 3 km view; the wide
frame shows all of it. On a short window the height gives way so the legend and
venue key stay above the fold. Map view only.

**The embed is `?embed=map`** — a query parameter rather than a hidden route,
because it says how a view is presented rather than which view you are on, and
it pins its own route so the pasted URL is the whole address. Deferred questions
answered while building: cooperative gestures are embed-only (on our own page
the map is the page and the wheel should zoom it); the notice banner stays,
because a same-day change has to reach people reading the map on the organizers'
site too; and the iframe height is a fixed number rather than a postMessage
protocol, made safe by laying the venue key out in columns in the embed — 21
venues in one column is ~1900 px of iframe and grows by a row per venue, in
columns it is ~1160 px and grows by a row per three or four. Links out of the
map open the full app in a new tab, since an embed has no tab bar to come back
with. The service worker needed no case: it already answers every navigation
with the cached `index.html`.

Found on the way, and not fixed here because it is not ours to fix: **the live
venues tab's `id` header has been overwritten with `5`**, so `npm run build`
fails and no deploy can ship until it is corrected in the sheet. The work above
was built and captured against `content/snapshot/sources/`, the last bytes that
passed. BACKLOG carries it at the top.

### 2026-09-04 — sapphire cards go two-up, outranking a ruby tier nobody holds

The restored height ladder (below) wasn't enough: most sponsor logos are wide,
so under `object-fit: contain` the card's width — shared across tiers by the
common three-up grid — still decided their drawn size, and sapphire read
barely bigger than topaz. Sapphire now gets its own two-cards-per-row grid
with the logo tile scaled up to 96px to match the wider card; measured on the
live logos, each sapphire mark now draws around four times the area of any
topaz one. That deliberately jumps sapphire past ruby's 84px tile and
crowds the emerald spotlight's 140px: accepted and deferred (Anthony,
2026-09-04) because no ruby or emerald sponsor exists and none may sign —
the re-ranking item rides the sponsor-presentation entry in BACKLOG.

### 2026-09-04 — sponsor pins may sit anywhere the map can show

The organizers started filling the sheet's sponsor `location` column and the
build failed on Ideal Printers, whose plus code resolves to downtown
St. Paul — outside the tight festival box every location was checked
against. Ruled valid data: a sponsor is a neighborhood business, not
festival infrastructure. Sponsors now validate against the map's calibration
frame instead, derived in `build.mjs` from
`site/assets/map-calibration.json`'s control points so a recalibration stays
a pure data change; Ideal Printers lands ~2 km inside its east edge, so its
pin is reachable. Outside the frame is still a build error — the map's
maxBounds mean such a pin could never be panned to — and the message says to
leave `location` blank to list the sponsor without one. Venues and vendors
keep the tight festival box: what the festival itself places must be in
Midway, and the tight box is what catches a swapped lat/lng or a mistyped
digit. CONTRACTS.md records both boxes, and the validation tests cover the
asymmetry using the exact plus code that surfaced the ruling.

### 2026-09-04 — restore the sponsor-tier logo ladder

Sapphire and topaz sponsor logos rendered at the same visual size, defeating
the point of tiered branding. The uniform-tile change (2026-08-31) fixed
`height: 56px` on the base `.sponsor-card__logo`, but the per-tier overrides
stayed `max-height` — and a max-height of 84px or 64px cannot raise a fixed
56px, so the ruby and sapphire caps were silently inert and only topaz's 44px
still bit. Even that 12px difference read as nothing, because the topaz logos
are the widest (up to 4.17:1) and under `object-fit: contain` they drew as
wide as or wider than the squarer sapphire marks.

The per-tier rules now set `height` instead (with a comment on why
`max-height` can't work there), restoring the descending ladder: emerald 140
(spotlight) > ruby 84 > sapphire 64 > topaz 44 > quartz (no logo). Measured
headless after the fix, drawn fixture logos step 118×59 > 104×52 > 64×32
across ruby/sapphire/topaz, and each live sapphire logo now draws with more
area than every topaz logo.

### 2026-09-04 — the venues list, and where to see each act

Every performer's bio now ends with "See them at Midway Saloon on Friday,
October 2 at 5:00 PM.", joining the event's `venue_id` against the venues
array in the same `content.json` fetch. `start` is read field by field and
the `Date` built from those numbers: `new Date("<string>")` parses by engine
and timezone, while a date built from components names the same weekday
everywhere.

The organizers' venues page renders the same way — one accordion item per
venue, address then description then link, `#venue-<id>` deep links on the
same slugs the app routes on. Rather than fork this much DOM surgery, the
script now carries two dataset adapters and picks one from the filename it
was loaded under (`data-embed` on the tag overrides; an unrecognized value
fails closed), and `site/js/venues-embed.js` is a byte-identical committed
copy of `performers-embed.js`. Nothing generates that copy, so
`tests/embed-twins.test.mjs` fails when the two drift, with the fix in its
message. CONTRACTS.md's embed section (retitled "Squarespace embed contract")
now covers both embeds; README carries the venues paste, the `data-embed`
override and the copy step.

Deployed and pasted the same day (after a sheet fix: a stray `5` in the
venues tab's `id` header cell failed the build exactly as designed, and the
validation email path got its first real exercise). Both pages verified live
by Anthony: midwaymusicandart.org/performers and /venues.

### 2026-09-04 — first live paste, and the invisible-bio fix

Anthony pasted the stub and the page rendered — settling the last open
platform question (the plan does execute code-block JS) — but every bio
paragraph was invisible while keeping its space. Cause, confirmed by probing
the live page: Squarespace's scroll-reveal animation holds elements at
opacity 0 under a `preFade` class until its engine reveals them, and the
engine only tracks elements present at page init, so generated paragraphs
inherited a pre-state that could never fire. The script now strips animation
state from everything it generates (see the embed contract); verified visible
on the live page after deploy.

### 2026-09-04 — the lineup, rendered on the organizers' own website

`site/js/performers-embed.js` renders the performers list on
www.midwaymusicandart.org from this site's published `content.json`, so the
events tab feeds both the app and the main website and neither drifts.
Squarespace is edited once — an accordion block with one placeholder item and a
one-line code block — and never again for content. README carries the paste
procedure and the first-load checklist; the binding interface is the new
embed contract section in CONTRACTS.md (now "Squarespace embed contract",
covering both embeds); the definition is
`definitions/performers-page.md`.

Two facts about the Squarespace side came from reading the live page and its
accordion bundle rather than guessing. The bundle binds a click handler to each
item at init and does not delegate, so items cloned from the authored one are
inert under Squarespace's JS — which is why this script carries its own
open/close, a copy of the bundle's `setItemOpen` down to the 250 ms curve and
the offscreen height measurement, guarded with `stopImmediatePropagation` so a
click cannot double-fire if that ever changes. And Squarespace emits the leading
divider on the first item only, so cloning it onto every item would double the
rule between them; the script strips it from all but the first.

The constraint that shaped everything else is that the authored page must
survive our failure. Every step that can fail happens before any DOM is touched
and the swap is one synchronous batch, so a bad deploy shows the organizers'
placeholder rather than half a lineup. A test asserts the block's `outerHTML` is
identical with the script failing and with the script never loaded at all.

The script sits in `site/`, so the service worker precaches ~15 KB of it (mostly
comment) onto every attendee phone for a page the app never opens — accepted
rather than special-cased; a second deploy path would cost more than the bytes.

Verified in Chromium against the live page: items render with the organizers'
own type, dividers and icons, open and close natively, and deep links work.
Still unverified is whether the Squarespace plan executes code-block JS at all;
that is settled the moment the stub is pasted.

### 2026-09-04 — events.url promoted to the validated schema

Promoted the events tab's existing `url` column (performer/act website) from an
ignored notes column into the schema: required header, optional value,
validated and bare-domain-completed by the same code path as
venues.url/sponsors.url, emitted on every event in content.json ("" when
blank). It feeds the performers page above; the festival app itself still
ignores the field. Verified against the live sheet's actual url cells via the
snapshot before landing: 24 of 34 events carry one, 9 needed bare-domain
completion, 0 failures. site/js/ untouched by design.

### 2026-08-31 — the sheet's real events and sponsors, and a build that bends to meet them

Pointing `events` and `sponsors` at the live sheet failed the build with two
header errors hiding 165 row errors across 39 rows. Almost none were content mistakes: they
were Google Sheets emitting `10/2/2026`, `6:30:00 PM`, `all ages` and `Topaz
(Community Partner)` where the build demanded `2026-10-02`, `18:30`, blank and
`topaz`. The ruling was that the build absorbs what the spreadsheet naturally
produces, extending what `normalizeIds` and `normalizeUrls` already did for ids
and links — a volunteer coordinator should not have to fight their own tool
into machine shapes. Dates are the one rewrite logged per row, because
`2/10/2026` is February or October depending on locale and nothing downstream
can tell a misentered date from a correct one; the log is the only place a
misread becomes visible. Times are rewritten silently — a 12-hour clock carries
no such ambiguity, and 34 more lines would bury the ones that matter.

`end_time` became optional, defaulting to one hour. That hour comes from the data, not from
convention: Midway Saloon, Turf Club, Sundin and Ginkgo
all run exact 1-hour slots, and the only four events that run longer are the
only four carrying an explicit `end_time`.

Sponsor logos now resolve by convention — `content/logos/<slugified id>.<ext>`
— instead of a filename in the CSV. All nine placeholder sponsor logos were
already named exactly `<id>.svg`, so that column had never carried anything but
the extension. The `https://` remote-logo form went with it, deleting the
snapshot's entire logo half, and `content/fixtures/logos/` moved to
`content/logos/` since real sponsor logos are not fixtures.

A source can now be declared intentionally empty with `null` in
`content/config.json`, which is how vendors ships as an empty list. The guard
against an *accidentally* emptied tab — a header with no data rows — stays
strict. The difference is intent recorded in config, and only a literal `null`
counts: an empty string or a missing key is still a missing-source error, so a
typo that clears a path cannot be mistaken for a decision.

Two sponsor logos needed work before they could sit on a light card. Ideal
Printers publishes no light-background variant: its "PRINTERS" wordmark and the
registration target inside the "d" are both white, measuring 1.08:1 against the
card and rendering the "d" as a broken glyph. It now sits on the same `#333`
plate the sponsor uses on their own site, at 12.6:1. Old National Bank arrived
as a JPEG with a baked-in white rectangle that showed as a box on the card; it
is now a transparent PNG, converted by min-channel unpremultiply so antialiased
edges keep their smoothness instead of gaining a white fringe.

Logos also stopped rendering at natural size. Aspect ratios across the five real
ones run 1.66:1 to 4.17:1, and the wide ones hit `img { max-width: 100% }`
before the 48 px height cap, drawing 34–38 px tall while the others got 48 — so
aspect ratio, not tier, decided how prominent a sponsor looked. Every logo now
occupies the same 56 px tile over a white plate, which also lets Ideal Printers'
dark artwork read as that sponsor's mark rather than as a layout mistake.

The organizers cleared the two content errors this work depended on: the `kind`
column, which a broken formula had made a verbatim copy of `venue_id` on all 34
rows, and the `#REF!` in row 23.

Confirming that took three tries and turned up something worth knowing:
Google's published-CSV endpoint serves several versions of a tab at once. Eight
consecutive fetches of the same URL returned three distinct files — one with
`kind` still broken and the `#REF!` present, one with `kind` fixed and the
`#REF!` still there, one with both fixed — and the oldest came back on three of
the eight. Only fetching repeatedly and comparing showed which version was
current; a single fetch looks authoritative and is not. The redirect target
carries `cache-control: private, max-age=300`, but the disagreement is between
edges rather than within one cache, so a retry can move backwards as well as
forwards. What that means for build determinism, for deploys and for the
snapshot is open work in BACKLOG.md.

The banner no longer says the schedule is placeholder, because it no longer is.

### 2026-08-23 — venue and sponsor names label their pins at close zoom

The BACKLOG idea from earlier today, shipped as the always-on variant at
Anthony's direction, extended to sponsor pins: from the leader zoom inward,
venue, featured-destination and generic sponsor pins carry their name beside
the diamond, in the pin's own hue over a paper halo (6.77:1 / 6.61:1). Names
take none of the pins' overlap escape hatches — the collision pass hides the
ones that don't fit (visible in practice: the two displaced groups' names
give way to each other right at the leader zoom and appear a level in) — and
displaced venues' names ride their lanes, anchored on the outward side, since
a name at the true coordinate would label empty paper and a coincident pair's
names would collide down to one.

Two non-obvious pieces. First, the visible pin layers now REGISTER their
collision boxes (`icon-ignore-placement` off, invisible halo layers
excepted): pins still always draw, but names and street labels placed after
them can no longer land across a diamond, a number or a leader line — which
also makes the old comment about the baked-in leader line being
untrespassable actually true. Second, label offsets must clear the pin's
collision box, not its drawn shape: the box is the whole image rect (bleed,
the generic sponsor pin's stroke) plus the engine's default 2 px icon- and
text-padding, and an offset measured to the diamond is rejected by the very
collision pass that places the label — every name silently vanishes.
Transit stops stay unnamed: their pins already say what they are.

New `tests/map-name-labels.spec.mjs` pins the layer gating, the
no-allow-overlap posture, the box registration split, and both names of the
fixtures' coincident pair rendering at once (impossible if labels sat at the
shared coordinate). Full suite green; verified visually at 375 px.

### 2026-08-23 — deployed regression: collision zooms now frame-independent

The QA round below shipped and Anthony's desktop still showed the 6/10 and
12/14 stacks at zoom 14 with the A-line stop under pin 2. Two data-dependent
flips between what was validated and what deployed. First, **the live sheet
had changed**: Hamline Park's point moved ~77 m (it no longer shares Mosaic on
a Stick's coordinate — the fixtures, snapshotted earlier, still have them at
0 m), and the sheet is mid-edit (four new venues with incomplete rows, which
currently fail `npm run build`'s validation — a push cannot deploy until the
rows are finished). Second, and the real defect: **the split zoom was derived
from the device's frame width**, so a 560 px desktop frame computed split 15
and decided group membership there, where 77 m no longer qualifies as
"cannot draw apart" — phones computed 14 and grouped the pair. Every sim and
test had run against fixtures (0 m pair) at widths where the numbers happened
to agree.

Fix: collision-behavior zooms (cluster release, split, leader zoom) now
derive from a fixed 375 px reference frame (`PIN_GEOMETRY_REF_PX`) — pins are
constant CSS pixels at a given zoom on every device, so collision behavior is
a property of the venue set, not the screen; only the view zooms (extent,
home, closest) still read the real frame. The split lands at 14 everywhere,
membership at 14 groups {6,10} and {12,14} on the live coordinates and on the
fixtures alike, and both conflicted stops displace. The leader-zoom guard's
cluster-release model also moves from continuous to integer tile zooms
(supercluster builds per tile), which stops it rejecting states that never
render; the one-level-out attempt is now rejected on real geometry (two
ungrouped venues would draw 33 px apart at 13) identically on every frame.
Verified against the deployed live content.json at 700 px and 375 px
viewports: leader zoom 14, four leader pins, two displaced stops, zero stacks
at 14.2 — plus the fixture suite, and a new test pinning that the leader
treatment is identical across frame widths. BACKLOG gains the residual gap:
CI validates against fixtures while collision outcomes ride the live sheet.

### 2026-08-23 — map QA round: legend order, earlier leaders, route 67 bridge, cross-type spacing

Four fixes from Anthony's pass over the deployed site. **Legend** now leads
with festival content — venue, featured destination, sponsor — ahead of the
transit entries (order pinned by test). **The displaced-pin treatment starts
one whole zoom level outside the split** where it provably fits: membership is
still decided at the ~1200 m split, and `leaderStartZoom` adopts the wider
level only after checking every drawn pin pair across the entire displaced
range — analytically, not by sampling, since static lane offsets make drawn
distance non-monotone in zoom (piecewise linear in the scale factor: endpoints
plus the kink where offset and true separation cancel). A 560 px frame adopts
it, so leader pins now cover the band where the 6/10 and 12/14 numbered
stacks used to sit; phone frames reject it (their two groups' diamonds would
land 21.7 px apart against the 38 they need) and keep the split — phones are
unchanged. A consequence on both frames: the pairs never render as their own
numbered two-stacks with this venue set (below the leader zoom the two groups
merge into one anonymous stack), so the picker is reachable only in the
display-zoom sliver just under the leader zoom where a stack's expansion zoom
falls within the tap epsilon; the stack tap otherwise zooms straight into the
leader band. Both paths tested; the numbered-stack glyph still serves
transient pairs like 1/4.

**Route 67** drew with a 441 m hole at the Franklin Avenue bridge: OSM
relation 2449177 is missing that span upstream — live Overpass has the same
115 members, so refetching cannot fix it. The seven cached highway ways that
chain the approaches now complete the line (`BUS_ROUTE_GAP_FILL` in the
generator, which warns when upstream gains the bridge); a unit test asserts
route 67 stays one connected piece.

**Cross-type pin overlap**: a transit stop whose pin cannot clear a venue pin
anywhere from the leader zoom inward now draws displaced with the same
dot-line-diamond treatment — small-pin lane (43 px), letters riding the
diamond, tap and halo included, the venue itself never moving. With current
data that is Snelling & Minnehaha (east, clearing Ginkgo) and Hamline Avenue
(west, clearing Black Garnet), the same two stops on every frame width.
Sponsor pins join the clearance checks but none needs a lane (nearest
sponsor–venue pair is 368 m; see BACKLOG for the live-sheet caveat). Below the
leader zoom small pins may still tuck under venue pins — ordinary map
generalization: the venue wins the space by paint order, and every current
cross-type pair resolves by ~z15 against a max zoom near 18.

### 2026-08-23 — coincident venues: numbered stacks wide, leader pins close

Shipped per `definitions/coincident-pin-presentation.md`'s ruling — the (b)+(c)
composite with (a)'s leader honesty, since MapLibre's collision handling hides
symbols rather than displacing them and the offsets had to be hand-rolled
anyway. A ~1200 m view, **rounded to a whole zoom level** (a layer filter reads
`zoom`, which the engine evaluates only at integer zooms — fractional splits
briefly drew both treatments), divides the two: wider, venues that can't draw
apart stack as the cluster glyph now carrying **both members' key-list numbers**
(`labelMin`/`labelMax` aggregation, since supercluster guarantees no leaf
order; numbers at exactly two members, the anonymous glyph past that). From the
split inward each member draws its own numbered diamond displaced east–west
into a lane, with a dot at its true coordinate and a line joining the two —
dot, line and diamond are **one canvas image per lane**, so no label can cover
the line. Displaced pins come from a new unclustered `venue-groups` source;
their tap halo is a symbol whose ring is baked at the same offset (a circle
layer would ring the dot, i.e. empty paper). Taps measure to the **drawn**
diamond, which closes the 2026-08-11 bug where one Hamline Park venue could
not be tapped at all — pinned by a test that fails with "opened the wrong
sheet" when the offset is removed. Leader colors `--map-leader-dot` (6.77:1)
and `--map-leader-line` (4.77:1) against the paper.

Two knowing deviations from the definition's text: its "34 px apart against a
28 px pin" arithmetic used the old pin size (pins are 38 px), so the ~14 m pair
never actually separates below max zoom — it keeps leader treatment across the
whole displaced range; and member numbers stop at two, not three, because a
third needs an ordering supercluster doesn't provide for legibility the
definition itself called marginal. Watch item: the tightest venue-pin pair in
the displaced range is 39.06 px against 38 px pins on a 343 px frame — ~1 px of
clearance, a property of the current venue set (limiting pair is the
pre-existing venues 1 and 4); the overlap test runs at 560 px and 375 px
viewports for exactly this reason.

### 2026-08-23 — bus route lines: A, B and 67 drawn from a refreshed cache

Shipped per `definitions/bus-route-lines.md`'s ruling (option (a)): the main
OSM cache was refetched once with a `route=bus` relation clause scoped to refs
A/B/67/72 and `network="Metro Transit"`, and `make-map-geojson.mjs` now emits
`kind: "bus-route"` LineStrings (`ref` + `class`: `brt`/`local`) that one
`bus-route` layer draws above the street fills, beneath rail, colored by class
(`--bus-route-brt` #59595f at 5.99:1 against the paper, `--bus-route-local`
#63478a at 6.46:1). Two legend entries, refs named, swatch-matches-paint test
extended to both. No `minzoom` — width (1.2/2.5/5 px vs rail's 2/4.2/9) and
muted color carry the subordination; judged on device later (see BACKLOG's
device checklist).

**What the map actually gained:** A and B both directions, **67 eastbound
only, 72 nothing** — OSM carries no `route=bus` relation for 72 anywhere in
the metro and only one direction for 67, verified with an unscoped diagnostic
query. **Shipping without 72 is accepted, not owed** (Anthony, 2026-08-23) —
no follow-up item. All four stay wired in the query and class map at zero
carrying cost, so if OSM ever gains the relation it flows in on the next
refresh, and only then does the legend string gain "& 72" back. Relation
`network`/`operator` tags were verified as Metro Transit in the fetched cache,
per the acceptance criteria.

**Costs, measured:** gzipped `map-vector.geojson` 306.8 KB → 329.1 KB
(+22.3 KB, under the 30 KB budget — no bbox clipping needed). The wholesale
refetch also brought upstream street drift: 2,564 → 2,662 street features,
accepted by the ruling. `map-calibration.json` byte-identical; generator
deterministic across two runs (hash-checked).

### 2026-08-23 — web share: Share buttons + the `#/venue/<id>` route

Shipped per `definitions/web-share.md`'s 2026-08-23 ruling. Share buttons
(`[data-testid="share-btn"]`, `btn btn--secondary`, sheet.js's SHARE_GLYPH) on
event detail, the venue sheet, and the new `#/venue/<id>` route: `navigator.share`
where present, clipboard + "Link copied" toast otherwise, AbortError treated as
a silent cancel. Payload is `{ title, url }` — url is `location.href` with the
hash swapped in and `?t=` stripped, never a hardcoded origin.

`#/venue/<id>` renders like `#/event/<id>` (route announcer "Venue detail",
per-route title, back via `getLastListRoute()`, not-found state linking to
`#/map`), built from `sheet.js#buildVenueDetailHtml`, a builder now shared with
`openVenueSheet` so there is still exactly one venue detail builder. **One
deliberate divergence:** the sheet lists only today's events at the venue; the
route lists every festival day, grouped by day, since a shared link may be
opened days early. Nothing else differs between the two surfaces.

A resumed session should know: id-rename exposure for `#/venue/<id>` links is
accepted per the ruling (degrades to not-found, never a blank page) — the
build-time changed-id check that would catch the rename earlier is still a
BACKLOG item, not built yet.

### 2026-08-22 — pin numbers in the wrong font on Safari: a bare "Bold" is a font

Reported from Safari/macOS: the digits on the map pins were not the digits on
the venue cards below them. This is the same defect as the "serif digits"
report of 2026-08-11, which 19a8ae2 could not reproduce because it was looked
for on Chromium.

MapLibre reads the label weight out of the FIRST family name in `text-font`
and then hands the whole stack, weight word included, to a canvas as a CSS
`font-family`. The stack led with a bare `Bold` (and `Semibold` for the
smaller labels) on the assumption that a style word is not a real family and
would fall through. On WebKit it is one: CoreText matches bare style words
against face names, so `Bold` resolved to a real face — 277.4 units/digit
against `system-ui`'s 299.5, measured in Playwright WebKit on this Mac — and
`system-ui` and everything behind it was dead code. Blink resolves none of
those words, which is exactly why the report only ever came from Safari, and
why the two rounds of work in August fixed real problems in the stack behind
the weight word without touching the thing shadowing it.

`MMAF Bold` / `MMAF Semibold` fixes it: still a `\bbold\b` match for the weight
sniff, resolves nowhere on either engine. Verified by screenshot diff under
WebKit — before and after differ only inside the map frame, and the after
digits match the key list's.

The test already asserted the right relationship and still passed, because it
runs on Chromium where the bug is invisible. It now also asserts, for every
`text-font` in the style, that the weight word is not a bare style word (a
static check, so Chromium CI catches a regression) and that it measures as an
unresolvable family (a live check, so an engine that resolves some other word
is caught too). Both fail against the old stack on both engines.

A WebKit lane in CI would not have caught this: the resolution is CoreText's,
and CI is Linux. What catches it is running the suite against WebKit on a Mac,
which is now a BACKLOG line. That run is not clean today — 9 of 88 fail, all
in the service-worker/offline group, and the one checked fails with "WebKit
encountered an internal error" on an offline navigation, i.e. the Playwright
harness rather than the app. The font test passes there.

### 2026-08-22 — a deploy can now publish around bad rows, without banking them

Deploy gained a third dispatch checkbox, `skip_invalid_rows`: fetch the
sources live as usual, publish the rows that validate, leave out the ones
that don't. It answers the incident below — four incomplete venue rows have
held the live site at 14 venues since 2026-08-11 — where the only choices
were a red build or a sheet fix nobody could make yet. It is dispatch-only
by construction: a push cannot set an input, and the cron rebuild does not
offer it, because a cron that silently drops rows is the same silent
failure in a new costume.

The flag is `build.mjs --skip-invalid-rows`, and the design turns on where
the line between "a bad row" and "a broken file" sits. Structural problems
still fail: an unreachable source, a renamed header column, an emptied tab,
a bad config. Skipping is for rows, and an outage remains `--use-snapshot`'s
job — otherwise this becomes a second, quieter way to publish through one.

Four decisions worth the ink:

- **Each validator runs twice** — once to learn which rows it objects to,
  then again over the survivors. The second pass is what makes the output
  trustworthy: nothing reaches `content.json` that a validator hasn't
  approved as it stands. It should always be silent, and anything it does
  report still fails the build.
- **A dropped venue takes its events with it.** Events resolve against the
  venues that survived, so the foreign key holds in what ships rather than
  leaving cards pointing at a venue the app never received. On the current
  fixtures, dropping one venue drops six events with it.
- **A source cannot be emptied one bad row at a time.** If every row of a
  tab fails, the build stops — the same call `validateSourceShape` already
  makes for a tab that arrives empty, for the same reason.
- **A bad logo costs the logo, not the sponsor** (Anthony's call). The row
  is sound; a sponsor is likelier to want to appear without a wordmark than
  to vanish over an oversized file. This is the one place the mode ships a
  row the strict build would refuse, when the tier required a logo.

`--write-snapshot` and `--skip-invalid-rows` are refused together, in
`build.mjs` rather than only in the workflow: the snapshot is what
`--use-snapshot` spends on the assumption that everything in it once passed
in full, and a run that knowingly published less must not become that copy.
The workflow drops `--write-snapshot` in the same branch that adds the skip
flag, so the refusal is unreachable rather than a way to fail a deploy.

Nobody is emailed. The run itself carries it: `SKIPPED n invalid row(s)` in
the build log, a warning annotation, and the dropped rows in the job
summary — the pattern the stale-content fallback already uses, and the
operator who ticked the box is watching. `--report` gains `skipInvalidRows`
and `droppedRows` for the workflow to read.

Row-level errors now carry the row they came from (`errorMsg` returns
`{ rowNum, message }`), which is what makes any of this possible; file-level
errors stay bare strings and are, by that fact, the ones no row can be
dropped to answer. Suite green: 143 unit (16 new) + 88 Playwright.

### 2026-08-22 — star restored to its place; category chips dropped; dead CSS out

Anthony caught the color-scheme agent's one structural liberty in the
final screenshots: the star had moved inside the event tile. Reverted
(76f91df) — card chrome back on `.event-row__link`, the star its own
borderless control outside the card, per both the pre-change code and
the 2026-08-08 QA ruling against boxed row stars, which the agent cited
to decline the coordinating session's mistaken instruction to add a
panel-and-border treatment. Two rulings landed with the revert:
by-category rows drop the kind chip their group heading repeats
(223f584, vendors-view precedent), and the dead kind CSS went
(7329738 — family/community tokens and rules, vendor type-badge
classes). The day-prefix gold stays, as ruled. Suite green at 130 unit +
88 Playwright, agent-run and independently re-run. Process note,
recorded deliberately: implementer judgment calls that alter approved
design get surfaced as questions before acceptance — the rule fired in
both directions today, once against the agent's liberty and once
against the coordinator's.

### 2026-08-22 — white-on-gray color scheme, kind-tinted event tiles

The main-site alignment Anthony requested landed as five commits
(f2f08c0..e3a5eca) from a dispatched agent: page white, panels `#f6f6f6`,
neutral borders, eight kind-tint tokens (six distinct colors) tinting
every event tile through a row-level `.kind-tint--<kind>` class — sheet
event lists included — and every chip (kind, age, vendor) outlined rather
than filled, ruled by Anthony from rendered mockups on the ground that
nothing on a tile may compete with the title. Three inks darkened
globally to hold contrast on the tints: muted text `#5a6b74` → `#4b5962`
(worst pair 5.73:1, clearing the ≥5.5 floor Anthony set after calling the
original drab-and-marginal; the agent rejected the suggested `#4d5b64` as
another rounding-error pass at 5.56), the cross-day prefix `#a05f00` →
`#8f5400`, the unsaved star `#7c878e` → `#727c84`. The tile became the
row container so the star shares the tint; CONTRACTS' contrast clause now
names the tints as tile backgrounds. Suite green at 130 unit + 88
Playwright with the axe gate, verified independently in the coordinating
session; forced colors verified improved (outlined chips keep a visible
boundary where filled ones used to lose their fill). Follow-ups and two
open aesthetic calls are in BACKLOG's color-scheme item; the full
contrast table is in the agent's report.

### 2026-08-22 — pre-push review: two blockers fixed, pipeline hardened

A Fable reviewer ran inversion-framed over the six implementation commits.
Two blockers, both fixed: the rebuild job's explicit permissions zeroed
`actions:`, so the gate's run-listing could 403 and every cron would
decline inside a green run — a silent content freeze (one line:
`actions: read`); and the gate wrote its reason to GITHUB_OUTPUT
unflattened, so a newline-bearing filename could inject `publish=true`
(now single-lined at the write site). Also taken: `.github/` joined the
gate's publish-affecting paths, the organizer email now says a failed code
deploy needs its own re-run, snapshot meta sorts by codepoint rather than
locale (cross-platform determinism), and curl config values flatten
newlines. Checked and clean: interpolation discipline (every `${{ }}` in
`if:`/`env:`/inputs, none in `run:` bodies), secret handling, the push
step, gate vs acceptance criterion 4, determinism on all three paths.
Reviewer's bottom line was push-after-fixes; the fixes are in and the unit
suite is green over them. The reviewer's remaining recommendation — invert
the gate's path list to an allowlist of known-inert paths so it fails
closed on future build-input additions — Anthony ruled for the same day,
and the inversion landed with a test proving unenumerated paths decline.

### 2026-08-21 — agent report recovered; live content pipeline failing since 08-11

The implementation agent's lost report was recovered by messaging the idle
agent. Its deviations — notably a path-scoped gate rule (`site/`,
`scripts/`, `content/` minus the snapshot) replacing the strict "nothing
outside `content/snapshot/`" test, which would deadlock on this repo's
`[skip ci]` doc commits — plus the gate-spike results, a ten-step first-run
checklist, and residual risks are now sections in the definition.
Re-verifying the report's sheet finding uncovered a live incident: the
organizers have added four venue rows (16–19) with eight required cells
empty, every build since 2026-08-11T19:31Z fails validation, roughly forty
consecutive cron runs have failed unnoticed, and the live site's venues are
frozen at 14 — ten days of exactly the silent failure the deploy-robustness
work exists to end. The fix is sheet-side; BACKLOG's Content section
carries it with the post-push email-cadence note.

### 2026-08-21 — venue-popup ruled: do nothing, deferred with the definition as the bar

Anthony ruled on `definitions/venue-card-map-popup.md`: no felt problem —
the popup was an idea, not a response to friction — so the `<dialog>` sheet
stays the single venue surface. The teaser variant is revisited only if pin
browsing still feels heavy on a real phone with the landed tapped-pin
highlight and key-list recentering, and any attempt must meet the
definition's acceptance criteria. Desktop-only hover teaser ruled out.
Rulings recorded in the definition; BACKLOG dropped to three definitions
awaiting rulings.

### 2026-08-12 — deploy robustness implemented: six commits, still unpushed

The dispatched agent implemented the ruled definition in six commits
(a958ad3..221886d) and, per its brief, never pushed; a session pause also
swallowed its final report, so this entry was reconstructed from the tree
on 2026-08-21 (the report was recovered later that day — its deviations and
checklist are folded into the definition). What landed: snapshot write and fallback plus failure
classification in `scripts/build.mjs`; `.github/scripts/content-gate.mjs`
and `notify-failure.mjs`; `rebuild-content.yml` reworked into the zero-npm
content publish with the two-part gate and skip-if-unchanged; `deploy.yml`
gained the `use_content_snapshot` and `skip_tests` dispatch inputs, the
lockfile-keyed npm cache, staleness marking and the snapshot commit step;
README playbook, CONTRACTS snapshot contract, CLAUDE.md's two-copies
venues wording (ruling 6). The merged tree's full suite was re-verified
green on 2026-08-21: 129 unit (44 new) + 88 Playwright, exit 0. Push and
the first-run inspection checklist remained — the push landed 2026-08-31; the
checklist is tracked in BACKLOG under "Pushed — first-run verification still
owed".

Anthony ruled on `definitions/deploy-robustness.md` in session. The
recommended package stands: committed `content/snapshot/` refreshed by every
successful publish, opt-in `use_content_snapshot` fallback (cron never falls
back), operator-only staleness, the zero-npm content-only workflow guarded
by the two-part last-tested-code check, bot commits plus job-scoped
`contents: write` accepted, snapshot and fixtures kept as distinct jobs. Two
rulings went past the recommendation: npm-down code deploys get both the
lockfile-keyed npm cache and an emergency `skip_tests` dispatch input, and
failure notification entered scope — Fastmail SMTP app password + curl
(npm-free, best-effort, `if: failure()`), Anthony on every failure,
organizers only on sheet validation failures, the class their own edits
cause and fix. Anthony's counter-proposal to keep tests in the cron path was
priced and declined — it is today's architecture and re-couples content to
npm — but its good half was adopted: the cron now skips deploying when
fetched bytes match the snapshot. Rulings and both additions are recorded in
the definition; BACKLOG moved the item to a new Ready-to-build section.

### 2026-08-11 — execution pass: three bundles landed, five definitions written

An orchestrated pass over BACKLOG's well-defined items, run as parallel
worktree agents and merged in sequence. The suite on the merged tree is green
at 85 unit + 88 Playwright, axe gate included.

**Content path.** The bare catches narrowed to the awaited fetch alone, in
both the worker's `revalidateContent` (via `scripts/sw.template.js`) and
`store.js#refreshContent`: offline still degrades quietly to last-known-good,
while any other throw — the class that silently disabled revalidation for the
feature's whole life — now surfaces. A new spec replays the historical
consumed-body case against the live worker and was proven red pre-fix. This
changed the service worker, so the airplane-mode pass is owed.

**App.** The Now view's live redraw patches its two lists in place — rows
keyed by event id, departed nodes removed before survivors are matched, since
moving a node blurs focus — with a fake-clock test walking a focused star
across the 13:45 boundary; wholesale replacement remains only for whole-state
transitions, where nothing persists. Forced colors: `SelectedItem` restates
the day-tab and group-by state, and the nav bar's active link (the same
defect, found in passing) gained an underline. Every route sets its own
`document.title`. The seven external links announce "opens in a new tab".
`scroll-padding-top` keeps focused rows out from under the schedule's sticky
controls — the test had to Shift+Tab its way down, because programmatic focus
scrolls to center and hides the bug.

**Map.** Every pin now has a keyboard path: a visually-hidden button list
built from the same pre-filtered subsets the pin layers draw, so list and map
cannot disagree, with focus handing into sheets and back. Tapped pins
highlight via `feature-state`; venue cards act like pin taps (`easeTo`,
jumping under reduced motion). A d-pad drives `map.panBy` — 34 px buttons,
which is what fits eight controls into a 288 px frame, clearing the 24 px
floor with spacing. A `ScaleControl` with a contrast assertion. Legend
swatches are `calc()`ed to pin size. Venue pins grew 28 → 38 px — **1.73×,
an accepted deviation from the guide's 2×**, recorded in CONTRACTS with its
measurement: the tightest venue-pair separation across frame widths is
39.2 px, 44 px diamonds provably collide, and clustering cannot buy the room
back. The figure is a property of the current venue set; re-measure if the
sheet gains venues. The locate-denial toast names Safari's website location
settings and lingers longer. Key-list buttons carry "Venue N" in their
accessible names. And the label font stack, which led with Apple-only
families (non-Apple engines fell through to Helvetica), now leads with
`system-ui` — a real cross-platform fix, but *not* confirmed as the cause of
the serif digits Anthony saw on the iPhone, which never reproduced off the
device. On-device probe if they persist: set an `OffscreenCanvas` 2d
context's font to `'normal 700 48px ' +
__mmafMap.getLayoutProperty('venue-pin','text-font').join(',') +
',sans-serif'`, read `.font` back, and compare `measureText('8').width`
against the same string with `serif`.

**Definitions.** Five docs in `definitions/`, each through the write-doc
editorial flow; every open question is collected under Decisions in BACKLOG.
Deploy-robustness (the unmet build-robustness invariant), coincident-pin
presentation — whose research found the tap bug now in BACKLOG: exactly
superimposed venues break the tap tie on layer rank, so one is untappable at
close zoom — venue-card-as-popup (recommends do nothing), bus route lines
(A/B Line geometry is already committed; 67/72 need a query extension, not a
refetch), and Web Share with its `#/venue/<id>` prerequisite. The MapLibre
spike definition gained an outcome line so its non-goals stop contradicting
the shipped migration, and the two places claiming `transit.json` carries 64
stops (CONTRACTS, a map.js comment) now say 76, which is what it ships.

Process notes. The first run of the map bundle and two definition agents died
against the session usage cap and were resumed on cheaper models in the same
worktrees; the inherited venue-pin work claimed a clean 2× that measurement
disproved — the 1.73× above is the correction. CI then caught the font test
asserting more than is true off macOS (on the Linux runner the map's
`system-ui` resolves to DejaVu Sans while `app.css`'s pre-`system-ui` stack
falls through to Liberation Sans — different faces, neither serif); the test
now gates its same-face claim on the platform actually agreeing, and
CONTRACTS records adding `system-ui` to `app.css` as the open option.
Screenshot baseline recapture is owed: four visible changes, all inside the
map frame.

### 2026-08-10 — device-checklist results

Anthony worked through part of the real-device checklist on the iPhone.
Passing, and now off the BACKLOG list: the native `<dialog>` detail sheet
renders fine (with the caveat that the item never said what a failure would
look like), header scroll with the pinned control bar under real browser
chrome, multi-touch pinch zoom on the new map ("works great" — which also
closes the deferred genuine-pinch-test idea), the install path on iPhone, and
a single-letter transit pin rendering its letter on iOS — mooting the
never-reproduced Selby & Dale missing-"B" mystery, that stop having fallen
outside the pin radius anyway. Transit stop names and positions were verified
against Metro Transit's published Green Line / A Line / B Line stop lists.
The airplane-mode pass is recorded in the migration entry below; it stays on
the checklist as a standing gate for service-worker and caching changes.

### 2026-08-10 — the map is MapLibre

The `#/map` tab is drawn by MapLibre GL JS 6, vendored into
`site/assets/maplibre/` and loaded from there. The hand-rolled inline-SVG map,
its pan/zoom/counter-scale machinery and `map.svg` itself are gone; `map.svg` is
still generated by `tools/make-map.mjs`, but into a gitignored `artwork/`
directory that never ships. The ground is `site/assets/map-vector.geojson`,
generated offline from the same committed Overpass response the SVG was built
from — so both maps drew the same features and the audition was a fair
comparison rather than two different maps.

**It costs less than what it replaced.** Gzipped, the engine is 289 KB and the
vector ground 314 KB, against `map.svg`'s 707 KB: a net **104 KB smaller** first
visit. That is the opposite of what the August review's cost estimate implied,
and the reason the `map.svg` weight item closed rather than moving. The engine's
own figure landed on the review's ~289 KB estimate exactly. (All sizes here are
decimal KB, as the review's were.)

Three things the audition settled that reading could not. **Overlapping pins**,
the map's largest open item, are handled by clustering; two venues in the sheet
share a coordinate exactly, which no zoom can separate, so a cluster that cannot
expand opens a picker sheet listing what is under it. **Street labels** are
symbol layers, re-placed at every zoom instead of positioned once for the whole
map. And the **pan/zoom lag** item closed without ever being profiled: the
iPhone evaluation reported it smooth, which was the question the profile existed
to answer.

A four-corner `ImageSource` ground, standing in for commissioned artwork, was
auditioned alongside the vector one and not adopted; the two constraints it
measured are in BACKLOG's artwork entry.

The engine also removed a problem nobody had listed. MapLibre 6 draws text
locally with TinySDF when a style carries no `glyphs` URL — for every codepoint,
not just CJK — so offline-capable map labels needed no font infrastructure at
all: no glyph server, no committed SDF assets, and labels in the device's own
UI font.

Five things went wrong, and each looked plausible while being wrong. MapLibre's
world is 512 px wide at zoom 0, so the familiar 156543 m/px constant is one
level off and every view came out exactly twice as tight as intended — which
reads as "a bit close", not as a bug. OSM splits an avenue at every junction and
`symbol-placement: line` gets one attempt per feature per tile, so the map's
most important streets came out unlabelled until the generator began merging
same-name ways. Merging them naively then ran up one carriageway of a divided
road and back down the other, so the merge now takes the straightest
continuation and refuses joins sharper than 60°. Collision runs from the top of
the layer stack downward, so the two spine streets had to be listed *last* to
stop ordinary side streets taking their space. And a camera animation started
inside a `dblclick` handler is cancelled by the engine's own gesture processing
a moment later, so double-tap-to-go-home defers by a frame.

**The WebGL2 floor is accepted rather than worked around** (Anthony,
2026-08-10). Reviving the SVG map as a fallback and swapping to Leaflet were
both rejected — the first as two implementations to maintain, the second because
it lacks the per-zoom labels and vector styling the audition was largely about.
What ships instead is a graceful degrade: the view tests for WebGL2 *before*
importing the engine, so a device that cannot draw the map skips ~1.1 MB it
could never use and gets a short explanation in the frame plus the venue key
list, which carries every venue and its directions link. Tests reach that path
by stubbing `getContext('webgl2')` to null.

**Still outstanding:** transit and sponsor pins have no keyboard path to their
sheets, now that pins are canvas symbols rather than DOM nodes. In BACKLOG.

Everything else held. The whole suite passes — 85 unit and 65 Playwright —
including the offline acceptance test and the axe gate now scanning the real
map, and the build is still byte-identical across runs from unchanged sources.
The offline suite gained a cold-start case (a page that was never online, so the
worker is doing the work rather than a warm reload) and a negative control that
proves going offline actually severs the network; both were checked by breaking
them on purpose. Map tests drive the engine through a `window.__mmafMap` hook,
documented in CONTRACTS.

Deployed the same day (fast-forward `3480382..a5f715a`), and the acceptance
criterion passed where it counts: Anthony's manual airplane-mode pass on a real
iPhone in Safari, against the deployed site after one online visit — site and
map both working offline on the new precache.

### 2026-08-10 — audit decisions ratified; MapLibre adoption decided

Anthony ruled on the audit's open ends, and on the MapLibre spike from the
parallel session (`definitions/maplibre-map-spike.md`). The map keeps the AA
goal — and the engine swap is happening, so the remaining map failures became
requirements on the migrated map rather than fixes to the outgoing SVG one:
BACKLOG now carries an accessibility carry-over list and a post-migration map
re-audit item, and both map decision blocks read DECIDED. Transit-pin green
stays deferred until after the migration. The optional `logo_alt` sponsor
column is approved and tracked. Co-located venues (Mosaic on a Stick inside
Hamline Park) are ruled valid data — recorded in CLAUDE.md so sessions stop
flagging them, and the duplicate-location build-validation idea is dropped.

Also this session: the audit report gained an implementation-stage
corrections section (an F2 misattribution, a disproven no-wrap claim, a
phantom CONTRACTS citation), and the screenshot baseline was recaptured —
15 of 37 shots changed, every one attributable to the fixes since the live
sheet was byte-identical between captures (RECIPE.md updated).

### 2026-08-10 — WCAG 2.2 AA audit, and the cheap half of its fix list

The audit is `reviews/2026-08-wcag-aa-audit.md`: all 55 Level A/AA criteria
dispositioned — 24 pass, 10 fail, 3 wait on a real device, 18 don't apply —
against the site profile distilled into `reference/wcag-aa-site-profile.md`,
which is where future audits now start instead of the 512 KB spec. Nothing
found was expensive, and nothing was inherent to the hand-rolled SVG map.

Seven of the ten failures are fixed, one commit and one pinned test each. The
schedule's group toggle no longer widens the page at 320 px — it shrink-wrapped
its three buttons to 322 px instead of stretching into the 288 px available. An
event row's time may now wrap, so growing letter-spacing no longer prints it
over the kind badge beside it. `html` carries a `scroll-padding-bottom`, so the
fixed tab bar stops swallowing controls at the moment they take focus. The
manifest no longer locks an installed app to portrait. A saved row's star is
`--color-accent-dark` instead of a 1.9:1 near-invisible gold. The legend names
both rail lines, which until now differed only in hue — and the Blue Line,
having no station pin in range to carry a letter, was unnamed anywhere on the
page. And the attribution baked into the map artwork is gone from both the SVG
and its generator: at 2.90:1, scaling with the map instead of holding its size,
it rendered 1–2 px at the only zoom where it was on screen at all, while the
HTML attribution below the frame is the one people actually read.

An axe-core gate joined the suite — 11 scans over all seven routes plus an open
sheet, a settled toast, the by-venue grouping, and a starred list with rows. It
starts green with no exclusions. Scanning a toast mid-fade measures its text
blended with the map behind it, which reads as a contrast failure that isn't
one, so that scan waits for the transition to settle.

Two of the report's own claims didn't survive contact. Its text-spacing finding
was attributed to `.event-row__time`'s `nowrap` and measured as 76 px of
document overflow, but that overflow was the group toggle amplified by
letter-spacing; the nowrap defect is real and different — the time overflows
its own column and paints over the labels — so the pinned test compares element
overflow before and after the overrides rather than watching document width.
And the report's assurance that the time "never wraps anyway" at normal spacing
is wrong: two fixture rows take a second line at 320 px. An obscured badge is
the worse trade, so it landed; the screenshot baseline wants recapturing.

Not landed: the transit-green darkening, which moves a brand color and waits on
Anthony's ack, and everything gated on the map conformance decision — which the
report frames and recommends settling by bringing the map to AA, since the
lists-as-alternate-path option relocates the work rather than avoiding it. Both
are scoped in BACKLOG with their measurements, alongside the device checklist
and the content-pipeline items that need organizer coordination before any
validation can land. CONTRACTS.md's Accessibility contract absorbed what the
audit found it too narrow to say: non-text contrast, map SVG text,
rendered-pixel sizing for the large-text exemption, reflow and text spacing at
320 px, focus not obscured, no orientation lock, and target size with its one
known deviation.

### 2026-08-09 — the revalidation that never worked, and the last follow-ups

The four remaining review follow-ups landed as a fourth wave: the
content-update fix, Dependabot version updates (`.github/dependabot.yml`,
weekly, actions + npm), test-hook gaps closed (`data-testid` containers on the
Now view's two lists; the schedule's existing `data-day`/`data-group`
attributes and `.event-group__title` bound in CONTRACTS.md), and a `--root`
flag on `serve.mjs` so the SW-update spec spawns the real server instead of
carrying its own.

The headline: **stale-while-revalidate had never revalidated.** The BACKLOG
hypothesis (message posted before the page's listener attaches gets dropped)
was real but never reached — the worker threw first, every time. The fetch
handler passed the same `Response` to both `respondWith` (which consumes the
body to serve the page) and `revalidateContent`, whose later `clone()` threw
`Response body is already used` into a bare `catch` labeled "offline". So
`cache.put` never ran, `content-updated` was never posted, and content only
ever reached a phone via the next worker version's precache — a reload. Fixed
on both sides: the worker clones before handing the response over (these hunks
were authored and applied by Anthony — a tf-plugin guard content-sniffed the
template's line-1 banner as "generated file" and blocked agent edits; the
banner now lives in `build-sw.mjs` and is prepended to the generated `sw.js`,
where it is true), and `app.js` attaches its message listener at module
evaluation with a booted-promise gate. A four-way on/off matrix showed the
worker fix alone repaired the behavior on localhost by a 0.2 ms accident of
timing; the listener fix makes the ordering structural, which is what a real
phone parsing a larger content.json needs. The SW-update spec now asserts the
in-place refresh on the load that performs the update and was proven to fail
against both the shipped and half-fixed states.

Suite unchanged in shape (67 unit + 30 Playwright, green twice; the changed
sw-update spec 3× more). Twelve pre/post screenshot pairs byte-identical, so
the Now-view container hooks changed no pixels. The manual iPhone pass is
required before trusting day-of banners: airplane-mode reload, then the
in-place banner refresh on an open tab (both now on the device checklist in
BACKLOG).

### 2026-08-09 — review follow-ups: build hardening, app fixes, test coverage

The August review's follow-ups (`reviews/2026-08-code-and-test-review.md`)
landed in three agent waves, merged in order: build/CI integrity, app fixes,
then test coverage written against the merged result.

**The build now distrusts its inputs.** Column headers are validated — a
renamed or space-padded header is a build error naming both spellings, where
it previously blanked that field on the live site with a green build. An
empty tab, or an HTML body where CSV should be, fails the build. Settings keys
and values are validated against the known set. URL fields follow the same
normalize-don't-reject rule ids already used: bare domains are completed to
`https://` with a logged rewrite (two live venue urls rely on this today);
`javascript:`/`data:` schemes are errors. Sponsor logos are capped at 512 KB,
content-type checked, rejected if an SVG contains script-capable constructs,
confined to the logos dir, and named by sponsor id. The content fetch retries
transient errors under a timeout, and sw.js generation is immune to `$&` in
filenames.

**`npm test` is hermetic now** — `build.mjs` grew `--config`/`--out` flags,
tests build `site/` from fixtures and run fully offline, and the old
mixed-tree hazard (fixture content under a live-sheet sw.js) is gone; only the
deploy workflow touches the live sheet. The 14 copied `fixtures-bad/` dirs
became a generator (`tests/fixture-sets.mjs`) applying one documented mutation
each. GitHub Actions are pinned to commit SHAs with Dependabot-style version
comments (verified against the tags independently), and CI caches Playwright
browsers.

**App:** external links pass through a `safeHref()` scheme allow-list, and
`venues.url` — previously silently ignored — renders in the venue sheet. The
detail sheet is a native `<dialog>.showModal()` with a real focus trap, inert
background, and a `:has()`-based scroll lock (Chromium still scrolls behind a
modal dialog without it). Group-by buttons carry `aria-pressed` per the
contract. The Now view skips its 60 s redraw when the on-now/up-next sets are
unchanged, so focus survives the tick. `renderMap` cancels superseded renders,
caches the parsed SVG (one fetch across visits instead of one per visit), and
batches pan writes to rAF (30 pointer events → 1 viewBox write). One
`mapsDirectionsHref()` replaced four hand-built Maps URLs. Map pins are a
single roving tab stop (arrows move between pins when a pin has focus; the
svg keeps arrow-key panning). Each route has exactly one `h1`. A
`groupBy`/`groupSection` pair replaced six copies of the grouping idiom and
three near-identical CSS blocks.

**Tests: 45 → 97** (67 unit + 30 Playwright). The Now view's on-now/up-next
sets are asserted exactly at boundary instants: a shared 13:45 end/start
boundary proves end-exclusivity and start-inclusivity in one stroke, 16:59 vs
17:00 pins both sides of the two-hour up-next window including the per-venue
fallback, and 00:05/00:15 prove the past-midnight convention across a date
boundary. A real-clock test asserts the landing view in whichever era today
falls (with faked-clock companions for all three eras, so the post-festival
branch is proven before October). Also covered: day/group-by switching with
`aria-pressed`, banner re-show on a changed `banner_id`, a two-build
service-worker update-over-install test, the `mfc:starred` key pinned by
assertion, and double-tap zoom. The boot-retry spec got timeout headroom after
flaking twice under parallel-suite machine load.

The screenshot baseline in `reviews/2026-08-baseline/` was recaptured
post-fix; six shots changed, all explained (venue sheet website link,
sub-perceptual dialog-backdrop compositing, one pre-existing 6 px map-phone
environment diff).

Surfaced during the work and now in BACKLOG: a plausible dropped
`content-updated` message on boot (the urgent-banner path — hypothesis,
unconfirmed), missing test hooks for the Now lists and schedule controls, and
`serve.mjs` lacking a `--root` flag.

### 2026-08-09 — second QA round

The map was largely rebuilt. Its extent is now a **10-mile square centered on
Hamline Park**; the previous downtown-anchored rectangle left visibly torn
north and south edges, because Overpass returns a way's whole geometry whenever
it intersects the bbox, so some features ran past the boundary while others
stopped dead at it. Light rail now comes from OSM **route relations** rather
than `railway=light_rail` ways, which had swept in the Franklin Avenue
maintenance yard and drawn it as a hatched blob; Green and Blue now draw in
their own colors as one thick solid stroke instead of two thin dashed ones.
Labels gained **level-of-detail classes** (`lod0`–`lod3`, with `data-lod` set
on the root as the view widens) so a wide view keeps only the spine names
instead of 400. Pins, map labels and the location dot all **counter-scale** to
hold a constant on-screen size, rather than ballooning when zoomed in.

Pin hit targets became diamonds matching the visible shape, at roughly 1.26×
the pin radius — a diamond has area 2r² against a circle's πr², so matching the
radius exactly would have cut the tappable area by about a third. Dragging the
map no longer sweeps a text selection across every street name it crosses
(`user-select: none`, scoped to the map surface).

Event rows were restructured into two columns, text beside labels: as a top
line, a stack of two labels pushed the title and venue down, so rows misaligned
against each other. Event detail now repeats the row's own icons next to plain
language ("Free Ticket Required", "Must be age 21 or older"), and vendor cards
dropped the type badge that only repeated their group heading.

One regression worth remembering as a *class* of bug: `renderMap` kept a stale
reference to `original` (renamed to `full` when the view model was split into
extent and home view) inside the geolocation success callback, which silently
broke the "you are here" dot — the button simply did nothing. Paths behind a
device permission are reachable by neither the screenshot harness nor the old
test suite. They have coverage now, via Playwright's `setGeolocation`, and
`tools/shoot.mjs --geo lat,lng` can exercise them visually.

### 2026-08-08 — first QA round

Renamed the app to "Midway Music & Arts Fest" (manifest `short_name` MMAF).
Rebuilt the icons from the primary brand lockup, and added a separate "M"-only
PNG favicon because Safari renders the SVG favicon as a gray placeholder where
Chrome renders it correctly. Events gained an `age_limit` column
(blank/18+/21+). Ticket icons were replaced with the organizers' own artwork,
inlined as a `<symbol>` sprite so each row costs one `<use>` rather than a copy
of the glyph paths. The schedule's kind filter was removed — grouping by
category already isolates a kind without hiding the rest of the day. The page,
not `#view`, became the scroll container, so the logo header scrolls away while
control bars pin. Transit pins gained a detail sheet, and starred rows now
linger dimmed for a few seconds before leaving the list. `tools/shoot.mjs` was
added, rendering routes to PNGs so changes can be eyeballed without a manual
browser pass.

The live sheet also broke every build that day: a venue id of
`mamasmarket&deli` failed the `[a-z0-9-]+` rule, taking down CI and deploys
with it. Rather than widen the charset, `build.mjs` now **normalizes** ids
instead of rejecting them, applying the same slugify to `events.venue_id` so
both tabs agree however each was typed. It is deliberately a no-op for any
already-valid id, so a starred event or a shared `#/event/<id>` link can never
be invalidated by it. Only an id that slugifies to nothing, or two that
collide, still fail.

### 2026-08-02 — August feature round

Schema migration first: events moved to `date`/`start_time`/`end_time` (an
`end_time` earlier than `start_time` means past midnight and is valid; equal
times are an error), kinds became
`music|art|performance|literary|vendor|other`, and a `tickets` column arrived.
Sponsors moved to tier slugs (`emerald`–`quartz`, capped at 1 and 5) with an
optional location and no `tier_order` column. Then four parallel worktree
agents delivered schedule UX, the map redesign with transit and sponsor pins,
the vendors list view with the Support donate button, and the PWA
install/persist-storage work — followed by an accessibility hardening pass
covering route-change focus and announcement, sheet focus management,
`prefers-reduced-motion`, and a keyboard-pannable map.

The venues tab went live from the organizers' Google Sheet the same day, and
venue/vendor positions moved to a single `location` column accepting either a
decimal pair or a Google Maps plus code. The custom domain
`go.midwaymusicandart.org` was cut over; certificate provisioning stalled for
about four hours until removing and re-adding the domain retriggered it. A
transient CDN 503 during the cutover exposed how fragile a first, uncached
visit is — one failed module fetch kills the whole static module graph — which
is why `index.html` carries a boot guard that reloads with backoff.

### 2026-08-01 — POC complete and live

Repo made public, Pages enabled, deploy workflow green, live URL verified with
the service worker active and an offline reload rendering schedule, map and
pins.

## Standing mechanics

Deploys propagate through a service-worker version bump — `sw.js` is generated
with a hash of the site's bytes, so unchanged sources must produce a
byte-identical `content.json`, and `npm test` asserts that. `content.json`
additionally gets per-request stale-while-revalidate.

Append `?t=2026-10-03T15:00` to any URL to override the clock, so "On now" has
content outside the festival weekend. `gh` is authenticated as `amanfredi`, and
pushing to `origin main` is verified working.
