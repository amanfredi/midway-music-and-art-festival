# Backlog — open work, open decisions, deferred ideas

Everything forward-looking lives here. PROGRESS.md is the state journal: what
happened and why. Nothing should appear in both.

Items are not prioritized against each other. The festival is October 2–4,
2026; nothing here blocks the site working today.

- Consider adopting svelte/sveltekit (see especially the static site adapter https://svelte.dev/docs/kit/adapter-static)
- Consider moving deployment to Cloudflare Pages free plan and reverting github repo to private visibility (https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-kit-site/#deploy-with-cloudflare-pages)

## Pushed — first-run verification still owed

- **Deploy robustness** (`definitions/deploy-robustness.md`) — implemented
  2026-08-12, reviewed 2026-08-22 (Fable, inversion-framed; both blockers and
  four smaller findings fixed the same day), pushed 2026-08-31 along with the
  white-on-gray colour scheme that had been riding the same stack. It is
  demonstrably running: `content/snapshot/` on `origin/main` now holds
  `meta.json` plus venues, events and sponsors, written by a successful build.
  What is still owed is the ten-step first-run inspection checklist in the
  definition, written as the post-push script and not yet run. Once it passes,
  the "currently not met" clause on the deploy-robustness invariant in
  CLAUDE.md can come out — Anthony's call, since that clause states his
  acceptance criterion rather than a fact about the code. Operator config
  exists since 2026-08-12: `FASTMAIL_APP_PASSWORD` secret;
  `DEPLOY_NOTIFICATION_EMAIL`, `CONTENT_NOTIFICATION_EMAIL`, `FASTMAIL_USER`
  variables (recipient lists may be comma-separated).

## Decisions that need Anthony

**Venue popup: ruled deferred, nothing to build (2026-08-21).** No felt
problem — the popup was an idea, not friction — so the `<dialog>` sheet
stays the single venue surface. Revisit the teaser variant only if pin
browsing still feels heavy on a real phone now that tapped-pin highlight
and key-list recentering have landed; the acceptance criteria in
`definitions/venue-card-map-popup.md` are the bar for any attempt.
Desktop-only hover teaser ruled out.

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
likewise unspecified. Added 2026-09-04: the Support tab's card ladder is now
deliberately inverted above sapphire — sapphire renders two cards per row
with a 96px logo tile, past ruby's 84px, because the two live tiers
(sapphire/topaz) needed a visible step and no ruby or emerald sponsor exists
(Anthony's call, problem deferred). If a ruby or emerald sponsor signs,
re-rank the tiers above sapphire's new size before their logo publishes.

**Transit pin green — needs a brand ack, then it lands.** White line letters
on `--pin-transit` `#298d4e` compute 4.19:1. The CSS comment justifies that as
large text, but the letters render 8.4px bold at a 288px frame and 16.4px at
the 560px cap, so the 4.5:1 small-text threshold applies at every width.
Darkening to `#1e7a41` gives 5.36:1 against the letters and 4.60:1 against the
paper, and lifts the pin fill's own non-text contrast from 3.61:1 as a side
effect. Deferred 2026-08-10 by Anthony until after the MapLibre migration — which has
since landed, so this is ripe again. But the fix as specified (one `app.css`
token, the CONTRACTS.md pin-table row) targeted the retired SVG pins; transit
pins are now canvas symbols, so before the ack matters, find where the color
lives in `map.js`, re-measure the letter contrast as the engine renders it,
and re-spec. The 4.5:1 small-text requirement is unchanged.

## Squarespace umbrella site

**Does the embed's venue sheet read as cramped on a phone?** (added 2026-09-05,
for Anthony's eye rather than an engineer's). The sheet is confined to the map
frame and never taller than it — on a phone that is a 361 px square, and a
typical venue's sheet wants about 500, so it scrolls inside itself with the last
button cut off mid-height: `reviews/2026-09-embed-sheet/after-sheet-phone.png`.
The alternative is to start it at the frame's *top* and let it grow downward to
its natural height, which fits on screen in every case measured — but only while
the visitor has the map near the top of their screen, and the embed has no way
to know whether they do (CONTRACTS.md, "Map embed"). Confinement was chosen
because it is always visible, not because it is prettier. The picture is what to
judge it on.

**Performers embed follow-ups** (added 2026-09-04). The embed ignores the
accordion block's "expand first item" setting (`data-is-expanded-first-item`) —
the generated list always starts collapsed; implement it only against observed
markup, since Squarespace's emitted form for that setting wasn't verifiable
without editing the live site. And performer dedupe (one act, several sets)
stays deferred per the definition — `#performer-<id>` deep links change meaning
when it lands, so don't publicize per-performer links until it's settled.

## Map

**Fix route 67 upstream in OSM** (added 2026-08-23). Relation 2449177 (Metro
Transit 67, eastbound) is missing its member ways across the Franklin Avenue
bridge — verified against live Overpass, not just the cache — so the map
completes the line locally from cached highway ways (`BUS_ROUTE_GAP_FILL` in
`tools/make-map-geojson.mjs`). The durable fix is an OSM edit adding the seven
bridge/approach ways to the relation; after the next cache refresh the
generator warns that the patch is redundant and it can be deleted. Needs an
OSM account and editing by hand — Anthony's call whether it's worth it.

**Sponsor pins never get a displacement lane** (added 2026-08-23). Cross-type
displacement covers transit stops only; sponsor pins participate in the
clearance checks but are assumed static. The live sponsor sheet landed 2026-08-31 with every
`location` empty, so no sponsor pin renders at all and there is currently
nothing to space. The trigger is now the item below on filling that column:
when real sponsor coordinates exist, re-check the spacing. The old 368 m
nearest sponsor–venue pair (clear by ~z12.2, wider than the home view) measured
the placeholder fixtures and no longer describes what ships. Extending
`displacedStopOffsets` to sponsors is mechanical (small-pin lanes, no letters to
offset).

**The Snelling and Thomas venue neighbourhood has no room for a north–south
lane** (added 2026-09-04, found while making the lane axis deliberate). Vig
Guitars and Fluid Ink Tattoos share a longitude and differ only in latitude, so
their lanes should run north–south — and on both the live sheet and the
committed fixtures they cannot: Fluid Ink's north lane lands within 38 px of
Mosaic on a Stick (13 px on the live sheet), and every other axis assignment for
the surrounding groups is worse. The pair therefore keeps east–west lanes by the
give-way rule, which is the outcome that ships today, decided rather than
inherited. Four venues sit inside ~100 m there and 64 px lanes need more room
than that. Nothing to do unless it reads badly on the deployed map; if it does,
the lever is a shorter lane step for cramped groups (the floor is 2 × `VENUE_R`
= 38 px, against today's 64), which would cost every displaced pin its visible
leader run and so needs its own look.

Same neighbourhood, resolved: Fluid Ink Tattoos and Mosaic on a Stick are both
named as of the 2026-09-04 collision-box shrink. Fluid Ink's "below" candidate
had been blocked by 2 px of Vig Guitars' bounding-box overhang.

**Sponsor names have no per-pin candidate ordering** (added 2026-09-04). Venue
names get an order worked out from what is around each pin, so a name that would
read as labelling a neighbour goes elsewhere first; sponsor names keep one
constant order. Nobody has reported an ambiguous sponsor name, and there are six
sponsors against twenty-one venues, so it was left. `nameOrders` in `map.js`
takes venues today and would need the sponsor list threading through it.

**Transit tethers wear venue colors** (added 2026-09-05, from Anthony's review
of the deployed-candidate map). One `tetherColors` pair (`map.js` ~:1756, fed by
`--map-leader-dot` / `--map-leader-line`) colors every leader line and dot,
venue and transit alike — so the displaced A Line stop beside Ginkgo hangs from
a blue-ish leader that reads as a venue's, is hard to attribute to its green
pin, and is easy to lose against the purple route-67 line it crosses. Leader
lines and dots should match the pin type they belong to: a transit tether in
the transit green family, venue tethers as they are. The fix threads a
per-kind color pair through the tether image and layer creation; the contrast
of the chosen green against the paper and the route lines needs a check at the
same time.

**Small pins have no collision blocker** (added 2026-09-04). Venue pins reserve
a square of the diamond's own area rather than its bounding box; transit and
sponsor pins still reserve the box. Their overhang is ~10 px on the diagonal
against a venue pin's ~14, and it would cost two more layers each, so it was
left. The pattern to copy is `venue-pin-block` in `map.js`. Worth doing only if
a name is seen standing off a transit or sponsor pin the way they used to stand
off venue pins.

**A label can be placed off the frame edge, invisibly** (added 2026-09-04).
MapLibre allows off-screen placements — sensibly, so labels are ready as you pan
— but that means a name whose only unblocked candidate lies past the edge is
consumed rather than dropped, and no later candidate is tried. Seen once, on
Black Hart of Saint Paul at the phone home view before the box shrink; the
shrink freed an on-screen candidate and it has not recurred. There is no engine
control for preferring on-screen candidates, so the only fix would be placing
names ourselves. Not worth it unless it starts happening to venues that matter.

**Sponsor and street labels were never re-measured after the tether split**
(added 2026-09-04). Taking the leader composites out of the collision index
freed space for every symbol layer placed after the venue names, not just for
them — sponsor names and street names both place later and should have gained
room. Nobody counted. Worth a look only if the map starts to read busy.

**Map presentation is CI-validated against fixtures only** (added 2026-08-23).
The venues sheet is live, and pin-collision outcomes (group membership, the
leader-zoom guard, displaced-stop lanes) are data-dependent with margins as
thin as ~1 px. This bit once: the sheet's Hamline Park point moved ~77 m after
the fixtures were snapshotted, and the deployed map regressed in a way every
fixture-based test missed. Runtime derivation plus the frame-independent
reference frame now absorb coordinate drift, but near-threshold flips remain
silent. Consider a build-time report in `scripts/build.mjs` that recomputes
pair margins from the fetched sheet and warns when any drawn-pin clearance
falls under a floor — the build already refuses invalid rows, so it is the
natural choke point.

**Recapture the screenshot baseline** (`reviews/2026-08-baseline/`, procedure
in its RECIPE.md): the 2026-08-11 map bundle changed four things inside the
map frame — 38 px venue pins, pin-matched legend swatches, the pan d-pad, and
the scale bar — and the 2026-08-22 color scheme then changed every view, so
the recapture now covers the whole shell, not just the map frame. The
2026-09-04 desktop map frame folds in too: every `map-desktop` shot is now a
1100 × 560 frame rather than a 560 px square. The before/after pairs in
`reviews/2026-09-map-collisions/` are evidence for that change, not a new
baseline — they cover four states at two widths, against the snapshot content
rather than the live sheet.

**Give the app's own desktop Map view the embed's columnar venue key**
(added 2026-09-04). `body.is-embed .venue-key-list` lays the venue key out in
as many columns as fit, which took the embed from ~1900 px tall to ~1160 px.
The app's own Map view keeps the single column, because it has no iframe height
to overflow — but at 1440 px it is a 21-row column under a 1100 px map, and the
same grid would read better there too. Deliberately not done with the desktop
frame: that change was scoped to the frame, and this one changes a list.

The remaining audit items below were specified against the retired SVG map;
they are requirements the MapLibre map must meet, kept for their measurements
and acceptance criteria (evidence in `reviews/2026-08-wcag-aa-audit.md`).

- [ ] **MapLibre migration: map accessibility re-audit.** After the migration
      lands, re-run the map sections of `reference/wcag-aa-site-profile.md` —
      its re-audit triggers name map rework as exactly this invalidating
      change. The 2026-08 audit's map dispositions describe the SVG map and
      expire with it. Scope is the map view unless the shell changed too.

- [ ] **Hit-target floor for transit and sponsor pins** (WCAG 2.5.8, F4).
      **Needs re-measuring against the new map** — the old measurement (22.7px
      rendered, closest pair 3.4px apart) described SVG pins whose hit shape
      was the diamond itself. Pins are now 22px canvas symbols, but a tap
      resolves against a ±10px box around the touch point, so the effective
      target is larger than the drawn one and the two no longer coincide. Which
      of them 2.5.8 measures here is the question to settle before deciding
      there is anything to fix; the map re-audit item above is the natural
      place. The coincident-venue half of this is fully closed as of
      2026-08-23: clustering plus the picker below the leader zoom, and
      displaced leader pins with a tap each from the leader zoom inward (the
      close-zoom tie that broke one venue's tap is fixed and pinned by test).
- [ ] **Station and arterial label size floors** (guide Part C #4). Advisory
      rather than a WCAG failure — the contrast passes. The old measurement
      (6.0px and 7.4px at a 288px frame) was of `map.svg`'s counter-scaled type
      and no longer applies: label sizes are now zoom-interpolated CSS pixels in
      `map.js`, currently bottoming out at 9.5px for arterials and 11px for
      station names, which clears the guide's 8px floor at every frame width.
      Re-measure on device to confirm, then close.

## App

**Closing a sheet does not return focus to the card that opened it, in Safari**
(added 2026-09-05, measured while checking something else). `views/sheet.js`
captures `document.activeElement` as the element to restore focus to on close.
That is right in Chromium, which focuses a button on a pointer click, and wrong
in WebKit, which does not: it captures `<main>`, and `.focus()` on a
non-focusable element does nothing. A Safari visitor who taps a venue card and
closes the sheet is left at the top of the page rather than back at the card.
Keyboard users are unaffected — tabbing to a button really does focus it, so
`activeElement` is the button on that path.

The fix is one line now that the tapped element is threaded through for the
embed's anchor: prefer it over the inference, `const trigger = openedBy ??
document.activeElement`. Left out of the anchoring work because it changes the
app's behaviour, which that work was scoped not to do. Only the key-list path
passes `openedBy` today, which is also the only path where the visitor has a
scroll position worth being returned to. Same root fact as the anchor's, which
CONTRACTS.md records under "Map embed".

**The active tab in the bottom nav is nearly invisible** (added 2026-08-31,
from Anthony's read of the deployed site). `.tab-bar a.is-active` changes
exactly one thing: `--color-text-muted` (`#4b5962`) becomes `--color-primary`
(`#10577b`). Both read well against the bar — 6.69:1 and 7.27:1 — which is why
the August audit cleared them, but the audit measured each against the
background and never measured them against *each other*. The two states differ
by **1.09:1**. That is the number that decides "which tab am I on", and at that
separation the answer is guesswork, more so outdoors or on a dimmed screen.

The design already concedes the point in one place: the `forced-colors` block
gives the active tab a 2 px underline, because colour alone survives no colour
override. The same reasoning applies in normal rendering — WCAG 1.4.1 asks that
colour not be the only visual means of conveying state, and 1.4.11 wants 3:1
for a meaningful UI indicator. Candidates, cheapest first: promote that
underline to always-on; put a filled or tinted pill behind the active tab; give
the active cell a thick top border. Weight and size changes are riskier than
they look — labels are already at 0.62rem to fit six tabs at 320 px, so
anything that widens "Schedule" needs re-checking at that width.


The **WCAG 2.2 AA review** ran on 2026-08-10. All 55 A/AA criteria are
dispositioned in `reviews/2026-08-wcag-aa-audit.md`;
`reference/wcag-aa-site-profile.md` is the checklist future audits start from,
and states its own re-audit triggers. The cheap fixes landed with pinned
tests, an axe-core gate covers every route, and the Accessibility contract in
CONTRACTS.md was corrected where the audit found it too narrow. Left open
outside the map (which is above):

- [ ] **Visible-on-focus skip link** (advisory). The last open one of the
      audit's four small advisory items — the other three landed 2026-08-11.
      a11yproject asks for it unconditionally, but 2.4.1 passes on landmarks
      and the tab bar follows `<main>`, so it buys little here; open until
      someone rules it worth the chrome.
- [ ] **Sticky group headings can cover a focused row** on the Now and
      Starred views — the same hazard class as the schedule and tab-bar
      scroll-padding fixes already landed, but heading-height only, so
      smaller. Noted 2026-08-11 while fixing the schedule case.

- [ ] **Border visibility, if it ever bothers anyone.** `--color-border`
      `#e2e5e8` is ~1.15:1 non-text on the white page — outside the
      contract's non-text scope and no worse than the old cream-on-cream,
      but a genuinely 3:1 border (≈ `#949494`) would read much heavier
      than the light-panel aesthetic. Left as-is 2026-08-22. The other
      color-scheme follow-ups (by-category chip, dead kind CSS,
      day-prefix gold) were all ruled and landed the same day.

- [ ] **Run the suite against WebKit on a Mac before a release.**
      `npx playwright test --browser=webkit` — not in CI, which is Linux and
      would have missed the 2026-08-22 pin-font bug for the same reason
      Chromium did: the misresolution was CoreText's. Two rounds of work
      chased that bug on the wrong engine. Not turnkey yet: 9 of 88 fail
      under Playwright WebKit, all service-worker/offline, and the one
      checked failed inside the harness ("WebKit encountered an internal
      error" on an offline navigation) rather than the app. Worth an hour to
      find out whether those can be made to pass or should be skipped for
      that project.

**QA on Android**, and an **agent review from a user's perspective**, possibly
using Claude for Chrome.

**Consider adding View Transitions for additional polish**, but this is low priority and might not even be an improvement.

**Include favicon sizes up to 64×64px** The favicon rendered in safari currently looks low-res.

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

**Decide what to do about Google serving several versions of a tab at once**
(measured 2026-08-31; the evidence is in that day's PROGRESS.md entry). The
build has no way to tell which version it fetched, and three things follow.
Two builds minutes apart can produce different `content.json` and therefore
different service-worker versions, pushing an update to every cached phone for
no content change — the determinism invariant broken from outside the build,
where none of its own guarantees reach. A deploy can silently revert content
the organizers already fixed, since the oldest version on offer was a full
edit cycle behind, not minutes stale. And `--write-snapshot` can record that
version as "last known good", which is the one artifact that has to be
trustworthy.

Exposure is probably worst right after a sheet edit, though how long the edges
stay in disagreement was not measured — the 2026-08-31 deploy picked up the
current version, which says the window closes but not how fast. The free
mitigation is procedural: wait a few minutes after editing before deploying. A
quorum fetch — two or three fetches of each source, accepted only when they
agree — would cost a few seconds per build. **Undecided:** living with it, the
procedural rule, and the quorum fetch are all still open.

**The events tab's `url` column is schema now** (promoted 2026-09-04 after
months as an ignored notes column): validated like every other link field and
published on every event in content.json, feeding the Squarespace performers
page (`definitions/performers-page.md`). The festival app still ignores it —
whether event detail should render an act's website is a separate open call.
(The row-20 link misalignment once flagged here — Keep For Cheap carrying Dan
Rumsey Trio's URL — was fixed in the sheet 2026-09-04.)

**Detect changed or removed content ids at build time** (accepted with the
web-share ruling, 2026-08-23). A venue or event `id` edited in the live sheet
silently kills previously shared `#/venue/<id>` / `#/event/<id>` links and
starred-event ids — one rename has already happened (the `ginkgocoffehouse`
typo fix, 2026-08-02). The build already snapshots the last-published sources,
so compare the incoming id set against the previous snapshot's and raise a
build error naming the changed/removed id, forcing the rename to be a
deliberate act rather than an accident.

Two live venue `url` cells are schemeless (`hamline.edu/sundin-music-hall`,
`blackgarnetbooks.com`). The build completes them to `https://` with a logged
rewrite, so this is cosmetic — worth adding the scheme in the sheet whenever
it's next touched.

`settings` is the last placeholder fixture. It becomes real with a one-line
change in `content/config.json` pointing at a published sheet tab — and when it
does, `banner_text` has to be carried over, or the banner reverts to whatever
the sheet holds.

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
      (procedure in README; standing gate, last passed 2026-08-10 — **owed
      again**: the 2026-08-11 pass narrowed the worker's revalidation catch).
- [ ] In-place content refresh on a real phone (new 2026-08-09, after the
      revalidation fix): with a tab already open, publish a banner change and
      confirm it appears without touching the tab; then confirm a worker
      version bump still leaves exactly one `circuit-map-*` cache. The
      clone-throw was observed in Chromium only — Safari unverified.
- [ ] Confirm map pan/zoom still feels smooth on a mid-range Android, not
      just the iPhone the migration was evaluated on. WebGL2 is a harder floor
      than SVG was.
- [ ] Judge the bus route lines at the 10-mile view on a phone (added
      2026-08-23): they draw at every zoom, subordination carried by width
      (~55–60% of rail) and muted color rather than a `minzoom`. If the wide
      view reads cluttered, give the `bus-route` layer a `minzoom` like the
      arterial labels' 11.6.
- [ ] Eyeball the displaced-pin treatment on a phone (added 2026-08-23):
      the stacks below the leader zoom, the displaced leader pins from the
      leader zoom inward, and the two displaced transit stops (beside Ginkgo
      and Black Garnet) — do the dot and line read as "this pin belongs
      there", and do the 10 px digits on a stack stay legible?
      Note the tightest venue-pin clearance is ~1 px (39.07 px between centres
      against 38 px pins at the leader zoom, limiting pair venues 1 and 4, a
      property of the current venue set and now the same on every frame
      width) — if the sheet gains venues, re-measure before trusting the home
      view.
- [ ] Sticky control bar against the iOS status bar when installed.
      `.schedule-controls` pins at `top: var(--safe-top)`, which *should*
      evaluate to 0 given `apple-mobile-web-app-status-bar-style: default`.
      Unverified; if it does tuck under, the fix is an opaque fixed filler of
      height `var(--safe-top)`.
- [ ] Venue-pin digits on the iPhone: still serifs after the font-stack fix?
      The map's stack now leads with `system-ui` (2026-08-11; the old one
      resolved to Helvetica off Apple engines), but the serif rendering was
      never reproduced off-device, so this is a diagnosis, not a confirmed
      fix. If the digits still read serif, run the canvas probe in the
      2026-08-11 PROGRESS entry and report what it prints.
- [ ] Install button on Android Chrome (native prompt).
- [ ] Splash screens render on iOS launch.
- [ ] Nav fits and reads at 320 px with six tabs.

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

   **Now the most important item on this list**, because the toast's live
   region became a popover on 2026-09-05 to get it out from under the venue
   sheet, and no headless test can tell you whether a screen reader still
   speaks it. `#toast-root` is shown *before* the message is appended, which is
   the necessary condition and is pinned by a test — but that it is
   *sufficient* for VoiceOver on a live region that was `display: none` a
   moment earlier is unverified. Do the second half too: open a venue sheet,
   tap Share, and confirm "Link copied" is both **spoken** and **visible**.
   That combination is what has never worked — before the fix the toast was
   painted underneath the sheet every time.
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
   lost. The in-place patch landed 2026-08-11; this step confirms it on a
   real device.
