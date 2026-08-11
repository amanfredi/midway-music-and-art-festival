# Venue card as a map popup — pin-anchored detail vs the bottom sheet

Status: defined 2026-08-11 | Overall confidence: high

## Problem & motivation

BACKLOG carries the idea: the venue info card could appear as a map popup
anchored to the tapped pin rather than (or before) the current detail sheet.
Today a pin tap opens the sheet — a native `<dialog>` whose focus trap,
background inertness and scroll lock are bound by the Accessibility contract
and supplied by `showModal()` rather than by custom code. The appeal is real:
the sheet is modal, so opening it takes the map away, and a pin-anchored
surface would keep the map visible and make browsing pins feel lighter. The
question is whether that gain survives the frame and the contract; "do nothing"
is a live answer if the sheet is simply better.

Everything below is read from the contract, the view code and the vendored
engine build. Nothing here has been tried on a device.

## What a MapLibre popup gives and costs

`maplibregl.Popup` is a DOM node anchored to a lng/lat that tracks the camera.
Anchoring, a close button and camera-following come free; being DOM, it is
stylable and reachable by screen readers. What it does not give is the modality
the contract binds: no focus trap, no background inertness, no scroll lock.
`focusAfterOpen` (default on in the vendored 6.2.0 build) moves focus to the
first focusable element inside the popup but does not hold it there, so tabbing
walks straight out into the page behind. Those are precisely the behaviors the
2026-08-09 hardening stopped hand-rolling by adopting `<dialog>.showModal()`;
a popup as the venue surface re-opens every one of them as bespoke code.

The frame is the harder constraint. The map is a fixed square: `max-width`
560 px, and about 288 px at the small end — a 320 px viewport less `#view`'s
1 rem of side padding. `.map-frame` sets `overflow: hidden`, so a popup taller
than the frame is *clipped*, not spilled over the page. The venue card is
title, address, description, today's events and two action links; on the
sheet's own type scale that runs well past a 288 px square for a typical venue,
though it has not been measured as a popup. MapLibre's own default `maxWidth`
is 240 px, and inside a 288 px frame a popup that wide covers the map the popup
exists to keep visible. The card either gets clipped, scrolls inside a pannable
canvas (a gesture conflict), or shrinks to a teaser.

The sheet is also deliberately the *single* venue surface: `sheet.js` serves
the map's pins, the venue key list, and event detail's venue link. A popup can
only serve the map, so a full replacement forks venue presentation into two
implementations — the duplication the ledger has rejected before.

## Options

**(a) Replace the sheet with a popup.** Fails all three constraints: it
re-implements solved modality, cannot hold the card at 288 px inside a clipping
frame, and forks the venue surface. Not developed further.

**(b) Teaser popup in front of the sheet.** A small non-modal popup showing the
venue name and number with a "Details" button that opens the existing sheet.
The contract stays intact (the sheet remains the accessibility surface), the
teaser fits the frame, and the card stays single-sourced. Costs: a second
surface to build and maintain — close behavior, Escape, a 24 px close target,
contrast, reduced motion, and deconflicting `closeOnClick` (default on) with
the existing `map.on('click')` pin handler — plus an extra tap on the common
path. Call it an evening for the surface and a second for the accessibility
work, since none of it is covered by `showModal()` any more. Most of its
orientation value ("which pin did I just tap?") is also delivered by two
cheaper items already in BACKLOG: tapped-pin highlight, and key-list taps
recentering the map.

**(c) Do nothing.** The sheet satisfies every bound requirement today, works at
every frame width, and nothing here is broken.

## Recommendation

(c) — do nothing now. A full replacement is strictly worse than the sheet; a
teaser is plausible but pays roughly two evenings for a new surface to deliver
value the backlogged highlight-and-recenter items mostly deliver for less. Land
those first. Revisit (b) only if, with them on device, pin browsing still feels
heavy — the criteria below are written for that revisit so the bar is already
on record.

## Acceptance criteria (for any future popup)

- The full venue card never leaves the `<dialog>` sheet; a popup may only be a
  teaser that opens it.
- Every Accessibility-contract clause still holds end to end: focus lands in
  the surface on open and returns to the trigger on close, background content
  is inert while the sheet is up, and the axe gate passes with a popup open.
- The teaser renders without clipping or two-dimensional scrolling at both
  288 px and 560 px frames, against `.map-frame`'s `overflow: hidden`.
- The pin tap contract (±10 px box, nearest pin wins) and every existing
  tap-through test are unchanged; no venue costs more taps to reach than today.
- Map keyboard access is not regressed: the canvas keeps focus and arrow-key
  panning while a teaser is open.

## Open questions for Anthony

- Is the felt problem *context loss* (the sheet covers the map) or *weight*
  (the full card is too much per tap)? They point at different fixes —
  highlight/recenter for the first, a teaser for the second.
- Should BACKLOG record this as closed-won't-do, or as deferred pending the
  highlight-and-recenter items? (Recommended: deferred, with this doc as the
  bar.)
- Any interest in a desktop-only hover teaser, which sidesteps the extra-tap
  cost but adds a pointer-conditional code path to a phone-first site?
