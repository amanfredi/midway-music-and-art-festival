# In-depth code and test review

Status: defined 2026-08-09 | Overall confidence: high

Defines the "in-depth code and test review" item in BACKLOG.md (App section).
Audience: /build-prompt and the implementation agent(s) it dispatches.

## Problem & motivation

The codebase grew through several fast QA rounds and no one has read it end to
end since. Three questions motivate the review, plus one artifact it must
produce:

1. **Test coverage** — do the key user-facing features (derive the list from
   DEFINITION.md, which is binding scope) have appropriate coverage? Existing
   tests should also be assessed for quality, not just gaps counted.
2. **Reuse** — does the code use reusable components, or copy/paste similar
   patterns across views?
3. **Third-party leverage** — could a library or framework, bundled at build
   time (self-hosted, offline-capable), reduce the volume of code maintained
   here? Anthony's specific interest: libraries that absorb accessibility and
   cross-browser/cross-device concerns the code currently hand-rolls —
   avoiding rebuilding an app framework that already exists at high quality.
   This applies at two layers: the map (MapLibre GL JS is the named candidate,
   already an open decision in BACKLOG.md) and the app/UI layer (no candidate
   named yet).
4. **Screenshot baseline** — document the current app state visually before
   any refactoring begins, so later changes are identifiable.

The review also feeds two pending decisions reserved for Anthony: the map
library and any UI/PWA library adoption. It provides evidence; it does not
decide.

Timing matters: the festival is Oct 2–4, 2026 (~8 weeks out). Defects found
now are cheaply fixable; the map-library evidence is wanted before
commissioning hand-drawn map artwork.

## Success criteria

- Every finding is specific enough to triage (do / defer / drop) without
  re-investigating: file:line references, concrete failure scenario or cost,
  severity, and confidence label (verified / inferred), prioritized by user
  impact.
- The map-library and UI-library questions each gain a written evidence base:
  the hand-rolled-surface inventory (Level A) plus named-candidate assessment
  (Level B) as defined under Approach.
- A screenshot baseline exists in durable storage with its capture recipe
  documented and reproducible.
- Empirical checks were run, not assumed: double-build determinism diff, the
  test suite, and behavior when a content source fetch fails.
- Failure looks like: generic advice ("add more tests"), unverified claims in
  the voice of fact, findings requiring a re-read of the code to understand,
  or a library section that merely restates the BACKLOG.md entry.

## Non-goals

- **No code changes of any kind**, including trivial refactors. Fixes are
  separate follow-ups triaged from the report. The only new artifacts are the
  report, the baseline screenshots, and their recipe documentation.
- **No WCAG 2.2 conformance audit.** That is a separate BACKLOG.md item. This
  review's accessibility scope is an *inventory of hand-rolled a11y-sensitive
  surfaces* (focus management, ARIA state, keyboard handling, touch targets,
  contrast decisions — where they are hand-implemented and where visibly
  absent), which becomes the audit's starting map.
- **No investigative spikes** beyond the cheap empirical checks listed. In
  particular, no on-device performance profiling and no prototype builds with
  candidate libraries. Level B is desk research.
- **Does not make the library decisions** or edit DEFINITION.md non-goals
  (which currently exclude a map engine). Those stay with Anthony.

## Constraints

- Repo invariants (CLAUDE.md) hold throughout: zero runtime dependencies,
  generated outputs (`site/sw.js`, `site/data/`, `site/assets/sponsors/`) are
  never hand-edited, deterministic builds, offline as the acceptance
  criterion.
- Any candidate library must be bundleable at build time, self-hosted, and
  fully offline-capable to qualify. Size matters: the current worst offender
  is map.svg at ~690 KB gzipped, all precached.
