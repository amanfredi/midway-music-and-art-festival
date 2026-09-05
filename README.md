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
`npm run build` afterwards to put the live sheet's content back. The test
server's port is derived from the checkout's path (printed in Playwright's
output; `PW_PORT` overrides it), so suites in different checkouts or worktrees
can run at the same time without fighting over a port.

The Playwright suite is the automated acceptance test: it loads the site, waits
for the service worker, stars an event, goes offline, reloads, and asserts
the schedule, map, sponsor logos, and the star all still work. Run it before
trusting any change to caching or the build.

The build tests run `scripts/build.mjs` against generated copies of the good
fixtures — one deliberately broken cell each (`tests/fixture-sets.mjs`) — into
throwaway output directories, so they never disturb `site/`.

### Two traps when a test serves its own page

Both bit real work in September 2026, and both fail quietly — the harness runs,
the numbers are just wrong.

- **A page route cannot intercept what the service worker answers.** The embed
  and collision specs fulfil their own `data/content.json` or host page through
  `page.route`; the site's worker installs on the first load and serves the
  cached *app* for it on every load after that, so the interception silently
  stops applying partway through a run. `test.use({ serviceWorkers: 'block' })`,
  or `serviceWorkers: 'block'` on the context in a standalone harness.
- **A stand-in host page needs `<meta name="viewport">`.** Without one, mobile
  emulation lays the page out at its 980px fallback width rather than the
  viewport you asked for. That is invisible in a screenshot of a 393px phone —
  it just quietly gives the embedded map a four-column venue key, an iframe
  ~600px shorter than a real phone's, and every measurement taken from it.

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
without the logo. A **missing pin mark still stops the run**: skipping it would
publish the empty pin the rule exists to prevent, so commit the file instead
(see "Sponsor logos and pin marks").

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

### Sponsor logos and pin marks

Sponsor images are never named in the sheet. Both kinds live in
`content/logos/`, named for the sponsor's id — the slug in the sheet's `id`
column:

| file | who needs it | what it is |
|---|---|---|
| `<id>.svg` (or `.png`, `.jpg`, `.webp`) | every tier but `quartz` | the wordmark, shown in the Support list |
| `<id>-pin.svg` or `<id>-pin.png` | `emerald`/`ruby`/`sapphire` **with a location** | the square mark inside the map pin |

**A featured sponsor with a location and no `-pin` file fails the build**,
naming the path it looked for, and the site stays on its last good version
until the file is committed. This is deliberate: a Featured Destination pin
with nothing in it is a paying sponsor's presence quietly disappearing, which
is worse than a deploy that stops and says why. So when the organizers add an
emerald, ruby or sapphire sponsor with an address, the mark has to land in the
same commit. (Unlike a logo, this one is not skippable with
`--skip-invalid-rows`.)

Making a mark: crop the sponsor's own logo down to its square sub-mark — the
monogram, the icon, the thing that is not the words — on a **transparent
background**, tight to the ink. The pin adds its own outline and inset, so any
padding you leave is padding the reader loses. Aim for **256 px** square; below
128 px it will blur on a phone, and the build says so. Anything beyond a 2:1
aspect gets a warning too: contain-fit is honest about proportions, so a wide
mark ends up a sliver inside the square. Keep it under **64 KB** — it is
precached onto every attendee's phone. SVG or PNG only, and **an SVG must carry
`width` and `height` attributes on its `<svg>` root**, not just a `viewBox`:
Safari draws nothing into a canvas without them, so the pin would come out
blank on iPhones and look fine everywhere you tested.

The build prints a line for each of the soft problems (too small, too wide, a
`-pin` file for a sponsor that draws no featured pin) without failing. Read
them; they are the ones a phone will confirm.

### During the festival

Tighten the rebuild cron in `rebuild-content.yml` so sheet edits land fast.
The notice banner ("Main stage running 30 min late") is the `banner_text` /
`banner_id` pair in the settings tab: set the text, change the id, rebuild.
Attendees see it next time their device gets signal; dismissing it sticks
until the id changes again.

