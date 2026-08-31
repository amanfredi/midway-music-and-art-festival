# Midway Music & Arts Fest — map & schedule site

An offline-capable map and schedule website for the Midway Music & Arts
Fest (October 2–4, 2026, St. Paul, MN).
Attendees load it once, and it keeps working on festival day even with no cell signal.
Schedule, venue map, and starred events all survive airplane mode and browser tab reloads.

> **Some content on the demo site is placeholder.** All artist, vendor,
> and sponsor names are currently fictional.
> Venues are populated from the live spreadsheet.

The design goals and decision history live in [DEFINITION.md](DEFINITION.md);
internal component interfaces in [CONTRACTS.md](CONTRACTS.md).

## How it works

The site is plain HTML/CSS/JS on GitHub Pages — no framework, no server, no
accounts, no external requests. A service worker precaches every file on
first visit and serves everything from cache afterward, so being offline (or
having the tab evicted and reloaded, as iOS Safari likes to do) doesn't
break anything. Content comes from CSV — placeholder data via committed fixture files, and
live data from coordinator-edited Google Sheets — and a build script validates it and
compiles it into the JSON the site reads. A broken edit fails the build with
a readable error instead of shipping a broken site.

## Run it locally

Built and tested on Node 24–25 (CI runs 24). The map engine (MapLibre GL JS)
is the one runtime dependency, and it is vendored into `site/assets/maplibre/`
rather than fetched, so the site still loads nothing from anyone else's server.
`npm install` is only needed for the tooling — Playwright, and the pinned
`maplibre-gl` package that `npm run vendor:maplibre` copies from.

```sh
npm install            # one-time, dev tooling only
npm run build          # content sources -> site/data/content.json + site/sw.js
                       # (venues comes from the live sheet; the rest are fixtures)
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
npm test                          # fixture build + unit tests + Playwright offline test
```

`npm test` needs no network: it builds `site/` from the local fixtures
(`npm run build:fixtures`, content and service worker together) and serves that
to Playwright, so the suite runs on a tree one build actually produced. Run
`npm run build` afterwards to put the live sheet's content back.

The Playwright suite is the automated acceptance test: it loads the site, waits
for the service worker, stars an event, goes offline, reloads, and asserts
the schedule, map, sponsor logos, and the star all still work. Run it before
trusting any change to caching or the build.

The build tests run `scripts/build.mjs` against generated copies of the good
fixtures — one deliberately broken cell each (`tests/fixture-sets.mjs`) — into
throwaway output directories, so they never disturb `site/`.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: tests, then build,
then deploy to GitHub Pages. To deploy on demand instead — after a sheet
edit, or to re-run a failed deploy — both workflows accept a manual trigger:

```sh
gh workflow run deploy.yml           # test + build + deploy (~90s)
gh workflow run rebuild-content.yml  # re-pull the sheet and redeploy
gh run watch                         # follow the run to completion
gh run list --limit 5                # or just check recent results
```

The Actions tab does the same thing. There is deliberately no local deploy
script: Pages is set to `build_type=workflow`, so it publishes only what the
workflow uploads, and that path is what enforces the "tests must pass first"
gate. Publishing from a laptop would mean switching Pages to branch-based
deploys, which also means carrying a `CNAME` file in the published branch to
keep the custom domain — worth knowing before anyone tries it.

One-time repo setup (already done if the site is live): repo must be public
(free-plan Pages requirement), then

```sh
gh api -X POST repos/amanfredi/midway-music-and-art-festival/pages -f build_type=workflow
```

A failed run emails the addresses in the `DEPLOY_NOTIFICATION_EMAIL` repository
variable; a failure caused by a spreadsheet edit also goes to
`CONTENT_NOTIFICATION_EMAIL`, since that is the failure the organizers can fix.
Mail goes out over Fastmail SMTP using the `FASTMAIL_USER` variable and the
`FASTMAIL_APP_PASSWORD` secret. The step is best-effort: a send failure is
logged and never changes the run's own result.

## Emergency deploys

Three things can stop a deploy — two outages and a bad sheet edit — and each has
one command that gets around it. All are deliberate acts: nothing falls back on
its own. A rebuild can also stop on its own, deliberately — the last case below.

