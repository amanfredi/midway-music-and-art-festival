# Dispatch: Midway Festival Circuit Map — POC build

## Context

You are the orchestrator for building the proof-of-concept of the Midway Music & Arts Festival "Circuit Map": an offline-capable static map-and-schedule website for a real neighborhood festival in St. Paul, MN (October 2–4, 2026). Anthony Manfredi is the volunteer implementer; the POC's purpose is a demo to festival organizers by August 8–9, 2026, using placeholder content, to win adoption before real content exists. Build it as the foundation of the real site, not a throwaway.

Read `DEFINITION.md` at the repo root before doing anything else. It is the authoritative scope document — approach sketch, non-goals, constraints, and risks. This prompt adds execution mechanics only; where the two seem to conflict, the definition wins and the conflict goes in your final report.

Working directory: `/Users/amanfredi/midway-music-and-art-festival` (git repo, remote `github.com/amanfredi/midway-music-and-art-festival`, currently just a README). Node 25 and Python 3.14 are available.

## Task

Build the v1 described in the definition's approach sketch:

1. **Static site scaffold** — mobile-first, installable PWA (manifest, icons). Plain HTML/CSS/JS unless something earns a framework; the maintainers after handoff are volunteers, and every dependency is a future liability. A build step is justified only for the content pipeline, not for the UI.
2. **Service worker** — precache the full site (app shell, content JSON, map image, sponsor logos); serve cache-first with background revalidation; versioned caches so deploys propagate. This is the heart of the project: iOS Safari evicting and reloading the tab must result in an instant, fully-working offline page.
3. **Content pipeline** — content schema matching the future Google Sheet tabs: `venues`, `events`, `vendors`, `sponsors`, `settings` (settings includes the notice-banner text). A build script consumes CSV from configurable URLs — a Google Sheet "published to web" serves CSV without credentials, so the same code path works for local fixture files now and the real sheet later; only a config value changes. Validate on build: malformed rows, bad references (event → nonexistent venue), and missing required fields fail the build with an error message a non-programmer could act on. Ship committed placeholder fixtures.
4. **UI views** — (a) "On now / up next" as the landing view; (b) schedule browsable by time and by venue; (c) event detail with star toggle; (d) map view; (e) sponsors page grouped by tier with logos and blurbs; (f) dismissible notice banner driven by settings; (g) starred-events list. Starring lives in `localStorage`.
5. **Map** — a stylized SVG placeholder map of the real Snelling & University corridor street grid with venue/vendor pins. Draw real streets at true scale; the final artwork will be commissioned under the same constraint. Include the georeferencing module: an affine transform between map coordinates and lat/lng calibrated from 2–3 control points, powering an optional "you are here" dot (geolocation permission requested only on user action, feature-flagged so it can ship disabled). Each venue gets an "open in Google Maps" link for online directions.
6. **Deploy** — GitHub Actions workflow: validate → build → deploy to GitHub Pages. Enable Pages on the repo via `gh`. A second workflow (manual trigger + schedule) rebuilds from the content source, so a coordinator edit reaches production without Anthony.
7. **Placeholder content** — realistic but clearly fictional venue, artist, vendor, and sponsor names (real streets, invented establishments) so the demo can't be mistaken for real festival information or misrepresent real businesses. Roughly 8 venues, ~60 events across three days, ~15 vendors, ~8 sponsors in 3 tiers.
8. **README** — replace the stub: what this is, how to run locally, how to deploy, how content updates work, and the manual iPhone verification steps for Anthony.

## Constraints

- No server-side runtime, no accounts, no analytics, no third-party CDN or font/script requests — every byte self-hosted, because offline capability and zero operating cost are the point, and any external request is a failure mode on festival day.
- Respect the definition's non-goals: no native app, no push notifications, no Google Maps engine, no search/filter in v1.
- Keep the dependency count near zero for the runtime site. Dev/build dependencies are acceptable when they pay rent (e.g., a test runner).
- Commit as you go with plain descriptive messages; push to `origin main`. This is a fresh single-purpose personal repo — trunk development, no ticket IDs.
- Comments only for durable constraints the code can't express (e.g., why the affine transform expects control points in a given order).

## Verification

Claim nothing you haven't run. For each check, the report includes the actual command and output.

- **Offline test (the acceptance criterion):** an automated browser test (Playwright or equivalent) that loads the deployed or locally-served site, goes offline, reloads, and asserts the schedule and map render and a star persists. Make it repeatable (`npm test` or a script), since it guards every future change.
- **Validation test:** a deliberately malformed fixture fails the build with a readable message.
- **Deploy check:** live GitHub Pages URL responds, service worker registers over HTTPS, Lighthouse (or equivalent) confirms installability.
- **Audit sub-agent output:** verify claimed work against files on disk and passing tests before integrating it.

## Boundaries

- Autonomous: everything inside this repo, pushing to `origin main`, enabling GitHub Pages via `gh`.
- Stop and ask: anything requiring credentials or accounts you don't have (Google Cloud, custom domains), anything outside this repo, and any scope addition not in the definition.
- Out of scope: acquiring real content, the real map artwork, the custom subdomain, and everything in the definition's non-goals.

## Orchestration notes

- Parallelize with implementer sub-agents where chunks are independent (content pipeline, service worker + offline test, UI views, placeholder content). Use worktree isolation for parallel writers. Routine implementation can go to Sonnet-class agents; keep the service-worker and caching work under your direct control or a top-tier agent, because offline correctness is the project's central promise.
- A mid-tier local LLM is available via the `/delegate-local` skill (costs zero API tokens). Test it on bounded drafting tasks — placeholder event descriptions, vendor blurbs, README prose skeleton. Review its output before committing it, and assess its usefulness in your final report.
- Usage-limit resilience: this session may be halted and auto-resumed by an external wrapper, and sub-agents can hit the same limits. Treat a silent or incomplete sub-agent as possibly paused, not failed — check its task status and prompt it to continue before redoing its work. Maintain a brief `PROGRESS.md` at the repo root (updated at each milestone, committed) so a resumed session can re-orient from disk instead of from lost context.

## Final report

- What was built, as a short file map with one line per component.
- Live URL and the local run command.
- Verification results with real output: offline test, validation failure test, deploy check.
- What is stubbed and the exact swap procedure for each: real Google Sheet (which config value), real map artwork (what format and the true-scale constraint to give the artist), real content.
- Manual steps for Anthony: iPhone airplane-mode test script, Google Sheet creation and publish-to-web steps, enabling anything you couldn't.
- Assessment of the local-LLM delegation experiment.
- Open questions and any definition conflicts encountered.
