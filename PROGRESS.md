# Build progress — Midway Music & Arts Fest site

Orientation file for resumed sessions. Authoritative scope: DEFINITION.md.
Execution mechanics: PROMPT.md. Integration spec: CONTRACTS.md.

## Status: POC complete and LIVE (2026-08-01)

Live URL verified: https://amanfredi.github.io/midway-music-and-art-festival/
(HTTP 200; SW active over HTTPS with correct scope; CDP installability errors
empty; offline reload on the live site rendered schedule + map + pins.)
Remaining items are Anthony's: real-iPhone airplane-mode test (README steps),
Google Sheet creation when real content exists, Aug 8–9 organizer demo.

## Milestones

- [x] Definition + prompt committed
- [x] CONTRACTS.md written (schemas, interfaces, file ownership)
- [x] Local-LLM experiment: placeholder content drafts (reviewed + cleaned; geography and collision-risky names fixed by orchestrator)
- [x] Agent A: content pipeline (build.mjs, fixtures, validation + tests) — audited, merged
- [x] Agent B: UI views — audited, merged
- [x] Agent C: map generation (OSM→SVG), geo.js affine module + tests — audited (tests re-run, SVG rendered + eyeballed, scope clean), merged to main
- [x] Orchestrator: PWA shell (manifest, icons), service worker + build-sw.mjs, serve.mjs
- [x] Orchestrator: Playwright offline test (needs integrated site to run)
- [x] Integration: merged, `npm run build` + `npm test` green locally AND in CI (run 30721533589: 15 unit + 3 Playwright pass)
- [x] CI: deploy.yml + rebuild.yml committed; test job green; deploy job fails at configure-pages until repo is public
- [x] README rewrite (write-doc skill, editorial subagent pass applied)
- [x] Verification: offline test (Playwright + dead-server harness), validation failure (bad-date fixture, readable message, exit 1), installability (CDP getInstallabilityErrors = [], manifest parse errors 0). Live-URL check pending repo visibility.
- [x] Final report delivered in session
- [] Review site for accessibility according to WCAG 2.2 and update Accessibility contract in CONTRACTS.md if necessary - see reference/ directory
- [] QA on android
- [] Agent review from user perspective. Maybe using Claude for chrome or claude cowork features?
- [] Bus routes 67 and 72: draw the **routes as lines** on the map rather than
  their stops as pins. Rejected adding ~40+ stop pins (clutter, and the map now
  covers 24 sq mi); a route line gives the same "the bus goes along here"
  information at a fraction of the visual cost. Deferred, not dismissed.
- [] Deeper map-design pass against `reference/Accessibility - map-design-guide
  (updated)_tcm38-565153.pdf`. The 2026-08-08 QA round retuned scale, density
  and labeling by eye; the guide covers contrast, symbol size and legend
  conventions systematically. Worth doing before commissioning hand-drawn
  artwork — a hand-drawn map is still on the table, and `geo.js` was built so
  that swapping artwork means new control points only.

### Open decisions from the 2026-08-08 QA round (Anthony's call)

Shipped as-is; each is a deliberate default that can be changed cheaply.

- [] **Transit pin density.** Widening the map bbox took transit pins from 10
  to 34, out as far as Stadium Village and Selby & Arundel. They're accurate,
  but far more than the one stop (Raymond Ave) that was actually requested.
  Keep the full set as context, or filter to a radius around the core?
  One-line change in `map.js` where `transitStops` is filtered.
- [] **Zoom-out limit.** Zoom-out currently stops when the square view reaches
  the map's north–south extent, so ~4 of the 6 miles are visible at once and
  you pan east–west for the rest (`maxViewW` in `map.js#setupInteraction`).
  The alternative shows the full 6-mile width with empty bands top and bottom,
  which reads as broken. Panning was chosen; revisit if it feels cramped.
- [] **`map.svg` weight.** 197KB → 507KB, all of it precached for offline. The
  core/sparse-surround split already avoided the naive ~1.3MB. If this matters,
  the next lever is the `simplify()` tolerance in `tools/make-map.mjs` (currently
  2 m), which trades geometry fidelity for bytes.
- [] Minor: the OSM station dots and names baked into `map.svg` now sit
  underneath the much larger transit pins — mild visual redundancy. Either
  suppress the baked dots in `make-map.mjs` or leave them as a zoomed-in detail.

### Needs a real device (can't be checked from the harness)

- [] **Header-scroll behavior on a phone.** The page (not `#view`) is now the
  scroll container. Verified via Playwright screenshots at 393px, but momentum
  scrolling, rubber-banding and the sticky control bar under a real iOS/Android
  browser chrome are not something a headless screenshot can confirm. Anthony
  offered to verify interactively.
- [] **Sticky control bar vs. the iOS status bar, installed.** `.schedule-controls`
  pins at `top: var(--safe-top)`, which should evaluate to 0 given
  `apple-mobile-web-app-status-bar-style: default` (iOS puts the web view below
  the status bar in that mode). Unverified — if the bar does tuck under the
  status bar in standalone mode, the fix is an opaque fixed filler of height
  `var(--safe-top)`. Check during the next airplane-mode pass.

## Agent branches (worktrees)

Agents work in worktrees on branches `agent/content-pipeline`, `agent/ui`,
`agent/map-geo`; orchestrator merges into `main`.

## Notes / decisions

- Deploys propagate via SW version bump (generated sw.js hash); content.json
  additionally gets per-request stale-while-revalidate. See CONTRACTS.md.
