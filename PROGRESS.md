# Build progress — Circuit Map POC

Orientation file for resumed sessions. Authoritative scope: DEFINITION.md.
Execution mechanics: PROMPT.md. Integration spec: CONTRACTS.md.

## Status: in progress — started 2026-08-01

## Milestones

- [x] Definition + prompt committed
- [x] CONTRACTS.md written (schemas, interfaces, file ownership)
- [ ] Local-LLM experiment: placeholder content drafts (input to content agent)
- [ ] Agent A: content pipeline (build.mjs, fixtures, validation + tests)
- [ ] Agent B: UI views (app shell, now/next, schedule, detail+star, map view, sponsors, banner, starred)
- [ ] Agent C: map generation (OSM→SVG), geo.js affine module + tests
- [ ] Orchestrator: PWA shell (manifest, icons), service worker + build-sw.mjs, serve.mjs
- [ ] Orchestrator: Playwright offline test
- [ ] Integration: merge agent branches, `npm run build` + `npm test` green
- [ ] CI: deploy.yml + rebuild.yml, GitHub Pages enabled, live URL verified
- [ ] README rewrite (write-doc skill)
- [ ] Verification: offline test output, validation failure output, deploy check, Lighthouse installability
- [ ] Final report

## Agent branches (worktrees)

Agents work in worktrees on branches `agent/content-pipeline`, `agent/ui`,
`agent/map-geo`; orchestrator merges into `main`.

## Notes / decisions

- Deploys propagate via SW version bump (generated sw.js hash); content.json
  additionally gets per-request stale-while-revalidate. See CONTRACTS.md.
- Demo clock override `?t=2026-10-03T15:00` so "on now" demos before October.
- gh authed as amanfredi; push to origin main verified working.
