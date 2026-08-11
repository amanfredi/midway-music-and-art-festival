# Coincident-pin presentation — labelling venues that share a location

Status: defined 2026-08-11 | Overall confidence: medium-high

## Problem & motivation

Two venue-location facts are valid data by ruling (2026-08-10) and are never to
be "fixed" in the sheet: Mosaic on a Stick sits inside Hamline Park with the
park's address and plus code, and Vig Guitars / Fluid Ink Tattoos are ~14 m
apart. The shipped treatment — clustering (`clusterRadius` 26 px) plus a picker
sheet when a cluster has no expansion zoom — solved reachability, which was the
open item. It is not broken, and "do nothing" is a live option here.

What remains is presentation at close zoom, raised from the iPhone evaluation
2026-08-10: a label should never misrepresent where something physically is.
Three defects, all read from the code and the calibration rather than observed
on a device:

- The coincident pair renders as the stacked-diamond cluster glyph across the
  whole clustered range, so neither venue's key-list number is ever legible on
  the map, and reaching either takes two taps (cluster → picker → pick).
- Above `clusterMaxZoom` the pair draws as two exactly superimposed pins with
  `icon-allow-overlap` and `text-allow-overlap` both on: one number covers the
  other, and `wirePinTaps` ranks by distance to the feature's true coordinate,
  which ties. The tie-break only compares layer rank, so the first feature the
  engine enumerates always wins and the other venue cannot be tapped at all.
  That band varies sharply and unpredictably with frame width, because
  `clusterMaxZoom` rounds to an integer while `maxZoom` does not: across
  280–560 px frames it runs from 0.31 to 1.31 zoom levels, and adjacent widths
  can differ by a full level (1.27 at 343 px, the frame on a 375 px viewport,
  against 0.34 at 360 px). It cannot be judged from one device.
- The ~14 m pair separates cleanly by the 120 m closest view (34 px apart on a
  288 px frame up to 65 px at 560 px, against a 28 px pin) but passes a band, from
  roughly where clustering releases it to where the pins clear each other, in
  which the diamonds partly overlap and a number can sit ambiguously between
  them.

## Options

**(a) Leader lines for unresolvable groups.** Where a group cannot be
separated, each member renders as a small dot at its true lat/lng with the
numbered diamond floating clear, joined by a short line — the standard
cartographic answer for coincident points, and the only presentation in which
no label claims a position that isn't the venue's. MapLibre has no leader-line
primitive, so the cheap implementation is a composite canvas icon: dot, line
and displaced diamond baked into one image, one image per offset direction.
What keeps this cheap is that group membership is *static* — venue coordinates
come from the sheet at build time and don't move at runtime — so each affected
venue can carry a precomputed offset property, and a `step` expression on zoom
switches between the plain and leader icons. No per-zoom geometry updates, no
extra layers, and pins keep their constant screen size. The one real hazard:
`wirePinTaps` measures against the true coordinate, so it must add the same
offset for these pins or the wrong sheet opens. Retires the picker above
`clusterMaxZoom`: both numbers on the map, one tap each.

**(b) Displacement without the line.** Offset the pins so they never overlap
and show nothing at the true position. Cheaper than (a) by exactly the dot and
the line, and it silently misstates position: a 28 px displacement is 6–12 m at
the closest zoom — comparable to the 13.9 m that actually separates the Vig /
Fluid Ink pair — and ~230 m at the home view on a 360 px frame. The dot and
line are the part that keeps displacement honest.

**(c) Member numbers on the cluster glyph at far zoom.** The way transit pins
stack line letters, a cluster of venues 3 and 7 could show "3" and "7" instead
of the anonymous diamond stack. CONTRACTS.md bans a *count* on clusters because
a digit reads as a venue number; here the digits are the venue numbers, which
arguably serves the rule's intent rather than violating it — but that is
Anthony's ruling, not an implementer's. `tests/a11y.spec.mjs` asserts the
`venue-cluster` layer carries no `text-field` at all, so (c) means amending
contract and test together. Legible at two members, marginal at three,
impossible beyond, so the plain glyph stays as the overflow form. Needs cluster
property aggregation to collect member labels, whose ordering supercluster does
not guarantee. Independent of (a) and (b): this addresses far zoom, they
address close zoom.

**(d) Do nothing.** Every venue is reachable at most zooms today, and BACKLOG
already frames leader lines as "a legibility refinement... not a fix for a
broken case." What that leaves standing: the numberless coincident pair, its
two-tap access, and the superimposed band where one of the two venues cannot be
tapped at all.

## Recommendation

(a), scoped to one evening: leader treatment only for groups the current zoom
cannot separate — the coincident pair above cluster-expansion zoom, and the
~14 m pair only in the band where their pins would overlap. Cluster-plus-picker
stays untouched everywhere else. (b) is rejected as the same work minus the
honesty. (c) is a separable follow-up gated on the numbers-on-clusters ruling;
don't bundle it.

The untappable venue in the superimposed band is the one defect here that is
arguably a bug rather than a refinement, and it has a fix far smaller than this
feature: when the nearest-pin search ties between two `venue-pin` features,
open the picker sheet, exactly as an unsplittable cluster already does. That
makes both venues reachable in the band without any new rendering. If the
composite-icon work threatens the evening estimate, land that alone and fall
back to (d).

## Acceptance criteria

- At max zoom over Hamline Park: two venue pins visible, each carrying its
  key-list number, each opening its own sheet in one tap, each joined by a
  visible line back to the shared true coordinate — as two coincident dots or
  as one shared dot, implementer's choice, recorded in CONTRACTS.md.
- At no zoom do two venue symbols draw at the same screen point without leader
  treatment.
- A tap on a displaced diamond opens that venue even though both features share
  a true coordinate — pinned by a test driving the map through
  `tests/map-helpers.mjs`, since the superimposed case currently resolves by
  enumeration order.
- CONTRACTS.md is amended in both places it binds: the pin clause describes the
  leader treatment (today it says diamonds are unstroked), and the tap clause
  describes measuring against the displaced diamond rather than the true
  coordinate — or, if the picker fallback ships instead of (a), the
  tie-to-picker rule.
- Cluster and picker behavior at wider zooms is unchanged; existing cluster and
  picker tests stay green, or are consciously amended alongside CONTRACTS.md.
- Leader dot and line colors live in `app.css` as custom properties and meet
  3:1 non-text contrast against `--map-paper`.
- Rendering only: no build, validation or `content.json` change, and build
  output stays byte-identical for unchanged sources.

## Open questions for Anthony

- Does the picker stay as the far-zoom path (recommended), or should leader
  presentation start earlier and retire it entirely?
- Ruling on (c): are member venue numbers on a cluster glyph acceptable, or
  does the no-digits rule stand as written?
- Is the ~14 m pair in scope, or only the exactly-coincident pair?
- Offset direction — one choice covering both pairs. Vig Guitars and Fluid Ink
  are separated due north–south (13.9 m of latitude, no longitude difference at
  all: plus codes `XR5M+J3` and `XR5M+M3` differ only in the latitude
  character), so an east–west split adds the most separation and is the
  default. The Hamline Park pair is exactly coincident, so any direction works
  for it — and the ground draws no park polygon, only the streets around it, so
  there is nothing on the map for a displaced diamond to sit "on". Cheap to fix
  now, annoying to retrofit.
- Where does the ruling land — this doc plus a BACKLOG line, or does the
  BACKLOG leader-lines entry get replaced by a pointer here?