### The content sheet is unreachable

The failing run says `source "venues" … could not be reached`, or `… returned
HTTP 503 on every attempt` when the sheet answers with 5xx. Publish from the
last saved copy of whatever can't be reached:

```sh
gh workflow run deploy.yml -f use_content_snapshot=true
gh run watch
```

Sources that can still be reached are fetched live as usual. For the rest the
build serves `content/snapshot/`, validates those bytes exactly as it validates
live ones, and refuses to publish a source it has no saved copy of. It says what
shipped stale and since when: `STALE CONTENT` in the build log, a warning
annotation on the run, and the same lines in the job summary.

A source that answers *wrongly* — a 404, or a sign-in page where CSV should be —
fails the build even with this flag. The snapshot covers outages, not link rot.

Nothing pins the site to those bytes afterwards. Once the sheet answers again,
the next 6-hour rebuild fetches it live and publishes whatever changed.

### npm is unreachable

Content updates never touch npm, so publish one the usual way:

```sh
gh workflow run rebuild-content.yml
```

A code change still needs the test job — but try the normal deploy first. npm
and the Playwright browsers both install from caches keyed on
`package-lock.json`, so an unchanged lockfile may need nothing from the
registry. GitHub evicts caches untouched for 7 days, though, and this path has
never been tried against a real outage. If it fails:

```sh
gh workflow run deploy.yml -f skip_tests=true
```

That publishes with no tests run at all. It exists for the case where the
alternative is not shipping.

### The sheet has bad rows and the fix can't wait

The failing run names the rows: `venues.csv row 16 ("Hive Collaborative"):
missing required field "location".` The fix is sheet-side, but if a deploy has
to go out first, publish the rows that are good:

```sh
gh workflow run deploy.yml -f skip_invalid_rows=true
```

Sources are fetched live as usual and every row is validated as usual — the run
just leaves out the ones that fail instead of stopping. An event whose venue was
dropped is dropped with it, so nothing ships pointing at a venue that isn't
there. A sponsor whose logo is the only problem keeps its place and publishes
without the logo.

It says what it left out: `SKIPPED n invalid row(s)` in the build log, a warning
annotation on the run, and the rows in the job summary.

This skips rows, not files. An unreachable source, a renamed header column, or a
tab with no data rows still fails — as does a tab where *every* row is bad, which
would empty the guide. And it never updates `content/snapshot/`: that copy stays
the last content that passed in full, so a later `use_content_snapshot` deploy
isn't quietly building on a partial one.

The 6-hour rebuild has no such flag and keeps failing on those rows. Fix the
sheet.

### A rebuild publishes nothing

Two reasons, and its job summary says which.

The rebuild republishes only code that has already passed a Deploy run, and
stops whenever it can't confirm that — usually because the most recent completed
Deploy run on `main` failed, or because a commit touching `site/`, `scripts/`,
or `content/` outside `content/snapshot/` hasn't been through one. Run
`gh workflow run deploy.yml`, which publishes the code and leaves the passing
run the gate looks for, or fix the red run, and the next rebuild goes through.

Or every source came back byte-identical to the snapshot, in which case the
rebuild succeeds without deploying.

## Content updates

`content/config.json` maps each content tab (venues, events, vendors,
sponsors, settings) to a source: either a fixture CSV in `content/fixtures/`,
or a Google Sheet tab published to the web. The build treats both
identically, so the swap is config-only:

1. Create a Google Sheet with tabs whose header rows match the fixture
   CSVs (column reference: CONTRACTS.md). Venue and vendor positions go in a
   single `location` column that takes either decimal coordinates
   (`44.9557, -93.1668`) or the plus code shown on a Google Maps place card
   (`XR4H+C2 St. Paul, Minnesota`) — on a phone, copying the plus code is the
   easy path.
2. File → Share → Publish to web → select each tab → CSV format → copy each
   tab's URL.
3. Replace the paths in `content/config.json` with those URLs; commit.