- Demo clock override `?t=2026-10-03T15:00` so "on now" demos before October.
- gh authed as amanfredi; push to origin main verified working.
- RESOLVED 2026-08-01: Anthony made the repo public and enabled Pages; Deploy
  workflow succeeded and the live URL was verified (see Status).
- 2026-08-02: venues/vendors CSV schema changed — single `location` column
  (decimal pair or Google Maps plus code) replaces `lat`/`lng`; see
  CONTRACTS.md and scripts/{olc,location}.mjs.
- 2026-08-02 (later): venues tab is LIVE from the organizers' Google Sheet
  (URL in content/config.json); fixture venues.csv is a committed snapshot;
  validation tests use hermetic tests/fixtures-good/config.json (the default
  `npm run build` still fetches the sheet). Placeholder events
  remapped onto the 9 real venues. Map regenerated with wider bbox (Jimmy
  Lee Rec Center + Sundin). MMAF branding applied: header logo, brand
  palette, emblem app icons. Maps links default to walking directions.
- 2026-08-02 (August feature round, Wave 0 merged): events schema is now
  date/start_time/end_time (end_time < start_time = past-midnight, valid;
  equal = error), kinds music|art|performance|literary|vendor|other, new
  tickets column; sponsors use tier slugs (emerald..quartz, caps 1/5) with
  optional location, no tier_order column; settings gained donation_url/
  donation_label. CONTRACTS.md rewritten (routes incl. #/vendors, diamond
  pin/transit contract, a11y section, new test hooks). Fixture venue id
  refreshed to ginkgocoffeehouse — the live sheet had corrected the typo,
  which was failing every live-sheet build (and CI) until this merge.
  BACKLOG.md tracks the round; Wave 1 (4 parallel UI agents) next.
- RESOLVED 2026-08-02: custom domain https://go.midwaymusicandart.org/ is the
  live URL (github.io 301s to it). Initial cert provisioning was stuck
  (GitHub health check showed eligible-but-unissued for ~4h); Anthony's
  remove/re-add of the domain retriggered it. Enforce HTTPS is ON. Offline +
  installability re-verified on the custom domain. A transient CDN 503
  during cutover exposed the first-visit module-graph fragility — fixed with
  the boot guard in index.html (auto-reload with backoff, Playwright-tested).
- 2026-08-02 (August feature round complete, Waves 0–2 merged): schema
  migration (Wave 0); schedule UX, map redesign with transit/sponsor pins,
  vendors list view + Support donate button, PWA install/persist storage
  (Wave 1, four parallel worktree agents); accessibility hardening + cleanup
  + this docs pass (Wave 2) — route-change focus/announcement, sheet focus
  management (`aria-labelledby`, focus-into/restore-on-close), day switcher
  demoted from an incomplete tablist to a plain button group (see
  CONTRACTS.md Accessibility contract), `prefers-reduced-motion` honored,
  keyboard-pannable map; dead `openVendorSheet`/`findVendor` removed.
  `npm test` green: 26 unit + 9 Playwright (6 existing + 3 new a11y-focused).
  BACKLOG.md can be archived once its remaining checklist — all human QA, not
  code — is done: iPhone airplane-mode pass, install-button check on a real
  iPhone and Android Chrome, splash-screen render check, transit-stop
  accuracy vs. Metro Transit's published stop lists, and the featured-vs-
  generic sponsor-pin design review at the next demo.
- 2026-08-08 (QA round, BUGS.md): app renamed to "Midway Music & Arts Fest"
  (manifest `short_name` MMAF); icons rebuilt from the primary brand lockup and
  a separate "M"-only PNG favicon added because Safari renders SVG favicons as
  a gray placeholder; events gained `age_limit` (blank|18+|21+); ticket icons
  replaced with the organizers' artwork as an inline `<symbol>` sprite; row
  labels stack vertically; schedule kind filter removed (grouping stays);
  the page (not `#view`) is now the scroll container so the logo header scrolls
  away while control bars pin; starred rows linger dimmed for 6s before
  removal; transit pins gained a detail sheet; the map was rebuilt at 6x4 miles
  centered on Hamline Park with a dense core / sparse surround, a separate
  square home view, and everything rescaled for phone legibility. Screenshot
  harness added at `tools/shoot.mjs` (renders routes to PNGs for eyeballing).
  `npm test` green: 27 unit + 9 Playwright.
- RESOLVED 2026-08-08: the live sheet's `mamasmarket&deli` venue id was failing
  every build (and CI, and deploy). Rather than widen the id charset, build.mjs
  now **normalizes** ids instead of rejecting them, applying the same slugify
  to `events.venue_id` so both tabs agree however each was typed. It is a
  deliberate no-op for already-valid ids, so starred events and shared
  `#/event/<id>` links can't be invalidated by it. Only an id that slugifies to
  nothing, or two that collide, still fail. See CONTRACTS.md "Ids are
  normalized, not rejected".
- **Sheet data bugs found 2026-08-08** (organizers to fix, not code):
  - Mosaic on a Stick carries Hamline Park's address *and* plus code verbatim
    (`1564 Lafond Ave` / `XR5M+X8`), so its pin lands exactly on the park's and
    hides it. One of the two is wrong.
  - Vig Guitars and Fluid Ink Tattoos are ~14 m apart, so their pins overlap.
    As the venue list grows (9 → 14 this week) the map needs a pin-collision
    strategy — offset, or cluster-and-expand-on-zoom.
- `content/fixtures/venues.csv` is now 5 venues behind the live sheet. Harmless
  (it's only a snapshot, and tests build from it deliberately), but worth a
  refresh next time the fixtures are touched.
