# Deliberate label collisions and the desktop map frame — change evidence

Before/after captures for the 2026-09-04 map work (`definitions/squarespace-map-embed.md`).
**Change evidence, not a baseline.** Four states at two widths, against snapshot
content rather than the live sheet — the full baseline recapture is still owed
and is tracked in BACKLOG.md.

**Captures only compare cleanly within one session.** The CSS font stack
(`-apple-system, BlinkMacSystemFont, …`) resolves differently between headless
browser launches, so the legend and venue key below the map render at different
sizes in different prefixes. It is stable within a run — re-shooting a prefix
reproduces it byte for byte — and it never touches the map frame, whose type
MapLibre draws itself. When a prefix has to be compared against an earlier one,
re-shoot the earlier commit in the same session; `before-aim-labels-desktop.png`
is such a re-shoot, of `f52205b`.

Sets, each the same ten shots unless noted:

| prefix | code |
|---|---|
| `before-` | commit `94187a0`, the last commit before any of this work |
| `after-` | the collision rulings only (commit `a45c739`) |
| `after-wide-` | plus the desktop map frame (commit `d021bce`) |
| `after-fill-` | the label-space work: split composites, fallback anchors, dot rule, rank lanes (`56a035e`) |
| `after-dots-` | dots reserve their own box; names gain corner candidates (`62e8453`) |
| `after-box-` | pins reserve the diamond's area, not its bounding box (`f52205b`) |
| `before-aim-` / `after-aim-` | per-venue candidate order and diagonals pulled in to the ink (`f52205b` → `221114c`), two shots and four |

Those three shas are checked, not assumed: re-shooting `sundin-soeffker` at
`94187a0` reproduces the committed `before-` pair byte for byte. Do not read
`before-` as "the commit before `a45c739` in `git log`" — the log is
interleaved with another agent's commits from the same afternoon, and the one
that reads as adjacent (`c63b187`) already contains both this work's stage 1
and its stage 2 CSS.

The five states, at `phone` (393×852, touch) and `desktop` (1440×900):

- `home` — the Map view as it opens. Below the leader zoom, so no names and no
  leader lines: these are identical across all three sets at phone width, and
  differ at desktop width only in `after-wide-` (the frame).
- `labels` — centred on the festival at the leader zoom, the widest view at
  which any venue name is sacrificed. This is where the sort key shows.
- `vig-fluid` — Vig Guitars and Fluid Ink Tattoos at z16.5. Identical before and
  after **on purpose**: they share a longitude and want north–south lanes, and
  the give-way rule keeps them east–west because Mosaic on a Stick is in the way
  (BACKLOG, "The Snelling and Thomas venue neighbourhood").
- `sundin-soeffker` — Sundin Music Hall and Soeffker Gallery at z16.5. This is
  the lane-axis change: side by side before, stacked north–south after, each on
  the side of the pair its venue is really on.
- `urban-lights` — Urban Lights, Elsa's House of Sleep and Black Hart of Saint
  Paul, plus Black Garnet Books, at the leader zoom. The biggest phone-facing
  change in the batch, and the one place the give-way rule is visible: this
  group spreads east–west and wants east–west lanes, but taking them puts Black
  Hart's east lane 36 px from Black Garnet Books, under the 38 px two diamonds
  need to clear. In `before-` the two diamonds visibly touch; in `after-` the
  group has given up its own axis, Black Hart hangs north and Elsa's south on
  vertical leaders with Urban Lights at its own coordinate between them, and
  Black Garnet Books stands clear.

  Both facts live at the leader zoom and nowhere else — one level in, the pair
  has drawn far enough apart that there is nothing to see — so this is the one
  site shot at `zoom: 'leader'` rather than at a fixed close zoom.

  Worth knowing before reading it as a regression: Urban Lights is unlabelled
  in both, though it has two events to Elsa's none. The ranking gives it the
  earlier attempt; it is the middle lane, so its name goes east, and east is
  taken. Sort order sets who tries first, not who wins when the geometry
  differs.

## `diag-` — why three venues stay unnamed (2026-09-04)

