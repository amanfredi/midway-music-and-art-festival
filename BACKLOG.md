# Backlog — open work, open decisions, deferred ideas

Everything forward-looking lives here. PROGRESS.md is the state journal: what
happened and why. Nothing should appear in both.

Items are not prioritized against each other. The festival is October 2–4,
2026; nothing here blocks the site working today.

- Consider adopting svelte/sveltekit (see especially the static site adapter https://svelte.dev/docs/kit/adapter-static)
- Consider moving deployment to Cloudflare Pages free plan and reverting github repo to private visibility (https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-kit-site/#deploy-with-cloudflare-pages)

## Implemented locally — awaiting push and first-run verification

- **Deploy robustness** (`definitions/deploy-robustness.md`) — implemented
  2026-08-12 by the dispatched agent: six commits on local `main`
  (a958ad3..221886d), never pushed. Snapshot write/fallback in `build.mjs`,
  the zero-npm content publish with the two-part gate and
  skip-if-unchanged, npm cache + `skip_tests`, the Fastmail failure
  notifier, README playbook, CONTRACTS snapshot contract. The agent's
  recovered report (2026-08-21) added as-implemented deviations, a ten-step
  first-run inspection checklist, and residual risks to the definition —
  the checklist is the post-push script. Reviewed 2026-08-22 (Fable,
  inversion-framed); both blockers and four smaller findings fixed same
  day. Remaining, in order: Anthony pushes; run the checklist; then
  Anthony removes the invariant's "currently not met" clause in CLAUDE.md.
  The review's allowlist inversion was ruled and landed 2026-08-22, with a
  fail-closed test. Mind the sequencing note on the
  live sheet incident under Content and data: until the sheet is fixed,
  each failed cron after the push emails both recipient lists. Operator config exists since 2026-08-12:
  `FASTMAIL_APP_PASSWORD` secret; `DEPLOY_NOTIFICATION_EMAIL`,
  `CONTENT_NOTIFICATION_EMAIL`, `FASTMAIL_USER` variables (recipient lists
  may be comma-separated).

- **White-on-gray color scheme + kind-tinted event tiles** — landed
  2026-08-22 (f2f08c0..e3a5eca) on the same unpushed stack, so it rides the
  deploy-robustness push. Page white, panels `#f6f6f6`, eight kind-tint
  tokens tinting tiles via row-level classes, every chip outlined. All text
  pairs ≥4.85:1 (muted ≥5.73:1 after Anthony's floor correction); axe gate
  green; forced-colors improved (outlined chips keep a boundary).

## Decisions that need Anthony

**Three definitions await rulings (written 2026-08-11).** Each doc collects
its open questions at the end; the one-line asks:

- `definitions/coincident-pin-presentation.md` — leader lines for pin groups
  no zoom can separate; the cheap fallback is routing a tied venue tap to the
  picker sheet. The tap bug it found is under Map and stands regardless of
  the ruling.
- `definitions/bus-route-lines.md` — recommends drawing the A/B Line BRT
  first from geometry already committed (~11.6 KB gzipped marginal), then
  extending the transit query for 67/72. Inverts if the interest is
  specifically 67/72.
- `definitions/web-share.md` — share buttons on event and venue detail; the
  prerequisite `#/venue/<id>` route is a CONTRACTS routes change and the
  scope question.

**Venue popup: ruled deferred, nothing to build (2026-08-21).** No felt
problem — the popup was an idea, not friction — so the `<dialog>` sheet
stays the single venue surface. Revisit the teaser variant only if pin
browsing still feels heavy on a real phone now that tapped-pin highlight
and key-list recentering have landed; the acceptance criteria in
`definitions/venue-card-map-popup.md` are the bar for any attempt.
Desktop-only hover teaser ruled out.

**Map artwork, if it is ever commissioned.** The spike auditioned a four-corner
`ImageSource` ground against the vector one, and measured three constraints that
belong in any artist brief.

First, **~5 m of drift**: `map.svg` is drawn in a local equirectangular
projection while `ImageSource` places an image by its four corners in Web
Mercator, and over a 16 km sheet those disagree most in the middle. Pins land
correctly; the artwork under them slides. Four corners are not enough
georeferencing at this extent — more control points, or a pre-warped image, or a
tiled source.

Second, a **4096 px ceiling**: MapLibre uploads an `ImageSource` as a single
WebGL texture, and 4096 is the largest size every WebGL2 device is guaranteed to
accept. Over this extent that is 3.9 m per pixel, which reads acceptably at the
home view and goes soft at the closest zoom, so shipped artwork needs tiling
rather than a bigger single image.

Third, and observed rather than measured: **the raster ground was noticeably
slower than the vector one** on a real iPhone (Anthony, 2026-08-10). Not
diagnosed — vector is what ships, so it was not worth chasing — but it points the
same way the resolution ceiling does, toward a tiled raster source rather than
one large texture. The practical consequence for any future artwork work is
sequencing: **validate performance on a real device early**, before art is
commissioned against an approach that turns out to feel worse than what it
replaces. It is also a third reason the raster stays out of the shipped payload,
alongside its 863 KB and the fact that nothing renders it.

Tooling is kept — see the `artwork/` entries in CONTRACTS.md's directory layout.
Nothing ships. The artist-facing constraints are in
`reference/artist-accessibility-rider.md`; the three above are implementation
constraints on whoever wires the artwork up, not on the artist.

**Sponsor presentation, pending real sponsors.** The featured-vs-generic
sponsor pin distinction wants a design review once someone can see it against
real logos. Emerald tier's "special treatment / custom branding" is undefined
because no emerald sponsor exists yet, and the ruby logo-pin map format is
likewise unspecified.

**Transit pin green — needs a brand ack, then it lands.** White line letters
on `--pin-transit` `#298d4e` compute 4.19:1. The CSS comment justifies that as
large text, but the letters render 8.4px bold at a 288px frame and 16.4px at
the 560px cap, so the 4.5:1 small-text threshold applies at every width.
Darkening to `#1e7a41` gives 5.36:1 against the letters and 4.60:1 against the
paper, and lifts the pin fill's own non-text contrast from 3.61:1 as a side
effect. Deferred 2026-08-10 by Anthony until after the MapLibre migration — which has
since landed, so this is ripe again. But the fix as specified (one `app.css`
token, the CONTRACTS.md pin-table row) targeted the retired SVG pins; transit
pins are now canvas symbols, so before the ack matters, find where the color
lives in `map.js`, re-measure the letter contrast as the engine renders it,
and re-spec. The 4.5:1 small-text requirement is unchanged.

## Map

**Bug: one of two exactly-coincident venues cannot be tapped at close zoom.**
Above `clusterMaxZoom` the two Hamline Park venues draw exactly superimposed,
and `wirePinTaps` breaks the distance tie on layer rank, so the engine's
first-enumerated feature always wins (found 2026-08-11 while defining
coincident-pin presentation). Nobody is stranded — the venue stays reachable
through the key list — but the tap is broken. Cheap fix: route a tied
venue-pin hit to the picker sheet, which already handles the unsplittable
cluster; the fuller treatment is the leader-lines definition awaiting a
ruling (see Decisions).

**Recapture the screenshot baseline** (`reviews/2026-08-baseline/`, procedure
in its RECIPE.md): the 2026-08-11 map bundle changed four things inside the
map frame — 38 px venue pins, pin-matched legend swatches, the pan d-pad, and
the scale bar — and the 2026-08-22 color scheme then changed every view, so
the recapture now covers the whole shell, not just the map frame.

The remaining audit items below were specified against the retired SVG map;
they are requirements the MapLibre map must meet, kept for their measurements
and acceptance criteria (evidence in `reviews/2026-08-wcag-aa-audit.md`).

- [ ] **MapLibre migration: map accessibility re-audit.** After the migration
      lands, re-run the map sections of `reference/wcag-aa-site-profile.md` —
      its re-audit triggers name map rework as exactly this invalidating
      change. The 2026-08 audit's map dispositions describe the SVG map and
      expire with it. Scope is the map view unless the shell changed too.

- [ ] **Hit-target floor for transit and sponsor pins** (WCAG 2.5.8, F4).
      **Needs re-measuring against the new map** — the old measurement (22.7px
      rendered, closest pair 3.4px apart) described SVG pins whose hit shape
      was the diamond itself. Pins are now 22px canvas symbols, but a tap
      resolves against a ±10px box around the touch point, so the effective
      target is larger than the drawn one and the two no longer coincide. Which
      of them 2.5.8 measures here is the question to settle before deciding
      there is anything to fix; the map re-audit item above is the natural
      place. The coincident-venue half of this is closed for reachability by
      clustering plus the picker sheet — though see the tap bug at the top of
      this section for the close-zoom exception found 2026-08-11.
- [ ] **Station and arterial label size floors** (guide Part C #4). Advisory
      rather than a WCAG failure — the contrast passes. The old measurement
      (6.0px and 7.4px at a 288px frame) was of `map.svg`'s counter-scaled type
      and no longer applies: label sizes are now zoom-interpolated CSS pixels in
      `map.js`, currently bottoming out at 9.5px for arterials and 11px for
      station names, which clears the guide's 8px floor at every frame width.
      Re-measure on device to confirm, then close.

## App

The **WCAG 2.2 AA review** ran on 2026-08-10. All 55 A/AA criteria are
dispositioned in `reviews/2026-08-wcag-aa-audit.md`;
`reference/wcag-aa-site-profile.md` is the checklist future audits start from,
and states its own re-audit triggers. The cheap fixes landed with pinned
tests, an axe-core gate covers every route, and the Accessibility contract in
CONTRACTS.md was corrected where the audit found it too narrow. Left open
outside the map (which is above):

- [ ] **Visible-on-focus skip link** (advisory). The last open one of the
      audit's four small advisory items — the other three landed 2026-08-11.
      a11yproject asks for it unconditionally, but 2.4.1 passes on landmarks
      and the tab bar follows `<main>`, so it buys little here; open until
      someone rules it worth the chrome.
- [ ] **Sticky group headings can cover a focused row** on the Now and
      Starred views — the same hazard class as the schedule and tab-bar
      scroll-padding fixes already landed, but heading-height only, so
      smaller. Noted 2026-08-11 while fixing the schedule case.

- [ ] **Color-scheme follow-ups** (from the 2026-08-22 implementation
      report): Anthony to rule on dropping the kind badge from by-category
      rows, where it repeats the group heading (the vendors view already
      dropped its type badge for this reason 2026-08-09); remove the dead
      kind CSS (family/community are not in the build's VALID_KINDS, the
      vendor type-badge classes have no markup); Anthony's call on the
      cross-day prefix gold at 4.85:1 on the two warm tints (passes 4.5:1;
      the 5.5 comfort floor would turn it brown, ~#7d4900) and on borders
      (~1.15:1 non-text, outside the contract's scope; a true 3:1 border
      ≈ #949494 reads much heavier than the light-panel aesthetic).

**QA on Android**, and an **agent review from a user's perspective**, possibly
using Claude for Chrome.

**Consider adding View Transitions for additional polish**, but this is low priority and might not even be an improvement.

**Include favicon sizes up to 64×64px** The favicon rendered in safari currently looks low-res.

## Content and data

**Live content pipeline failing — venue content frozen since 2026-08-11.**
The organizers added four venues (sheet rows 16–19: Hive Collaborative,
Celtic Junction Arts Center, Black Hart of Saint Paul, Can Can Wonderland)
with eight required cells still empty across description/location/address,
so every build since the last success (2026-08-11T19:31Z) fails validation:
roughly forty consecutive 6-hour cron runs have failed and the live site
still shows the old 14 venues. The fix is filling the eight cells in the
sheet. Sequencing: once the deploy-robustness work is pushed, every failed
cron emails both recipient lists naming exactly these rows — four times a
day until the sheet is fixed — which is either the system doing its job or
mail the organizers weren't warned about, depending on what they've been
told.

Two venue-location facts are **valid data, not sheet errors** (ruled by
Anthony 2026-08-10, after repeated sessions flagged them; also recorded in
CLAUDE.md): **Mosaic on a Stick sits inside Hamline Park** and correctly
carries the park's address and plus code (`1564 Lafond Ave` / `XR5M+X8`), and
**Vig Guitars and Fluid Ink Tattoos are about 14 m apart**. Identical or
near-identical coordinates were a rendering limitation of the retired SVG map
(overlapping pins, one pointer-unreachable). The MapLibre migration fixed it
with clustering plus a picker sheet for pins no zoom can separate — not data
changes or build validation.

Two live venue `url` cells are schemeless (`hamline.edu/sundin-music-hall`,
`blackgarnetbooks.com`). The build completes them to `https://` with a logged
rewrite, so this is cosmetic — worth adding the scheme in the sheet whenever
it's next touched.

Events, vendors, sponsors and settings are still placeholder fixtures. Each
becomes real with a one-line change in `content/config.json` pointing at a
published sheet tab.

- Should we try to translate the content to multiple languages? Limited English Proficiency languages in Saint Paul are Spanish, Hmong, Karen, and Somali.

Two accessibility items from the August 2026 audit need content-side
follow-through:

- [ ] **Add the optional `logo_alt` sponsor-sheet column** (approved by
      Anthony 2026-08-10). The build derives `alt="<name> logo"`; a logo
      whose meaning exceeds the sponsor's name — a tagline, a co-brand —
      needs the override. Coordinate the new column with organizers, then
      wire the build: use `logo_alt` when non-empty, derive otherwise, and
      validate non-empty-if-present so a stray space can't blank the alt.
- [ ] **Editorial check of venue and event descriptions at content freeze**
      for non-English passages needing a `lang` attribute (WCAG 3.1.2). A
      one-time read, not a build rule — the audit concluded validation is not
      worth writing, since proper names are exempt and cover the realistic
      cases.

## Needs a real device

None of these can be checked from the screenshot harness or the test suite.

- [ ] iPhone airplane-mode pass after any service-worker or caching change
      (procedure in README; standing gate, last passed 2026-08-10 — **owed
      again**: the 2026-08-11 pass narrowed the worker's revalidation catch).
- [ ] In-place content refresh on a real phone (new 2026-08-09, after the
      revalidation fix): with a tab already open, publish a banner change and
      confirm it appears without touching the tab; then confirm a worker
      version bump still leaves exactly one `circuit-map-*` cache. The
      clone-throw was observed in Chromium only — Safari unverified.
- [ ] Confirm map pan/zoom still feels smooth on a mid-range Android, not
      just the iPhone the migration was evaluated on. WebGL2 is a harder floor
      than SVG was.
- [ ] Sticky control bar against the iOS status bar when installed.
      `.schedule-controls` pins at `top: var(--safe-top)`, which *should*
      evaluate to 0 given `apple-mobile-web-app-status-bar-style: default`.
      Unverified; if it does tuck under, the fix is an opaque fixed filler of
      height `var(--safe-top)`.
- [ ] Venue-pin digits on the iPhone: still serifs after the font-stack fix?
      The map's stack now leads with `system-ui` (2026-08-11; the old one
      resolved to Helvetica off Apple engines), but the serif rendering was
      never reproduced off-device, so this is a diagnosis, not a confirmed
      fix. If the digits still read serif, run the canvas probe in the
      2026-08-11 PROGRESS entry and report what it prints.
- [ ] Install button on Android Chrome (native prompt).
- [ ] Splash screens render on iOS launch.
- [ ] Nav fits and reads at 320 px with six tabs.

### VoiceOver and zoom pass (about 15 minutes, from the WCAG audit)

Three criteria stay **pending** in `reviews/2026-08-wcag-aa-audit.md` until
this runs: 1.1.1 (is the text alternative for the map adequate?), 1.4.4
(zoom against map type), and 4.1.3 (does VoiceOver actually speak the live
regions?). Everything else about them is settled mechanically. Step 6 also
confirms the orientation fix on a real installed app. Run it top to bottom,
like the README airplane-mode pass.

1. **Setup:** deploy, or serve on the LAN, and open in iOS Safari. Turn
   VoiceOver on (Settings → Accessibility, or triple-click the side button).
2. **[4.1.3] Route announcements:** swipe through the tab bar and activate
   Schedule, then Map, then Support. Each should announce "<Name> view"
   without focus jumping anywhere. Activate the same tab twice — the
   announcement should repeat, not go silent.
3. **[4.1.3] Banner and toast:** load with an undismissed banner; VoiceOver
   should announce the notice text without focus moving. Then on the Map,
   with Location Services off for Safari, tap "Show my location" — the
   permission-denied toast should be spoken once, not twice.
4. **[1.1.1] Is the map's text alternative adequate?** With VoiceOver on, on
   the Map view: touch the map and you should hear its name and the arrow-key
   hint; swipe through the pins and each venue should announce "Venue N:
   name", each stop its name and lines. Then answer the real question using
   only the venue key list and the sheets, never the map picture: how do I get
   from a Green Line stop to venue 3? If the answer is "yes, comfortably",
   1.1.1 closes as a pass. If you needed the picture, venues need
   transit-relative information in text somewhere.
5. **[1.4.4] Zoom and reflow judgment:** VoiceOver off. Pinch-zoom the *page*
   to 200% on the schedule — everything should reflow or scroll readably. On
   the map, pinch the *map*: street names hold their size by design, so judge
   whether page zoom (pinch outside the map frame, or Safari's Page Zoom
   setting) makes map labels comfortably readable. Then try Settings → Larger
   Text and confirm app text grows while the site stays usable.
6. **[1.3.4] Rotation:** Add to Home Screen, open from the icon, rotate the
   phone. The app should follow into landscape and stay usable.
7. **[2.2.2, optional] Now-view stability:** during a real or simulated
   festival window, leave VoiceOver focus on a Now-view row across a minute
   boundary where the lineup changes, and note whether reading position is
   lost. The in-place patch landed 2026-08-11; this step confirms it on a
   real device.
