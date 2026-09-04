# Squarespace Performers Page

Status: defined 2026-09-04 | Overall confidence: high

A Performers page on the main Squarespace site (www.midwaymusicandart.org),
rendered by custom JS from the same validated events data that feeds the
festival app. This is a new, second consumer of this repo's content pipeline;
the Squarespace umbrella site itself stays out of repo scope per DEFINITION.md.

## Problem & motivation

Organizers already maintain the full lineup — including performer bios
(`description`) and websites (`url`, present in the live sheet today) — in the
events tab of the Google Sheet. The main website has no performers listing.
Hand-authoring one in Squarespace means double entry against a sheet that keeps
changing until October, and silent drift between the app and the website. The
pipeline already validates and publishes this data; the page should read it.

## Success criteria

- The page renders one accordion item per non-`vendor` event from the live
  `content.json`: performer name (`title`), short bio (`description`), website
  link (`url`).
- A sheet edit reaches the page with no Squarespace touch — within the existing
  6-hour cron rebuild, or immediately via manual workflow dispatch.
- Organizers restyle the accordion (colors, sizes, fonts) in the Squarespace
  editor and the styling applies to every generated item automatically.
- Visiting the page with `#performer-<event id>` opens that item and scrolls to
  it (and `hashchange` after load does the same).
- On any fetch/parse failure the page shows exactly what was authored in
  Squarespace — never a broken or half-rendered list.

Failure would look like: an empty or broken accordion on the public page, a
lineup that drifts from the app's, or logic changes that require re-pasting
code into Squarespace.

## Non-goals

- **No performer dedupe.** Each event is one accordion item; a performer with
  two sets appears twice. Explicitly accepted for v1 (Anthony, 2026-09-04);
  revisit when the real lineup makes it ugly.
- **No vendors** on this page (`kind === "vendor"` filtered out client-side).
- **No repo-owned styling.** Layout/type/color live in Squarespace so
  organizers keep control; the repo ships behavior only.
- **No festival-app UI changes.** `url` lands in `content.json` as a side
  effect and the app may use it later — that's a separate decision.
- **No new hosting or server-side anything** — the script rides the existing
  GitHub Pages deploy.

## Constraints

- $0/month, no new infrastructure; the existing CI deploys everything.
- The Squarespace side is edited approximately once: a code-block stub plus a
  one-item placeholder accordion that doubles as the clone template and the
  failure-mode display.
- `content.json` remains the app's contract; the schema change must be additive
  and keep builds deterministic (byte-identical for unchanged sources).
- The new script sits under `site/` so the service worker precaches it onto
  attendee phones (~few KB) — accepted rather than special-cased.
- Squarespace's editor does not execute custom scripts, so organizers see the
  placeholder item while editing, not the rendered list. Known platform
  behavior; document it, don't fight it.

## Approach sketch

1. **Build:** promote the events tab's existing `url` column (verified present
   in the live sheet, 2026-09-04) into the official schema — optional, validated
   by the same link rules as other URL fields (`https:`/`http:`/`mailto:`, bare
   domains completed to `https://` with a printed rewrite), emitted on every
   event in `content.json` (`""` when blank). Update CONTRACTS.md (events.csv
   schema + content.json shape), add the column to `content/fixtures/events.csv`,
   extend validation tests.
2. **Script:** new `site/js/performers-embed.js`, deployed by existing CI.
   Fetches `https://go.midwaymusicandart.org/data/content.json` (CORS verified:
   GitHub Pages sends `access-control-allow-origin: *`), filters out
   `kind === "vendor"`, sorts by `title` case-insensitively, locates the page's
   accordion block, clones its first item as the template, fills name/bio/link
   per event, assigns `id="performer-<event id>"` (the build-slugified id),
   hides the template item only after a fully successful render, then applies
   the location hash. Missing `url` → no link; empty `description` → name/link
   only.
3. **Squarespace:** one code block on the performers page:
   `<script src="https://go.midwaymusicandart.org/js/performers-embed.js" defer></script>`
   (plus whatever marker attribute the script needs to find the right block).
   Verified 2026-09-04: the Squarespace site serves no Content-Security-Policy
   header, so the cross-origin script loads; site is Squarespace 7.1 (no 7.0
   AJAX-navigation script quirk).

**Settled by experiment (Anthony, Chrome console on `/new-page`, 2026-09-04):
cloned accordion items are not clickable** — Squarespace binds toggling
per-item at init, not by delegation. The plan of record is therefore the
guarded own-handler design: clone the markup for styling, attach our own
open/close handler replicating the aria-expanded/height behavior, guarded so
a click can never double-fire if Squarespace ever does handle a clone.
Remaining invalidating assumption: the plan doesn't execute code-block JS at
all (Business-plan requirement) — settled the moment the stub is pasted.

## Risks & unknowns

- ~~Cloned items toggle under Squarespace's JS~~ — **resolved 2026-09-04**:
  Anthony's Chrome console test showed cloned items are not clickable, so the
  script owns the toggle (see Approach sketch). Bundle inspection is still
  worthwhile, to replicate the native open/close behavior faithfully rather
  than to choose the mechanism.
- **The plan executes JS in code blocks** (Business plan or higher required —
  recalled, high confidence). Settled by pasting the stub; until then the
  console test above only proves markup, not code-block execution.
- **Squarespace DOM drift over time** — template-cloning self-heals class
  renames, but the script must still locate the title and content *roles*
  inside an item; a structural redesign could break that. Mitigated by
  defensive selectors and the fail-closed rendering rule. Low likelihood
  before Oct 2026.
- **App tolerance of the new field** — the app reads known keys from event
  objects, so an added `url` is inert. High confidence; the existing test
  suite confirms in passing.

## Deferred questions

- **Performer dedupe** (one performer, several events): must be answered when
  the real lineup gains repeat performers — likely a performer key column or a
  dedicated tab. Deep-link ids will change meaning then; don't publicize
  per-performer links externally until settled.
- **Showing `url` in the festival app's event detail**: data will exist;
  decide separately.
- **Ordering beyond alphabetical** (e.g., headliners first): only if
  organizers ask; would need a sheet signal.

## Ledger

- **Source = events tab + content.json** (2026-09-04) — the validated,
  CORS-open, already-published artifact beats raw sheet CSV (no validation;
  sign-in pages render as public breakage) and a separate performers.json
  (second contract, no gain). The live sheet already carries `url`, so the
  build change is promoting an existing column, not asking organizers for one.
- **Vendor-kind events excluded client-side** — `content.json` keeps all
  events for the app; the filter is the page's concern.
- **Native accordion styling via template-clone** — organizer styling autonomy
  outweighed markup-independence; Anthony chose this knowing the DOM-dependency
  trade-off. Deep-link requirement is compatible with it.
- **Repo-hosted script + Squarespace stub** — versioned, testable, deploys via
  git push; no CSP blocks it (verified). Inline paste rejected for drift.
- **Defaults set 2026-09-04:** alphabetical by name; optional-field rendering
  as above; fail closed to authored content; freshness rides the existing
  cron; SW precache of the script accepted.
