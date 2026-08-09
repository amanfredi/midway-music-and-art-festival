# In-depth code and test review — August 2026

Reviewed 2026-08-09 at commit `4dce690` (plus the baseline/report commits on
top). Method: three parallel read-only lenses (app `site/`, tests `tests/`,
tooling `scripts/`+`tools/`), merged and spot-checked against source by the
orchestrator, with cheap empirical checks run once and desk research on the
library candidates. No code was changed; this is report-only. Fixes are
follow-ups, listed at the end in BACKLOG-import form.

Every finding carries `file:line`, a severity, a confidence label
(verified = read the code and confirmed the mechanism; inferred = reasoned but
not executed), quoted evidence in the source sections, a concrete failure
scenario, and a one-line fix direction. Findings are ordered by user impact,
not by lens.

## The one thing to read first

**No injection is exploitable through the live data source as it stands
today.** The venues tab is the only third-party input currently wired to the
Google Sheet, its fields reach the DOM at three sinks, and all three escape
correctly; the one venue field that could carry a `javascript:` scheme
(`venues.url`) is rendered nowhere. That check was the review's highest-stakes
question and it comes back clean.

What the review did surface is a cluster of **latent** integrity risks that
arm the moment more sheet tabs go live — which DEFINITION.md plans as one-line
config changes — plus **one integrity defect that is live on the venues sheet
right now**:

- A renamed or space-padded column header **silently blanks that field on the
  live site**, with a green build and no warning (F3). This needs no config
  change; a coordinator editing the venues sheet can trigger it today.
- A sponsor logo URL from the sheet is **fetched and served from the festival's
  own origin with no content-type, size, or SVG-safety check** (F1) — and the
  local-logo path resolves `..`, reading arbitrary files off the build runner
  (F2). Both are gated only by the sponsors tab going live.
- An emptied sheet tab **builds clean and deploys an empty festival guide over
  a working one** (F4) — the single case where "the live site stays on the last
  good version" does not hold.

The map and test suites are stronger than "grew through fast QA rounds"
suggests: the map interaction and offline-acceptance tests are genuinely
well-built, and content escaping is applied consistently. The gaps are
concentrated, named below, and cheaply fixable eight weeks out.

## Empirical checks (run 2026-08-09, outputs verbatim)

**Double-build determinism — PASS.** Two sequential `npm run build` runs
produced byte-identical `site/data/content.json`, `site/sw.js`, and
`site/assets/sponsors/` (`diff -r` clean). Both runs logged:

```
Normalized 1 id(s):
  - venues.csv row 12 (Mamas Market & Deli): id "mamasmarket&deli" -> "mamasmarketdeli"
Built site/data/content.json: 14 venues, 60 events, 15 vendors, 11 sponsors, version d32b9e94e182
sw.js generated: version ea2244cf7eec, 47 precached files
```

The build is deterministic for fixed inputs. Note the two version strings
differ by design: `content.json`'s `version` (`d32b9e94e182`) hashes the source
CSVs; `sw.js`'s (`ea2244cf7eec`) hashes all of `site/`.