After that, a coordinator edits the sheet and the site rebuilds either on
the 6-hour schedule in `.github/workflows/rebuild-content.yml` or on demand
(`gh workflow run rebuild-content.yml`, or Actions tab → "Rebuild content" →
Run workflow). Validation errors —
misspelled venue ids, bad dates, missing fields — fail the build with a
message naming the tab, row, and problem; the live site stays on the last
good version. A renamed or space-padded column header, a tab emptied of its
rows, and a publish link that starts answering with a sign-in page fail the
same way rather than quietly publishing a hole.

### During the festival

Tighten the rebuild cron in `rebuild-content.yml` so sheet edits land fast.
The notice banner ("Main stage running 30 min late") is the `banner_text` /
`banner_id` pair in the settings tab: set the text, change the id, rebuild.
Attendees see it next time their device gets signal; dismissing it sticks
until the id changes again.

## Swapping in the real map artwork (maybe)

The map today is drawn by MapLibre from OpenStreetMap street centerlines
(`site/assets/map-vector.geojson`). Commissioned artwork would replace that
ground with an image, under one hard constraint the artist must know **before
starting**: the artwork must be drawn over the true-scale street grid —
stylize freely on top (colors, texture, decoration), but keep street positions
to scale. That is what lets venue pins and the optional "you are here" dot land
correctly via the control-point calibration in
`site/assets/map-calibration.json`. To recalibrate: pick 3+ spread-out,
non-collinear landmarks whose lat/lng you know, record each one's x/y position
in the artwork's coordinate space, and replace `control_points`.

Two measured constraints go in the artist brief before anyone is commissioned —
a georeferencing error and a resolution ceiling, both in BACKLOG.md under "Map
artwork". Neither is a reason not to commission artwork; both change what has to
be delivered.

## Verifying offline on a real iPhone

The automated test covers Chromium; iOS Safari is the environment that
matters and needs a hands-on check after any caching change:

1. Open the deployed site in Safari over cellular or Wi-Fi. Browse: Now,
   Schedule, Map, Vendors, Support. Star an event.
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

## Known limitations

- **The installed app and the Safari tab don't share storage on iOS.**
  Adding the site to the Home Screen gives it its own isolated storage
  context, separate from the regular Safari tab — starred events (and
  everything else in `localStorage`) don't carry over between the two. Not
  worth fixing: pick one and stick with it for the festival.
- **Non-installed iOS Safari storage is deleted after 7 days without a
  visit.** This is Safari's Intelligent Tracking Prevention, not a bug —
  [WebKit bug 209563](https://bugs.webkit.org/show_bug.cgi?id=209563).
  `navigator.storage.persist()`, requested silently at startup, does **not**
  prevent it on iOS; only adding the site to the Home Screen does. (On
  Chrome/Android, `persist()` does its job: it protects against eviction
  under disk pressure.) The in-app install button exists mainly to get
  people onto the Home Screen path.

## Repository map

| Path | What it is |
|---|---|
| `site/` | The deployed site (everything in it ships verbatim) |
| `site/sw.js`, `site/data/`, `site/assets/sponsors/` | Generated by the build — never hand-edit |
| `content/fixtures/` | Placeholder CSV content, and what the offline tests build from |
| `content/logos/` | Sponsor logos, one file per sponsor named `<sponsor id>.svg` (or `.png`, `.jpg`, `.webp`) — the sheet names no filenames |
| `content/config.json` | Where content comes from (fixture paths or sheet URLs) |
| `content/snapshot/` | Generated: the last bytes fetched from each remote source, and where `use_content_snapshot` reads a source the build can't reach |
| `scripts/` | Build (CSV→JSON, validation), service-worker generator, dev server |
| `.github/scripts/` | Zero-dependency helpers the workflows run: the content-publish gate and the failure email |
| `tools/` | One-off generators (map GeoJSON and calibration from OSM data, transit stops, PWA icons, ticket-icon sprite), `vendor-maplibre.mjs`, and `shoot.mjs`, which renders routes to PNGs in `.screenshots/` for visual review |
| `tests/` | Unit tests (validation, georeferencing) + Playwright offline test |
| `.github/workflows/` | Deploy on push; scheduled/manual content rebuild (which invokes no npm, by design) |