## The performers and venues lists on the main website

The organizers' Squarespace site can list the lineup and the venues without
anyone re-typing either. Two scripts deploy with this site, read the same
`data/content.json` the app reads, and fill a Squarespace accordion:

- `js/performers-embed.js` — one item per non-vendor event, alphabetically:
  performer name, bio, where and when to see them, website link.
- `js/venues-embed.js` — one item per venue, alphabetically: venue name,
  address, description, website link.

They are the same file under two names, and each renders the list its filename
asks for. A sheet edit reaches both pages exactly as it reaches the app: on the
6-hour rebuild, or immediately with `gh workflow run rebuild-content.yml`.
Squarespace itself is edited once per page, to set this up, and never again for
content.

### Setting it up

On the performers page, add an Accordion block with a single item, then a Code
block holding one line:

```html
<script src="https://go.midwaymusicandart.org/js/performers-embed.js" defer></script>
```

The venues page is set up the same way, with the other script:

```html
<script src="https://go.midwaymusicandart.org/js/venues-embed.js" defer></script>
```

That accordion item is not filler. It is the template every generated item is
cloned from, and it is what visitors see if the data ever fails to load, so give
it a real title and a real body — "Performers", with a sentence or two about the
lineup underneath; "Venues" and a sentence about the grounds on the other page.
Text styling applied to that body is what the generated bios and venue
descriptions copy.

If the page ends up with more than one accordion, name the right one.
Squarespace gives every block an id, visible in the browser's element inspector:

```html
<script src="https://go.midwaymusicandart.org/js/performers-embed.js"
        data-accordion="#block-yui_3_17_2_1_1788549325512_459" defer></script>
```

With no `data-accordion`, the script takes the first accordion on the page.

Which list a page gets follows from the script's filename, so nothing else
distinguishes the two pastes. To say it outright instead — after a rename, or
when a snippet was copied from the wrong page — add `data-embed="performers"`
or `data-embed="venues"` to the script tag; it overrides the filename. A
`data-embed` value that is neither leaves the page as authored rather than
guessing.

### Styling stays in Squarespace

Each generated item is a copy of the authored one, carrying its classes and so
its fonts, colors, padding, icon, and dividers. Restyling the block in the
Squarespace editor restyles the whole list — no code change, no deploy. This
repo ships no CSS for those pages and adds no classes of its own.

The Squarespace editor doesn't run custom scripts, so an organizer editing the
page sees the lone placeholder item rather than the list; that is the platform
working as designed. Bios and venue descriptions render as plain text with their
paragraph breaks kept — never as HTML, because sheet content is untrusted on
someone else's origin.

### Linking to one performer or venue

Any performer can be linked directly as `#performer-<event id>`, taking the id
from the events tab: `…/performers#performer-artuduo` opens that item and
scrolls to it. Those ids stay meaningful only while one event means one
performer — see the dedupe question in `definitions/performers-page.md` before
publishing them anywhere.

Venues work the same way as `#venue-<venue id>`, from the venues tab:
`…/venues#venue-midwaysaloon`. Those are the same ids the app uses in
`#/venue/<id>`, so the two sites can link to each other's copy of a venue.

### Verifying after a paste

Load the published page in an ordinary tab, not the editor, and open the
browser console. Both pages get the same walk-through; the log prefix is
`[performers]` on one and `[venues]` on the other.

1. The list should have replaced the placeholder item, alphabetically, one
   entry per non-vendor event (or one per venue).
2. The console should carry one `[performers] n performers rendered` line — or
   `[venues] n venues rendered`. A `leaving the page as authored` warning
   instead means the fetch or the markup failed, and names which; the page is
   showing the placeholder, which is the intended failure. That warning under
   the `[embed]` prefix means a `data-embed` value the script doesn't know.