**Test suite — PASS, 45/45.** `npm test`: 30/30 `node --test` unit tests
(~3.2 s), then 15/15 Playwright tests (offline.spec 5, a11y.spec 8,
boot-retry.spec 2; ~15.4 s), exit 0. One Playwright test runs 12.7 s by design
(it waits out the app's own 1 s + 3 s + 8 s boot-retry backoff). The suite was
green before any review activity, so nothing here is a regression I introduced.

**Fetch-failure — safe.** Building with the venues source pointed at an
unreachable URL (`https://127.0.0.1:9/venues.csv`):

```
Found 1 content error(s):

  - source "venues" (https://127.0.0.1:9/venues.csv) could not be loaded: fetch failed

Fix the field(s) above in the spreadsheet/CSV and re-run the build.
```

Exit 1; the pre-existing `site/data/content.json` and `site/sw.js` were not
modified (hashes unchanged). A source outage is fatal to the build but cannot
publish a broken site — the last good deploy stays live. The one cost is that
this is equally true for code-only changes: with the sheet down, nothing can be
deployed at all (see F17).

**Live-sheet drift observed, not nondeterminism.** The `content.json` already
on disk at the start (version `033d5bee822c`, 9 venues) differed from a fresh
live build (`d32b9e94e182`, 14 venues). Cause is not the build — it is that a
prior `npm test` had left the tree holding fixture content (see F17), and the
live sheet has grown from the committed 9-venue fixture snapshot to 14. Both
are known and tracked; recorded here so the diff isn't mistaken for a
determinism failure.

---

## Prioritized findings

### Integrity and injection (the render/publish trust boundary)

The end-to-end escaping story spans the tooling and app lenses; here is the
joined-up version, because it is the crux of the two P1 clusters.

The **build guarantees structural safety only**: every `content.json` value is
JSON-encoded, so no value can break the file's shape. It constrains a few
fields to closed forms (`id`/`venue_id` to `[a-z0-9-]`, `kind`/`tickets`/
`tier`/vendor `type` to enums, `lat`/`lng` to bbox-checked numbers). For
**everything else — name, title, address, description, blurb, `url`,
`banner_text`, `donation_url` — the build provides no escaping, no scheme
check, no length cap.** Arbitrary sheet text reaches the renderer byte-for-byte
(`scripts/build.mjs:388`, `:611`, `:763` are verbatim `?? ""` passthroughs).

The **app then escapes at the sink**: `util.esc()` (`site/js/util.js:3-8`)
covers `& < > " '`, which is complete for text nodes and for both quote styles
of attribute value, and it is applied at every `content.json` text/attribute
sink in `site/js/` (verified by reading all view files). So HTML-context
injection is closed app-side. The two places this leaves open are (a) URL
schemes, which `esc()` does not touch, and (b) content that never passes
through `esc()` at all — the sponsor logo bytes and the inlined map SVG.

**F1 · sponsor-logo-bytes-unchecked · `scripts/build.mjs:650-659`, `:800-802`
· P1 · verified · latent (arms when the sponsors tab goes live).**
The build fetches an arbitrary sheet-supplied `https` URL and writes the
response body into `site/assets/sponsors/*.svg` with no content-type allow-list,
no size cap, no image sniffing, and no SVG sanitization; the extension comes
from the URL path, so `https://evil.example/logo.svg` returning `text/html`
still lands as a `.svg`. That file is served from the festival's own origin and
precached offline indefinitely. SVG is a script-capable format
(`<script>`, `<foreignObject>`, `onbegin`), so navigating directly to
`/assets/sponsors/<x>.svg` executes attacker JS in the site's origin — same
scope as `localStorage` (`mfc:starred`) and the service worker. `index.html`
carries no CSP (F26), and a page-level `<meta>` CSP would not cover a
directly-navigated asset anyway. The fetch-and-write path is verified; the "SVG
executes JS in the origin" consequence is standard SVG behavior, reasoned rather
than exercised here. *Fix:* allow-list content types, cap body size, and either
sanitize SVG (strip `script`/`foreignObject`/`on*`/script-scheme `href`) or
rasterize at build time.

**F2 · sponsor-logo-path-escape · `scripts/build.mjs:664-671` · P1 · verified ·
latent.** The local-logo branch does `path.join(LOGOS_DIR, logoValue)` on a raw
sheet cell; `path.join` resolves `..`, so a `logo` value of
`../../../../etc/hostname` reads that file and `path.basename` flattens the name
to something innocuous written into `site/assets/sponsors/`. Verified the join
semantics directly:
`path.join('/repo/content/fixtures/logos','../../../../etc/hostname')` →
`/etc/hostname`. On the deploy runner, files readable by the job include
`.git/config` and the process environment; by `actions/checkout`'s default
behavior `.git/config` carries an `http.extraheader` with the job's
`GITHUB_TOKEN` (that token-exposure step is inferred from documented checkout
behavior, not exercised here). Exploitation currently needs repo write (sponsors is a
committed fixture); it goes fully third-party the moment the sponsors tab points
at the sheet. *Fix:* reject `logo` values containing a path separator or `..`;
assert the resolved path stays under `LOGOS_DIR`.

**F3 · silent-column-header-typo · `scripts/build.mjs:118-128` · P1 · verified ·
LIVE on the venues sheet today.** Header cells become object keys verbatim and
are never inspected against the expected column set:

```js
header.forEach((h, i) => { fields[h] = r[i] ?? ""; });
```

CONTRACTS.md's "extra columns are ignored (coordinators may keep notes
columns)" is exactly what makes a rename indistinguishable from an addition. A
coordinator who renames `description` to `Description`, or whose header cell
picks up a trailing space, blanks that field for every row: build prints
nothing, exits 0, CI green, and the live site loses all venue descriptions.
Silent for every optional column; required columns fail, but as "missing
required field" on every row rather than "your header is wrong." Because the
venues tab is live, this is reachable now with no config change. *Fix:* fail (or
loudly warn) when a known column is absent from a header, and flag headers that
match a known column only case- or whitespace-insensitively.

**F4 · empty-source-builds-clean · `scripts/build.mjs:119`, `:139-144` · P1 ·
verified · latent (arms when a tab beyond venues goes live).** Reconciled from
tooling and test lenses, which found the same mechanism at different severities;
rated P1 here for its festival-weekend blast radius, with the precondition
stated. `rowsToRecords` returns `{header: [], records: []}` for a header-only
body, every validator iterates `records`, so zero rows produces zero errors and
a clean `[]`. `loadSource` checks only HTTP status, not content-type or shape.
A tab emptied by a select-all-delete, or whose publish link starts returning an
unrelated single-line body, builds clean and deploys. The service worker then
revalidates, posts `content-updated` (`scripts/sw.template.js:36-39`), and every
online phone swaps its working cached schedule for an empty one — the one place
"the live site stays on the last good version" fails. Today only venues is live,
and an emptied venues tab happens to fail via unresolved `venue_id` references
from the fixture events; the hole opens when events/vendors/sponsors/settings go
live. *Fix:* fail the build when any source yields zero data rows (add a
header-only fixture to lock it in), and reject `text/html` on fetched sources.

**F5 · url-fields-no-scheme-allowlist · `site/js/views/sponsors.js:18`, `:68`;
`scripts/build.mjs:388`, `:763` · P2 · verified · latent (fixture-only today).**
Merged from the app and tooling lenses. `esc()` stops attribute breakout but is
not a URL sanitizer, so `javascript:` and `data:` pass through into `href`:

