# Web Share — share buttons for events and venues

Status: drafted 2026-08-10, awaiting Anthony's ruling on the open questions
below | Confidence: high on mechanics, open on scope and copy

## Problem & motivation

A festival guide spreads person to person — "come to this set" — and the app
has no share affordance: an attendee must copy the address bar by hand.
Events are at least shareable that way because they have URLs
(`#/event/<id>`); venues have no URL at all, so "meet me at this venue" can't
be sent as a link in any form. The 2026-08-02 PWA feature survey flagged the
Web Share API as the strongest candidate — iOS Safari has supported it since
12.2, and the happy path is roughly five lines — and BACKLOG.md carries it as
an open item.

## Recommendation

Ship it as one half-day feature: a Share button on the event detail page and
the venue detail surface, calling `navigator.share` where it exists and
falling back to clipboard-copy-plus-toast where it doesn't. The prerequisite
is giving venues a URL — a new `#/venue/<id>` route, the one scope-adding
change to CONTRACTS.md and therefore the only part needing Anthony's say-so
before work starts. If the venue route is ruled out of scope, ship the events
half alone; it stands on its own at perhaps a third of the value.

## Success criteria

- Tapping Share on an event or venue on an iPhone opens the OS share sheet
  with a URL that, opened by the recipient, lands on that event or venue.
- On a browser without `navigator.share` (desktop Firefox — unverified this
  session, from the 2026-08-02 survey), the same tap copies the URL and shows
  a "Link copied" toast.
- `#/venue/<id>` renders the venue's details standalone, deep-links cold, and
  — per the project's acceptance criterion — loads offline after one prior
  online visit.
- The shared URL derives from the live origin, not a hardcoded one — correct
  at github.io and at the custom domain alike — and is stable across
  rebuilds.
- `npm test` covers all of the above headlessly.

## Non-goals

- **No share for vendors, sponsors, or transit stops** — nothing else has or
  gains a URL. Revisit only on demand.
- **No share affordance on list rows** — detail surfaces only; a row button
  would crowd the existing star target.
- **No Web Share Target, file sharing, or URL shortening.**
- **No custom share dialog** — the fallback is clipboard + toast, not a
  hand-built picker.

## Approach sketch

**The `#/venue/<id>` route.** A standalone venue view, rendered like
`#/event/<id>`: no nav tab active, route announcer says "Venue detail", back
button returns via `getLastListRoute()`, unknown id gets the event-detail
not-found treatment with a link to `#/map`. It shows what the venue sheet
shows — name, address, description, the venue's events, then Share / Open in
Google Maps / Visit venue website — built by a builder shared with
`sheet.js#openVenueSheet`, preserving that file's "exactly one venue/vendor
detail surface" intent. One deliberate divergence: the sheet lists today's events,
but a link recipient may open the page days early, so the route lists all
festival days grouped by day (open question 4). In-app taps on venue names
and pins still open the sheet; the route exists as the deep-link and share
target. Deep-linking to a modal instead was rejected — see Ledger.

**Id stability.** CONTRACTS.md already guarantees slugification "can never
invalidate a starred event id or a shared `#/event/<id>` link" — the same
normalization runs on venue ids, so the guarantee extends verbatim; the
implementation amends that sentence to name `#/venue/<id>`. Residual
exposure: an organizer editing a venue's `id` cell in the live sheet kills
previously shared links. The same break class exists for starred ids and
`#/event/<id>` links, but events come from committed fixtures — venues are
the one live tab, so this is the first instance an organizer can trigger.
No build changes: the route resolves against ids already in content.json.

**The Share button.** Event detail: in `.event-detail__actions` beside Star
and Open in Google Maps. Venue sheet and venue route: in the actions row via
the shared builder. Styled `btn btn--secondary`, visible text "Share", the
existing `SHARE_GLYPH` SVG from sheet.js (exported, not duplicated). Payload:
`{ title: <item name>, url }` — recommendation, pending open question 2; the
url is `location.href` with the hash replaced by the item's route and the
`?t=` demo-clock param stripped (open question 3), so it works at any origin
the site is served from.

