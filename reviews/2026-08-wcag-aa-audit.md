# WCAG 2.2 Level AA audit — August 2026

Audited 2026-08-10 at commit `b990244`, against the criterion checklist in
`reference/wcag-aa-site-profile.md` (55 A/AA criteria: 37 applicable, 18 n/a)
and the map checks in `reference/map-artwork-a11y-constraints.md`. The site
was built from fixtures (`npm run build:fixtures`, content version
`d32b9e94e182`) and served locally; every URL carried `?t=2026-10-03T15:00`
so time-dependent views had content. No site code, tests, or docs were
changed; fixes are priced here and land next stage, each with a pinned test.

Method, matched to each criterion's check tag in the profile:

- **axe** — `@axe-core/playwright` (WCAG 2.x A/AA tags) on 10 scans: all 7
  routes plus the schedule's by-venue variant, the venue sheet open (a
  route-only scan never sees the dialog), and a visible toast. The notice
  banner was present in every scan (fixtures ship `banner_id: demo-2`).
  **Result: zero violations in all 10 scans.** axe marked up to 54 nodes per
  scan "incomplete" for color-contrast — all SVG text and glyphs it cannot
  resolve backgrounds for — and every one of those is settled by computation
  below, which is exactly the division of labor the profile prescribes.
- **pw** — throwaway Playwright scripts (not committed): keyboard walks and
  focus-order recording on every route, dialog open/cycle/Escape/restore,
  map arrow-key panning and pin roving, pointer-cancellation drag, the
  starred undo-grace timing, live-region text capture, reflow at 320 px,
  text-spacing injection, target-size measurement, focus-obscured probing
  with real Tab keys, and forced-colors emulation.
- **calc** — WCAG relative-luminance contrast computed for every declared
  color pair in `site/css/app.css` and the `<style>` block of
  `site/assets/map.svg`; rendered sizes derived from map units × frame/3000.
- **code** — file:line citations against the working tree at `b990244`.

**Step-0 inspectability: confirmed.** `site/assets/map.svg` declares every
color, font size, and stroke width in a single `<style>` block; no raster
anywhere. Every map check below is computed, not eyeballed. Nothing in this
audit was contrast-indeterminate; the only judgments routed to the human pass
are the assistive-technology and device-behavior ones listed in the checklist.

## Disposition summary

| Disposition | Level A | Level AA | Total |
|---|---|---|---|
| Pass | 17 | 7 | **24** |
| Fail (priced) | 2 | 8 | **10** |
| Pending human pass | 1 | 2 | **3** |
| Not applicable | 11 | 7 | **18** |
| | 31 | 24 | 55 |

The ten failures cluster into: two layout defects on the schedule (cheap),
one focus-visibility defect from the fixed tab bar (cheap), one manifest line
(trivial), one color token (trivial), and five map findings (three cheap, two
moderate). Nothing found is expensive, and nothing is inherent to the
hand-rolled SVG approach — see the map section.

## Findings, ranked by user impact

### F1 · Schedule view breaks 320 px reflow — 1.4.10 · FAIL (cheap)

At a 320 px viewport the schedule route (both groupings tested) scrolls
horizontally by 18 px. Culprit measured: `.group-toggle` has
`align-self: flex-start` (`site/css/app.css:531-533`), which makes it
shrink-wrap its three buttons (322 px total) instead of stretching to the
288 px available; the container escapes `#view` and widens the document. The
sibling `.day-switcher` (no `align-self`) stretches and scrolls internally,
which is the intended behavior. Every other route measured 0 px overflow, and
no tab-bar label clips at 320 px. This also violates CONTRACTS.md's explicit
"no two-dimensional scrolling at 320 px" line and the map's exemption does
not apply — this is the control bar, not the map.
*Fix:* delete the `align-self: flex-start` (the toggle then stretches and its
existing `overflow-x: auto` takes over if it ever overflows).
*Regression test:* 320×568 viewport, `#/schedule`, assert
`document.scrollingElement.scrollWidth <= clientWidth`.

### F2 · Schedule overflows under text-spacing overrides — 1.4.12 · FAIL (cheap)

With the SC's four spacing overrides injected (line-height 1.5, letter
0.12 em, word 0.16 em, paragraph 2 em), the schedule route overflows the
320 px document by 76 px and the Now view's rows push wide. Culprit:
`.event-row__time { white-space: nowrap }` (`site/css/app.css:410`) — the
time range ("11:00 AM–12:30 PM") cannot wrap, so letter-spacing growth
forces the whole row past the viewport. All other routes survive the
injection with 0 px overflow.
*Fix:* remove the `nowrap` (at normal spacing the time never wraps anyway —
it is the shortest line in the column; verify against the screenshot
baseline).
*Regression test:* inject the four overrides on `#/schedule` at 320 px,
assert no document horizontal overflow.