```js
`<a class="${linkClass}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`
```

The build passes `url` and `donation_url` through verbatim, so neither side
filters. Reachable via `sponsors.url` and `settings.donation_url`, both
fixtures today; live with one line in `content/config.json`. The one URL field
that *is* live-sheet-controlled now, `venues.url`, is rendered nowhere (F23), so
no live sink exists. *Fix:* a `safeHref(url)` helper allowing only
`https:`/`http:`/`mailto:`, applied at all three link sinks — ideally mirrored
as build-time validation so a bad sheet edit fails loudly rather than quietly.

**F6 · precache-`$&`-substitution-breaks-offline · `scripts/build-sw.mjs:43-45`
· P2 (escalated: breaks the acceptance criterion) · verified · latent, chains
from F1/F2.** `String.prototype.replace` expands `$&`, `` $` ``, `$'` in the
replacement string. Verified empirically:
`'const P = __PRECACHE__;'.replace('__PRECACHE__', JSON.stringify(['./assets/sponsors/$&.svg']))`
yields `const P = ["./assets/sponsors/__PRECACHE__.svg"];`. A file under `site/`
whose name contains `$&` (reachable via the unsanitized logo-filename path —
`new URL('https://e.test/$&.svg').pathname` gives basename `$&.svg`, a legal
filename) produces a precache entry for a file that doesn't exist. `cache.addAll`
rejects on the 404, the `install` handler's `waitUntil` rejects
(`sw.template.js:13`), the worker never activates, and **offline stops working
site-wide** while the online site looks healthy. *Fix:* pass a function as the
replacement (`.replace('__PRECACHE__', () => json)`), which disables `$`
expansion.

**F7 · sponsor-logo-filename-collision · `scripts/build.mjs:620-637`, `:800-802`
· P2 · verified.** The bundled filename is the URL basename with no per-sponsor
uniqueness, so two sponsors whose logo URLs both end `/logo.svg` — the common
case for real company sites — write the same file; last write wins and one
sponsor renders the other's logo, with no error. *Fix:* name the file from the
sponsor `id` (already uniqueness-checked): `${id}.${ext}`.

**F22 · settings-values-unvalidated · `scripts/build.mjs:603-614` · P2 ·
verified · latent (fixture-only today).** Only the settings `key` column is
presence- and uniqueness-checked; no value is validated. A `you_are_here_enabled`
typo silently disables the locate button (the app compares `=== "true"`), and
because keys are not trimmed, a trailing space on `donation_url` is a different
key so the donate button silently vanishes. *Fix:* validate against the known
key set (unknown key = error, catching typos) plus value checks for the
enumerated ones. Two smaller build-input gaps in the same area: `http:` sources
are accepted where CONTRACTS specifies `https:` (`build.mjs:136`), and sheet
values are interpolated raw into the public Actions log, so a cell with newlines
can forge error lines (`build.mjs:161-171`) — both P3.

*The OSM/Overpass path is handled correctly* — `esc()` is defined and applied at
both name sinks in `tools/make-map.mjs`, and the map SVG is a committed,
git-reviewed artifact — so the inlined-SVG sink (`site/js/views/map.js:393`) is
safe today, though it *is* a script-capable context whose trust rests entirely on
that generator's escaping.

### User-facing test blindness (bugs that would ship green)

**F8 · now-view-asserted-as-container-only · `tests/offline.spec.mjs:20`,
`tests/a11y.spec.mjs:10` · P1 · verified.** The entire assertion on the app's
default view, in both spec files, is
`await expect(page.locator('[data-testid="now-view"]')).toBeVisible()`. The
on-now filter (`now.js:60`, `x.start <= t && t < x.end`), the two-hour up-next
window, and the per-venue fallback have zero assertions. An off-by-one that
keeps finished sets listed as "on now" ships green, and an attendee walks to a
stage where the band has packed up. *Fix:* assert the exact on-now/up-next title
sets at two or three fixed `?t=` values chosen for boundary behavior (a
15:15 value proves end-exclusivity; a 00:05 value proves the past-midnight
convention).

**F9 · pre-festival-branch-never-executed · `tests/offline.spec.mjs:7`, `:135`
· P1 · verified.** Every Playwright navigation pins `?t=2026-10-03T15:00` except
the one at `:135`, which is the PWA-installability test and asserts nothing
about rendered content. Today (pre-festival) every real visitor takes
`drawNotStarted` (`now.js:94-112`); from Oct 4 every visitor takes `drawEnded`.
Neither branch runs in any test, so the app's live behavior for the next eight
weeks — including at the organizer demo — is unverified by a green CI run. A
throw in that branch blanks the landing view for everyone while CI stays green.
*Fix:* one test at `/` with no `?t=`, asserting the pre-festival hero and a
non-empty opening lineup.

**F10 · schedule-grouping-paths-never-execute · `tests/offline.spec.mjs:40-42` ·
P2 · verified.** No test sets `?group=` or `?day=` or clicks the toggles, so
`renderByVenue` and `renderByCategory` (`schedule.js:49-85`) are dead code as
far as CI is concerned. A festival-goer taps "By venue" and gets an empty list,
or can't look at tomorrow — grouping by category is also the app's only way to
isolate a kind since the filter was removed. *Fix:* one test that clicks each
grouping toggle and each day button, asserting rows stay non-empty and headings
change.

