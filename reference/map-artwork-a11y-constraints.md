# Map accessibility constraints — commissioned artwork and the current SVG

**Audience: Claude agents.** Two jobs: (1) supply the source material for the
artist-facing accessibility rider that must reach the illustrator *before* the
hand-drawn map is commissioned, and (2) give the WCAG audit's map section a
concrete set of checks for the map that exists today.

## Provenance and what this source does *not* give you

Distilled from `reference/Accessibility - map-design-guide (updated)_tcm38-565153.pdf`
— *Map Design Guide: Best Practices Ensuring Accessibility/Usability*, State of
Minnesota Interagency Map Accessibility Workgroup, 17 pp., updated Feb 2023
(PDF metadata author: Amy Ellison, Minnesota State Parks and Trails).

Two honest caveats that change how you use it:

- **The guide states no contrast ratios of its own.** It says the most important
  features should carry the greatest contrast, then defers to WebAIM's contrast
  checker, Color Oracle, the Colour Contrast Analyser and ColorBrewer. **Every
  numeric contrast threshold in this document therefore comes from WCAG 2.2,
  not from the guide.** Do not cite the guide for a ratio.
- **The guide is print-first.** Its size rules are in points and inches for a
  sheet of paper read at arm's length. It says nothing about a pannable,
  zoomable phone map. Section "Translating print sizes" below does the
  conversion and names the assumption that would invalidate it.

Everything the guide *does* supply — the numbers, the reasons, the legend
conventions, the colorblind-safe palette — is below.

---

## Part A — Constraints for the commissioned artwork

These are the rider's raw material. Each carries the guide's stated reason,
because the reason is what lets an illustrator make a sensible call in a case
the rule doesn't cover.

### Content and hierarchy

- **Draw the minimum that tells the story.** Too much irrelevant data buries
  the important information.
- **Establish an explicit visual hierarchy** — the most important feature is
  seen first, the next second, and so on. Supporting information should be
  "noticed, not announced" and fall visually to the background.
- **The most important features must carry the greatest contrast** against the
  rest of the map. The guide's own example: points of interest in red or black
  on a white ground. For this site that means the venue pins, not the streets.
- **Do not confuse personal preference for convention.** Named in the guide as
  the hardest failure mode to self-detect.

### Type

- **Absolute minimum label size 6 pt; target at least 8 pt.** Body/reading text
  in an accompanying document, minimum 12 pt.
- **Font size must track feature importance** — the more important the feature,
  the larger the label.
- **Two or three typefaces at most.** More typefaces create more work for the
  reader's brain. Prefer simple sans-serif faces.
- **The one sanctioned serif exception is water labelling** — Times New Roman
  italic is the historic cartographic standard for water.
- **Never underline.** Two reasons: it is hard for low-vision readers, and it
  reads as a hyperlink. *(Scope note: this is a rule about map labels. It does
  not transfer to the site's body-text links, where WCAG 1.4.1 pushes the
  opposite way — do not let the rider ban underlines site-wide.)*
- **Italics sparingly** (water labels and short labels only); **bold** is a good
  call-out but not for continuous text; **ALL CAPS sparingly** — it stands out
  but is harder to read; **expanded kerning only for large areas**, and not so
  wide that the reader has to reconnect letters across other map elements.

### Labels

- **Assign labels to features before drawing.** Labels for the same feature
  class must be consistent in appearance, orientation and placement — all road
  labels on the same side of vertical roads, city labels in the same relative
  position. The reader should never have to search to match a feature to its
  label.
- **Rarely rotate past 90°, never upside down.**
- **Labels must never cover other labels**, and there must be real white space
  between a labelled feature and any other label.
- **Halos: small, sparing, and matched to the background color.** If text and
  background lack contrast, *change a color rather than adding a halo*. Halos
  earn their place mainly where a label crosses a linear feature.

### Symbols

- **Intuitive and familiar symbols are a requirement, not a preference.**
  Imitate the real world (airplane = airport). If a symbol cannot be made
  intuitive, it must be explained in the legend or labelled on the map.
- **Be consistent** — reuse an established symbol set where one exists.
- **Visible white space between symbols.** Touching symbols blend together for
  low-vision users. Avoid overlapping points and annotations; offset from lines.
- **2× size difference between levels of information.** The guide's example: if
  one circle has radius 0.1″, the next level is 0.2″, then 0.4″. A 1.25×
  step is not a level distinction the eye can resolve.

### Color

