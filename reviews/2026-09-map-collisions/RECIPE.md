# Deliberate label collisions and the desktop map frame — change evidence

Before/after captures for the 2026-09-04 map work (`definitions/squarespace-map-embed.md`).
**Change evidence, not a baseline.** Four states at two widths, against snapshot
content rather than the live sheet — the full baseline recapture is still owed
and is tracked in BACKLOG.md.

Three sets, each the same eight shots:

| prefix | code |
|---|---|
| `before-` | commit `c63b187`, before any of this work |
| `after-` | the collision rulings only (commit `a45c739`) |
| `after-wide-` | plus the desktop map frame (commit `d021bce`) |

The four states, at `phone` (393×852, touch) and `desktop` (1440×900):

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

## State at capture

Build outputs are gitignored, so the commit alone does not pin the content.
All three sets were captured against a build from `content/snapshot/sources/`
(see below), which produced `site/data/content.json` version **`fb2eb71e70b1`**
— 21 venues, 34 events, 6 sponsors. `content/snapshot/sources/sponsors.csv`
changed afterwards in `ecf5279`, so the same command today builds
`40f85f499538` instead; the venues and events the captures are about are
unchanged, and the before/after comparison is between two builds of identical
bytes either way.

The live sheet could not be built from: the venues tab's `id` column header had
been overwritten with `5`, which fails the build (BACKLOG, top). The snapshot is
the last bytes that passed.

## Reproduction commands

Prerequisites: `npm install`, `npx playwright install chromium`.

The live sheet is what `npm run build` uses, and what these shots should be
taken against once the sheet is fixed. To reproduce them exactly as committed,
build from the snapshot instead — a config of your own pointing at
`content/snapshot/sources/*.csv` plus `content/fixtures/settings.csv`, since
nothing in the repo ships one:

```sh
node scripts/build.mjs --config /tmp/snapshot-config.json && node scripts/build-sw.mjs
node reviews/2026-09-map-collisions/shoot-map-collisions.mjs --prefix after
```

Beware the same trap as the 2026-08 baseline: `npm test` leaves `site/` rebuilt
from the committed fixtures, which are a different venue set. Rebuild before
capturing.

The helper drives the engine through the `window.__mmafMap` test hook and
centres on venues by id, so a sheet edit that moves a pair out of a coincident
group prints a warning and skips that shot rather than quietly photographing
somewhere else.
