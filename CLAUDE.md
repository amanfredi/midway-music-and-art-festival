# Midway Music & Arts Fest — map & schedule site

Offline-capable map/schedule PWA for the Midway Music & Arts Fest
(St. Paul, Oct 2–4, 2026). Live at https://go.midwaymusicandart.org/
(github.io redirects there).

## Where things are decided

- `DEFINITION.md` — binding scope and **non-goals**. Don't add what it excludes
  (no native app, no server runtime, no map engine, no push, no search, no
  accounts) without Anthony's say-so.
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

- Zero runtime dependencies, zero external page resources. Every byte
  self-hosted: no CDNs, fonts, analytics, or third-party scripts. Offline and
  $0/month are the point.
- `site/sw.js`, `site/data/`, `site/assets/sponsors/` are generated — edit
  sources and run `npm run build`, never the outputs.
- Build output is deterministic: unchanged sources must produce byte-identical
  `content.json` (and therefore an unchanged service-worker version). Don't
  add timestamps or randomness to build outputs.
- Offline is the acceptance criterion. `npm test` before trusting a change;
  anything touching the service worker or caching also needs the manual
  iPhone airplane-mode pass in README.

## Content

- The venues tab is LIVE from the organizers' Google Sheet (URL in
  `content/config.json`). Venue content fixes belong in the sheet;
  `content/fixtures/venues.csv` is only a committed snapshot of it.
- Events/vendors/sponsors/settings are still placeholder fixtures; swapping
  each to the sheet is a one-line change in `content/config.json`.
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