- **Test every palette through a color-vision-deficiency filter** (Color
  Oracle is the guide's named tool).
- **Implicit color meanings help but cannot be relied on** — blue reads as
  water, red as danger/warning, but cultural understanding varies. Use the
  association *and* provide a non-color cue.
- **Pull background reference material back with transparency** so it does not
  compete with the data.
- **The guide's colorblind-optimized qualitative palette** (from Bang Wong,
  *Nature Methods*, "Points of View: Color blindness") — the one to hand an
  illustrator who needs categorical colors:

  | RGB (guide) | Correct hex | Hex as printed in the guide |
  |---|---|---|
  | 0, 0, 0 | `#000000` | `#000000` |
  | 230, 159, 0 | `#E69F00` | `#E69F00` |
  | 86, 180, 233 | `#56B4E9` | `#56B4E9` |
  | 0, 158, 115 | `#009E73` | `#009E73` |
  | 240, 228, 66 | `#F0E442` | ~~`#ECDE38`~~ |
  | 0, 114, 178 | `#0072B2` | ~~`#0072BC`~~ |
  | 213, 94, 0 | `#D55E00` | ~~`#F15A22`~~ |
  | 204, 121, 167 | `#CC79A7` | ~~`#DA6FAB`~~ |

  **Use the middle column. The guide's own hex column is wrong in four of eight
  rows** — verified 2026-08-10 by converting its RGB values, which match Wong's
  published palette exactly while the printed hex does not (it looks like a
  lossy CMYK round-trip). Handing an illustrator `#ECDE38` would hand them a
  value that is not the colorblind-optimized color it claims to be. Flag this
  to the organizers if the guide is ever cited directly.

  (The guide also offers Jewel Tones, Muted, Earth Tones, Brights, Minnesota
  brand, and the full ColorBrewer sequential/diverging sets. Only this one is
  specified as colorblind-optimized for *qualitative* categories, which is what
  pin types are.)

### Patterns and line styles

- **At most one or two patterns**, carrying non-hierarchical information.
  Patterns are visually distracting; a light or transparent fill is preferred.
- **Never put dashed lines on top of fully opaque patterns.** Solid lines over
  transparent patterns is the recommended combination.
- **At most 6 line-style types** — beyond that a reader cannot discern them.
- **Line weights in the same color and feature family must differ by ≥ 1 pt**
  (the guide's example: major roads 3 pt, county 2 pt, city 1 pt). A 0.5 pt
  difference is acceptable *only* when paired with a 20%-lighter color.
- **Run every color + line-style combination through a colorblind checker.**

### Legend and standard elements

- **Required on every map: a title.** **Conditional: north arrow, scale bar,
  legend.** Optional: neatline, logos, aerial imagery, inset/key map,
  disclaimers, data sources, production date, metadata.
- **A legend is as important as the title, scale bar and north arrow** once the
  map shows more than a few items; without it the reader is missing the context
  that makes the map readable. Any symbol not in the legend must be clearly
  labelled on the map.
- **Legend symbols must be the same size as the thing they represent on the
  map** — including line thickness. A size difference makes the reader think it
  is a different symbol.
- **Do not title the legend "Legend."** The contents speak for themselves; spend
  that space on a title or subtitle that adds context.
- **Order legend entries by feature importance, symbol type (point/line/
  polygon), and likeness** — grouping related features so the legend integrates
  with the map and definitions are easy to find.
- **Every symbol on the map must be accounted for in the legend.** Adding or
  removing a map object without updating the legend is the guide's named
  recurring error. Common features like roads and water bodies may be omitted
  *if they are properly labelled* and are not the map's focus.
- **Group the north arrow and scale bar with the legend** where there is room,
  and keep the whole cluster out of visually cluttered areas.

### Constraints this repo adds, which are not in the guide

Label these separately in the rider — they are ours, not Minnesota's:

- **The artwork must stay georeferenceable.** `site/js/geo.js` fits a
  least-squares affine transform from ≥ 3 non-collinear control points
  (`site/assets/map-calibration.json`). Recalibrating to new artwork must be a
  control-points-only change, which requires the artwork to be true-to-scale
  enough that an affine fit holds across the festival footprint. DEFINITION.md
  already promises the artist this constraint.
- **Deliver vector art with declared fills and strokes, not raster.** Not an
  accessibility rule in itself, but it is what makes contrast auditable by
  computation instead of by eye. Raster artwork forfeits that permanently, and
  the audit's pricing of map findings loses its precision (this is the stated
  step-0 assumption of the audit).
- **Symbols must survive counter-scaling.** Pins and labels hold a constant
  on-screen size while the map zooms (see Part B), so artwork detail that only
  reads at one scale will be wrong at every other.

---

## Translating print sizes to this map

At the CSS reference of 96 px per inch, the guide's type floors convert to:

