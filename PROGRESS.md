# Build progress — Circuit Map POC

Orientation file for resumed sessions. Authoritative scope: DEFINITION.md.
Execution mechanics: PROMPT.md. Integration spec: CONTRACTS.md.

## Status: in progress — started 2026-08-01

## Milestones

- [x] Definition + prompt committed
- [x] CONTRACTS.md written (schemas, interfaces, file ownership)
- [x] Local-LLM experiment: placeholder content drafts (reviewed + cleaned; geography and collision-risky names fixed by orchestrator)
- [ ] Agent A: content pipeline (build.mjs, fixtures, validation + tests) — dispatched, running
- [ ] Agent B: UI views — dispatched, running
- [x] Agent C: map generation (OSM→SVG), geo.js affine module + tests — audited (tests re-run, SVG rendered + eyeballed, scope clean), merged to main
- [x] Orchestrator: PWA shell (manifest, icons), service worker + build-sw.mjs, serve.mjs
- [x] Orchestrator: Playwright offline test (needs integrated site to run)
- [ ] Integration: merge agent branches, `npm run build` + `npm test` green
- [ ] CI: deploy.yml + rebuild.yml, GitHub Pages enabled, live URL verified
- [x] README rewrite (write-doc skill, editorial subagent pass applied)
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
- BLOCKED (needs Anthony): repo is PRIVATE; free-plan GitHub Pages requires a
  public repo. `gh repo edit --visibility public` was denied by the session's
  permission classifier. Manual step: make repo public (repo Settings →
  General → Danger Zone) or run
  `gh repo edit amanfredi/midway-music-and-art-festival --visibility public --accept-visibility-change-consequences`,
  then `gh api -X POST repos/amanfredi/midway-music-and-art-festival/pages -f build_type=workflow`
  and re-run the Deploy workflow. Everything else verifies locally meanwhile.
