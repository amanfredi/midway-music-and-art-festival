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

**Only the venues tab is real content.** It is live from the organizers' Google
Sheet (URL in `content/config.json`), currently 14 venues.
`content/fixtures/venues.csv` is a committed snapshot of it (refreshed
2026-08-09). Events, vendors, sponsors and settings are still **placeholder
fixtures** — invented names, invented schedule. The dismissible banner on the
site says so. Swapping each to a sheet tab is a one-line change in
`content/config.json` once real content exists.

The POC is complete — content pipeline, UI, OSM-derived map, PWA shell,
service worker and CI all landed and were audited in earlier rounds.

## Log

Newest first.

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
disproved — the 1.73× above is the correction. Screenshot baseline recapture
is owed: four visible changes, all inside the map frame.

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