| Guide rule | Points | CSS px |
|---|---|---|
| Absolute minimum map label | 6 pt | **8.00 px** |
| Target map label | 8 pt | **10.67 px** |
| Reading text in an accompanying document | 12 pt | **16.00 px** |

**The assumption that would invalidate this:** that print read at arm's length
and a phone held closer demand the same physical size. They do not, and the
guide offers no basis for a screen-specific number — a phone is typically held
nearer than a printed map is read, which argues the print floor is conservative
here. Treat 8.00 px as a hard floor and 10.67 px as the target, and let the
human device pass, not this conversion, settle anything close to the line.

---

## Part B — What to check on the current generated SVG

The map is `site/assets/map.svg`, generated by **`tools/make-map.mjs`** (note:
`tools/`, not `scripts/` — the brief for this stage had it wrong). All of its
colors, font sizes and stroke widths are declared in one `<style>` block, so
every check below is computable rather than visual.

**How rendered size works, because every number depends on it.** Labels and
pins are authored in map units (1 unit = 1 metre) inside `.map-label__scale` /
`.pin__scale` groups, which `site/js/views/map.js` counter-scales by
`view.w / 3000` on every zoom. They therefore hold a **constant on-screen
size at every zoom level**, set only by the frame width: `.map-frame` is square
with `max-width: 560px`, inside `#view`'s 1 rem side padding. So a 320 px
viewport yields a 288 px frame, and the home view spans 3000 m.

### Measured 2026-08-10

Label sizes, with pt-equivalents against the guide's 6 pt / 8 pt floors:

| Label | Map units | 288 px frame (320 px phone) | 560 px frame (cap) |
|---|---|---|---|
| Spine street (`#3f3f3f`, 700) | 98 | 9.4 px ≈ 7.1 pt | 18.3 px ≈ 13.7 pt |
| Arterial street (`#565654`, 600) | 77 | **7.4 px ≈ 5.5 pt** | 14.4 px ≈ 10.8 pt |
| Station (`#3d5c4d`, 600) | 63 | **6.0 px ≈ 4.5 pt** | 11.8 px ≈ 8.8 pt |
| SVG `.attribution` | 56 | **5.4 px ≈ 4.0 pt** | 10.5 px ≈ 7.8 pt |