- Commits for the report/baseline use plain descriptive messages, no ticket
  IDs, and `[skip ci]` (they don't change the site).
- Repo scale (verified 2026-08-09): ~3,200 lines shipped app (`site/`),
  ~835 lines tests, ~2,200 lines build/tooling (`scripts/`, `tools/`). One
  reviewer can read all of it; effort is bounded accordingly.
- `npm test`'s initial build fetches the live venues sheet (network); test
  code itself builds from local fixtures.

## Approach sketch

Read everything, with three different lenses; run cheap empirical checks;
desk-research candidates; write one prioritized report.

**Orientation first.** Read DEFINITION.md, CONTRACTS.md, PROGRESS.md,
BACKLOG.md. Derive the key user-facing feature list from DEFINITION.md; use
CONTRACTS.md as the reference for intended interfaces and test hooks.

**Screenshot baseline.** The harness (`tools/shoot.mjs`, verified adequate)
already shoots all routes across four viewport presets with demo clock,
seeded stars, mocked geolocation, and click sequences. Define a baseline
recipe: routes × viewports (at minimum phone + desktop, plus narrow/320px) ×
key interactive states (open detail sheet, map zoom levels, install prompt).
Capture it, commit to `reviews/2026-08-baseline/` with the exact commands
documented alongside, `[skip ci]`.

**App lens (`site/` — full treatment).** All four concerns. Includes the
hand-rolled framework-surface inventory: routing, store/state, sheet/dialog
semantics, focus and keyboard handling, ARIA, gesture/pan/zoom, label
collision — for each, roughly how many lines, what defects or BACKLOG items
trace to it, and whether a library could plausibly absorb it.

**Test lens (`tests/`).** Coverage mapped feature-by-feature against the
DEFINITION.md list, plus test quality: what the suite would and wouldn't
catch, fixture realism, reliance on the live sheet, flake risk.

**Tooling lens (`scripts/`, `tools/` — correctness and integrity only, no
style deep-dive).** Three named integrity questions: (a) paths by which a
broken site could be published (build half-succeeds, bad data passes
validation, deploy races); (b) unsafe incorporation of untrusted external
data — the live Google Sheet CSV and OSM/Overpass responses both flow into
rendered output; check escaping/injection at each sink; (c) source
availability — what happens to the ability to publish when the sheet or
Overpass is unreachable; what's cached, what's fatal.

**Empirical checks.** Build twice, diff outputs (determinism invariant). Run
`npm test`. Exercise a fetch-failure path (e.g., build with the sheet URL
unreachable) and record actual behavior. Off-the-shelf analyzers (axe-core,
Lighthouse) may be run as evidence-gathering where cheap — they supplement,
not replace, the read.

**Level B desk research.** For MapLibre GL JS and at least two UI-layer
candidates the reviewer selects (justifying the selection; e.g.
Preact/Lit-class runtimes or headless accessible component sets, plus
optionally a service-worker library such as Workbox for `sw.js`): gzipped
bundled size against the precache budget, build-time bundling and offline
feasibility, WebGL/Lockdown-Mode and low-end-device risk (map), documented
accessibility track record, and — keyed to the Level A inventory — what
fraction of the hand-rolled code each would actually replace. Every claim
carries a source + version and a confidence label. Stale or unverifiable
numbers are labeled as such, not smoothed over.

**Report.** Written to `reviews/2026-08-code-and-test-review.md`. Prioritized
findings (user impact order) with the labels from Success criteria; the
inventory and candidate assessment as evidence sections addressed to the two
pending decisions; a proposed follow-up list (fixes, spikes, WCAG audit
sequencing) formatted so items can be lifted into BACKLOG.md during triage.

**Invalidating assumption:** that reading plus desk research yields
decision-grade evidence. If the map decision's crux is the undiagnosed iOS
scroll/zoom lag, reading can only bound the answer (e.g., count SVG nodes
against known Safari thresholds) — the report must say so plainly and define
the measurement spike as the named follow-up, not dress inference as
diagnosis.

## Risks & unknowns

- **iOS lag cause is unverified** (medium confidence it's SVG size/node
  count, per BACKLOG.md — explicitly a hypothesis). Cheapest test: on-device
  Safari profiling — a follow-up spike, out of scope here. The review
  contributes node counts and desk evidence only.
- **Report rot** — findings never triaged (medium risk for report-only
  reviews). Mitigation: follow-up list formatted for direct BACKLOG.md
  import; success criterion is that Anthony can triage every finding.
- **Live-exploitable finding** (low likelihood, high impact): if the
  untrusted-data check turns up an actively exploitable injection via the
  live sheet, flag it to Anthony immediately — do not sit on it until the
  report is done.
- **Desk-research numbers go stale or mislead** (medium likelihood, low
  impact if labeled). Mitigation: source + version on every claim; unverified
  claims labeled.
- **Scope creep into fixing** (medium likelihood given agent habits).
  Mitigation: the no-code-changes non-goal is absolute; the dispatch prompt
  should restate it.

## Deferred questions

- **Which follow-ups to dispatch** — answered at triage, after the report.
- **The two library decisions** — Anthony's, after the report; the map one
  should be decided together with commissioning hand-drawn artwork.
- **Adoption thresholds** (how many KB is absorbing the a11y burden worth?) —
  Anthony forms these on seeing the evidence; the report presents trade-offs,
  not a single verdict, though a labeled recommendation is welcome.
- **WCAG 2.2 audit scheduling** — after this review; it inherits the
  inventory.
- **Spike definitions** (iOS profiling, candidate-library prototypes) — the
  report names them; defining them is follow-up work.

## Ledger

1. **Report first; fixes separate.** Review-plus-rewrite in one pass is
   bigger, riskier, and muddies the deliverable. (Anthony, turn 2.)
2. **Library question is first-class**, framed as buy-vs-build for the
   hand-rolled a11y/cross-browser surface, at both map and UI layers.
   (Anthony, turn 2.)
3. **Level A rigorous + Level B desk research; spikes deferred.** Desk
   research is credible for size/fit, weak for performance diagnosis — hence
   confidence labels. (Anthony, turn 3.)
4. **A11y scope = hand-rolled-surface inventory, not conformance audit.**
   Keeps each deliverable coherent; WCAG 2.2 is long and the audit is its own
   BACKLOG item. (Anthony, turn 4.)
5. **Read everything, three lenses.** "No one has read it end to end"
   motivated the item; tooling gets determinism/integrity/availability
   (broken publish, untrusted data, source outage) rather than style review.
   (Anthony, turn 5.)
6. **Screenshot harness verified adequate** (tools/shoot.mjs read
   2026-08-09); baseline work is recipe + durable storage only.
7. **Artifacts live in-repo** (`definitions/`, `reviews/`) — personal
   project, follows the repo's in-repo doc convention. Baseline PNGs are
   committed (a few MB at 1x viewport size; acceptable next to a 1.87 MB
   map.svg), `[skip ci]`.
8. **The review informs, never makes, the library decisions** — those stay in
   BACKLOG.md "Decisions that need Anthony," as does any DEFINITION.md
   non-goal change.