**F11 · banner-reshow-on-id-change-untested · `tests/offline.spec.mjs:82-94` ·
P2 · verified.** The test proves a dismissed banner *stays* dismissed; nothing
proves a new `banner_id` re-shows it (`store.js:71-73`), which is the feature's
whole point per DEFINITION.md's day-of-updates tier. If the comparison regressed,
"Main stage running 30 min late" would be invisible to everyone who dismissed
the earlier notice — i.e. everyone who used the site before the change. *Fix:*
seed `mfc:dismissed-banner` with a stale id via `addInitScript`, load, expect
the banner visible.

**F12 · sw-update-path-untested · `tests/offline.spec.mjs`,
`scripts/sw.template.js:14-25` · P2 · verified.** The offline suite covers a
*first* service-worker install serving cached bytes; it does not cover a second
version installing over a first (`skipWaiting`, `clients.claim`, the
prefix-matched cache deletion). That is the exact mechanism by which any content
update, including the urgent banner, reaches a returning phone — and it is the
project's hostile environment (iOS tab eviction/reload). *Fix:* a two-build
Playwright test that loads v1 offline, deploys v2, and asserts the new version
activates and serves fresh content; and assert `sw.js`'s `VERSION` changes on a
content change and is stable on an unchanged rebuild (the version hash is
asserted by no test today).

### Accessibility (binding contract + spec gaps)

**F13 · schedule-group-toggle-missing-aria-pressed ·
`site/js/views/schedule.js:137-139` · P2 · verified · binding-contract
violation.** The day switcher one block above carries `aria-pressed`
(`schedule.js:132`); the three group-by buttons beside it do not, and no runtime
code patches it. CONTRACTS.md:343-346 binds these to
"`aria-pressed`/`is-active` reflecting the selected button." Selection is carried
only by an `is-active` colour change, so a screen-reader user can operate the
control but cannot tell which grouping is applied (also a WCAG 1.4.1 concern for
the sighted case). *Fix:* add `aria-pressed="${group === '<mode>'}"` to each,
matching the day-tab pattern one block up.

**F14 · now-view-full-redraw-every-60s · `site/js/views/now.js:82`, `:129` · P2
· verified.** `draw()` unconditionally replaces the entire default view every
60 s via `container.innerHTML`, whether or not the on-now set changed. Any
focused element inside is destroyed, so a keyboard or screen-reader user is
dropped to `<body>` and loses their reading position once a minute; a tap in
flight when the timer fires can land on a replaced node. `starred.js:79-96`
deliberately mutates a single row "so toggling a star never disturbs scroll
position" — the same care wasn't applied here. *Fix:* diff the on-now/up-next id
sets against the last render and return early when unchanged, or patch the two
lists in place.

**F15 · sheet-aria-modal-without-modal-semantics ·
`site/js/views/sheet.js:20-52` · P2 · verified.** The sheet declares
`role="dialog" aria-modal="true"` but implements no focus trap (Tab walks into
the six-tab nav behind it), no `inert`/`aria-hidden` on the background, and no
scroll lock (the document scrolls under the 80vh overlay). Escape, click-outside,
and focus-restore are present and correct, so this is a narrow gap against the
ARIA spec, not the contract (which requires only focus-in and focus-restore,
both met). It is also the clearest small library candidate — native
`<dialog>.showModal()` supplies trap + inertness + scroll-lock with zero
dependency. *Fix:* drop `aria-modal` (be honest about behavior) or move to
`<dialog>.showModal()`.

