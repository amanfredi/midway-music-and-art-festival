# MapLibre GL JS map spike — felt-UX audition on a branch

Status: defined 2026-08-10 | Overall confidence: high

**Outcome (recorded 2026-08-11):** the spike ran, the audition passed on a
real iPhone, and MapLibre shipped to production 2026-08-10 — see PROGRESS.md's
migration entry. Non-goals below (including "not adoption, no merge to main")
describe the spike as scoped, not what ultimately happened.

## Problem & motivation

The map-library decision (keep hand-rolling vs adopt MapLibre GL JS) has been
held open in BACKLOG.md; the August 2026 review firmed up the cost numbers
(~289 KB gzipped self-hosted all-in, MapLibre 6, WebGL2-only) but not the felt
UX. The hand-rolled map has known UX gaps the engine claims to retire for
free: **overlapping pins** (the largest open map item — 14 venues, several
within ~15 m; the pin underneath is unreachable), **street labels placed once
for the whole map** and counter-scaled (a close view can land between labels;
an engine re-places labels per zoom), and general pan/zoom feel (inertia,
pinch behavior, smooth zoom).

Anthony wants a **holistic felt comparison** on a real device, not a
performance profile. Decision posture, stated 2026-08-10: *if it works well
and doesn't drop existing functionality, we will probably just go with it.*
The spike is therefore an audition of the configuration the project would
actually ship, not a throwaway demo.

## Success criteria

- A branch build, evaluated **side by side against production on Anthony's
  iPhone**, in which the real `#/map` tab is rendered by MapLibre with the
  rest of the site (shell, routes, venue data, navigation, venue key list)
  intact.
- **Functional parity is observable:** step one of implementation is
  enumerating a parity checklist from the current map code (pins and their
  paint order, tap targets/venue tap-through, venue key list, deep links,
  zoom/LOD behaviors, GPS/georeferencing hooks, demo-clock interplay, test
  hooks noted-but-skipped, anything else found). The spike demonstrates each
  item or explicitly records the gap.
- **Both ground modes work** and can be switched (toggle or query param):
  - **Mode A (primary, no-artwork default):** vector layers built from the
    same OSM source data `make-map.mjs` already uses — streets/transit as
    GeoJSON, engine-styled, labels as symbol layers that re-place per zoom,
    all pins as symbol layers with collision/offset or cluster handling.
  - **Mode B (artwork demonstrator):** `ImageSource` with a four-corner
    georeferenced raster (a rasterization of today's `map.svg` standing in
    for commissioned artwork), same pin layers on top.
- **Offline sanity:** MapLibre assets and spike data are precached well
  enough that the map tab loads in airplane mode after one online visit
  (quick check, not the full README pass).
- The outcome is a **decision input**: adopt / don't adopt / adopt-if, with
  the parity gaps and felt differences written down.

**Failure looks like:** janky feel on the real iPhone, parity gaps that cost
more to close than the engine's UX wins are worth, or offline breakage
inherent to the engine (not merely un-plumbed precache).

## Non-goals

- **Not adoption.** No deterministic-build integration, no test-hook parity,
  no invariant rewording, no merge to `main`. Branch tests may go red where
  they assert map internals; record which, don't chase them.
- **No performance lag profile** as a deliverable (felt performance is
  observed, not instrumented). The backlog's "profile first, then prototype"
  sequencing is deliberately jumped; the branch enables side-by-side
  profiling later if wanted.
- **No artwork decisions.** Mode B uses a stand-in raster; commissioning,
  artist brief changes, and the baked-labels question stay open.
- **No Lockdown Mode accommodation.** Downgraded 2026-08-10: a festival
  attendee running Lockdown Mode *and* needing this site is far-fetched, and
  Safari offers a per-site exemption anyway.
- **No new content types, routes, or features** beyond the map tab swap.

## Constraints

- **Worktree + branch:** the primary checkout is occupied by another agent.
  Create a git worktree off `main` and do all work there. No pushes to
  `main`; branch pushes don't deploy (CI deploys `main` only).
