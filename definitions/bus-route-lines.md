# Bus route lines — drawing the corridor instead of pinning its stops

Status: defined 2026-08-11 | Overall confidence: medium-high

## Problem & motivation

Metro Transit routes 67 and 72 serve the festival area, but their 40-plus stops
were rejected as pin clutter. A drawn route line conveys "the bus goes along
here" at a fraction of the visual cost, and the GeoJSON generator makes it
cheap: another `kind`, another layer. Non-goals up front: no stop pins, no tap
interactivity on the line, no schedule or frequency information — the map is
not a trip planner, and every sheet already links Google Maps for when the
device is online.

## What the two committed caches hold

Checked 2026-08-11:

- `tools/osm-cache.json` (8.8 MB), which the ground builds from, holds exactly
  four relations, all `route=light_rail` — Blue and Green, one per direction.
  **No bus relations at all.**
- `tools/osm-transit-cache.json` (762 KB), which `make-transit.mjs` uses for
  stops, holds exactly four relations and **all four are `route=bus`**: the A
  Line and B Line BRT routes, both directions, from
  `relation["route"="bus"]["ref"~"^(A|B)$"]["network"="Metro Transit"]`.

So **route geometry for two bus routes is already committed**: the transit
cache is fetched with `out body; >; out body qt;`, so member ways carry node
references and the nodes carry coordinates. It is reconstructible with no
network access, just not inline the way `out geom` puts it in the main cache,
so `wayToCoords` cannot read it as written.

The map already pins A and B Line stops and letters them in the legend, so if
bus routes are worth drawing, A and B have at least as strong a claim as 67 and
72 — and A Line runs the length of Snelling Avenue, the festival's own spine.

## Options

**(a) Refetch the main cache with bus relations.** Add a `route=bus` relation
clause matching refs 67 and 72 to the `QUERY` in `make-map.mjs` and run
`node tools/make-map.mjs --refresh` once, by hand, online. Costs: the refresh
rewrites the *whole* cache, so streets that drifted upstream since the last
fetch come along with it, and the regenerated `map-vector.geojson` diff spans
2,564 street features. Inline `out geom` for two bus routes' worth of member
ways adds roughly a megabyte to an already 8.8 MB committed file (estimate,
settled by the fetch). Buys: 67 and 72 specifically, in the cache the generator
already reads.

**(b) Extend the transit cache instead.** Add 67 and 72 to `make-transit.mjs`'s
existing bus-relation query and refresh that cache — 762 KB, no bbox clause,
and the ground is untouched. Not churn-free, though: the same run rewrites
`site/assets/transit.json`, so the stop list re-derives from current OSM and
needs the same diff review, at 76 stops rather than 2,564 street features. It
adds no stop pins — `extractRawPoints` maps only refs A and B to lines and
skips everything else. Costs: `make-map-geojson.mjs` must read a second cache
and reconstruct way geometry from node references, about fifteen lines it does
not have today.

**(c) Draw A and B only, from data already committed.** Zero fetch, zero cache
change, no `transit.json` churn; just the geometry reconstruction from (b).
Buys the two routes already named in the legend and pinned on the map,
including the Snelling corridor, and leaves 67 and 72 undrawn.

**(d) Do nothing.** Nothing here is broken; the corridor is legible from the
rail lines and the transit pins.

## Payload cost

Measured, not estimated, by putting the A and B Line geometry already in the
transit cache through the generator's own rounding (5 dp) and 2 m
simplification. Two routes, both directions, whole route: 818 LineStrings,
166 KB raw, 13.9 KB gzipped. Restricted to ways touching the 10-mile extent:
693 features, 141 KB raw, 11.4 KB gzipped. Appended to the shipped ground the
marginal cost is **11.6 KB gzipped on a 314 KB baseline**, about 4%.

No geometry for 67 or 72 is committed, so their cost is unmeasured. Assuming
they are local routes of comparable length with more turns, the same order
should hold — call it 10–15 KB gzipped per pair of routes; the fetch settles
it.

## Recommendation

Do (c) first, then (b) if 67 and 72 still matter. (c) is the whole feature —
generator kind, layer, legend entry, color, contrast, text alternative — proved
end to end for 11.6 KB gzipped and no network access at all, on routes already
named in the legend. The line should read as background information
subordinate to rail: thinner, muted, solid rather than dashed, since both
directions largely share the same street centerlines and two overlapping dashed
strokes at different phase read as clutter — the lesson the rail lines already
record. Once it is on device and Anthony can see whether a bus line under the
rail strokes reads as information or as clutter, adding 67 and 72 is one query
line and one cache refresh.

(a) is rejected: it buys the same two routes as (b) while rewriting the entire
8.8 MB cache and regenerating the whole ground.

## Acceptance criteria

- `tools/make-map-geojson.mjs` emits `kind: "bus-route"` LineStrings carrying
  `ref`, unmerged; rerunning it on unchanged committed caches is
  byte-identical.
- `npm test` is green and offline, and `npm run build` remains network-free
  with respect to OSM.
- One `bus-route` line layer, drawn above the street fills and beneath
  `rail-green`/`rail-blue`, at roughly 1.2/2.5/5 px across the three keyed
  zooms against rail's 2/4.2/9.
- Its color is a new `--bus-route` custom property in `app.css`, at ≥3:1
  contrast against `--map-paper` — checked with the contrast checker open,
  since "muted" pulls against that bar.
- One legend entry, stroke swatch plus name, covered by the
  swatch-matches-paint test in `tests/a11y.spec.mjs`. The
  color-is-never-the-only-means clause is satisfied as the rail lines' is —
  named in the legend — with line weight additionally separating bus from rail.
- CONTRACTS.md is amended in both places: `bus-route` added to the
  `map-vector.geojson` `kind` list, and the `bus-route` layer id added to the
  test-hook layer list.
- The added gzipped payload is recorded in PROGRESS.md and stays under 30 KB
  gzipped; above that, members are clipped to the bbox first.
- No new pointer or keyboard interactivity; existing tap tests unchanged.
- If routes 67 and 72 are added later: both directions present in
  `tools/osm-transit-cache.json`, `network`/`operator` verified in the diff
  rather than `ref` alone, and cache, `transit.json` and regenerated GeoJSON
  committed together.

## Open questions for Anthony

- Do A and B Lines belong in this at all, or is the interest specifically 67
  and 72? The recommendation assumes A and B are wanted; if they are not, (b)
  is the starting point and the free measurement above is only a cost estimate.
- The text alternative. For non-visual users the line's information exists only
  in the legend entry, which says bus routes exist but not where they run.
  Either add a one-sentence note under the legend naming the streets the routes
  follow, or leave it legend-only and judge at the pending VoiceOver pass — the
  device checklist's 1.1.1 step already asks whether the map's text alternative
  is adequate.
- One shared color for all bus routes, or per-route colors? One says "buses run
  along here" and route identity says which bus; a second color also doubles the
  legend entry and spends color budget the pin scheme reserves.
  (Recommended: one.)
- Legend wording: name the refs, or a generic "Bus route"? Naming costs nothing
  and matches street signage. (Recommended: name them.)
- Draw at every zoom, or from the home view inward (a `minzoom` like the
  arterial labels) to keep the 10-mile view calm? Cheap either way; judge on
  device.
- Where does the ruling land — this doc plus a BACKLOG line, or does the
  BACKLOG bus-routes entry get replaced by a pointer here?
