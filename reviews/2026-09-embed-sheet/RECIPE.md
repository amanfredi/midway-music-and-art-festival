# The embedded map's overlays — change evidence

Before/after captures for the 2026-09-05 work on where the venue sheet and the
toasts open inside the map embed (PROGRESS.md, "the embed's overlays move to the
map frame" and "an embed overlay opens where the tap was"). **Change evidence,
not a baseline**: built from `content/snapshot/sources/`, not from the live
sheet.

Twelve shots in two rounds, answering two different questions.

## Round one: is the overlay anchored at all?

Shot with the map on screen, which is where the first report came from.

| prefix | state |
|---|---|
| `before-` | overlays pinned to the bottom of the viewport, which in the embed is the bottom of the whole iframe |
| `after-` | overlays anchored to what the visitor tapped |

- `sheet` — a venue sheet, opened by tapping the topmost pin clear of the canvas
  edges. `before-sheet-phone.png` is the reported bug and the clearest shot in
  the set: the whole screen is dimmed by the sheet's backdrop and the sheet
  itself is nowhere on it, 300 px below the fold.
- `toast` — the locate button's answer with geolocation denied. Same fault,
  same fix, and the one a visitor is most likely to meet: the sheet's own share
  button raises "Link copied" the same way.

The host page is scrolled so the map is at the top of it and the rest of the
embed is below the fold, which is the position the report came from.

| | iframe height | sheet opens at | toast opens at |
|---|---|---|---|
| `before-` phone | 1711 | y=1195 | y=1623 |
| `after-` phone | 1711 | y=16 | y=289 |
| `before-` desktop | 1061 | y=606 | y=1011 |
| `after-` desktop | 1061 | y=121 | y=526 |

The phone's visible band is roughly y=40..890 of that 1711 px iframe.

## Round two: anchored to *what*?

Shot from the other end of the page — scrolled to the end of the venue key, the
map frame a screen above the fold — and the sheet opened by tapping the last
venue card rather than a pin. Anchoring everything to the map is right until the
map is not what the visitor is looking at.

| prefix | state |
|---|---|
| `frame-` | the sheet anchored to the map frame, which is round one's answer |
| `tap-` | the sheet anchored to the card that was tapped |

| | the card tap opens the sheet at |
|---|---|
| `frame-` phone | y=16 |
| `tap-` phone | y=1350 |
| `frame-` desktop | y=149 |
| `tap-` desktop | y=568 |

`frame-card-phone.png` against `tap-card-phone.png` is the pair to look at: the
same dimmed screen with nothing on it, and then the sheet sitting in the list
where the card was tapped.

Every shot is the whole host-page viewport rather than the iframe, because the
point of the set is where the overlay lands *on the visitor's screen*.

## Round three: does the sheet say it scrolls?

`node reviews/2026-09-embed-sheet/shoot-sheet-cue.mjs`, eight shots, same build.
The question `after-sheet-phone.png` raised and Anthony ruled on: the sheet is
confined to the map frame and scrolls inside itself, and the only sign of it was
content clipped at the border, which reads as a layout bug. The cramping stays;
the missing affordance was the defect.

| prefix | state |
|---|---|
| `before-cue-` | the sheet as it shipped — content clipped at the border |
| `after-cue-` | the same sheet with the cue at the edge that has more behind it |
| `end-cue-` | the same sheet scrolled to its end |

`-phone` is the embed on a phone inside the host page, sheet opened by a pin tap
so it sits on the map frame's bottom edge — directly comparable with
`after-sheet-phone.png`, and it lands on the same venue (Hive Collaborative).
`-app` is the app's own bottom sheet at 393 × 480, which is the other surface
that overflows: 80 vh of a short window is no roomier than the embed's frame.

| | sheet | runs past its edge by |
|---|---|---|
| `-phone` (embed, map frame) | 361 px | 155 px |
| `-app` (80 vh of a 480 px window) | 384 px | 261 px |

**`before-cue-phone-edge.png` against `after-cue-phone-edge.png` is the pair to
look at**, and the only one that answers the question. The cue occupies the last
~35 px of a 361 px sheet, which is precisely the band a whole-screen shot at 1x
loses — judged from the full shots the change looks like nothing happened. These
two are the same 56 px strip of the same sheet at 3x, with and without it: a
Share button sliced through by a hard border, against a button dissolving into
the surface under a shaded edge.

`end-cue-app.png` is the other half of the claim. At the end of the scroll the
bottom edge is clean — last button whole, padding below it, no cue — and the top
edge has taken the cue instead.

## How the earlier state in each pair was produced

All four prefixes come out of **one browser session** from the same working
tree, because the CSS font stack resolves differently between headless launches
(`../2026-09-map-collisions/RECIPE.md`).

- `before-` strips the anchor off the overlay element once it is open — the
  custom properties and the `data-embed-anchor` attribute — so every
  `body.is-embed` rule falls back to the app's own value. Done to the element
  rather than by deleting rules out of the stylesheet: selector names change,
  and a harness that quietly strips the wrong rule photographs a state that
  never shipped.
- `frame-` puts the sheet back on the map frame once it is open, which is what
  the previous code computed.
- `before-cue-` removes the two `.sheet__fade` elements from the open dialog.
  Those are the whole of the visible change — the dialog/scroller split behind
  them moved no padding and no pixel — so this is the previous state rather than
  an approximation of it.

What neither method captures is `preventScroll` on the sheet's focus call, which
is JS. Nothing is lost: no engine available here performs that scroll in either
state (see below).

## What these shots do and don't prove

They prove the overlay lands off the visitor's screen before and on it after.

They do **not** reproduce the scroll in the original report — "clicking a venue
pin scrolls the host page to the bottom of the iframe". Headless Chromium and
headless WebKit both move the host page 0 px, measured against the live
Squarespace page as well as against this harness. Cross-frame scroll
propagation works in both (focusing an ordinary element near the bottom of the
iframe moves the host page several hundred px); what neither does is propagate
it for a `position: fixed` element, which is what the sheet was. The engine on
the reporter's phone evidently does. That is why the fix targets the position
rather than the scroll.

## Reproduction

Prerequisites: `npm install`, `npx playwright install chromium`.

The shots are of real venues, so build from the snapshot rather than the test
fixtures. Nothing in the repo ships a config for that; write one pointing at
`content/snapshot/sources/*.csv` plus `content/fixtures/settings.csv`:

```sh
node scripts/build.mjs --config /tmp/snapshot-config.json && node scripts/build-sw.mjs
node reviews/2026-09-embed-sheet/shoot-embed-overlays.mjs
node reviews/2026-09-embed-sheet/shoot-sheet-cue.mjs
```

The two harnesses bind different ports (4187 and 4189) so they can be run
concurrently, or from two checkouts at once.

The build must print version `8dead5e026f7` — 21 venues, 34 events, 6 sponsors.
Anything else means the content has moved and the shots are not comparable with
the committed set.

Beware the trap the other review directory documents too: `npm test` leaves
`site/` rebuilt from the committed fixtures, which are a different venue set.
Rebuild before capturing.

The harness serves the site, fulfils `/embed-host.html` with a stand-in for the
Squarespace page carrying README's snippet verbatim, and blocks service workers
— without that, the site's own worker installs on the first load and answers the
second one with the *app* instead of the host page, because a page route cannot
intercept what a service worker serves.