3. No such line at all, and no request for the script in the Network tab, means
   Squarespace never ran the code block. Executing JS in a code block needs a
   Business plan or higher — recalled, not verified, and this is the check that
   settles it. A console error naming the script's URL means the opposite: the
   block ran and something blocked the load, which would be a content blocker
   or a Content-Security-Policy header the site wasn't sending on 2026-09-04.
4. Click an item: it opens with the accordion's usual animation and the icon
   flips. Click again: it closes. Open a second: the first closes, unless the
   block's "allow multiple open" setting says otherwise.
5. Load the page with `#performer-<id>` (or `#venue-<id>`) appended: that item
   opens and the page scrolls to it. Change the hash without reloading and the
   new one opens.
6. The rule between items should be a single line, and the placeholder item
   should be nowhere in sight.
7. On the performers page, each bio should end with a line naming the venue,
   day and start time. An act whose venue has gone missing from the sheet is
   the one case that line is absent.

### Changing the script

`site/js/performers-embed.js` is the canonical file and
`site/js/venues-embed.js` is a byte-identical copy of it — one script under two
names, so each Squarespace page can load a plain one-line `<script src>` and
still get its own list. Nothing generates the copy, so after editing the
canonical file:

```sh
cp site/js/performers-embed.js site/js/venues-embed.js
```

`npm test` fails if the two ever differ, with that command in the failure
message, so a forgotten copy shows up as a red test rather than as a venues
page quietly running last month's script. Neither page needs re-pasting when
the script changes — they load it by URL.

## The map on the main website

The Squarespace site can show the festival map itself rather than a link to it:
the same map, the same pins, the same venue sheets, inside the organizers' own
page. One URL does it —

```
https://go.midwaymusicandart.org/?embed=map
```

— the app's Map view with its own header and tab bar suppressed. It changes
nothing for anyone who visits go.midwaymusicandart.org directly, and content
reaches it exactly as it reaches the app: on the 6-hour rebuild, or immediately
with `gh workflow run rebuild-content.yml`. Squarespace is edited once, to set
this up, and never again for content.

It is live at **www.midwaymusicandart.org/map**, which is not in the site's
sitemap and is reachable only by its URL or by whatever links to it — so a page
search will not find it.

### Setting it up

Put a Code block in a **full-width** section of the map page holding this:

```html
<style>
  .mmaf-map-embed { display: block; width: 100%; border: 0; height: 1400px; }
  @media (max-width: 520px) { .mmaf-map-embed { height: 1810px; } }
</style>
<iframe class="mmaf-map-embed"
        src="https://go.midwaymusicandart.org/?embed=map"
        title="Midway Music &amp; Arts Fest map"
        loading="lazy"
        allow="geolocation"></iframe>
<script>
  window.addEventListener('message', function (event) {
    var frame = document.querySelector('.mmaf-map-embed');
    if (!frame || !event.data || event.data.type !== 'mmaf-embed-height') return;
    if (event.source !== frame.contentWindow) return;
    var height = Number(event.data.height);
    if (height > 200 && height < 6000) frame.style.height = height + 'px';
  });
</script>
```

`allow="geolocation"` is what lets the locate button work. Without it the button
is still there and does nothing.

Then add an ordinary text block under the embed with a link to the full guide,
worded however the page wants — something like "Planning your day? The full
schedule, your saved events and the map are at go.midwaymusicandart.org." That
link is the whole mobile story: the embedded map works on a phone, but the
schedule, starring and search only exist in the app, and a phone-sized iframe is
a poor place to meet them. Keeping the link in Squarespace's own content means
the organizers can reword it without a deploy.

### Why there is a script, and what happens without it

An iframe is exactly as tall as you tell it to be, and this one cannot be told
once. The venue list under the map lays out in as many columns as the iframe is
wide enough for, so the height it needs steps as the width crosses each column
boundary — measured at 21 venues, roughly 1060 px at four columns, 1110 at
three, 1340 at two, 1780 at one. A stylesheet here can only ask about *this
page's* width, while the column count follows the *iframe's* width, which
Squarespace decides from whatever section the block is in. Any fixed number can
therefore land on the wrong step, and landing short puts a second scrollbar
inside the map block.

