# Midway Festival Circuit Map

An offline-capable map and schedule website for the Midway Music & Arts
Festival (October 2–4, 2026, St. Paul, MN) — the digital version of the
festival's "Circuit Map". Attendees load it once, and it keeps working on
festival day even with no cell signal: schedule, venue map, and starred
events all survive airplane mode and browser tab reloads.

> **Everything on the demo site is placeholder.** All venue, artist, vendor,
> and sponsor names are fictional (the streets are real). Do not treat
> anything here as actual festival information.

The design goals and decision history live in [DEFINITION.md](DEFINITION.md);
internal component interfaces in [CONTRACTS.md](CONTRACTS.md).

## How it works

The site is plain HTML/CSS/JS on GitHub Pages — no framework, no server, no
accounts, no external requests. A service worker precaches every file on
first visit and serves everything from cache afterward, so being offline (or
having the tab evicted and reloaded, as iOS Safari likes to do) doesn't
break anything. Content comes from CSV — committed fixture files today, a
coordinator-edited Google Sheet later — and a build script validates it and
compiles it into the JSON the site reads. A broken edit fails the build with
a readable error instead of shipping a broken site.

## Run it locally

Built and tested on Node 24–25 (CI runs 24). There are no runtime
dependencies; `npm install` is only needed for the test tooling (Playwright).

```sh
npm install            # one-time, dev tooling only
npm run build          # CSV fixtures -> site/data/content.json + site/sw.js
npm run serve          # http://localhost:4173
```

While developing:

- `?t=2026-10-03T15:00` freezes "now" at a festival-weekend moment, so the
  "On now" view has content before October.
- The service worker caches aggressively by design. In DevTools, use
  Application → Service workers → "Update on reload" while iterating, or
  bump anything in `site/` and re-run `npm run build` (the worker versions
  itself from a hash of the site's contents).

## Tests

```sh
npx playwright install chromium   # one-time browser download
npm test                          # build + unit tests + Playwright offline test
```

The Playwright suite is the automated acceptance test: it loads the site, waits
for the service worker, stars an event, goes offline, reloads, and asserts
the schedule, map, sponsor logos, and the star all still work. Run it before
trusting any change to caching or the build.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: tests, then build,
then deploy to GitHub Pages. One-time repo setup (already done if the site
is live): repo must be public (free-plan Pages requirement), then

```sh
gh api -X POST repos/amanfredi/midway-music-and-art-festival/pages -f build_type=workflow
```

## Content updates

`content/config.json` maps each content tab (venues, events, vendors,
sponsors, settings) to a source: today a fixture CSV in `content/fixtures/`,
later a Google Sheet tab published to the web. The build treats both
identically, so the swap is config-only:

1. Create a Google Sheet with five tabs whose header rows match the fixture
   CSVs (column reference: CONTRACTS.md).
2. File → Share → Publish to web → select each tab → CSV format → copy each
   tab's URL.
3. Replace the five paths in `content/config.json` with those URLs; commit.

After that, a coordinator edits the sheet and the site rebuilds either on
the 6-hour schedule in `.github/workflows/rebuild-content.yml` or on demand
(Actions tab → "Rebuild content" → Run workflow). Validation errors —
misspelled venue ids, bad dates, missing fields — fail the build with a
message naming the tab, row, and problem; the live site stays on the last
good version.

### During festival weekend

Tighten the rebuild cron in `rebuild-content.yml` so sheet edits land fast.
The notice banner ("Main stage running 30 min late") is the `banner_text` /
`banner_id` pair in the settings tab: set the text, change the id, rebuild.
Attendees see it next time their device gets signal; dismissing it sticks
until the id changes again.

## Swapping in the real map artwork

The current map is a generated placeholder drawn from OpenStreetMap street
centerlines at true scale (1 SVG unit = 1 meter). The commissioned artwork
replaces `site/assets/map.svg`, under one hard constraint the artist must
know **before starting**: the artwork must be drawn over the true-scale
street grid — stylize freely on top (colors, texture, decoration), but keep
street positions to scale. That's what lets venue pins and the optional
"you are here" dot land correctly via the control-point calibration in
`site/assets/map-calibration.json`. To recalibrate for new artwork: pick 3+
spread-out, non-collinear landmarks whose lat/lng you know, record each
one's x/y position in the new SVG's coordinate space, and replace
`control_points`. Nothing else changes.

## Verifying offline on a real iPhone

The automated test covers Chromium; iOS Safari is the environment that
matters and needs a hands-on check after any caching change:

1. Open the deployed site in Safari over cellular or Wi-Fi. Browse: Now,
   Schedule, Map, Sponsors. Star an event.
2. Optionally add to Home Screen (Share → Add to Home Screen) and open from
   the icon.
3. Turn on Airplane Mode (leave Wi-Fi off).
4. Reload the page. Everything should load instantly: schedule browsable,
   map pans and shows pins, sponsor logos render, your starred event is
   still starred.
5. Kill Safari (swipe away), reopen, load the site again — still offline.
   This simulates iOS evicting the tab.
6. Turn Airplane Mode off, reload once, and confirm the site still works
   online (it should quietly pick up any newly published content).

Stars live only on the device (`localStorage`); iOS may clear them if the
site goes unused for ~7 days — acceptable for a 3-day festival, worth
knowing when testing weeks apart.

## Repository map

| Path | What it is |
|---|---|
| `site/` | The deployed site (everything in it ships verbatim) |
| `site/sw.js`, `site/data/`, `site/assets/sponsors/` | Generated by the build — never hand-edit |
| `content/fixtures/` | Placeholder CSV content + sponsor logo SVGs |
| `content/config.json` | Where content comes from (fixture paths or sheet URLs) |
| `scripts/` | Build (CSV→JSON, validation), service-worker generator, dev server |
| `tools/` | One-off generators: map SVG from OSM data, PWA icons |
| `tests/` | Unit tests (validation, georeferencing) + Playwright offline test |
| `.github/workflows/` | Deploy on push; scheduled/manual content rebuild |