Contrast against the paper fill `#eeeeec` (WCAG thresholds, not the guide's):

| Element | Ratio | Threshold | |
|---|---|---|---|
| Spine label `#3f3f3f` | 9.06:1 | 4.5:1 | pass |
| Arterial label `#565654` | 6.33:1 | 4.5:1 | pass |
| Station label `#3d5c4d` | 6.37:1 | 4.5:1 | pass |
| `.attribution` text `#8c8c8a` | **2.90:1** | 4.5:1 | **fail** |
| Venue pin `#10577b` | 6.77:1 | 3:1 | pass |
| Sponsor pin `#a11f22` | 6.61:1 | 3:1 | pass |
| Transit pin `#298d4e` | 3.61:1 | 3:1 | pass |
| Green Line `#2f7d4f` | 4.34:1 | 3:1 | pass |
| Blue Line `#2b5fa8` | 5.47:1 | 3:1 | pass |
| Street fills `#cfcfcf` / `#dedede` / `#d9d9d9` | 1.34 / 1.16 / 1.22:1 | 3:1 | **fail if held to be required for understanding** |
| Water `#bcd2de` | 1.35:1 | 3:1 | same question |
| White glyph on transit pin | 4.19:1 | 3:1 (large text) | pass — but under 4.5:1, so this fill can never carry small text |

Symbol sizes:

| Symbol | Map units | 288 px frame | 560 px frame |
|---|---|---|---|
| Venue pin diameter | 230 | 22.1 px | 42.9 px |
| Venue hit target (bbox) | 290 | 27.8 px | 54.1 px |
| Transit / sponsor pin diameter | 184 | 17.7 px | 34.3 px |
| Transit / sponsor hit target (bbox) | 236 | **22.7 px** | 44.1 px |
| Station dot diameter | 38.6 | 3.7 px | 7.2 px |
| Legend swatch (fixed CSS, does **not** scale) | — | 20 px | 20 px |
| Venue key diamond (fixed CSS) | — | 28 px | 28 px |

### Checks for the audit's map section

1. Recompute all of the above from source rather than trusting this table — it
   is a baseline, not a result, and `tools/make-map.mjs` may have changed.
2. Decide and **record** whether base-map streets and water are "graphical
   objects required to understand the content" under WCAG 1.4.11. This single
   call determines whether the map has one contrast failure or eight.
3. Check the `.attribution` text's status: it is positioned at `y=16071` of a
   16093-unit extent — the very bottom edge, outside the home view — and is not
   inside a `.map-label__scale` group. Determine whether it is ever visible.
   If it is dead markup, deleting it is cheaper than recoloring it, and the
   visible attribution already renders as HTML below the map from
   `settings.map_attribution`.
4. Verify pin white space at the home view: pins are placed at data coordinates
   and CONTRACTS.md defines a paint order for overlaps, which concedes that
   they do overlap. The guide requires visible white space between symbols.
5. Check forced-colors / Windows High Contrast rendering. An SVG built entirely
   from declared `fill`/`stroke` values is exactly the case that collapses.
6. Confirm the label halo still matches the paper: `.street-label` uses
   `paint-order: stroke; stroke: #eeeeec; stroke-width: 7.7`, which satisfies
   the guide's halo rule as written.

---

## Part C — Where the current map contradicts the guide

Flagged now, priced in the audit. Ordered by how much they cost to fix later.

1. **Legend symbols are not the size of the map symbols they key.** The guide
   is unambiguous that they must match exactly, because a size difference makes
   the reader think it is a different symbol. Legend swatches are a fixed 20 CSS
   px; the venue pin renders at 22.1 px on a 320 px phone and 42.9 px at the
   560 px cap. So the legend nearly matches on a small phone and is **2.15×
   too small** at the cap. Because pin size tracks frame width and the legend's
   does not, no single legend size fixes this — matching requires the legend
   swatch to scale with the frame, or the pins to stop doing so.

2. **The symbol size hierarchy is 1.25×, where the guide requires 2×.** Venue
   pins are `r = 115`, every other pin type `r = 92`. CONTRACTS.md describes
   venue pins as "the largest pin" and "the dominant symbol", which is the
   intent — but a 1.25× step is not a level distinction the guide considers
   resolvable. Note the tension before changing anything: venue pins are
   already 27.8 px at 320 px against the transit/sponsor 22.7 px, so closing
   the gap by *shrinking* non-venue pins would push them further under WCAG
   2.5.8's 24 px target-size floor. Growing the venue pin is the direction that
   satisfies both.

3. **Map symbols are missing from the legend.** The legend lists exactly four
   entries — Venue, Transit, Featured Destination, Sponsor. Drawn but absent:
   the METRO Green Line (`#2f7d4f`) and Blue Line (`#2b5fa8`), the station
   dots, and the water. The guide permits omitting roads and water when they
   are properly labelled — the water is *not* labelled, and rail lines are a
   thematic feature, not base-map furniture. **The Blue Line is the sharpest
   case: it has no legend entry, no label, and no pins** (`TRANSIT_LINE_LETTER`
   covers `green`/`a`/`b` only), so a rider sees a blue line and has nothing
   anywhere that says what it is. That is also a WCAG 1.4.1 Use of Color
   problem, since hue is the only thing separating it from the Green Line.

4. **Label sizes fall under the guide's absolute floor on a small phone.**
   Against the 6 pt ≈ 8.00 px minimum: arterial street labels render at 7.4 px
   and station labels at 6.0 px on a 320 px viewport. Both clear the floor at
   the 560 px cap. Since labels counter-scale, **zooming the map does not fix
   this** — a reader on a small phone has no way to make a street name bigger
   except page zoom.

5. **No scale bar and no north arrow, on a map that zooms from 350 m to 16093 m
   across.** The guide classes both as *conditional*, and a pannable map at a
   46× zoom range is the condition that triggers them: nothing on screen tells
   the reader what they are looking at the scale of. Cheap to add, and it is
   the kind of thing that is much cheaper to specify to the illustrator now
   than to retrofit onto finished artwork.

6. **The map carries no visible title.** The guide lists a title as the one
   unconditionally required element. The view's `<h1>Map</h1>` is `sr-only` by
   deliberate design (CONTRACTS.md reserves the space for a future sponsor
   logo), so screen-reader users get a title and sighted users do not. Worth
   recording as a considered trade-off rather than an oversight.

### Two places the guide does *not* apply, despite appearances

State these explicitly so a later audit does not re-raise them:

- **"Do not title the legend 'Legend'"** — the map's legend heading *is*
  literally "Legend", but it is `sr-only`. The guide's reason is that the word
  wastes visual space that a contextual title could use; a visually hidden
  heading wastes none, and "Legend" is the accessible name a screen-reader user
  actually wants. Not a finding.
- **Low-contrast streets are the guide working as intended.** The guide's
  hierarchy rule — supporting information "noticed, not announced", the
  important data popping off the page — is precisely what a 1.16:1 street under
  a 6.77:1 venue pin achieves. Here the guide and WCAG 1.4.11 pull in opposite
  directions, and the audit has to resolve it as a WCAG question, not by citing
  the guide on either side.
