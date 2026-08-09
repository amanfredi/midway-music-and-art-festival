# Midway Festival Circuit Map — offline-capable festival map & schedule site

Status: defined 2026-08-01 | Overall confidence: high

## Problem & motivation

The inaugural Midway Music & Arts Festival (October 2–4, 2026, organized by the Hamline Midway Coalition) is a *decentralized, neighborhood-wide* event: 5–10 independent venues spread along the Snelling & University commercial corridor in St. Paul, MN, plus artists, vendors, and sponsors. Attendees must navigate real city blocks to answer "what's happening where, right now / next?" The festival's own planning names a central digital/physical **"Circuit Map"** as a deliverable.

Anthony Manfredi (volunteer, spouse of Lisa, who is building the festival's umbrella website in Wix/Squarespace) owns the **implementation of the mobile map/schedule component** — not its content, which comes from festival organizers. Attendees will be outdoors, in crowds, on congested or absent cell networks; the component must work offline after first load. Without it, attendees fall back to printed guides and a generic website — survivable, but a purpose-built now/next map is a genuine improvement, and the build cost is donated volunteer labor.

## Success criteria

- **Offline promise (acceptance criterion #1):** on a real iPhone in airplane mode, after one prior online visit, the site loads fully — map, schedule, starred events — including after Safari evicts and reloads the tab. Verified early in the POC on a deployed skeleton, not in October.
- A demo with placeholder content is in front of festival organizers by **August 8–9, 2026**, and they adopt the component as the digital Circuit Map (the project's main external risk; the demo is its cheapest test).
- The festival coordinator can update content (schedule, venues, vendors, sponsors, notice banner) by editing a Google Sheet and triggering a rebuild, with no code knowledge and minimal guidance.
- Day-of usefulness is at least parity with the printed guide; when the device has signal, the site opportunistically picks up published updates.

**Failure looks like:** organizers route around it (orphaned component), or the offline behavior fails on real devices in the field.

## Non-goals

- **No native app** — no app-store registration, review process, or install friction.
- **No server-side runtime** — nothing to operate, patch, or pay for. Static hosting only.
- **No push notifications** (phone buzzing while site is closed) — on iOS this requires home-screen install plus a push server; a banner shown on next open captures most of the value.
- **No accounts, tracking, or personal data collection** — starring is device-local.

## Constraints

- **Time:** festival is Oct 2–4, 2026; demo target Aug 8–9, 2026. Anthony directs; implementation is delegated to LLM agents, so calendar time matters more than labor hours.
- **Money:** effectively zero budget. GitHub Pages (free) + a custom subdomain under the festival's domain. HMC has Google Workspace for Nonprofits (relevant for the Sheets pipeline; its Google Maps credits are *not* useful here — see Non-goals).
- **Maintenance:** end state is coordinator-maintained via Google Sheet; Anthony should not be a required operator during festival weekend.
- **Content dependency:** all real content (venues, schedule, vendors, sponsors, map artwork) comes from organizers and is currently TBD. The build proceeds on realistic placeholder content.
- **Devices:** attendee phones, iOS Safari and Android Chrome, on poor/no connectivity. iOS Safari's tab eviction/reload behavior is the canonical hostile environment.

## Approach sketch

A **static, offline-capable website (PWA)** on GitHub Pages under a festival subdomain, umbrella site remaining in Wix/Squarespace.

- **Offline:** a service worker precaches the full site (app shell, content JSON, map image, sponsor logos) on first visit; thereafter serves from cache and quietly revalidates when online (stale-while-revalidate). Tab reloads become instant and offline-safe rather than fatal.
- **Content pipeline:** a Google Sheet (tabs: venues, events, vendors, sponsors, settings/banner) is the source of truth. A GitHub Action (scheduled and manually triggerable) pulls the sheet, validates it, builds static JSON + site, and deploys. Broken edits fail the build with a readable error rather than shipping a broken site.
- **Map:** a single **designed/illustrated map image** with venue/vendor pins overlaid — the digital twin of the printed map, matching the festival's arts identity, trivially offline. **Load-bearing assumption:** the commissioned artist draws over the true-scale street grid (stylized freely on top), keeping the artwork georeferenceable via a simple 2–3-control-point affine transform. This preserves an optional "you are here" GPS dot without any map engine. *This constraint must reach the artist before artwork begins; freehand-distorted art forecloses GPS overlay permanently.* Each venue also gets an "open in Google Maps" link for directions when online.
- **Schedule:** "on now / up next" view plus browsable schedule by time and by venue. Scale ~5–10 venues, up to ~100 events.
- **Starring:** attendees mark events of interest; stored in localStorage (survives reloads; iOS may evict after 7 days of non-use — acceptable for a 3-day festival, worth one line in user-facing docs).
- **Update bonus tier:** organizers edit the sheet → rebuild → deployed; online devices pick it up on next revalidation. A settings-tab **notice banner** field ("Main stage running 30 min late") renders as a dismissible banner. Cheap because the architecture above already provides it.
- **Sponsors:** tiered sponsor list with logos and blurbs; optional map pins. Logos are fetched at build time and bundled as site assets so they render offline (never hotlinked).

**Assumption that would invalidate this sketch:** if HMC's Circuit Map owner has a conflicting vision or tool already chosen, this component gets orphaned regardless of quality. The Aug 8–9 demo exists to surface that before deeper investment.

## Risks & unknowns

| Risk | Confidence it's fine | Cheapest test |
|---|---|---|
| Organizers adopt the component and feed it content | medium | Demo with placeholder content, Aug 8–9 |
| iOS Safari serves the site offline across tab eviction/reload | high | Deploy skeleton PWA week 1; airplane-mode test on a real iPhone |
| Artist can/will work to the true-scale constraint | medium-high | Communicate the constraint before commissioning; a georeferenced test image validates the transform |
| Google Sheet → Actions pipeline is coordinator-proof | medium | Have a non-technical person (Lisa) make an edit end-to-end during the POC |
| Sheet API access from CI (auth, sharing) is frictionless under HMC's Workspace | medium-high | Wire the pipeline against a placeholder sheet in week 1 |

## Deferred questions

- **Coordinator editing workflow details** (validation guardrails, who triggers rebuilds, edit permissions) — decide before handoff, not before POC.
- **Whether the GPS "you are here" dot ships at all** — organizers may not want it; architecture keeps it possible. Decide after demo feedback.
- **Domain/subdomain name** — needed before publicizing, not before building.
- **Minimum browser/device floor** — assume evergreen iOS Safari + Android Chrome for POC; revisit only if organizers report older-device constraints.
- **Search/filtering** — revisit only if content scale or user feedback demands it.

## Ledger

- **Static PWA over native app** — app-store registration, review, build pipeline, and install friction add cost and user friction with no offsetting benefit at this scale.
- **Static PWA over commercial event apps (Sched, Guidebook, LineUpr, Yapp)** — surveyed 2026-08-01: conference-centric, maps as static uploads, meaningful pricing tiers, connectivity-dependent, some push native installs. None serve "offline interactive neighborhood map + schedule" well. Strongest free alternative if organizers balk: Google My Maps embedded in Wix (loses offline, now/next, identity).
- **GitHub Pages + subdomain over a page inside Wix** — full control of service worker scope and mobile full-screen UX; free; Anthony's preferred tooling.
- **Google Sheet as content source over "push to the GitHub repo"** — resolves the tension between coordinator-maintainability and git workflow; validation lives in CI.
- **One illustrated map over dual illustrated + slippy-map implementations** — "plan for both" was explicitly reconsidered; two map engines double the hardest engineering. Georeferencing the artwork preserves the GPS benefit of a real map at a fraction of the cost. Google Maps credits don't transfer to offline use, removing the main argument for the interactive option.
- **Day-of updates as bonus tier, not requirement** — baseline is parity with the printed guide (frozen at publish); opportunistic refresh + banner come nearly free from the chosen architecture; push notifications explicitly out.
- **Starring in localStorage** — requested nice-to-have; zero server cost; eviction nuance acceptable for a 3-day event.
- **Sponsors as a first-class content type** — requested 2026-08-01; tiered list + optional pins; logos bundled at build for offline correctness.
- **Placeholder content strategy** — framework ships with realistic demo data so organizer iteration starts before real content exists.
