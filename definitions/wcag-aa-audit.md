# WCAG 2.2 AA accessibility audit — site, pipeline, and artwork

Status: defined 2026-08-09 | Overall confidence: high

## Problem & motivation

The site has had real but ad-hoc accessibility work: a "Wave 2" hardening pass
(focus management, route announcements, keyboard map panning), a binding
Accessibility contract in CONTRACTS.md, and a11y fixes out of the August 2026
code review (native `<dialog>` sheet, group-by `aria-pressed`) — all landed.
What it has never had is a **systematic evaluation against WCAG 2.2 Level AA**:
nobody has walked every applicable success criterion and dispositioned it.

BACKLOG.md already anticipates this work as two items this project subsumes:

1. A **map-design pass** against `reference/Accessibility - map-design-guide
   (updated)_tcm38-565153.pdf` (contrast, symbol size, legend conventions) —
   flagged as "worth doing before commissioning hand-drawn artwork."
2. An **accessibility review against WCAG 2.2**, updating the CONTRACTS.md
   Accessibility contract if it turns up gaps, sequenced after the August
   review's a11y fixes (now landed), taking
   `reviews/2026-08-code-and-test-review.md` as input, not replacement.

Timing is the forcing function: the riskiest accessibility moments are ahead,
not behind. Commissioned map artwork is permanent once drawn — low-contrast art
cannot be fixed in code. Organizer content (venue descriptions, sponsor logos)
arrives via the Google Sheet with no accessibility guardrails in the build.
Festival is Oct 2–4, 2026.

## Success criteria

- **Prioritized findings report** at `reviews/2026-08-wcag-aa-audit.md`. Every
  applicable WCAG 2.2 AA success criterion dispositioned: **pass** (with
  evidence), **fail** (with a priced fix), **pending human pass**, or **not
  applicable** (with the reason). Findings ranked by user impact, not by
  criterion number.
- **The map decision is framed, not dodged.** The report's map section prices
  each failure as *fixable in place* / *expensive* / *inherent to the current
  approach*, then presents the explicit decision: bring the map itself to AA,
  or designate the list views (venues, schedule) as the conforming alternate
  path with the map as best-effort enhancement. Where a failure is inherent,
  the report notes whether a mapping library would change the answer — this
  audit is an input to that choice.
- **Automated regression coverage** in the Playwright suite: axe-core scans of
  every route plus targeted assertions pinning any finding fixed during the
  audit. Runs offline against fixtures (network-free, like the rest of
  `npm test`), gates CI strictly.
- **Condensed reference document** at `reference/wcag-aa-site-profile.md`: the
  AA criteria that apply to *this* site profile (static PWA, hash routing,
  list views, native-dialog sheets, inline SVG map, no video/audio/forms),
  each with what "pass" means here and how to check it. It states its own
  re-audit trigger (which kinds of design change invalidate which sections).
  Future audits start from this document, not the 500KB spec.
- **Artist-brief accessibility rider**: a short organizer/artist-facing
  document of constraints for the commissioned artwork (contrast ratios,
  minimum symbol/label sizes, color-independence, legend conventions),
  distilled from the map design guide. Delivered **before artwork is
  commissioned** — this is the time-critical deliverable. It is human-facing
  durable prose: draft it with the write-doc skill, and it joins the existing
  georeferencing constraint already promised to the artist in DEFINITION.md.
- **Content-pipeline findings**: which sheet columns must carry accessibility
  content (e.g., sponsor logo alt text) and what build validation should
  enforce, so organizer edits can't ship inaccessible content silently.
- **Scripted human device checklist** (VoiceOver walkthrough on a real iPhone,
  zoom/reflow judgment) added to BACKLOG.md's human/device QA section, in the
  style of the README iPhone airplane-mode pass. The report marks the criteria
  it covers as pending until Anthony runs it.
- **Repo docs reconciled**: CONTRACTS.md Accessibility contract updated where
  the audit reveals gaps (explicitly sanctioned by the existing BACKLOG item);
  both subsumed BACKLOG items resolved; PROGRESS.md journaled.

**Failure looks like:** a report that dumps axe output without judgment on the
map or pricing of fixes; automated tests that are flaky or need the network; a
reference doc that summarizes the spec instead of profiling this site; the
artist rider arriving after the artwork is commissioned.

## Non-goals

- **No formal conformance claim** or public accessibility statement. AA is an
  internal target; the report is honest about what was and wasn't verified.
- **Not AAA.** Level AA only.
- **No remediation commitment beyond cheap fixes.** Fixes land in-session only
  when they're straightforward and landing them eases verification; everything
  expensive becomes a scoped BACKLOG item carrying the audit evidence.
- **No accessibility overlays or widgets** — categorically excluded; they are
  an industry anti-pattern and would violate the zero-runtime-dependency
  invariant anyway.
- **No new shipped bytes for tooling.** Accessibility test tooling is
  devDependency-only.
- **Not the umbrella Wix site.** This repo's site only.
- **Executing the human device pass** is Anthony's, outside agent scope.

## Constraints

- **Invariants hold**: zero runtime dependencies, every byte self-hosted,
  deterministic build, `npm test` network-free. axe-core enters only as a
  devDependency; per CONTRACTS.md conventions, agents report needed
  devDependencies to the orchestrator rather than editing package.json.
- **Every push deploys**; main must stay deployable at each intermediate
  commit. The strict CI gate is safe for festival weekend because tests run on
  committed fixtures — organizer sheet edits can never fail the a11y tests
  (content problems are build-validation's jurisdiction, and validation
  failures already fail the build readably rather than shipping).
