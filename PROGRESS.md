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
  CONTRACTS.md and scripts/{olc,location}.mjs. Sheet being set up by
  Anthony/organizers should use the new column. MMAF brand assets committed
  at repo root, not yet wired into the site.