**Detection and fallback.** Feature-detect `navigator.share` in the click
handler (the click satisfies WebKit's user-gesture requirement; no `canShare`
needed for a title+url payload). A rejection with `AbortError` is the user
cancelling the OS sheet — do nothing. A missing API or any other failure
falls back to `navigator.clipboard.writeText(url)` and
`showToast('Link copied')` — the
existing `util.js` toast, which already handles the live region and reduced
motion. If the clipboard call also fails, toast an honest "Couldn't share on
this browser". Known accepted gap: on the README's LAN-HTTP dev workflow,
neither API exists (both need a secure context), so dev serving always lands
on the failure toast; production is HTTPS.

**Offline.** Sharing offline works — `navigator.share` and clipboard are
local OS actions. The recipient needs network to first load the link; no
code addresses it. The route adds no files,
so the service worker is untouched: hash navigations are already answered
with cached `index.html` per the SW contract.

## What the tests pin

- **Share payload:** a Playwright init script installs a stub
  `navigator.share` that records its argument; clicking Share on
  `#/event/<id>` and on `#/venue/<id>` yields one call whose `url` ends with
  the right route and whose `title` matches the spec (the shared builder
  makes separate sheet coverage redundant).
- **Cancel:** a stub rejecting with `AbortError` produces no toast and no
  error surface.
- **Fallback:** with `navigator.share` deleted and clipboard permission
  granted, clicking Share puts the URL on the clipboard and shows the toast.
- **Route:** `#/venue/<id>` cold-loaded renders name, address, and hooks;
  an unknown id renders the not-found state. The offline spec gains a
  deep-link check: after cache priming, `#/venue/<id>` renders offline.
- **Sweeps:** the new route joins the explicit route lists in `axe.spec.mjs`
  and `reflow.spec.mjs`.

## CONTRACTS.md delta (applied at implementation)

- UI contract route list gains `#/venue/<id>`.
- The id-normalization consequence names `#/venue/<id>` alongside
  `#/event/<id>`.
- Accessibility contract: the route announcer says "Venue detail".
- Test hooks gain `[data-testid="venue-view"]` on the route's container and
  `[data-testid="share-btn"]` on every Share button.

## Risks & unknowns

| Risk | Confidence it's fine | Cheapest test |
|---|---|---|
| Real iOS share sheet behaves as the stub assumes | high | One manual tap during the next on-device pass |
| Desktop-Firefox-has-no-share claim is stale | high (harmless either way — fallback still correct) | caniuse check at implementation |
| Venue id renamed in the live sheet breaks shared links | medium (pre-existing class) | none — accepted; one rename has already happened (the `ginkgocoffehouse` typo fix, 2026-08-02) |

## Open questions (for Anthony)

1. **Is the `#/venue/<id>` route in scope?** DEFINITION.md's non-goals don't
   exclude it (they bar native app, server, push, accounts), and the maplibre
   spike's "no new routes" was spike-scoped — but CONTRACTS.md routes are
   binding, so adding one needs your say-so. Fallback: events-only share.
2. **Share copy.** Recommended payload is `{ title: <item name>, url }` with
   no `text` (several targets concatenate text and url — unverified this
   session). Want richer copy, e.g. "Sat 7:00 PM at Hamline Park — Midway
   Music & Arts Fest"?
3. **Strip `?t=` from shared URLs?** Recommend yes: sharing during a demo
   shouldn't hand the recipient a frozen clock.
4. **Venue route event list: all festival days (recommended) or today-only
   (exact sheet reuse)?** Cost difference is near zero either way.

## Ledger

- **Standalone route over deep-link-that-opens-the-sheet** — the sheet is a
  modal that every route change closes by design; auto-opening a modal on
  page load fights focus management and screen-reader flow, and would tie
  venue links to the map tab's WebGL2 floor.