### F3 · Focused controls scroll in behind the fixed tab bar — 2.4.11 · FAIL (cheap)

Reproduced with real Tab keypresses at 390×844: tabbing down the map view's
venue key list, the browser scrolls each newly focused button flush with the
window bottom — which is under the fixed `.tab-bar` (60 px + safe area,
`z-index: 30`). Buttons 4 ("Turf Club") and 13 ("The Dubliner Pub") were
**entirely** hidden at the moment of focus: all five sampled points of each
button's rect hit a tab-bar link (`elementFromPoint` evidence). 2.4.11 is the
minimum flavor — entirely-hidden is precisely what it prohibits. The
mechanism is generic to every scrollable view with focusables near the
bottom; the map's long venue list is just where it reproduces today.
*Fix:* `html { scroll-padding-bottom: calc(var(--tab-bar-height) +
var(--safe-bottom) + 8px); }` so UA scroll-into-view clears the bar. Consider
`scroll-padding-top` for the schedule's sticky controls at the same time
(no failure measured there today — the sticky bar sits above the scroll
target position — but the same class of bug).
*Regression test:* map route, Tab from the map SVG until a lower venue-key
button has focus, assert `document.elementFromPoint()` at its center returns
the button or a descendant.

### F4 · Non-venue map pins miss the 24 px floor on narrow phones, clustered — 2.5.8 · FAIL (moderate; map)

