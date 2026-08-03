# Feature backlog — August 2026 round

**Status 2026-08-02: Waves 0–2 all merged and deployed.** What remains here:
the human QA checklist below, the TBD section, and one open decision (Web
Share button on event/venue detail — recommended in the PWA research, awaiting
Anthony's yes/no).

Working plan for the current implementation round, from decisions settled with
Anthony on 2026-08-02. PROGRESS.md stays the state journal; this file tracks
what's being built now and what's consciously deferred. Delete or archive it
when the round lands.

## Decisions (binding for this round)

### Events schema
- Replace `start`/`end` columns with `date` (`YYYY-MM-DD`), `start_time`,
  `end_time` (24h `HH:MM`). An event lives on one calendar date.
- Convention: `end_time` ≤ `start_time` means the event ends past midnight
  (end is on the following day). Validation accepts it; docs explain it.
- `content.json` keeps emitting derived `start`/`end` (`YYYY-MM-DDTHH:MM`)
  strings — runtime shape unchanged, UI code untouched by the schema swap.
- Kinds become `music | art | performance | literary | vendor | other`
  (replaces `music|art|family|community`). Optional, default `music`.
- New optional `tickets` column, exact values (sheet dropdown enforces):
  `General Admission` (default when blank) · `General Admission (limited
  capacity)` · `Free Ticket Required` · `Paid Ticket Required`.
  The two "Required" values get ticket-stub icons (FREE / $) on event rows
  next to the kind badge; event detail shows the full tickets text. The other
  two values get no list icon.

### Sponsor tiers
`tier` becomes a fixed enum (CSV carries the slug; display labels live in the
app). `tier_order` column is dropped — order is intrinsic to tier.

| slug | display | limit | map pin | sponsors page |
|---|---|---|---|---|
| `emerald` | Emerald Tier (Presenting Partner) | 1 | Featured Destination | dedicated top spot, largest logo |
| `ruby` | Ruby Tier (Leading Partner) | 5 | Featured Destination *(logo-pin format TBD)* | second-largest logos |
| `sapphire` | Sapphire Tier (Supporting Partner) | — | Featured Destination | third-largest logos |
| `topaz` | Topaz Tier (Community Partner) | — | Sponsor (generic) | smallest logos |
| `quartz` | Quartz Tier (Neighborhood Supporter) | — | none | name + link only, no logo |

- New optional `location` column (same formats as venues). A sponsor gets a
  pin iff its tier maps AND it has a location; missing location on a pin tier
  = no pin, no error (some sponsors have no in-map address).
- `logo` required for emerald–topaz, optional and unused for quartz.
- Build validates: known slug, ≤1 emerald, ≤5 ruby — readable errors.
- Emerald "special treatment / custom branding": TBD until one exists.

### Map
- Item types: **Venue** (brand blue `#10577b`), **Transit** (brand green
  `#298d4e`), **Sponsor** (brand red `#a11f22`). All pins and legend icons are
  diamonds. Venues keep their numbers inside the diamond; transit diamonds
  carry the line letter (G / A / B).
- Featured Destination vs generic Sponsor pins both use brand red; the visual
  distinction (e.g. filled + larger vs outlined) is the map agent's design
  call, reviewed at the next demo.
- Vendor pins removed from the map entirely.
- Transit stops: Green Line LRT, A Line BRT, B Line BRT stops inside the map
  bbox, sourced from OSM via `tools/make-map.mjs` into a committed data file.
  Accuracy is provisional — see QA checklist below.

### Vendors & Support
- Vendors stay a content type but move from map pins to a new list view:
  route `#/vendors`, nav tab "Vendors" between Starred and Support, rendering
  vendor name/type/description from the sheet. No starring of vendors.
- Sponsors tab renamed **Support** in the nav (route stays `#/sponsors`).
- Donation button at the top of the Support view, driven by new settings keys
  `donation_url` and `donation_label` (label defaults to "Donate"; empty url =
  no button). Current url (verified live 2026-08-02):
  https://www.zeffy.com/en-US/donation-form/midway-music-and-arts
- Nav grows to 6 tabs — verify layout/labels still work at 320 px width.

### Schedule UX
- Star toggle on every event row (schedule, now, starred views): rows
  restructure from a bare `<a>` to a container holding the link plus a sibling
  star `<button aria-pressed>` (44 px target) — a button nested inside a link
  is broken for screen readers and touch.
- Filter chips by kind: All + the six kinds.
- "By category" added as a third grouping mode next to by-time/by-venue.
- Six kinds need six badge tints, WCAG AA.

### PWA platform
- Call `navigator.storage.persist()` at startup (best-effort, no UI on deny).
  Research finding (2026-08-02): persist() protects against disk-pressure
  eviction on Chrome/Android, but does **not** exempt a non-installed iOS
  Safari site from the 7-day ITP storage wipe (open WebKit bug 209563).
  Home-screen install is what exempts iOS storage (webkit.org/tracking-
  prevention/, verified). Known-limitations copy must not present persist()
  as the iOS mitigation — install is.
- Install button: `beforeinstallprompt` flow on Chromium; inline "Add to Home
  Screen" instructions on iOS Safari (no external link — offline-first);
  hidden entirely when already running standalone.
- Generate `apple-touch-startup-image` splash set via `tools/make-icons.mjs`.
- Document as a known limitation: installed app and browser tab have isolated
  storage on iOS (independent starred lists); not worth fixing.

### Accessibility
- Hardening pass over existing gaps (survey 2026-08-02): no focus management
  on route change or sheet open/close, incomplete tablist pattern on day tabs,
  star state invisible to screen readers in list views, no
  `prefers-reduced-motion` (infinite pulse animation), map pan/zoom is
  pointer-only.
- Binding a11y criteria get a section in CONTRACTS.md; every UI agent's prompt
  carries them as acceptance criteria.

### Scope bookkeeping
- DEFINITION.md's "no search/filtering in v1" non-goal is overridden by
  Anthony (2026-08-02); update DEFINITION.md in the docs pass.
- No fixed demo deadline; waves run in order without scope cuts.

## Waves

- **Wave 0 — contracts + schema (one agent, merges first).** CONTRACTS.md
  updated in full (CSV schemas, routes, test hooks, legend, a11y section) so
  Wave 1 agents build against one truth. `build.mjs` parsing/validation,
  fixtures regenerated (six kinds, tickets column, five sponsor tiers incl.
  emerald/ruby/quartz examples, ≥1 past-midnight event), new bad-fixture cases
  (bad tickets value, bad tier slug, emerald limit exceeded), settings keys.
  `npm test` green.
- **Wave 1 — four parallel worktree agents** (after Wave 0 merges; merge
  serially, rebasing — shared `app.css` will conflict additively):
  1A Schedule UX · 1B Map · 1C Vendors + Support · 1D PWA platform.
- **Wave 2 — a11y hardening + docs** (after Wave 1, same views get touched):
  a11y fixes above; DEFINITION.md, README.md, PROGRESS.md updates.
- **Anytime, parallel:** PWA feature-candidates research doc (survey
  whatpwacando.today against the zero-deps/offline invariants; also verify
  per-browser whether `storage.persist()` covers localStorage). Doc only.

## QA / verification (human)

- [ ] Transit stops: verify OSM-derived stop names/positions against Metro
      Transit's published Green Line / A Line / B Line stop lists.
- [ ] iPhone airplane-mode pass after any SW/caching change (README procedure).
- [ ] Install button on a real iPhone (instructions sheet) and Android Chrome
      (native prompt).
- [ ] Splash screens render on iOS launch.
- [ ] Nav fits at 320 px with 6 tabs.
- [ ] Featured-vs-generic sponsor pin design review at next demo.

## TBD / deferred (not forgotten)

- Emerald custom branding treatment — no emerald sponsor exists yet.
- Ruby logo-pin map format.
- Feature candidates from whatpwacando.today — research done 2026-08-02.
  Recommend: Web Share button on event/venue detail (iOS Safari 12.2+, ~5
  lines, deep links already exist). Possible: View Transitions (pure polish),
  Wake Lock (opt-in toggle only — fights battery). Rejected: everything else,
  incl. manifest `shortcuts` (iOS ignores the field). Pending Anthony's pick.