Lower-severity a11y items, verified: map pins are 30+ sequential tab stops with
no roving tabindex, and off-screen pins stay focusable (`map.js:447/462/477`,
P3); each toast is a `role="status"` live region nested inside the
`aria-live` `#toast-root`, a double-announcement pattern (P3); every route has
two `<h1>` (the permanent header plus each view's own, P3); an unknown transit
line renders the literal `undefined` inside the pin diamond (`map.js:86`, P3).

### Correctness and robustness

**F16 · map-render-has-no-cancellation · `site/js/views/map.js:360-373`,
`:525-526`; `site/js/app.js:81`, `:98` · P2 · verified.** `renderMap` captures
DOM references, awaits the 1.87 MB `map.svg` fetch, then keeps writing to the
container; `handleRoute` clears `#view` and renders synchronously on any route
change with no generation token. Tap Map, then another tab before the SVG
resolves: the map's continuation resumes against a wiped container and
`keyList.innerHTML` throws on null — an unhandled rejection, and
`interaction.destroy()` is never returned, so listeners on the detached SVG
leak. The Map → away → Map variant double-binds the zoom buttons. Nothing
visibly corrupts today, but it is error noise plus a leak on a path a user hits
by being impatient on first load — when the SVG is largest and slowest. *Fix:*
capture a render token (module counter or `AbortController`) before the await
and bail if it moved; re-query DOM refs after the await.

**F17 · source-fetch-has-no-timeout-retry-or-fallback · `scripts/build.mjs:139`
· P2 · verified.** The content fetch is a bare `await fetch(value)` — no
`AbortController`, no retry, no fallback to the committed
`content/fixtures/venues.csv`. `tools/make-map.mjs:118-142` wraps the same call
in a 45 s abort plus retries and a mirror endpoint; the build has none of it. A
single transient 500 fails the whole deploy, and during festival weekend a
code hotfix cannot be deployed at all while Google Sheets is unreachable,
because every deploy path rebuilds content from the live sheet. *Fix:* timeout +
2–3 retries; consider an opt-in snapshot fallback for emergency deploys with a
loud build-log banner.

**F18 · inconsistent-latlng-guards-before-maps-links ·
`site/js/views/sheet.js:54-61` vs `:137`, `:151`; `event-detail.js:30` · P2 ·
verified.** Transit and sponsor sheets guard `Number.isFinite(lat/lng)` before
building a Maps link; the venue sheet and event detail do not. Not reachable
today (the build bbox-checks venue coordinates), but a venue with bad
coordinates would render a live "Open in Google Maps" button pointing at
`destination=undefined,undefined` where the other paths correctly render
nothing. `map.js:424` also filters venues by `Number.isFinite`, so map and sheet
disagree about what a valid venue is. *Fix:* one `mapsDirectionsHref(lat, lng)`
returning `''` for non-finite input, used at all four sites (this also removes
the four-way duplication of the Maps URL).

### Test-infrastructure and process

These do not break the site, but they weaken the safety net or make the
documented workflow more expensive. Grouped because they share a root cause: the
test scripts entangle the live sheet, the deploy artifact, and the full
toolchain.

**F19 · npm-test-requires-the-live-google-sheet · `package.json:11`,
`content/config.json` · P2 · verified.** `npm test`'s first step is
`npm run build`, which fetches the live venues sheet. The test *code* is
hermetic (`validation.test.mjs:31-32`), but the script wrapping it is not, so
for an offline-first project the test cannot run offline; a Google outage or an
accidental un-publish turns every push and every 6-hourly cron red; and a
festival-weekend code hotfix cannot deploy while the sheet is unreachable,
because the test job gates the deploy job. *Fix:* point `npm test`'s build step
at `tests/fixtures-good/config.json` and keep the live build in the deploy job,
which already runs it.

**F20 · offline-acceptance-test-runs-against-fixture-content · `package.json:11`,
`tests/validation.test.mjs:21-28`, `scripts/build.mjs:15` · P2 · verified.**
`build.mjs`'s output path is fixed, so the unit tests (which invoke it against
`tests/fixtures-*` configs) overwrite the `content.json` that `npm run build`
just produced from the live sheet, without regenerating `sw.js`. The tree ends
in a state no single build produced, and Playwright then serves it — so the
offline *acceptance* test, the project's stated acceptance criterion, exercises
an artifact no deploy ever produces (the stale 9-venue fixture, not the live
14). **Verified this cannot reach production:** the deploy job checks out fresh
and rebuilds (`deploy.yml:37-42`), and the build outputs are gitignored, so the
mixed state exists only on the test runner and on a developer's laptop — it is a
test-integrity and confusion cost (it caused the stale first screenshot pass in
this very review), not a publish risk. *Fix:* give `build.mjs` an `--out` flag so
tests build into a temp dir and leave `site/` alone; this also fixes F19's
mutation.

**F21 · content-refresh-gated-on-the-whole-toolchain ·
`.github/workflows/rebuild-content.yml:19`, `deploy.yml:26-28` · P2 · verified.**
Every content refresh — the 6-hourly cron and every manual "Rebuild content" —
runs `npm ci`, downloads Chromium uncached, and runs the full Playwright suite
before publishing. Publishing a "main stage running 30 min late" banner during
the festival therefore depends on the npm registry, Playwright's browser CDN,
and a non-flaky browser suite, none of which relate to the content change. This
is the same four-external-dependency critical path (GitHub Actions + npm +
Playwright CDN + Google Sheets) that F17/F19 touch, in a project whose stated
invariant is zero runtime dependencies. *Fix:* cache Playwright browsers keyed on
the lockfile; consider a content-only publish path that reuses the last tested
code.