So the map measures itself and posts its height to this page, and the listener
applies it. Nothing else is sent, ever, and the listener ignores messages from
anywhere but this iframe.

The two heights in the `<style>` block are the fallback for a visitor whose
browser blocks the script: generous enough that nothing scrolls inside the
iframe at any width, at the cost of some blank space under the venue list. If
the venues tab grows a lot, those two numbers are the only thing to revisit —
and only for that fallback. Step 3 below is the check either way.

### Verifying after a paste

Load the published page in an ordinary tab, not the Squarespace editor.

1. The map draws, with numbered venue pins on it, a legend under it and the
   numbered venue list under that. No Midway header bar, no row of app tabs, and
   no notice bar above the map — the app's banner is deliberately left out of
   the embed, so anything the organizers need to announce here belongs in the
   Squarespace page itself.
2. Put the pointer over the map and scroll: the **page** scrolls and the map
   stays put. Hold Ctrl (Cmd on a Mac won't do it) and scroll: now the map
   zooms. That swap is deliberate — without it, scrolling down the page stops
   dead on the map.
3. Scroll to the bottom of the embed: the last venue in the list should be
   followed by the page's own content, with no scrollbar of its own down the
   side of the map block and no band of blank space under the last venue. Either
   one means the height message is not getting through — check that the
   `<script>` half of the snippet was pasted, and that the class on the iframe
   still matches the one the listener looks for.
4. Click a pin, or a venue in the list: the venue sheet opens **over the map**
   and the page does not move under you. Escape or the × closes it. A page that
   jumps down to the bottom of the map block instead is running a deploy from
   before 2026-09-05, when the sheet was pinned to the bottom of the iframe —
   which on a phone is a screen and a half below the map.
5. Click one of the events inside that sheet: it opens the full app in a new
   tab, on that event. It must not navigate the embed itself — there is no tab
   bar in there to get back with.
6. Click the ◎ locate button: the browser asks for location permission. Nothing
   happening means `allow="geolocation"` is missing from the iframe tag. Deny
   it, and the explanation appears as a dark bar across the map — over the map
   rather than at the bottom of the block, for the same reason as step 4.
7. On a phone: one finger scrolls the page past the map, two fingers pan the
   map, and the link out of step 1's text block is visible without hunting.

If the map block is blank, the code block never ran — the same Business-plan
question the performers page settles, and the same check: look in the Network
tab for a request to `go.midwaymusicandart.org`.

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
   still starred. Look at the **Featured Destination squares**: each should
   carry its sponsor's mark, not an empty red outline. An empty one means that
   mark did not load from the cache (or, on Safari specifically, that an SVG
   mark lost its `width`/`height` — the build rejects those, so this would be a
   new way to get there).
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
| `content/logos/` | Sponsor images, named for the sponsor's id and never in the sheet: the wordmark `<id>.svg` (or `.png`, `.jpg`, `.webp`), and for a sponsor that draws a Featured Destination pin the square mark `<id>-pin.svg` or `<id>-pin.png` (see "Sponsor logos and pin marks") |
| `content/config.json` | Where content comes from (fixture paths or sheet URLs) |
| `content/snapshot/` | Generated: the last bytes fetched from each remote source, and where `use_content_snapshot` reads a source the build can't reach |
| `scripts/` | Build (CSV→JSON, validation), service-worker generator, dev server |
| `.github/scripts/` | Zero-dependency helpers the workflows run: the content-publish gate and the failure email |
| `tools/` | One-off generators (map GeoJSON and calibration from OSM data, transit stops, PWA icons, ticket-icon sprite), `vendor-maplibre.mjs`, and `shoot.mjs`, which renders routes to PNGs in `.screenshots/` for visual review |
| `tests/` | Unit tests (validation, georeferencing) + Playwright offline test |
| `.github/workflows/` | Deploy on push; scheduled/manual content rebuild (which invokes no npm, by design) |
