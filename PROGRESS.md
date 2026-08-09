# Build progress — Midway Music & Arts Fest site

State journal. Read the Status section to know where things stand, then the log
for why the current design is what it is. Open work lives in BACKLOG.md;
binding interfaces in CONTRACTS.md; scope and non-goals in DEFINITION.md.

## Status

Live and working at https://go.midwaymusicandart.org/ (the github.io URL 301s
to it). Every push to `main` deploys; the last deploy and the full suite —
30 unit + 15 Playwright — were green.

**Only the venues tab is real content.** It is live from the organizers' Google
Sheet (URL in `content/config.json`), currently 14 venues.
`content/fixtures/venues.csv` is a committed snapshot of it and now runs a few
venues behind. Events, vendors, sponsors and settings are still **placeholder
fixtures** — invented names, invented schedule. The dismissible banner on the
site says so. Swapping each to a sheet tab is a one-line change in
`content/config.json` once real content exists.

The POC is complete — content pipeline, UI, OSM-derived map, PWA shell,
service worker and CI all landed and were audited in earlier rounds.

## Log

Newest first.

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