- **Timing**: artist rider before artwork commissioning (imminent; confirm the
  commissioning timeline with organizers); audit findings early enough that
  the map decision and any sheet-column changes land before content freeze;
  everything before Oct 2–4, 2026.
- **Reference inputs**: `reference/` holds the full WCAG 2.2 spec (HTML,
  512KB) and the map design guide (PDF, 676KB) — large; agents read them in
  fresh contexts, never dumped into an orchestrating session.
  https://www.a11yproject.com/checklist/ is a secondary cross-check.
  `reviews/2026-08-code-and-test-review.md` supplies the prior a11y findings
  and the hand-rolled surface inventory as audit input.
- **Zero budget**; all labor is agent-executed with Anthony directing.

## Approach sketch

Distill first, then audit against the distillation:

1. **Distill** — produce `reference/wcag-aa-site-profile.md` from the WCAG 2.2
   spec + a11yproject checklist + map design guide: enumerate every AA
   criterion, mark applicability to this site profile with reasons, and for
   applicable ones define the concrete check. This is the audit's checklist
   and the lasting artifact for future audits.
2. **Audit** — per-criterion evaluation using code inspection, DOM analysis
   and keyboard driving via Playwright, axe-core scans per route, and
   **programmatic contrast computation on the SVG map** (the map is generated
   vector art with inspectable colors, not raster — eyeballing is neither
   necessary nor acceptable). Each criterion gets a disposition and evidence.
3. **Price and frame the map decision** — classify map failures, write the
   fix-vs-alternate-path recommendation with its library implications.
4. **Automate** — axe scans per route added to the Playwright suite plus
   targeted assertions for anything fixed; extend `tests/a11y.spec.mjs` or add
   a sibling spec.
5. **Cheap fixes** — land in-session where straightforward and
   verification-easing; each covered by a pinned test.
6. **Produce the side deliverables** — artist rider (write-doc skill), content
   pipeline findings/validation rules, human device checklist.
7. **Reconcile docs** — findings report to `reviews/`, CONTRACTS.md contract
   updates, BACKLOG items resolved, PROGRESS.md journaled.

**Assumption that would invalidate this sketch:** that the map's colors and
text are programmatically inspectable in the built SVG. High confidence (the
map is generated from OSM data by `make-map.mjs`), but if substantial parts
turn out to be raster-embedded or contrast-indeterminate, the map audit falls
back to human judgment and the pricing of map findings loses precision —
verify inspectability as step 0 of the audit.

## Risks & unknowns

| Risk | Confidence it's fine | Cheapest test |
|---|---|---|
| Agents misprice map findings, feeding the fix-vs-alternate-path decision garbage | medium-high | Programmatic contrast from SVG source; human device pass covers AT reality |
| Artist rider arrives after artwork is commissioned | medium | Ask organizers for the commissioning timeline now; deliver the rider first, standalone |
| axe on placeholder fixture content produces noise unrelated to real content | high | Triage discipline: findings cite whether app shell or fixture content is at fault |
| Strict a11y gate blocks an urgent festival-weekend code push | high | Gate runs on fixtures only; a violating code change *should* block — that's the point |
| Human device pass never gets run, leaving AT-dependent criteria permanently pending | medium | Checklist is short and scripted; report lists exactly which criteria hang on it |

## Deferred questions

- **Map conformance path** (map meets AA itself vs. lists as conforming
  alternate) — deliberately deferred to the post-audit decision; the report
  exists to inform it. Decide before investing in expensive map remediation.
- **Sheet schema changes for accessibility content** (e.g., alt-text columns)
  — depends on findings and organizer coordination; decide before content
  freeze.
- **Whether a mapping library replaces the custom SVG** — out of this
  project's scope; the audit only feeds it evidence.
- **Public accessibility statement** — only if organizers request one.

## Ledger

- **Prioritized findings report as the primary deliverable; cheap fixes
  discretionary in-session** — Anthony wants the informed-decision document
  first; landing trivial fixes is acceptable when it eases verification.
- **Audit the map at "meets AA itself," pricing every failure** — starting
  posture is full conformance; the lists-as-alternate-path fallback is
  acceptable but must be an informed, documented decision, not a default. The
  findings also feed the custom-SVG-vs-library question.
- **Agent audit + human device pass** — automated tooling covers a minority of
  AA criteria; an audit claiming AA coverage while silently skipping
  AT-dependent criteria would be dishonest. Anthony runs a short scripted
  device checklist; those criteria stay pending until then.
- **Full pipeline scope (code + build validation + artist rider)** — content
  and artwork accessibility can't be fixed in code; the artist rider is
  time-critical and mirrors the existing georeferencing constraint precedent.
- **Subsumes the two existing BACKLOG a11y items** — this project is their
  execution, not a parallel effort; both get resolved by it.
- **axe-core as devDependency ruled invariant-compatible** — the
  zero-dependency invariant governs shipped page bytes; the test suite already
  uses Playwright from npm. Agents report the devDependency rather than
  editing package.json (CONTRACTS.md convention).
- **Strict CI gating for the automated a11y tests** — safe because tests run
  on fixtures; organizer content edits can never trip them.
- **No formal conformance claim** — internal target only; avoids maintaining a
  public legal-ish statement for a volunteer site.
- **Definition lives in `definitions/`** — new home for sub-project
  definitions, keeping the repo root reserved for the five established docs.

## Next

`/build-prompt definitions/wcag-aa-audit.md` to turn this into dispatch-ready
implementation prompts. Suggested decomposition when that happens: the
distillation + audit is the core dispatch; the artist rider is a separate,
earlier, write-doc-skill deliverable because its deadline (artwork
commissioning) is independent of the audit's.