The remaining test-quality items, verified, lower severity: the 14
`tests/fixtures-bad/*` directories are full five-CSV copies that have already
drifted (13 of 14 are missing the `age_limit` column the real fixture has), so a
schema change means editing 15 copies (P2 — *fix:* generate each bad set from the
good fixtures with one documented cell mutation); `validation.test.mjs:51,104-109`
assert exact fixture counts and a per-kind histogram that mirror the fixture
file and block the fixture refresh BACKLOG asks for (P3); the `mfc:starred` key
name is pinned by a comment but no test (a rename silently wipes every
attendee's stars while tests stay green — one cheap assertion closes it); pinch
and double-tap zoom are untested (P3 — double-tap is cheap, genuine multi-touch
is not and is arguably not worth paying before October).

### Documentation drift and small correctness notes (P3, one-line fixes)

**F23 · venues-url-never-rendered · `site/js/views/sheet.js:63-74` · P3 ·
verified.** `venues.url` is in the schema, emitted by the build, and
live-sheet-controlled today, but rendered nowhere in the app — an organizer who
fills that column gets silence. *Fix:* render it in the venue sheet (via the
`safeHref` from F5), or drop the column from the schema and sheet.

**F24 · stale-kind-filter-test-hook · `CONTRACTS.md:368` · P3 · verified.** The
binding contract lists a `[data-testid="kind-filter"]` hook for a control the
same document says was removed (`:344-347`) and that exists nowhere in `site/` —
found by both the app and test lenses. *Fix:* delete the line.

**F25 · dead-code-and-global-inline-style · `site/js/store.js:37-39`;
`site/js/views/map.js:393` · P3 · verified.** `onContentUpdate`/`listeners` has
no subscribers (`app.js` re-renders directly on the SW message) — dead code.
Separately, the map's inline `<style>` becomes a document-global stylesheet when
inlined via `innerHTML`; every current selector is class- or `#circuit-map`-scoped
so nothing leaks, but a future element selector in the generator would restyle
the whole app. *Fix:* delete the dead fan-out; keep the generator's selectors
scoped.

**F26 · no-content-security-policy · `site/index.html` · P3 · verified.** No CSP
meta tag. GitHub Pages can't set headers, so `<meta http-equiv>` is the only
option, and two current patterns block it (the inline boot module and an
`onclick` handler). Recorded as the reason CSP defense-in-depth isn't available
behind F1/F5, not as a standalone action item — a CSP would not have covered the
directly-navigated sponsor SVG anyway.

---

## Hand-rolled surface inventory

This is the evidence base for the UI/PWA-library question: for each framework-like
surface the app hand-rolls, its size, accessibility sensitivity, and whether a
mature library could plausibly absorb it. Of **2,118 JS lines,
roughly 1,065 (~50%) are framework-like** rather than festival-specific — treat
the split as a judgment call with fuzzy edges (`event-row.js` is both a component
framework and the festival's row design), but the largest concentration is
unambiguous: the map's gesture recognizer alone is 217 lines and does nothing
festival-specific.

| Surface | Location | ~Lines | A11y sensitivity | Library absorbs? |
|---|---|---|---|---|
| Gestures: drag / pinch / double-tap / clamp | `map.js:106-322` | **217** | Medium | **Yes** — map engine, or a pan/zoom lib |
| List/group/template plumbing across views | all views | ~150 | Medium | Partial — a render lib, at real cost to zero-dep |
| Install-prompt state machine | `pwa-install.js`; `sheet.js:85-124` | 137 | Low | Partial — Chromium half only; iOS/macOS copy is bespoke |
| Georeferencing | `geo.js` | 121 | — | **No** — the project's own IP (DEFINITION.md:41) |
| Routing | `router.js`; `app.js:26-34,74-121` | 100 | High | Partial — hash routing is trivial; focus/announce integration is bespoke |
| Boot / retry / SW registration | `index.html:28-56`; `app.js:137-168`; `sw-register.js` | 93 | Low | No |
| ARIA state plumbing | `event-row.js`; `event-detail.js`; `schedule.js`; `app.js` | 68 | **High** | Partial — a toggle-button component would have prevented F13 |
| Time / clock / formatting | `time.js` | 57 | Low | Partial — `Intl.DateTimeFormat` replaces ~30 lines with zero bytes |
| Store / content state | `store.js:1-39,87-103` | 55 | Low | No (nothing is smaller) |
| Sheet / dialog semantics | `sheet.js:8-52` | 45 | **High** | **Yes** — a11y-tested dialog primitive, or native `<dialog>` |
| Storage wrappers (starred, banner) | `store.js:41-85` | 45 | Low | No |
| Banner lifecycle | `app.js:47-63`; `store.js:71-85` | 32 | Medium | No — app-specific |
| Keyboard handling | `map.js:199-218,516-523`; `sheet.js:12-14` | 31 | **High** | Partial |
| Focus mgmt + route announcement | `app.js`; `sheet.js` | 27 | **High** | Partial — routers ship this; the sheet half comes with a dialog primitive |
| Level-of-detail (runtime half) | `map.js:134-152` | 19 | Low | **Yes** — core map-engine feature |
| Toast | `util.js:10-25` | 16 | Medium | Partial |

**Two surfaces concentrate the a11y-sensitive, absorbable code: the sheet/dialog
(45 lines, high sensitivity, cleanly absorbable) and the map's
gestures + LOD + label-collision (217 + 19 lines here, plus the build-time
collision work in `make-map.mjs`, all absorbable by a map engine).** Everything
else is either too small to justify a dependency (routing, store, toast, banner)
or too app-specific to delegate (geo is the project's own georeferencing IP; the
install flow's iOS/macOS branch is bespoke and its correctness only provable on
device).

**What reading can and cannot say about the reported iPhone lag.** Reading
bounds it; it does not diagnose it. Three verified facts: (1) `map.svg` is
**1,416 elements** (934 `<g>`, 439 `<text>`, 29 `<circle>`, 10 `<path>`, plus 4
structural: `svg`/`title`/`style`/`rect`), and all
1.87 MB of weight sits in ten `d` attributes totalling ~1.87 M bytes — so the
"node count" half of the BACKLOG hypothesis is **not supported by the file**;
the cost is concentrated in rasterizing ten very large paths, not DOM size. (2)
Each pan event does one forced layout read plus one `viewBox` write, unthrottled
and un-`requestAnimationFrame`-batched (`map.js:245-249`), so a 120 Hz pointer
stream produces 120 viewBox writes per second; each pinch-move writes a
`transform` to ~500 counter-scaled groups. (3) `renderMap` re-fetches and
re-parses the whole 1.87 MB SVG and rebuilds every pin on every navigation to
`#/map`, with no cached parse (`map.js:393`). **None of this diagnoses the lag —
that needs an on-device Safari profile** (named as a spike below). What it does
say: the rAF-batching and parse-caching wins are available *without* a map
library, so the lag is not, by itself, a decisive argument for MapLibre.

---

## Candidate assessment (addressed to the two decisions)

All sizes measured 2026-08-09 from the packages' published npm `dist` files
(gzipped with `gzip -c | wc -c`) unless labeled otherwise; versions and
confidence are stated per claim. The precache budget to weigh against is
**`map.svg` at ~690 KB gzipped**, per BACKLOG.

### Decision 1 — the map: adopt MapLibre GL JS, or keep hand-rolling?

**Size (verified, MapLibre 6.2.0, current):** the ESM entry is 139 KB gz, its
shared chunk 134 KB gz, the worker 6 KB gz, and the CSS 10 KB gz — **~289 KB gz
total** to self-host offline. The often-quoted "~210 KB" is a partial-import
figure that does not include the shared chunk or worker; the realistic
all-in offline cost is ~289 KB. The last WebGL1-capable line, **5.24.0**, is
~276 KB gz for its UMD bundle plus 10 KB gz CSS (~286 KB) — no smaller, and a
dead-end line.

**WebGL / Lockdown-Mode risk (verified with a caveat):** MapLibre **v6.0.0
removed WebGL1 and now requires WebGL2** (release notes, verified). iOS Lockdown
Mode disables WebGL in Safari — sourced to iOS-16-era reporting (9to5Mac,
2022-07-25) and Apple's Lockdown Mode support page; **whether current iOS still
disables WebGL under Lockdown Mode is unverified** (I could not confirm it
against a 2026 primary source). Lockdown Mode does offer per-site exclusions.
Either way, a static SVG always renders where a WebGL2 map may not: on low-end
phones for certain, and — if Lockdown Mode still disables WebGL on current iOS —
there too. That gap is the heart of the existing BACKLOG concern; the low-end
half stands regardless, the Lockdown half rides on the unverified premise above.

**Offline / bundling (verified feasible):** v6 is ESM-only (the UMD and CSP
builds are gone), self-hostable, and its **`ImageSource` accepts four corner
coordinates for a georeferenced raster** (verified from the API docs) — so the
commissioned hand-drawn artwork *could* ride inside the engine, with pins as
collision-managed symbol layers and per-zoom label placement for free. That is
the strongest technical argument for adoption: it directly retires the two
largest open map items (overlapping-pin clustering, per-zoom label re-placement)
that the hand-rolled code cannot do.

**What it would replace (keyed to the inventory):** the 217-line gesture
recognizer, the 19-line runtime LOD, and the build-time label-collision work in
`make-map.mjs` — call it ~236 app lines plus a chunk of the map generator.

**Labeled recommendation (yours to decide):** *lean no, or at most a
scoped spike — not now.* The ~289 KB gz is additive to, not a replacement for,
the artwork it would display, against a $0/offline-first budget; it forecloses
the low-end-device users a static SVG serves (and, if the Lockdown-Mode premise
holds, those users too); and it
complicates the georeferencing design (`geo.js`) that DEFINITION.md built the
whole map strategy around. The lag — the one argument that would tip this — is
undiagnosed, and the two cheapest lag wins (rAF-batching pan writes,
caching the SVG parse) need no library. Decide it together with commissioning
the artwork, and only after the on-device lag profile; if the profile shows SVG
rasterization is the wall, MapLibre's `ImageSource` path becomes the serious
option and this flips.

### Decision 2 — the UI/PWA layer: adopt a library to absorb hand-rolled a11y?

The inventory says the absorbable, a11y-sensitive surface is small and
concentrated in the dialog. The candidates below are chosen to match that shape:
a tiny dialog primitive (the highest-value, lowest-risk target), a render
runtime (only if the ~150 lines of list/group plumbing justify it), and a
service-worker library (for `sw.js`).

| Candidate | Size (gz, measured 2026-08-09) | Absorbs | Verdict |
|---|---|---|---|
| Native `<dialog>` + `showModal()` | **0 bytes** | F15's sheet: focus trap, inertness, scroll-lock | **Strongest.** No dependency, no invariant cost; supported in all target browsers |
| `a11y-dialog` 8.1.5 | 1.9 KB | Same as above, if `<dialog>` is judged insufficient | Good, documented a11y track record; only if native `<dialog>` falls short |
| Preact 10.29.8 | 4.8 KB | The ~150-line list/group/template plumbing | Marginal — would touch every view for a re-render model the app doesn't otherwise need |
| Lit 3.3.3 | ~5 KB (vendor claim; `dist` chunked, not cleanly measurable) | Same as Preact | Same marginal case; web-components model |
| Shoelace / Web Awesome | per-component ~0.4 KB chunk + shared runtime (est., not a clean self-host measurement) | Toggle buttons (F13), dialog | Component set is heavier to self-host offline than the gap justifies |
| `@panzoom/panzoom` 4.6.2 | 3.9 KB | Part of the 217-line gesture code (no pinch focal, no map semantics) | Only relevant if *not* adopting a map engine; partial |
| Workbox (`workbox-precaching` 7.4.1) | not measured | Hand-rolled `sw.template.js` | See below |

**Workbox (verified maintenance, unmeasured size):** actively maintained at
7.4.1 under Chrome's Aurora team (not deprecated). But the current `sw.js` is
~90 lines, deterministic, zero-dependency, and *working* — Workbox would add a
build-time dependency and bundle weight to replace code that isn't the problem.
The SW findings above (F6, F12) are bugs and test gaps in the hand-rolled worker,
not evidence that it should be replaced. **Recommend: keep the hand-rolled SW.**

**Labeled recommendation (yours to decide):** *adopt native `<dialog>` for the
sheet; adopt nothing else.* It closes the one real a11y-primitive gap (F15) at
zero bytes and zero dependency, which is the exact "absorb the hand-rolled
a11y/cross-browser surface" goal. A render runtime (Preact/Lit) is not justified
— the absorbable plumbing is ~150 lines, and a `groupBy()` helper plus a
`groupSection()` renderer remove most of it with no dependency (see reuse note
below). The a11y contract violations that matter (F13's missing `aria-pressed`)
are one-attribute fixes, not a library-shaped problem.

### Reuse (the buy-vs-build baseline)

The codebase is *not* copy-paste sprawl — `event-row.js`, `sheet.js`,
`pwa-install.js`, and `util.esc()` are genuine shared components. The material
duplication is at the group level, not the row level: venue-grouping logic
appears character-for-character in `now.js:11-20` and `schedule.js:51-57`; the
"accumulate into a Map keyed by field" idiom appears five times; the
`.venue-group`/`.time-group`/`.category-group` markup and CSS are triplicated
(the CSS says so in a comment at `app.css:1222-1224`); and the Google Maps URL
is written out four ways (the direct cause of F18). A `groupBy(items, keyFn)`
helper, a `groupSection({title, rows})` renderer, and a `mapsDirectionsHref()`
helper would remove ~80–100 lines and collapse three CSS blocks into one — **no
framework required.** The row abstraction is right; the group abstraction is the
one that's missing.

---

## Proposed follow-ups (formatted for BACKLOG.md import)

Ordered within each group by user impact. Severity and finding IDs carried so
triage can drop/defer/do without re-reading. Fixes are follow-up work, not part
of this review.

**Security / integrity — do before any tab beyond venues goes live:**
- [ ] Sanitize or rasterize sponsor logos; allow-list content-type, cap size (F1, P1)
- [ ] Confine the local-logo path to the logos dir; reject `..`/separators (F2, P1)
- [ ] Validate expected column headers; flag case/whitespace-only matches (F3, P1 — live today)
- [ ] Fail the build on a zero-row source; reject `text/html` bodies (F4, P1)
- [ ] `safeHref()` scheme allow-list at the three link sinks, mirrored as build validation (F5, P2)
- [ ] Replace `String.replace('__PRECACHE__', json)` with a function replacement (F6, P2 — breaks offline)
- [ ] Name bundled logos from the sponsor id to avoid collisions (F7, P2)
- [ ] Validate settings values (`you_are_here_enabled`, key set, trailing-space keys) (F22, P2)

**Test coverage — the bugs that would ship green:**
- [ ] Assert exact on-now/up-next sets at boundary `?t=` values (F8, P1)
- [ ] One real-clock smoke test of the pre-festival landing view (F9, P1)
- [ ] Schedule day-switch + group-by smoke test (F10, P2)
- [ ] Banner re-show on `banner_id` change (F11, P2)
- [ ] SW update-over-install test; assert `sw.js` version changes on content change (F12, P2)
- [ ] Pin the `mfc:starred` key name; double-tap zoom test (P3)

**Accessibility:**
- [ ] Add `aria-pressed` to the group-by toggle (F13, P2 — contract violation)
- [ ] Stop the 60 s full redraw of the Now view; diff or patch in place (F14, P2)
- [ ] Adopt native `<dialog>` for the sheet (focus trap, inertness, scroll-lock) (F15, P2)
- [ ] Roving tabindex over map pins; skip off-screen pins (P3); fix double-`<h1>`, nested toast live regions, `undefined` transit letter (P3)

**Correctness / robustness:**
- [ ] Render-cancellation token in `renderMap` (F16, P2)
- [ ] Timeout + retries on the content fetch; snapshot fallback for emergency deploys (F17, P2)
- [ ] `mapsDirectionsHref()` helper with finite-coord guard at all four sites (F18, P2)

**Test infrastructure / CI:**
- [ ] Give `build.mjs` an `--out` flag; point `npm test` at fixtures, keep the live build in deploy (F19+F20, P2)
- [ ] Cache Playwright browsers; consider a content-only publish path (F21, P2)
- [ ] Generate `fixtures-bad/*` from the good fixtures with one cell mutation each; drop exact-count/histogram asserts; refresh the 9→14 venue snapshot (P2/P3)

**Refactors (no dependency):**
- [ ] `groupBy()` + `groupSection()` + collapse the triplicated group CSS (~80–100 lines) (reuse, P3)

**Documentation / small correctness:**
- [ ] Decide `venues.url` render-or-drop (F23, P3)
- [ ] Delete the stale `kind-filter` test hook from CONTRACTS.md (F24, P3)
- [ ] Remove dead `onContentUpdate`; keep generator selectors scoped (F25, P3)

**Spikes (out of scope here — reading cannot settle them; rationale in the
"iPhone lag" and map-candidate sections above):**
- [ ] On-device iOS Safari profile of the map — the map-library decision's crux;
      apply the no-library wins (rAF-batch pan, cache the parse) and re-measure
      first (BACKLOG map-library decision)
- [ ] MapLibre `ImageSource` prototype — only if the profile shows SVG
      rasterization is the wall (decide with the artwork commission)

**Sequencing note for the WCAG 2.2 audit (separate BACKLOG item):** the
accessibility findings above (F13–F15 plus the P3 cluster) and the hand-rolled
a11y-surface inventory are that audit's *input*, not its replacement. Sequence
the audit after F13's one-line contract fix and after the `<dialog>` decision,
so it maps a surface that isn't mid-change.
