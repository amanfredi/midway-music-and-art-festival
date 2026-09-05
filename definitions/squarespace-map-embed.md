# Squarespace map embed & deliberate label collisions

Status: defined 2026-09-04 | Overall confidence: high

Two bundled pieces of map work: (1) embed the festival map on the main
Squarespace site (www.midwaymusicandart.org) as the same interactive
experience, right-sized and without app chrome; (2) replace the three
arbitrary label/lane collision mechanisms in the map with deliberate ones.
They bundle because the fix for "too small" is an app-wide desktop layout for
the Map view, and once the map renders at desktop widths as a first-class
layout, label behavior at those widths joins the acceptance surface.

## Problem & motivation

Today the umbrella site can only link out to go.midwaymusicandart.org: the
visitor gets a jarring nav/style change, and on desktop the map lives in a
~560 px capped column that reads far too small. The embed's job is the full
interactive map experience — pan/zoom, pin taps opening the venue sheet, the
venue key list below the map — feeling like part of the Squarespace page
rather than a teleport to a different product.

Separately, the deployed map's label behavior is arbitrary in three confirmed
ways (backlog, 2026-08-31, from Anthony's read of the deployed map):

1. **No `symbol-sort-key` anywhere in `site/js/views/map.js`** — when the
   collision pass drops a venue name, MapLibre falls back to source feature
   order, which is sheet row order. Which venue keeps its name is an accident
   of where the organizers typed it.
2. **Leader lanes always run east–west** — `coincidentGroups`
   (`site/js/views/map.js:296`) sorts each coincident group by longitude and
   lays members along a horizontal axis in `LEADER_LANE_PX` steps. Sound for
   groups that vary in longitude; degenerate for a north–south stack, which
   gets displaced along the axis it did not vary in.
3. **Horizontal-first anchors** — both name layers use
   `text-variable-anchor: ['left', 'right', 'top', 'bottom']`
   (`site/js/views/map.js:1563`, `:1584`), so a label tries both horizontal
   sides before above/below. Compounds with (2): a horizontally displaced pin
   carrying a horizontally anchored name reaches further sideways than either
   mechanism alone.

The mapping from each mechanism to what was seen on the deployed map is
**unconfirmed** — reproduction against named venues is the first step, but it
serves as before/after evidence, not as a gate (see Ledger).

Timing: the festival is Oct 2–4, 2026 — one month out. The collision fixes
change what renders on attendee phones, and there is no staging environment:
once the work verifies locally (tests plus capture evidence), it goes to
production. Verification carries the risk.

## Success criteria

- A page on www.midwaymusicandart.org shows the interactive map under the
  Squarespace header: pan/zoom, pin tap → venue sheet, venue key list below
  the map, no app header or tab bar. The visitor experiences no nav change.
- A desktop visitor to go.midwaymusicandart.org's own Map view gets a layout
  that uses the width well — no longer the small centered column — while the
  legend and venue key remain discoverable (not buried below the fold, which
  is why the 560 px cap exists; see Constraints).
- Which venue name survives label collision is a decision: ranked by event
  count (descending), tiebroken by venue id.
- A displaced coincident group spreads along its own dominant axis: a
  north–south stack displaces north–south.
- Label anchor order no longer compounds the lane bias unexamined — re-tuned
  alongside the lane-axis fix, with reproduction captures as evidence.
- Before/after captures against named venues for the two observed symptoms
  (names disappearing in arbitrary order; pins sliding sideways that should
  move vertically).
- The phone experience is unregressed: `npm test` passes, the offline
  invariant is untouched, and phone-width rendering changes only in the
  deliberate collision behaviors above.

Failure looks like: the embed missing or broken on the Squarespace page; the
desktop map still small or its venue key buried; or a phone-map regression
discovered in October.

## Non-goals

- **No Squarespace theme inheritance** (cheap style bar, ruled 2026-09-04).
  The venue list, sheet, and controls keep app styling; the map keeps its
  cartographic style. No parity liability when organizers restyle.
- **Mobile embed is functional, not first-class.** Desktop-oriented surface;
  phone visitors may get a reduced experience or a prominent link to
  go.midwaymusicandart.org. No cooperative-gesture polish requirement on
  mobile beyond "the visitor can still scroll the page and reach content
  below the map."
- **Map view only.** The other five tabs keep the capped phone-width column —
  width is information on the map and mere line length everywhere else.
- **No extra functionality or integration** with non-map Squarespace pages.
- **No "both names disappear" collision behavior** — rejected on cost (see
  Ledger).
- **No new hosting, no cost** — rides the existing GitHub Pages deploy,
  $0/month.
- Untouched adjacent backlog items: sponsor-pin displacement lanes, map
  artwork, transit pin green, OSM route 67.

## Constraints

- Repo invariants hold: offline-capable from the primary origin, deterministic
  builds, generated outputs (`site/sw.js`, `site/data/`) edited only via
  sources + `npm run build`, tests off-network from fixtures.
- **The 560 px cap has a documented rationale** (`site/css/app.css` ~:895):
  an uncapped square frame on a wide laptop grew as tall as the window was
  wide, pushing legend and venue key below the fold (QA 2026-08-08), and the
  cap keeps on-screen scale within ~1.5× of a phone's so one set of street
  widths, pin sizes, and label sizes reads on both. The desktop layout is
  therefore an **aspect-ratio problem, not a remove-the-cap problem**: a wide
  viewport wants a wider-than-tall frame, and the readable-scale rationale
  must be either preserved or consciously superseded with re-checked sizes.
- Pin displacement geometry is frame-independent (the runtime reference-frame
  work); MapLibre *label* collision is viewport-dependent by design — a wider
  frame fits more labels. Expected, not a defect.
- The screenshot baseline recapture is already owed (`reviews/2026-08-baseline/`
  RECIPE.md); wide-viewport frames fold into that existing debt.
- Squarespace side: iframe embedding verified unblocked 2026-09-04 (no
  `X-Frame-Options` / CSP on go.midwaymusicandart.org). Code-block execution
  is the same Business-plan bet the performers page carries; settled the
  moment either stub is pasted. Site is Squarespace 7.1.
- Sequencing: collision fixes first (the desktop layout should be judged
  with deliberate label behavior already in place), desktop layout second,
  embed surface last. No staging environment exists — once verified locally,
  everything goes to production.
- Anything touching the service worker or caching needs the manual iPhone
  airplane-mode pass (README); this work should avoid touching either.

## Approach sketch

1. **Collision fixes** (`site/js/views/map.js`):
   - Add `symbol-sort-key` to both venue name layers (`venue-name-label` at
     ~:1575 and its displaced sibling), ranked by event count descending with
     venue id as deterministic tiebreak. Event counts derive from the same
     `content.json` the view already loads — no schema change, determinism
     unaffected.
   - `coincidentGroups` (~:296): choose the lane axis from the group's own
     spread — whichever of lat/lng varies more, or the principal axis
     (implementer's choice) — preserving the existing stay-on-your-own-side
     rationale along the chosen axis.
   - Re-examine `text-variable-anchor` order (~:1563, ~:1584) together with
     the lane-axis change so the two stop compounding; exact order is
     implementer judgment backed by the reproduction captures.
   - First step: reproduce both observed symptoms against named venues;
     capture before/after at phone and desktop widths.
2. **Map view desktop layout** (map view only): at wide viewports the
   `.map-frame` breaks out of the 560 px cap into a wider-than-tall frame,
   with legend and venue key list still discoverable below. Re-verify label,
   pin, and street readability at the larger on-screen scale per the cap's
   rationale. Cheapest de-risk: resize a dev build to ~1200 px *before*
   designing, to see what `fitBounds` and the label pass actually do.
3. **Embed surface**: a chrome-suppressed presentation of the same Map view —
   query param or hidden route (implementer's choice; whichever URL gets
   pasted into Squarespace becomes a binding interface and goes in
   CONTRACTS.md). Suppresses `.app-header` and `.tab-bar`. On the Squarespace
   page: an iframe of that URL, `allow="geolocation"` for the locate button,
   with a mitigation for the desktop wheel-zoom trap (MapLibre
   `cooperativeGestures` or equivalent — scope of that setting is a deferred
   question). Mobile visitors get a functional map plus a link out to the app.
4. **Docs**: CONTRACTS.md (embed URL + any new route/param), README operator
   procedure for the Squarespace paste (pattern: the performers embed),
   BACKLOG item closures, PROGRESS entry.

**Assumption that would invalidate the sketch**: that a wide-aspect frame
yields a good home view — that `fitBounds` at desktop aspect ratios reads
well rather than cropping or over-zooming. Nobody has seen this map at
1200 px. Test by resizing before designing (step 2).

## Risks & unknowns

- **Width solves "too small"** — medium-high confidence; cheapest test is the
  dev-build resize above, before any layout work.
- **Squarespace executes the embed on the current plan** — high confidence,
  shared with the performers page; settled by pasting a stub.
- **Desktop wheel trap** — `cooperativeGestures` requires Ctrl+wheel to zoom,
  slightly diluting "same interactive experience"; whether it applies
  embed-only or app-wide is deferred. Low risk, visible trade-off.
- **Phone-facing changes one month before the festival** — mitigated by the
  pinned test suite, reproduction captures, and the screenshot baseline
  recapture; there is no staging tier, so local verification is the whole
  gate.
- **Event-count ranking shifts as the sheet changes** — which name survives
  can flip when organizers edit the lineup. Accepted: importance *should*
  track the actual lineup. Build determinism is unaffected (same inputs, same
  output).
- **Mechanism→symptom mapping unconfirmed** — fixes proceed on merits; if a
  reproduction shows a symptom traces elsewhere, that's a new finding for the
  backlog, not a reason to skip the fix.

## Deferred questions

- **Iframe height/scroll strategy** (fixed generous height vs postMessage
  auto-height): answer at embed implementation; acceptance bar is "no
  nested-scroll trap between page scroll and venue list on desktop."
- **Chrome-suppression mechanism** (query param vs hidden route): answer when
  touching the router; record the chosen URL shape in CONTRACTS.md.
- **Does the banner region show in the embed?** Banner text is organizer
  content, so probably yes — decide when building.
- **`cooperativeGestures` scope** (embed-only vs the app too): decide with the
  embed; the app's full-page map has no page-scroll to trap, so embed-only is
  the likely answer.
- **Where the mobile link-out lives** (Squarespace page content vs embed
  chrome): Squarespace page preferred — zero app code; decide at paste time.

## Ledger

All rulings Anthony, 2026-09-04, during the define session:

- **The embed's job is the full interactive experience** (map + venue sheet +
  key list), styled to feel in-place. A static image + link was the steelman
  alternative; rejected because in-page interactivity is the point.
- **Desktop-oriented**; mobile functional-not-first-class, link-out
  acceptable. Frees the design from mobile iframe scroll-trap polish.
- **Cheap style bar**: chrome suppression + right-sizing; no Squarespace
  theme inheritance (would create an unowned parity liability the performers
  page deliberately avoided by inverting control).
- **App-wide fix, Map view only**: the wide-viewport layout is its own
  deliverable benefiting direct desktop visitors — the cap is the root cause
  and a second embed-only layout would be accidental complexity. Other tabs
  stay as-is; capped columns are correct typography for lists.
- **All three collision mechanisms fixed on their merits**; reproduction is
  evidence, not a gate. Rationale: each is independently wrong, and a
  diagnosis against phone-width rendering half-expires when the frame widens.
- **Sacrifice order = event count desc, venue id tiebreak.** "Both disappear
  on collision" was acceptable to Anthony on outcome but rejected on cost:
  MapLibre's collision pass always keeps the higher-priority label, so
  symmetric hiding means hand-rolling label-box collision (text width, font
  metrics, zoom, chosen anchor) against the engine.
- **Venue number is a sheet artifact**, not curation — usable as tiebreak
  only.
- **One definition document** for the bundle, matching how the work was
  scoped together.

Next: `/build-prompt definitions/squarespace-map-embed.md`.
