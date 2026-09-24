# Ticket links and sold-out events
Status: defined 2026-09-23 | Overall confidence: high
Outcome note: the shipped Sold Out icon is a white ticket with a thin dashed
near-black outline and red "SOLD OUT" lettering, not the grey sketched below
(chosen after four review rounds; see PROGRESS.md 2026-09-23).

## Problem & motivation
Event detail pages say "Paid Ticket Required" / "Free Ticket Required" but give
no way to get the ticket. Organizers added a `ticketURL` column to the events
sheet (live as of 2026-09-23; all 16 ticketed rows filled). Organizers will also
mark sold-out events by setting `tickets` to `Sold Out`, which today would be an
unknown enum value — the row would be **dropped from the site**. The festival
runs Oct 2–4, 2026, so this must ship within days.

## Success criteria
- On the event detail page, the ticket text for `Paid Ticket Required`,
  `Free Ticket Required`, and `Sold Out` is a link to the event's `ticketURL`
  when one is present (opens in a new tab with the existing
  `util.js#NEW_TAB_HINT` convention). Without a usable URL, plain text as today.
- `tickets = Sold Out` is a valid value: the row publishes, the detail page shows
  the text "Sold Out", and a grey sold-out ticket icon appears wherever ticket
  icons appear today (schedule rows' label column and the detail page).
- A successful publish reports **warnings** (non-blocking; the row still
  publishes) for:
  1. `Paid Ticket Required` / `Free Ticket Required` / `Sold Out` with a blank
     `ticketURL`;
  2. `General Admission` or `General Admission (limited capacity)` (or blank,
     which defaults to GA) with a non-blank `ticketURL` — the URL is ignored,
     not rendered;
  3. a `ticketURL` that fails the shared link rule — the link is dropped, the
     event publishes with plain ticket text.
- Warnings reach the deploy and content email lists in the **same email** as
  skipped rows, under its own "warnings" list, with the same send gate
  (non-empty findings **and** a source changed since last publish). The email
  sends when either `droppedRows` or `warnings` is non-empty; the subject
  reflects what it contains. Warnings also appear in the CI run annotation and
  job summary alongside dropped rows.
- Failure looks like: a sold-out event missing from the schedule; a ticketed
  event with a URL rendering unlinked; a GA row rendering a link; a bad
  `ticketURL` dropping its event; warnings emailed on every code push/cron with
  no sheet change; `content.json` non-deterministic.

## Non-goals
- Squarespace Performers/Venues embeds (`site/js/*-embed.js`) — they don't show
  `tickets` today and stay unchanged.
- Filtering or sorting by ticket status; any sold-out treatment beyond icon and
  text (no strike-through, no hiding, no "Now" view changes).
- Linking ticket text in schedule rows — the link is detail-page only.
- Recording paid-vs-free for sold-out events (the `Sold Out` value replaces it;
  accepted).
- A separate warnings email or a separate send gate.

## Constraints
- Invariants from CLAUDE.md: deterministic build output, generated files
  (`site/sw.js`, `site/data/`) never hand-edited, tests stay off the network,
  offline acceptance. The ticket link is an outbound link; nothing new is cached.
- `ticketURL` header is **optional**: fixtures and older snapshots without it
  must still build. (If the header is ever renamed, every ticketed row warns,
  so the failure self-reports.) Header spelling in the sheet is `ticketURL`.
- content.json field name: `ticket_url` (blank string when absent, matching
  how other optional string fields are emitted — follow existing convention).
- `Sold Out` matches exactly, like the other `tickets` values (the sheet
  dropdown enforces values).
- Link validation reuses the shared rule (CONTRACTS.md "Links follow the same
  rule": `https:`/`http:`/`mailto:` only, bare domain completed to `https://`
  with the completion printed), except that a violation costs only the link and
  becomes a warning instead of dropping the row.
- **Sequencing:** this must deploy before organizers add `Sold Out` to the sheet
  dropdown; until then a `Sold Out` row is dropped.

## Approach sketch
- **Build (`build.mjs`)**: accept optional `ticketURL`; add `Sold Out` to the
  tickets enum; validate/complete the URL with the shared link helper but route
  failures to a new `warnings` collection; emit `ticket_url` only for the three
  ticket-requiring values (GA rows emit blank and warn if a URL was present).
  Report gains `warnings: [{ source, rowNum, message }]` next to `droppedRows`,
  empty on clean builds; build log prints warnings like other row messages.
- **Notify (`.github/scripts/notify.mjs skipped-rows`)** and the "Flag skipped
  rows"/summary steps in `deploy.yml` and `rebuild-content.yml`: include the
  warnings list; send when `droppedRows` or `warnings` is non-empty and
  `snapshot.changed` is non-empty.
- **UI**: `event-row.js` `TICKET_ICONS` gains `Sold Out` → new sprite symbol
  (aria-label "Sold out"); `event-detail.js` wraps the ticket text in a link
  when `ticket_url` is set.
- **Icon**: grey variant of the paid ticket, generated by
  `tools/make-ticket-icons.mjs` into the `index.html` sprite. "SOLD OUT"
  lettering if legible at schedule-row size (in the style of the FREE icon's
  lettering), otherwise a plain grey ticket — both acceptable; Anthony judges
  legibility on device.
- **Docs/tests**: CONTRACTS.md (events schema incl. `ticketURL`/`Sold Out`,
  content.json `ticket_url`, report `warnings`, notifications); test fixtures
  under `tests/fixtures-good/` and `content/fixtures/events.csv` gain the column
  and cases for each warning and for `Sold Out`; PROGRESS.md log entry;
  BACKLOG.md device-QA item for the icon and link.
- Invalidating assumption: that `ticketURL` stays one URL per row and `Sold Out`
  stays a `tickets` value. If organizers add a separate sold-out column
  instead, the enum change is wasted but harmless.

## Risks & unknowns
- Organizers add `Sold Out` to the dropdown before deploy → sold-out events
  vanish. Confidence it's handled: high if Anthony tells them to wait; cheapest
  test: deploy first, then tell them.
- "SOLD OUT" illegible at row size — medium likelihood; fallback (no words) is
  pre-approved. Test: render at 320px width.
- Existing notify tests/fixtures assume only `droppedRows`; the send gate and
  subject line change touches a tested contract. Low risk, covered by updating
  those tests.
- `ticketURL` header casing: build header matching may be case-sensitive or
  normalized — implementer must check how headers are matched (e.g. `age` alias
  for `age_limit`) and accept `ticketURL` as the sheet spells it.

## Deferred questions
- Whether the Squarespace performers page should show tickets/links — ask after
  the festival if organizers want it.
- Exact subject-line wording for mixed dropped/warning emails — implementer's
  call, following the existing `[Midway site] …` pattern.

## Ledger
- One new column `ticketURL` (not two); confirmed live in the sheet 2026-09-23.
- Sold out = `tickets` value exactly `Sold Out` (Anthony, option A) — not a
  separate column.
- Only Paid/Free/Sold Out get links; GA + URL → ignored and warned. Chosen
  partly because a warning would have caught the off-by-one row shift in the
  sheet on 2026-09-23 (URLs one row above their events).
- `Sold Out` keeps the link (waitlist/resale/re-release pages are the
  organizers' call); missing-URL warning therefore covers `Sold Out` too.
- Warnings go in the existing skipped-rows email as a separate list, same
  recipients, same "source changed" gate.
- Malformed `ticketURL`: shared link rule, but damage limited to the link plus a
  warning (non-blocking intent outweighs one-rule-for-all-links consistency).
- Adversarial review skipped at Anthony's direction.