A separate, later investigation, not part of the before/after set. Anthony read
`before-labels-phone.png` against `after-labels-phone.png` and found three
venues with visible free space around them and no name at the leader zoom:
Ginkgo Coffeehouse (2), Mosaic on a Stick (10), Fluid Ink Tattoos (14).

`shoot-label-diagnosis.mjs` turns on MapLibre's own `showCollisionBoxes` and
shoots the overview plus a close-up on each of the three, at phone width:

```
diag-overview-phone.png   diag-ginkgo-phone.png
diag-overview-desktop.png diag-mosaic-phone.png
                          diag-fluidink-phone.png
```

Blue boxes are symbols that were placed, red are symbols the collision pass
hid. What the pictures show is that **the free paper is not free**: a displaced
pin's collision box is its whole composite image, dot to diamond, so a pin
drawn 32 px off its coordinate reserves a 110 × 46 box where a plain pin
reserves 46 × 46 — and a displaced *transit* stop reserves 116 × 30. Those
boxes blanket the middle of a 361 px phone frame.

Desktop is there for contrast only. The boxes are identical; the frame is
wider, so more names fit. The diagnosis is about the phone.

`diag-mosaic-phone.png` is byte-identical to `diag-overview-phone.png`, which
is a coincidence rather than a duplicate: Mosaic on a Stick's coordinate is
the map's `home_center` to within a pixel, so centring on it and centring on
the home view are the same camera. Its diamond is the one 32 px west of the
frame centre, not the one at it.

Shot from `main` at the time (`02b9076`) against the current snapshot, which
builds `40f85f499538` — a later content version than the before/after sets
above, because this asks what the map does now rather than what changed.

## State at capture

Build outputs are gitignored, so the commit alone does not pin the content.
Every shot here was built from `content/snapshot/sources/` **as those files
stand in the commit being shot**, which for all three is
`site/data/content.json` version **`fb2eb71e70b1`** — 21 venues, 34 events,
6 sponsors.

That "as they stand in the commit" is the part that is easy to get wrong.
`ecf5279` refreshed `sponsors.csv` and reached `main` through the merge
`fe4557f`, which is a descendant of all three commits above. So building any of
them against *today's* snapshot yields `40f85f499538` instead and the shots come
out subtly different; checking the commit out takes its own snapshot with it,
which is what makes the three sets comparable.

Venues and events have not moved: `venues.csv` is `c4f02a74bbc4` in all of them
and in the live sheet as of 2026-09-04, so what these shots are about is the
same data the site deploys. The venues tab's `id` header, which was overwritten
with `5` and failing the build when the first eight shots were taken, has since
been fixed — as of 2026-09-04 all three live tabs are byte-identical to the
snapshot, so a snapshot build and a live build agree.

## Reproduction commands

Prerequisites: `npm install`, `npx playwright install chromium`.

One prefix per commit, each built from the snapshot that commit carries. Nothing
in the repo ships a config for that, so write one pointing at
`content/snapshot/sources/*.csv` plus `content/fixtures/settings.csv`:

```sh
git checkout --detach 94187a0     # or a45c739, or d021bce
node scripts/build.mjs --config /tmp/snapshot-config.json && node scripts/build-sw.mjs
node reviews/2026-09-map-collisions/shoot-map-collisions.mjs --prefix before
```

The build must print version `fb2eb71e70b1`. If it prints anything else the
content has moved and the shot is not comparable with the committed set.

`94187a0` predates this directory, so the helper is not in that checkout —
copy it in (it is ignored by nothing, so remember to remove it before switching
branches) or run a copy from outside the tree.

`--only <state>` reshoots one state and leaves the rest alone, which is how
`urban-lights` was added without rebuilding the other four against a different
content version:

```sh
node reviews/2026-09-map-collisions/shoot-map-collisions.mjs --prefix after --only urban-lights
```

Beware the same trap as the 2026-08 baseline: `npm test` leaves `site/` rebuilt
from the committed fixtures, which are a different venue set. Rebuild before
capturing.

The helper drives the engine through the `window.__mmafMap` test hook and
centres on venues by id, so a sheet edit that renames or removes one prints a
warning and skips that shot rather than quietly photographing somewhere else.
It also logs how many of a site's venues are displaced, which is the fastest way
to notice that a group has dissolved under the shot.
