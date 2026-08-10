# Map artwork — accessibility rider

This rider travels with the commission brief for the festival's illustrated
map, if and when one is commissioned. It collects everything the artwork
needs to satisfy so that attendees with low vision or color-vision deficiency
can use the map, and so the festival's digital map can build on the art. Each
rule carries its reason, because the reason is what lets you make a good call
in the situations no rule anticipates. Outside these floors, the style is
entirely yours — an illustrated map with a strong identity is the point of
commissioning one.

The layout and size rules are distilled from the State of Minnesota's
interagency map-accessibility guide (2023); the contrast numbers come from
the web accessibility standard the digital map is held to (WCAG 2.2).

## Five things that can't be fixed after the art is drawn

### 1. Importance must equal contrast

Whatever matters most on the map must stand out most strongly from its
surroundings, the second-most-important next, and so on — a reader with low
vision finds things in contrast order. For this map, venue markers and
anything an attendee must locate come first; streets, water, and decorative
texture are the ground they sit on — kept lighter or more transparent so they
are, in the guide's phrase, *noticed, not announced*. Concretely: shapes a
reader must pick out need contrast of at least 3:1 against what surrounds
them, and any text needs 4.5:1 against what it sits on. If a label and its
background don't contrast enough, change one of the colors rather than
reaching for an outline or halo — halos earn their place mainly where a label
must cross a linear feature, and even then small and matched to the
background.

### 2. Lettering has hard floors

Any lettering baked into the artwork must never render smaller than 6 pt
(8 px on screen), and should target 8 pt (about 11 px) or larger, measured at
the map's opening view on a phone — the smallest a reader normally meets it —
with letter size tracking importance, so the most important names are the
largest. One caveat: those floors come from print read at arm's length; a
phone is usually held closer, which makes them conservative rather than
exact, and borderline sizes get settled on a real device rather than by
arithmetic.

Use at most two or three typefaces, preferably simple sans-serifs — the one
traditional exception is water names, which cartography sets in a serif
italic. Never underline a map label (hard on low-vision readers, and on
screen it reads as a link). Use italics and ALL CAPS sparingly; bold works as
a call-out but not for running text; and if you letterspace a name across a
large area, never so wide that the reader must reconnect the letters across
other map elements.

### 3. Color may support meaning, but never carry it alone

Roughly one man in twelve and one woman in two hundred see color
differently. Blue-reads-as-water associations are worth using, but every
meaning a color carries must also be carried by something that isn't color —
a shape, a label, a pattern. Run the finished palette through a
color-vision-deficiency simulator (Color Oracle is free) before calling it
done.

If you need a set of colors for categories (kinds of marker, kinds of
place), this palette is the guide's colorblind-safe recommendation:

| Color | Hex |
|---|---|
| Black | `#000000` |
| Orange | `#E69F00` |
| Sky blue | `#56B4E9` |
| Bluish green | `#009E73` |
| Yellow | `#F0E442` |
| Blue | `#0072B2` |
| Vermillion | `#D55E00` |
| Reddish purple | `#CC79A7` |

### 4. The geometry must stay true to scale

Draw over the real street grid at true scale, and stylize freely *on top of*
that geometry — thicken streets, exaggerate landmarks, decorate open space —
without stretching or shifting where things actually are. The digital map
fits your artwork to GPS coordinates with a simple geometric alignment, which
holds only if the artwork's geometry agrees with the real world across the
whole festival area. Freehand-distorted geography would permanently close the
door on the "you are here" dot.

### 5. Deliver vector art, in layers

Deliver the artwork as vector files (SVG, or your working format exported to
it) with fills and strokes as declared colors, not as flattened raster
images. This is what lets the festival *verify* contrast by computation
instead of by eye — rasterized art gives that up permanently. Keep your
working layers separate in the delivered file — in particular, any lettering
separate from the illustrated ground — so the digital map keeps the option of
placing its own labels over your ground, and any future print or poster can
composite your lettering as drawn. One quirk of the digital map worth knowing
while you work: markers and labels hold a constant on-screen size while the
map behind them zooms, so detail that only reads at one particular zoom level
will be wrong at every other.

## If the artwork carries its own symbols and labels

These apply to whatever markers and lettering live in the art itself. The
digital map may render some of these on top of your ground instead — that's
a decision the festival hasn't made yet, and the layered delivery above keeps
both doors open.

Levels of importance must differ visibly in size: the guide's rule is 2×
between levels (a 0.1″ marker, then 0.2″, then 0.4″) — a 1.25× step is not a
difference the eye resolves as a different level. Leave visible white space
between neighboring symbols; touching symbols blend into one shape for a
low-vision reader. Prefer symbols that resemble what they mean (an airplane
for an airport); anything non-obvious must be explained in a legend or
labelled on the map.

Labels for the same kind of feature should look and sit the same everywhere —
all street names on the same side of vertical streets, for instance — so
nobody has to search to match a name to its feature. Rarely rotate text past
90°, never upside down, and never let labels overlap each other. Keep to one
or two fill patterns at most and no more than six line styles; line weights
within one color family should differ by at least 1 pt (or 0.5 pt only when
paired with a 20% lighter color); and never run a dashed line over an opaque
pattern.

If the artwork includes its own legend — for a poster or print use — every
symbol on the map must appear in it at exactly the size it appears on the map
(a size difference reads as a different symbol), ordered by importance and
grouped by likeness. Common ground features like roads and water may be left
out only if they're clearly labelled. Give the legend a title that says
something — not the word "Legend" — and keep it, with any scale bar, out of
the visually busy parts of the composition.

## Where you are completely free

Everything else. Medium and technique (within vector delivery), the palette
beyond the floors above, how landmarks are illustrated, ornament, texture,
humor — the festival wants the map to carry your identity. The one
self-awareness trap the guide names is worth repeating: personal preference
is easy to mistake for convention, so when a choice trades legibility for
style, check it against the floors above rather than instinct.
