# The embedded map's overlays — change evidence

Before/after captures for the 2026-09-05 fix to where the venue sheet and the
toasts open inside the map embed (PROGRESS.md, "the embed's overlays move to the
map frame"). **Change evidence, not a baseline**: built from
`content/snapshot/sources/`, not from the live sheet.

Eight shots, two states × two overlays × two widths:

| prefix | state |
|---|---|
| `before-` | overlays pinned to the bottom of the viewport, which in the embed is the bottom of the whole iframe |
| `after-` | overlays anchored to the map frame |

- `sheet` — a venue sheet, opened by tapping the topmost pin clear of the canvas
  edges. `before-sheet-phone.png` is the reported bug and the clearest shot in
  the set: the whole screen is dimmed by the sheet's backdrop and the sheet
  itself is nowhere on it, 300 px below the fold.
- `toast` — the locate button's answer with geolocation denied. Same fault,
  same fix, and the one a visitor is most likely to meet: the sheet's own share
  button raises "Link copied" the same way.

Each shot is the whole host-page viewport, not the iframe, because the point of
the set is where the overlay lands *on the visitor's screen*. The host page is
scrolled so the map is at the top of it and the rest of the embed is below the
fold, which is the position the report came from.

Measured positions inside the iframe, printed by the run that wrote these:

| | iframe height | sheet opens at | toast opens at |
|---|---|---|---|
| `before-` phone | 1711 | y=1195 | y=1623 |
| `after-` phone | 1711 | y=16 | y=289 |
| `before-` desktop | 1061 | y=606 | y=1011 |
| `after-` desktop | 1061 | y=121 | y=526 |

The phone's visible band is roughly y=40..890 of that 1711 px iframe.

## How `before-` was produced

Both prefixes come out of **one browser session**, from the same working tree.
`before-` is the same page with the `body.is-embed .sheet` and
`body.is-embed #toast-root` rules deleted from the stylesheet after load; those
two rules are the entire positional change, and the script fails if it does not
find exactly two of them. Shooting `before-` from a git checkout instead would
put the two prefixes in different browser launches, and this repo has been
bitten by that: the CSS font stack resolves differently per launch
(`../2026-09-map-collisions/RECIPE.md`).

What that method does *not* capture is `preventScroll` on the sheet's focus
call, which is JS. Nothing is lost: no engine available here performs that
scroll in either state (see below).

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
```

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