- **Self-hosted everything, even on a branch:** MapLibre ESM entry, shared
  chunk, worker, and CSS vendored into site assets. No CDN, no external page
  resources. (Adopting MapLibre would amend the "zero runtime dependencies"
  invariant — that's a conscious adoption-time decision, but "no external
  resources" is not negotiable at any stage.)
- **Tests stay off the network:** any data-generation step for the spike
  follows the existing convention (build fetches, tests use fixtures) or is
  a committed artifact on the branch.
- **Evaluation instrument:** Anthony's real iPhone over LAN serve per the
  README's local workflow. The iOS Simulator is layout-sweeps only — it runs
  on the Mac's GPU with mouse-simulated touch, so it cannot judge felt
  performance, pinch/inertia feel, or tab-eviction behavior.
- **Zero budget**, static output only, as ever.

## Approach sketch

Swap the `#/map` tab's rendering implementation on the branch; everything
around it stays. Vendor MapLibre 6. Generate GeoJSON for Mode A from the OSM
data the existing `make-map.mjs` pipeline already consumes (reuse its source
data; a one-off committed conversion is acceptable for the spike). Rasterize
`map.svg` for Mode B and place it via `ImageSource` four-corner coordinates
derived from the existing `geo.js` control points — which doubles as a live
test of the georeferencing story the artist constraint depends on. Port pins
from the existing structured venue/transit/sponsor data into symbol layers;
let the engine handle collision (offset/cluster config for the ~15 m venue
clusters). Add the vendored engine and spike data to the service-worker
precache list for the airplane-mode sanity check.

**Assumption that would invalidate the sketch:** that the OSM-source-to-
GeoJSON conversion is modest work because the data is already fetched and
parsed by `make-map.mjs`. If that pipeline's internals turn out unusable for
GeoJSON emission, Mode A's cost balloons; timebox it and fall back to a
one-off Overpass export committed to the branch.

## Risks & unknowns

| Risk | Confidence it's fine | Cheapest test |
|---|---|---|
| WebGL2 floor: audition passes on Anthony's recent iPhone but low-end attendee phones get a blank canvas the SVG never gives | medium | Try one older device if available during evaluation; otherwise decide at adoption time, not spike time |
| Felt UX on device is actually better, not just different | medium | The spike itself — that's the point |
| Parity gaps larger than expected (checklist surfaces surprises) | medium-high | Checklist is implementation step one, before deep engine work |
| GeoJSON generation from existing OSM source data is modest work | medium | Timebox; fall back to committed one-off export |
| `ImageSource` four-corner placement agrees with `geo.js` georeferencing | high | Mode B renders pins on the raster in the right places, or it doesn't |

## Deferred questions

- **Fallback story if adopted** (keep SVG map as fallback = two
  implementations, which the original ledger rejected; or accept the WebGL2
  floor). Must be answered **before merge**, not before the spike.
- **Adoption-grade work**: invariant rewording, deterministic build
  integration, SW versioning discipline, test hooks, full suite green. Only
  if the audition passes.
- **Artist brief hybrid** (artwork with no baked street lettering, engine
  labels on top, preserving per-zoom placement). Only if artwork happens and
  the engine is adopted; Mode B evidence feeds it.
- **Whether the hand-rolled map code is deleted or kept** post-adoption.

## Ledger

- **Spike purpose = felt-UX audition feeding the open map-library decision**
  — not the backlog's lag profile; that sequencing is jumped deliberately
  since the branch enables side-by-side profiling anyway.
- **Holistic comparison including street labels** — Anthony accepted the
  extra effort; pins-only was offered and declined because baked labels
  would undercut the felt comparison.
- **Dual ground modes, vector/OSM primary** — artwork is only a possibility
  with nothing firm planned; no-artwork is the default assumption, but the
  ImageSource mode demonstrates the artwork future cheaply once layers exist.
- **Integration depth: real `#/map` tab swap** ((b) of demo page / tab swap /
  full parity) — the cheapest configuration in which "doesn't drop existing
  functionality" is observable, plus offline sanity pulled forward because
  offline is the project's acceptance criterion.
- **Lockdown Mode concern downgraded** per Anthony 2026-08-10 (far-fetched
  audience overlap; per-site Safari exemption exists). WebGL-still-blocked
  sourcing remains iOS-16-era, noted and accepted.
- **Leaflet named as the fallback alternative** (~42 KB, no WebGL floor,
  `ImageOverlay`, cluster plugins) if the WebGL2 requirement ever
  disqualifies MapLibre — not auditioned now because it lacks per-zoom
  labels and vector styling, half of what the audition is for.
- **Worktree isolation** — the primary checkout is occupied by another
  working agent; the spike must not disturb it.
