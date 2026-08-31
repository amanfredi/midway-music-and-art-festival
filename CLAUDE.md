# Midway Music & Arts Fest — map & schedule site

Offline-capable map/schedule PWA for the Midway Music & Arts Fest
(St. Paul, Oct 2–4, 2026). Live at https://go.midwaymusicandart.org/
(github.io redirects there).

## Where things are decided

- `DEFINITION.md` — binding scope and **non-goals**. Don't add what it excludes
  without Anthony's say-so.
- `CONTRACTS.md` — binding interfaces: CSV schemas, content.json shape, geo/map
  calibration, UI routes, storage keys, test hooks.
- `README.md` — operator how-to: run, test, deploy, content swap, iPhone
  offline verification.
- `PROGRESS.md` — state journal: current status and a dated log of what changed
  and why. Resumed sessions re-orient from it.
- `BACKLOG.md` — all forward-looking work: open decisions, open engineering
  items, the human/device QA checklist, deferred ideas. Nothing belongs in both
  this and PROGRESS.md.

## Invariants

- Everything the app needs to function at runtime should be available from the primary origin and cached for offline use after initial load from Github Pages. Offline and $0/month are the point.
- `site/sw.js`, `site/data/`, `site/assets/sponsors/` are generated — edit
  sources and run `npm run build`, never the outputs.
- Build output is deterministic: unchanged sources must produce byte-identical
  `content.json` (and therefore an unchanged service-worker version). Don't
  add timestamps or randomness to build outputs.
- The build and deploy process should be robust against remote sources being unavailable. If NPM is down, we should still be able to deploy content updates. If a content spreadsheet is unavailable, we should still be able to deploy a code update using the latest available data. This is currently not met; a backlog item tracks compliance.
- Offline is the acceptance criterion. `npm test` before trusting a change;
  anything touching the service worker or caching also needs the manual
  iPhone airplane-mode pass in README.

## Content

- The venues, events and sponsors tabs are LIVE from the organizers' Google
  Sheet (URLs in `content/config.json`). Content fixes belong in the sheet —
  never in either committed copy of it. Two copies exist per live source, with
  distinct jobs: `content/fixtures/<key>.csv` is hand-committed and feeds the
  offline tests, and `content/snapshot/sources/<key>.csv` is machine-written by
  successful builds and feeds only emergency builds (`--use-snapshot`). Neither
  is generated from the other; the duplication is intended.
- Venues may legitimately share a location: Mosaic on a Stick sits inside
  Hamline Park and correctly carries the park's address and plus code, and
  two more venues are ~14 m apart. **Valid data, not an error** (ruled
  2026-08-10) — don't flag it or propose validation against it. Overlapping
  pins are a map-rendering concern, addressed by the MapLibre migration.
- `settings` is the last placeholder fixture; swapping it to the sheet is a
  one-line change in `content/config.json`. Vendors is deliberately empty
  (`"vendors": null`) until the organizers name vendors — a decision recorded
  in config, not an oversight.
- Tests build from local fixtures only — keep them off the network. `npm test`
  builds `site/` from `tests/fixtures-good/config.json`; the broken cases are
  generated from the good fixtures by `tests/fixture-sets.mjs` into temp dirs.
  `npm run build` (live sheet) is what the deploy workflow runs.

## Conventions

- Trunk development on `main`; every push deploys via CI. Plain descriptive
  commit messages — **no ticket IDs** (personal repo; the Transfix convention
  doesn't apply). Use `[skip ci]` for commits that don't change the site.
- Demo clock: append `?t=2026-10-03T15:00` to any URL so "On now" has content
  before October.