Measured at a 320 px viewport (288 px frame): transit and sponsor pin hit
diamonds render 22.7 px square; venue pins 27.8 px. 19 undersized targets
were in view at the home view. The spacing exception does not rescue them:
undersized targets need every other target's center ≥ 24 px away, and the
measured closest pairs are 3.4 px (Snelling & Minnehaha A-Line stop vs. the
Ginkgo Coffeehouse venue pin) and 7.3 px (Hamline Avenue Green Line stop vs.
Black Garnet Books). The equivalent-control exception covers venue pins (the
venue key list repeats them at 44 px+) but **not transit or sponsor pins —
the map pin is the only control that opens those sheets.** The failure window
closes at ≈335 px viewport (28.2 px hits at 390 px), so this affects the
narrowest phones only.
*Fix (in place):* floor the hit-target's rendered size — either raise
`TRANSIT_HIT_R`/`SPONSOR_*_HIT_R` (`site/js/views/map.js:50-54`; one line
each, but enlarges the tap halo at every width, re-trading the "swallowed
taps" QA decision) or clamp the counter-scale applied to `.pin__hit` so a hit
never renders below 24 px while the visible diamond keeps its size (better;
touches `updateOverlayScale`, moderate).
*Regression test:* 320 px viewport, measure every `.pin__hit` bbox ≥ 24 px.

**Entangled content finding (operator-confirmed known issue):** Hamline Park
and Mosaic on a Stick carry *identical* `lat`/`lng` in the venues snapshot
(44.9599375, −93.1666875…), so their pins coincide exactly at every zoom —
the lower-painted one is pointer-unreachable everywhere (keyboard roving and
the venue key list still reach it). Vig Guitars and Fluid Ink Tattoos are
14 m apart, which at constant pin size overlaps at every zoom too. The
operator confirmed overlapping pins are already known; recorded here with
the measured evidence and not investigated further. See content-pipeline
findings.

### F5 · The two rail lines are distinguishable only by hue — 1.4.1 · FAIL (cheap; map)

The METRO Green Line (`#2f7d4f`) and Blue Line (`#2b5fa8`) draw at identical
weight (24.8 units) and differ only in color — 1.26:1 between them, invisible
to red-green CVD. Neither line has an on-map label or a legend entry, and the
Blue Line has no pins either (`TRANSIT_LINE_LETTER` covers `green`/`a`/`b`
only, `map.js:60`; no stop within the 1.5-mile pin radius serves it), so
nothing anywhere names it. Green Line riders do get non-color identification
via station pins ("G"); Blue Line riders get nothing.
*Fix:* add both lines to the HTML legend under the map (`map.js:433-438`) —
two `<li>` entries with line-stroke swatches and the line names. That is
artwork-independent and closes both this and the map guide's "every symbol in
the legend" rule. On-map line labels in the generator are the fuller fix but
not required once the legend names them.
*Regression test:* map route, assert the legend list contains "METRO Green
Line" and "METRO Blue Line".

### F6 · Transit pin letters fail small-text contrast — 1.4.3 · FAIL (cheap; map)

White line letters on the transit green fill compute 4.19:1. The CSS comment
(`app.css:952-958`) justifies this as large text ("glyphs are bold and
30px+"), but that measures map units, not rendered pixels: letters render at
8.4 px bold at a 288 px frame and 16.4 px at the 560 px cap — never ≥18.66 px
bold, so the small-text 4.5:1 threshold applies at every real size, and
4.19:1 fails it. (Venue pin numbers, white on `#10577b`, are 7.86:1 — fine.)
*Fix:* darken `--pin-transit` (`app.css:24`) to ≈`#1e7a41` — computed 5.36:1
against white letters and 4.60:1 against the paper (also lifting the pin
fill's non-text contrast from 3.61:1). This changes a brand color in
CONTRACTS.md's pin table — the audit's contract-update mandate covers it, but
flag the shade to Anthony before landing.
*Regression test:* pin the computed fill and assert white-on-fill ≥ 4.5:1
numerically.

### F7 · Installed PWA is locked to portrait — 1.3.4 · FAIL (trivial)

`site/manifest.webmanifest:8` declares `"orientation": "portrait"` — exactly
the restriction 1.3.4 prohibits, and portrait is not essential to a map and
schedule. Browser-tab use is unaffected; anyone who installs the app (which
the site actively encourages as its storage-durability story) and uses a
landscape-mounted device is locked out.
*Fix:* delete the line (defaults to the device's own behavior).
*Regression test:* unit test parses the manifest and asserts no `orientation`
key.

### F8 · Pressed star glyph is near-invisible — 1.4.11 · FAIL (trivial)

The row star button's pressed state paints the ★ in `--color-accent`
`#efac37` on the white card — computed **1.98:1** (`app.css:469-471`). The
state is also carried by glyph shape (★ vs ☆) and `aria-pressed`, but at
1.98:1 the filled star — the visual state indicator — hovers at the edge of
visibility for low-vision users; the unpressed ☆ at `#7c878e` (3.68:1)
passes. The event-detail star button is unaffected (its pressed state uses
`--color-accent-dark` at 5.93:1 plus a label change, `app.css:274-278`).
*Fix:* pressed-row-star color to `--color-accent-dark` `#8a5a00` (5.93:1) or
`#a05f00` (5.08:1, already used for the day prefix) — keeps the gold family.
*Regression test:* assert the pressed star's computed color is the pinned
value.

### F9 · Map panning has no single-pointer non-drag alternative — 2.5.7 · FAIL (moderate; map)

Panning is drag-only for pointer users: the zoom/reset buttons change scale,
not position; double-tap zooms toward a point but cannot traverse; arrow keys
pan but are keyboard, which 2.5.7 explicitly does not accept as the
alternative (verified against the SC text). Is dragging "essential" to a map?
The W3C Understanding document for 2.5.7 uses a map with **up/down/left/right
buttons** as its compliant example — panning a map is their canonical
*non*-essential drag. Claiming the exception here would be wishful; recorded
as a fail.
*Fix:* four pan buttons (or a d-pad cluster) wired to the existing `panBy()`
(`map.js:215-220`) — the logic exists; the cost is UI design on an already
busy 288–560 px frame alongside the zoom stack. A mapping library would not
change this: MapLibre's default interaction is also drag-pan with no built-in
pan buttons.
*Regression test:* click each pan button, assert the viewBox translates.

### F10 · Now view auto-replaces itself with no pause — 2.2.2 · FAIL under the strict letter (low impact; judgment recorded)

Two triggers, judged separately as the profile demands:

- **The you-are-here pulse: pass.** It animates only after the user taps the
  locate button and a fix arrives (`map.js:668-698`) — user-initiated, not
  "starting automatically", so the SC's precondition isn't met. It is also
  disabled under `prefers-reduced-motion` (`app.css:996-999`). Recorded
  reasoning: if a stricter reader disagrees, the cheap mitigation is a
  finite pulse count with the dot persisting.
- **The Now view's 60 s redraw: fail under the letter.** Auto-updating
  information that starts automatically, in parallel with other content,
  with no pause/stop/hide control. Two honest mitigations short of a pass:
  the redraw is a no-op unless the on-now/up-next key actually changed
  (`now.js:16-22` — under the `?t=` demo clock it never repaints), so real
  updates land only at event boundaries; and an "essential" argument exists
  (a "what's on now" board that stops updating shows wrong information —
  arguably the update *is* the content). The argument is plausible but the
  Understanding doc's ticker examples cut against it; recorded as a fail
  rather than waved through. The real user harm is the side effect: on a key
  change `paint()` replaces `container.innerHTML` wholesale, destroying
  focus and screen-reader reading position mid-view.
  *Fix:* not a pause button (bizarre for this UI) — patch the two lists in
  place instead of replacing the view (this is the earlier review's F14,
  already a BACKLOG follow-up; this finding raises its priority).
  *Regression test:* with a mocked clock crossing an event boundary, focus a
  star button, advance 60 s, assert focus survives.

### F11 · SVG attribution text: fails contrast, effectively invisible — 1.4.3 · FAIL (trivial; map)

`site/assets/map.svg` carries one `<text class="attribution">` at
y = 16071 of a 16093-unit extent — visible only at/near full zoom-out — in
`#8c8c8a` on paper: **2.90:1**. It is not inside a `.map-label__scale` group,
so unlike every other label it scales with the map: at full zoom-out it
renders at 56 × (288…560)/16093 ≈ **1.0–1.9 px** — unreadable at any frame
size. This is dead markup: the visible attribution already renders as HTML
below the map from `settings.map_attribution` (`map.js:440`), where it passes
(muted text 5.23:1).
*Fix:* delete the element and its style rule from both the committed
`site/assets/map.svg` and its generator (`tools/make-map.mjs:550,636` —
regenerating needs Overpass, so edit both by hand).
*Regression test:* assert `site/assets/map.svg` contains no
`class="attribution"`.

## Pending the human device pass (3 criteria)

Everything machine-checkable under these three passes; what remains is
assistive-technology and device reality that no script can honestly claim.
The scripted checklist below covers exactly these, plus post-fix confirmation
of F7.

- **1.1.1** — is the venue key list + venue/transit/sponsor sheets an
  *adequate* text alternative for the map (a complex image the a11yproject
  checklist calls out by name)? All mechanical parts pass: the map SVG has an
  accessible name that doubles as a usage hint, every pin is a labelled
  button, every `<img>` has alt, decorative SVGs are `aria-hidden` (verified
  by axe `image-alt`/`svg-img-alt`/`role-img-alt` = 0 violations, plus code).
- **1.4.4** — app shell passes (no `maximum-scale`/`user-scalable` in the
  viewport meta, `index.html:5`; 200 % page zoom reflows within the 320 px
  evidence above). The map nuance needs a device judgment: page zoom scales
  the frame (map type grows to its 560 px-cap sizes), but *map* zoom never
  enlarges type (counter-scaling, S7), and iOS text-size adjustment does not
  touch SVG text at all.
- **4.1.3** — all three live regions verified mechanically:
  `#route-announcer` announced every route change including repeats
  ("Schedule view", "Support view" captured), a real toast (geolocation
  denied) landed inside `#toast-root[aria-live=polite]` with no nested role,
  and the banner carries `role="status"`. Whether VoiceOver actually *speaks*
  them is the human check.

## Notable passes (the ones a future audit will ask about)

- **Dialog (sheet) semantics — 2.1.2, 2.4.3, 4.1.2: pass, verified hard.**
  Native `<dialog>.showModal()`: focus lands on the sheet (announcing
  `aria-labelledby` → "Midway Saloon"), Tab cycles its controls (the
  brief `<body>` stop between cycles is the HTML-spec browser-chrome
  pass-through, not an escape — the background nav is genuinely
  unfocusable/inert, probed directly), Escape closes, focus returns to the
  opening control (venue-key button confirmed). axe with the dialog open: 0
  violations.
- **Map keyboard model — 2.1.1: pass.** Arrow keys pan the focused SVG
  (viewBox delta captured); the whole pin set is one tab stop (SVG → one
  roving pin → 4 map buttons → venue key list, sequence recorded); arrows
  walk between in-view pins; Enter opens the right sheet. Every function on
  every route was keyboard-reachable.
- **Focus visibility — 2.4.7: pass.** Every keyboard-focused element showed
  the 3 px `#0b3f5a` outline (9.65–11.21:1 against its grounds) — including
  the map SVG and pins, whose negative offset keeps the outline inside the
  clipped frame.
- **Pointer cancellation — 2.5.2: pass.** A 60 px drag across the map opened
  nothing (tap dispatch is on `pointerup` behind a 10 px / 600 ms gate,
  `map.js:296-326`); all other controls use `click`.
- **Starred undo grace — 2.2.1: pass, the profile's exact question.**
  Un-starring commits to `localStorage` immediately (`mfc:starred` read `[]`
  during the grace window); the lingering row is undo-only affordance; after
  the 3 s expiry the event was re-starred from the schedule. No time limit
  loses anything.
- **Contrast, everything except F6/F8/F11 — 1.4.3/1.4.11: pass by
  computation.** All 24 app-shell text pairs ≥ 5.08:1; all six kind badges
  5.11–9.18:1; map street labels 6.33–9.06:1 against paper *and* against the
  street fills they cross (4.73:1 worst case, station label over water); all
  five pin/line colors 3.61–6.77:1 against paper.
- **1.4.11 streets-and-water judgment — recorded as pass.** Street fills
  (1.16–1.35:1) and water (1.35:1) are held to be decorative ground, not
  "graphical objects required for understanding": the information-bearing
  objects — pins, labels, rail lines, station dots — all clear 3:1, and the
  labels (which pass) are what actually carry the street network's meaning.
  This is also the map guide's own hierarchy doctrine working as intended
  (supporting information "noticed, not announced"). A dissenting reading
  would add eight failures; anyone re-opening this should argue against the
  labels-carry-the-information point, not recount the ratios.
- **1.4.11 borders — pass via the hit-area exemption.** `#e6dcc8` borders
  measure ~1.3:1, but 1.4.11 does not require a boundary to meet 3:1 when
  the control is identified by other means (its text, at 5.5:1+); the
  *state* indicators (active-tab fill flip at 7.86:1) pass on their own.
- **2.4.2 — pass, one-document reading recorded.** One title
  ("Midway Music & Arts Fest", set from settings at boot) for one document;
  hash routes are announced by the live region. The conservative per-page
  reading would want per-route `document.title` — cheap to add
  (`app.js:37-46` already knows the name) but not required to pass; noted as
  an improvement, not a failure.
- **2.5.3 — pass, glyph judgment recorded.** `+`, `−`, `⟲`, `×` against
  names "Zoom in"/"Zoom out"/"Reset view"/"Dismiss notice"/"Close": symbolic
  characters are not visible text *labels* under the Understanding doc, so
  label-in-name is not triggered. Every control with a real text label
  (venue key buttons, day tabs, "Star this event") has it in the name.
- **1.3.2 — pass.** No `order`/reverse-flex anywhere in the CSS (clean
  grep); event-row DOM order is body-then-meta, matching visual order.
- **2.3.1 — pass.** The only animations are the 2 s pulse and 0.2–0.25 s
  transitions; nothing approaches three flashes per second.

## Advisory (not AA conformance findings)

- **Forced colors / Windows High Contrast:** the map does *not* collapse —
  SVG `fill`/`stroke` keep author colors under `forced-colors: active`
  (probed in Chromium), so the map stays readable but ignores the user's
  palette. The real loss is in HTML: the **active day-tab/group state
  disappears** (both states force to white/black; the 7.86:1 fill flip is
  erased). Cheap hardening: a `@media (forced-colors: active)` rule using
  `SelectedItem`/`transparent` border to mark `.is-active`, or an
  underline-style marker that survives forcing.
- **Skip link:** 2.4.1 passes on landmarks (and the tab bar follows `<main>`
  in DOM order, so almost nothing precedes content), but a11yproject asks
  for a visible-on-focus skip link unconditionally. Low value here; note
  only.
- **New-tab links:** 7 `target="_blank"` links (Maps, venue/sponsor sites,
  donate) with no "opens in new tab" notice — AAA (3.2.5) territory, cheap
  to add to the accessible names if wanted.
- **Venue-key numbers are aria-hidden:** map pins announce "Venue 4: Turf
  Club" but the key list's matching "4" is inside an `aria-hidden` SVG
  (`map.js:643-647`), so a screen-reader user can't cross-reference the
  number a sighted companion mentions. One-word fix (include the number in
  the button's name) if the human pass finds it matters.
- **Per-route document.title** — see 2.4.2 above.

## Full disposition table

| SC | Level | Disposition | Evidence anchor |
|---|---|---|---|
| 1.1.1 | A | pending human (mechanics pass) | axe ×10 clean; code inventory; pending section |
| 1.2.1–1.2.5 | A/AA | n/a — no time-based media (S1) | profile |
| 1.3.1 | A | pass | axe heading/list/landmark rules ×10; `schedule.js:96,103` aria-pressed |
| 1.3.2 | A | pass | CSS grep clean; row DOM order probe |
| 1.3.3 | A | pass | map aria-label names controls, position words supplementary |
| 1.3.4 | AA | **fail** | F7, `manifest.webmanifest:8` |
| 1.3.5 | AA | n/a — no inputs (S2) | profile |
| 1.4.1 | A | **fail** | F5, rail lines; all other color carries text/shape |
| 1.4.2 | A | n/a (S1) | profile |
| 1.4.3 | AA | **fail** | F6 transit glyph 4.19:1 small; F11 attribution 2.90:1; all else passes (calc) |
| 1.4.4 | AA | pending human (shell passes) | `index.html:5`; reflow data; map nuance |
| 1.4.5 | AA | pass | logotype exceptions; ticket sprite is labelled icon |
| 1.4.10 | AA | **fail** | F1, schedule 18 px overflow @320 |
| 1.4.11 | AA | **fail** | F8 pressed star 1.98:1; streets/borders judgments recorded above |
| 1.4.12 | AA | **fail** | F2, 76 px overflow under overrides |
| 1.4.13 | AA | n/a — no hover/focus content (S10; greps: 0 `:hover`, 0 tooltips) | code |
| 2.1.1 | A | pass | full keyboard walk, all routes |
| 2.1.2 | A | pass | dialog probe; background inert |
| 2.1.4 | A | n/a — handlers only on focused map/pins | grep |
| 2.2.1 | A | pass | undo-grace probe; storage immediate |
| 2.2.2 | A | **fail** (strict letter, Now redraw; pulse passes) | F10 |
| 2.3.1 | A | pass | keyframes grep: pulse 2 s, toasts 0.25 s |
| 2.4.1 | A | pass | landmarks; axe bypass/region; tab bar after main |
| 2.4.2 | A | pass (judgment recorded) | title probe; one-document reading |
| 2.4.3 | A | pass | focus sequences recorded; sheet restore |
| 2.4.4 | A | pass | axe link-name; rows carry time+title+venue; dialog labels context |
| 2.4.5 | AA | pass (scope caveat per profile) | tab bar + in-content paths |
| 2.4.6 | AA | pass | headings descriptive; axe button-name |
| 2.4.7 | AA | pass | outline probe on every keyboard stop |
| 2.4.11 | AA | **fail** | F3, tab bar obscures focus |
| 2.5.1 | A | pass | zoom buttons + double-tap cover pinch; drag not path-based |
| 2.5.2 | A | pass | drag-cancel probe; `map.js:296-326` |
| 2.5.3 | A | pass (glyph judgment recorded) | code inventory |
| 2.5.4 | A | n/a — geolocation on explicit tap only | `map.js:668` |
| 2.5.7 | AA | **fail** | F9, drag-only pan |
| 2.5.8 | AA | **fail** | F4, pin sizes + cluster measurements |
| 3.1.1 | A | pass | axe html-has-lang |
| 3.1.2 | AA | pass today, re-check at content freeze | fixtures English; no validation worth building |
| 3.2.1 | A | pass | only app-driven focus moves |
| 3.2.2 | A | n/a — no inputs (S2) | profile |
| 3.2.3 | AA | pass | nav order identical probe; single element |
| 3.2.4 | AA | pass | shared renderers (`event-row.js`, `sheet.js`) |
| 3.2.6 | A | n/a — no help mechanism | profile |
| 3.3.1–3.3.8 | A/AA | n/a — no forms/submission/auth (S2/S3) | profile |
| 4.1.2 | A | pass | axe ×10 incl. dialog open; code inventory |
| 4.1.3 | AA | pending human (mechanics pass) | live-region probes |

## The map: classification and the decision

Every map finding, classified as the definition requires:

**Fixable in place — cheap** (independent of the artwork and of each other):

1. Rail-line legend entries (F5) — closes WCAG 1.4.1 *and* the guide's
   "every symbol in the legend" rule; the Blue Line finally gets a name.
2. Darker transit green (F6) — one CSS token + CONTRACTS.md pin-table line.
3. Delete the SVG attribution (F11) — dead markup; HTML attribution stays.
4. Station/arterial label floors (guide Part C #4: 6.0 px and 7.4 px at a
   288 px frame vs. the guide's 8 px floor) — raise the font-size units in
   `tools/make-map.mjs` and/or gate small labels behind a deeper LOD so they
   never render sub-floor. Guide-advisory, not a WCAG failure (the contrast
   passes); do it in the generator before the artwork brief locks sizes.

**Fixable in place — moderate:**

5. Pan buttons (F9) — `panBy()` exists; the cost is UI on a small frame.
6. Hit-size floor for non-venue pins (F4) — clamp the hit polygon's
   counter-scale below 24 px rendered; entangled with the
   duplicate-coordinate content fix.
7. Legend swatch size (guide Part C #1): fixed 20 px CSS vs. pins at
   22–43 px depending on frame — matching exactly requires the legend to
   scale with the frame (or pins to stop). Moderate CSS/JS; or record it as
   an accepted deviation since the shapes and colors match exactly.
8. Venue-pin hierarchy (guide Part C #2): 1.25× where the guide wants 2×.
   Direction must be *growing* `VENUE_PIN_R`, since shrinking the others
   worsens F4. Check pin-overlap fallout at the home view before landing.
9. Scale bar (guide Part C #5): a zoomable map spanning 350 m–16 km triggers
   the guide's conditional requirement; add as a counter-scale-exempt
   element in the generator. The north arrow half is judged unnecessary —
   the map is north-up and never rotates; record that as the decision.

**Inherent to the current approach** (constant-size pins over a fixed square
frame, no clustering, no dynamic label placement):

- **Coincident-pin pileups can never be resolved by zooming** when venues
  sit at (near-)identical coordinates — constant on-screen pin size means
  the overlap survives every zoom level. Mitigations exist in place (the
  venue key list is a full pointer-operable equivalent for venues; paint
  order is contract-defined), but only clustering/spiderfying actually fixes
  it — that is a mapping-library feature (MapLibre symbol collision/cluster)
  or a significant hand-rolled build.
- **Map type is capped by frame width**: labels render at 9.4/7.4/6.0 px on
  a 320 px phone and map-zooming cannot enlarge them (S7); only page zoom
  helps, and past the point where the layout viewport shrinks below
  ~590 px, page zoom makes map type *smaller* again. A library with real
  per-zoom label placement (or abandoning counter-scaling) changes this;
  within the current design the lever is only "author bigger label units"
  (item 4).

**The decision this report exists to inform.** Two options:

- **(a) Bring the map itself to AA.** Cost: the four cheap items plus two
  moderate ones (pan buttons, hit floor) — all in-place, no library, no
  artwork dependency; the two inherent limitations remain but neither is a
  WCAG AA failure once F4's hit floor lands (clustering pain is a usability
  ceiling, not a conformance gap; the venue key list already provides the
  equivalent path for the worst case).
- **(b) Designate the list views as the conforming alternate path** and
  hold the map to best-effort. This is defensible under WCAG's conforming
  alternate version machinery only if every function the map offers exists
  off-map — today transit-stop and sponsor-location sheets do **not** (map
  pins are their only entry), so option (b) still requires adding those to
  a list view before the designation is honest. That work is comparable in
  size to just fixing the map.

**Recommendation: option (a).** Nothing found is expensive or inherent at
the AA bar; (b) doesn't avoid work, it relocates it and downgrades the
site's centerpiece. **A mapping library changes none of the ten failures**
— it would also default to drag-pan (F9 still needs buttons), its colors
would still be ours (F5/F6), and the app-shell failures are out of its reach;
the only thing it uniquely eases is the inherent clustering ceiling. So this
audit adds no new weight to the library question beyond what the August
review already recorded; decide it on the artwork/performance axis, not on
accessibility.

**Where the guide and WCAG pull opposite ways** (Part C's flagged
contradiction): the guide's hierarchy doctrine wants streets faint; WCAG
1.4.11 could be read to want them at 3:1. Resolved above as a WCAG question
— streets are decorative ground; the labelled, high-contrast objects carry
the information — which happens to also be the guide's own answer. No change
to the map; the reasoning is the deliverable.

## Content-pipeline findings (for the operator, not this repo's code)

1. **Sponsor logo alt text has no authoring channel.** The build derives
   `alt="<name> logo"` (`sponsors.js:26,36`); a logo whose meaning exceeds
   the sponsor's name (a tagline, a co-brand) has no way to say so, and the
   sheet has no column for it. Ask organizers whether any real logo needs
   more than its name; if yes, add an optional `logo_alt` column
   (build: use when non-empty, derive otherwise; validate non-empty-if-
   present so a stray space doesn't blank it). If no, record the derived
   form as sufficient — do not add a required column nobody will fill.
2. **Duplicate venue coordinates are live content today (operator-confirmed
   known issue).** Hamline Park and Mosaic on a Stick share an identical
   `location` in the venues sheet snapshot — almost certainly the same plus
   code pasted twice — which makes one map pin unreachable by touch at any
   zoom (F4). Organizers should fix the sheet; build validation should flag
   *identical* location values across venues (+ vendors/sponsors when live)
   as a warning-grade message, since legitimate co-located records are
   conceivable but rare.
3. **Language of parts (3.1.2):** no build validation is worth writing —
   proper names are exempt and cover the realistic cases. One-time editorial
   check of venue/event descriptions at content freeze; done.
4. **Nothing else in the sheet schema carries accessibility weight** —
   banner, descriptions, and names flow through `esc()` into plain text
   nodes with computed-passing contrast everywhere they render.

## Human device checklist (run on a real iPhone; ~15 minutes)

Covers exactly the three pending criteria plus post-fix confirmation of F7.
In the style of the README airplane-mode pass — do it top to bottom.

1. **Setup:** deploy (or serve on LAN); open in iOS Safari. Turn on
   VoiceOver (Settings → Accessibility, or triple-click side button).
2. **[4.1.3] Route announcements:** swipe through the tab bar and activate
   Schedule, then Map, then Support. After each, VoiceOver should announce
   "<Name> view" without focus jumping anywhere. Activate the same tab twice
   — the announcement should repeat, not go silent.
3. **[4.1.3] Banner + toast:** load with an undismissed banner — VoiceOver
   should announce the notice text without focus moving. On the Map, with
   Location Services off for Safari, tap "Show my location" — the "Location
   permission denied" toast should be spoken once (not twice).
4. **[1.1.1] Map alternative adequacy:** with VoiceOver on, on the Map
   view: touch the map — you should hear the map's name and the arrow-key
   hint; swipe through the pins — each venue announces "Venue N: name",
   each stop its name and lines. Then answer the actual question: using
   only the venue key list and the sheets (never the map picture), plan
   "how do I get from a Green Line stop to venue 3?" If the answer is
   "yes, comfortably", 1.1.1 closes as pass; if you needed the picture,
   the venues need transit-relative info in text somewhere.
5. **[1.4.4] Zoom and reflow judgment:** VoiceOver off. Pinch-zoom the
   *page* to 200 % on the schedule — everything should reflow/readably
   scroll (post-F1-fix). On the map, pinch the *map* — street names hold
   size by design; judge whether page-zoom (pinch outside the map frame,
   or Safari's Page Zoom setting) makes the map labels comfortably
   readable. Also try iOS Settings → Larger Text and confirm app text
   grows while the site stays usable.
6. **[1.3.4, after F7 lands] Rotation:** Add to Home Screen, open from the
   icon, rotate the phone — the app should follow to landscape and remain
   usable.
7. **[F10 judgment, optional] Now-view stability:** during a real or
   simulated festival window, leave VoiceOver focus on a Now-view row
   across a minute boundary where the lineup changes; note whether reading
   position is lost (it will be, until the in-place patch lands — this
   step is for confirming the fix later).

## Fix list for the next stage

Cheap = localized, test-verifiable, independent of the map decision. Each
lands with its pinned regression test (extend `tests/a11y.spec.mjs` or a
sibling spec; all run offline on fixtures).

| # | Finding | File(s) | Change sketch | Pinned test |
|---|---|---|---|---|
| 1 | F1 1.4.10 | `site/css/app.css:531-533` | delete `align-self: flex-start` on `.group-toggle` | schedule @320: no document horizontal overflow |
| 2 | F2 1.4.12 | `site/css/app.css:410` | remove `white-space: nowrap` from `.event-row__time` | schedule @320 + injected spacing overrides: no overflow |
| 3 | F3 2.4.11 | `site/css/app.css` (html rule) | `scroll-padding-bottom: calc(var(--tab-bar-height) + var(--safe-bottom) + 8px)` on `html` | Tab to a low venue-key button: `elementFromPoint` at center hits it |
| 4 | F7 1.3.4 | `site/manifest.webmanifest:8` | delete the `orientation` member | unit test: manifest has no `orientation` key |
| 5 | F8 1.4.11 | `site/css/app.css:469-471` | pressed star color → `var(--color-accent-dark)` | computed color of pressed row star = pinned value |
| 6 | F11 1.4.3 | `site/assets/map.svg`, `tools/make-map.mjs:550,636` | delete the attribution `<text>` + style rule in both | grep-test: no `class="attribution"` in map.svg |
| 7 | F5 1.4.1 | `site/js/views/map.js:433-438` | two legend `<li>` entries: Green/Blue line swatches + names | legend contains "METRO Green Line" and "METRO Blue Line" |
| 8 | F6 1.4.3 | `site/css/app.css:24`, CONTRACTS.md pin table | `--pin-transit` → `#1e7a41` (5.36:1 vs white; needs Anthony's brand ack) | computed pin fill pinned; white-on-fill ≥4.5 asserted numerically |
| 9 | axe gate | new spec (devDependency already present) | axe scan per route + dialog-open, 0 violations, strict | the scan itself is the gate |

Moderate items — BACKLOG-ready, carrying this report as evidence, most
gated on the map decision (recommendation: option (a) above):
pan buttons (F9), pin hit-size floor (F4), Now-view in-place patching (F10,
merges with the existing F14 follow-up), legend swatch scaling / venue-pin
2× hierarchy / scale bar / label size floors (guide items 1, 2, 4, 5),
forced-colors active-state marker (advisory), duplicate-location build
validation (content pipeline #2), per-route `document.title` (2.4.2
improvement).
