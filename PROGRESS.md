# Build progress — Circuit Map POC

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
