# Design Review: Tide windows — UI/UX polish pass

Reviewed against: [DESIGN_BRIEF.md](DESIGN_BRIEF.md)
Philosophy: **Instrument panel** — a calibrated scientific readout, NOAA station
page rather than surf app
Date: 2026-07-28
Branch: `feat/20-ui-polish` · PR #27 · commits `9fc56d1`…`e80c1b8`

The pre-build audit is [DESIGN_AUDIT.md](DESIGN_AUDIT.md); its evidence is the
"before" set in `screenshots/`. This review covers what was actually built.

## Screenshots Captured

All in `.design/ui-polish/screenshots/after/`.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `review-grid-desktop-1280.png` | Desktop 1280×800 | Grid, all 7 columns, floor gaps |
| `review-grid-tablet-768.png` | Tablet 768×1024 | **Grid clipped mid-cell, 3 columns lost** |
| `review-grid-mobile-375.png` | Mobile 375×812 | Collapsed to today's column |
| `review-spot-desktop-1280.png` | Desktop | Week ribbon, MPA + safety callouts |
| `review-spot-tablet-768.png` | Tablet | Spot page, ribbon |
| `review-spot-mobile-375.png` | Mobile | Vertical day list |
| `review-day-desktop-1280.png` | Desktop | Chart bounded at 900px, halo labels |
| `review-day-tablet-768.png` | Tablet | Chart |
| `review-day-mobile-375.png` | Mobile | Chart scrolling at 1:1 |
| `review-grid-desktop-1280-dark-mode.png` | Desktop dark | Tint fix verified |
| `review-spot-desktop-1280-dark-mode.png` | Desktop dark | Both callouts dark |
| `review-day-desktop-1280-dark-mode.png` | Desktop dark | Chart dark |
| `review-grid-mobile-375-dark-mode.png` | Mobile dark | |
| `review-spot-mobile-375-dark-mode.png` | Mobile dark | |
| `review-day-mobile-375-dark-mode.png` | Mobile dark | |
| `review-popover-last-column.png` | Desktop | **Badge inversion + top-layer escape** |
| `review-popover-open.png` | Desktop | Popover, first column |
| `review-row-expanded.png` | Desktop | Row disclosure open |
| `review-focus-cell-link.png` | Desktop | `:focus-visible` ring |
| `review-cell-hover.png` | Desktop | `.cell-link` hover |
| `review-all-disclosures-open.png` | Desktop | Every `<details>` expanded |
| `review-grid-sort-geographic.png` | Desktop | North-to-south order |

## Summary

The pass did what the brief set out to do. The grid's rows now differ, the type
scale inverts the old data-versus-caveat relationship, the dark-mode tint bug is
gone, and every contrast pair measured passes. The instrument-panel philosophy
reads clearly and nothing in the build fights it.

The biggest finding is one the pass did not address and the audit missed: **the
grid clips for every viewport between 600px and 1200px** — a 600px-wide band
covering essentially all tablets and small laptops. The audit captured
`review-grid-tablet-768.png` and never analysed it. That is a process failure as
much as a design one.

Second: the fix that removed the spot page's duplicate heading left an `<h3>`
containing nothing but a coordinate pair.

## Must Fix

### 1. The grid clips from 600px to 1200px, with no scroll affordance

Measured, table width against container width:

```
 600px  container  560  table 1160  clips 600px  (7 day cols rendered)
 768px  container  728  table 1160  clips 432px
 900px  container  860  table 1160  clips 300px
1024px  container  984  table 1160  clips 176px
1100px  container 1060  table 1160  clips 100px
1200px  container 1160  table 1160  ok
```

The `wide:` breakpoint reveals all seven day columns at 600px, but the table's
minimum content width is 1160px and it does not fit until the viewport reaches
1200px. See `screenshots/after/review-grid-tablet-768.png`: the Fri column is
sliced vertically down its middle and Sat, Sun and Mon are entirely off-screen,
with no scrollbar, gradient or any other cue that content continues.

`overflow-x-auto` means the page itself does not overflow (measured 0px), so
this is a silently scrollable region that does not look scrollable.

**Honest attribution.** The clipping is pre-existing — compare
`screenshots/review-grid-tablet-768.png` (before), where the same band was also
clipped. But it degraded differently: cells wrapped their clock text onto extra
lines (`2:51` / `pm`) and squeezed to show five columns. The
`whitespace-nowrap` added to `TideLine` in `d2d417f` — correct on its own terms,
since a clock time should not break across lines — removed that squeeze, so
cells now hold full width and the cut is a hard mid-cell slice at four columns.
The band is not new; the way it fails is partly this pass's doing.

_Fix: this is a design decision, not a mechanical one. Options, in the order I'd
weigh them: (a) raise the `wide:` reveal so the full week only appears once it
fits, and show a today-plus-tomorrow view between 600 and 1200; (b) keep seven
columns and add a real horizontal-scroll affordance — edge fade, a visible
scrollbar, and `scroll-snap` on column boundaries so the cut never lands
mid-cell; (c) drop the ▲ next-high line in the 600–1200 band, which is identical
on every row and would buy roughly 7×24px._

### 2. `SpotHeader` renders an `<h3>` containing only coordinates

`components/spot-summary.tsx`. The `nameOnPage` flag added in `65f7e0c`
correctly stops the spot page printing its own name twice, but it does so by
swapping the heading's *contents* rather than the heading itself. The element
survives as `<h3>32.669, -117.245</h3>`.

Two problems. A heading whose text is a coordinate pair is not a heading, and it
breaks the document outline for anyone navigating by headings. And the week
ribbon panel now has no accessible name at all — the `h3` was what named it.

See `screenshots/after/review-spot-desktop-1280.png`, the grey panel's top-left.

_Fix: when `nameOnPage` is true, render the coordinates as a `<p>` and drop the
`h3` entirely. If the panel needs a name, give the containing element an
`aria-label` referencing the spot rather than promoting coordinates to a heading._

## Should Fix

### 3. The popover covers the cell it describes

`screenshots/after/review-popover-last-column.png`. `position-area: block-end
span-inline-start` puts the panel below and to the left of its badge, which
overlaps the lower half of its own cell and the two rows beneath. The badge
inversion (see What Works Well) answers *which* cell, so this is no longer a
correctness problem — but the reader still cannot see the tide numbers the panel
is talking about while reading it.

_Fix: add `span-inline-end` variants earlier in `position-try-fallbacks`, or
offset the panel by the cell's height so it clears its own row._

### 4. Three different text measures on one page

The spot page now runs `max-w-prose` (~65ch) on the "From the inventory" body,
68ch on the two tinted panels, and full container width on the ribbon. The
result is three left-aligned text blocks with three different right edges down a
single column. See `screenshots/after/review-spot-desktop-1280.png`.

_Fix: fold `--panel-measure` and the prose measure into one token and use it for
both, so the page has one reading width._

### 5. `SwellProvenance` inherits `text-meta` but carries load-bearing content

The swell line — which buoy, how old, whether it is a substitute, whether the
reading is unknown — is now 11px, the same size as the evaluation stamp and the
file-provenance footnotes. The brief's principle 2 demotes *caveats*, but a
substituted buoy that "may be geographically distant and read differently for
the same conditions" is a fact about the data being shown, not apparatus.

_Fix: `text-ui` (12px) for `SwellProvenance`, keeping `text-meta` for stamps and
file provenance._

## Could Improve

### 6. The ▼/▲ glyphs render at 9.88px

Below the 11px floor this pass set. Already documented in `e80c1b8` and left
deliberately: they are aria-hidden decoration sized in `em` against their tide
line, and changing them changes `TideLine`'s proportions. Worth revisiting if
the cell is ever reworked.

### 7. `+0.0` is ambiguous at the crossover

Swami's and Torrey Pines on Mon Aug 3 both read `+0.0` — the low is at the floor
to within a tenth. The rounding guard in `formatFloorGap` correctly prevents
`−0.0`, but `+0.0` still reads as "above the floor" when it is really "at it".

_Suggestion: render exact-zero as `0.0` with no sign, or as `at floor`._

### 8. The safety callout appears in full on all three pages

Unchanged by this pass and defensible — it is a safety caveat and hiding it is
the failure mode the file-verbatim rule guards against. But a reader moving
grid → spot → day reads the same eight lines three times in one session.

_Suggestion: revisit only alongside the data-file PRD, since the real problem is
that the text is a commit message rather than reader-facing prose._

## Checklist Results

| Category | Result |
| --- | --- |
| Visual hierarchy | **Pass.** Title 22px → section 16 → data 13 → UI 12 → meta 11. Data now outranks its footnotes, 1.18 where it was 0.96. |
| Consistency | **Pass with one gap** — see finding 4 (three text measures). Spacing is Tailwind's 4px scale throughout; no one-off radii or shadows. |
| Aesthetic fidelity | **Pass.** Dense, monospaced, tabular, no verdict colour anywhere. Reads as an instrument, not a surf app. |
| Component quality | **Pass.** Nothing reimplemented; `CellShell`/`TideLine` remain the single source across grid, ribbon and mobile list. `FloorGap` follows existing prop conventions. |
| States & interactions | **Pass.** Hover, focus-visible, badge-open, row-expanded, disclosure-open all verified by screenshot. |
| Responsive | **Fail** — finding 1. Mobile (0px page overflow) and desktop (0px table overflow) are both clean; the 600–1200 band is not. |
| Accessibility | **Pass on contrast, one semantic defect** — finding 2. |
| Typography | **Pass.** Five intentional steps, no arbitrary `text-[Nrem]` remaining outside two em-relative values inside `TideLine`. |
| Dark mode | **Pass.** Not an inversion — cell skins keep their ordering across themes so "light means daylight" holds in both. |
| Mobile-first | **Pass.** `wide:` is `min-width: 600px`; no `max-width` queries. |

### Contrast, measured

Resolved to 8-bit sRGB through a canvas, because `getComputedStyle` returns
`lab()`/`oklch()` here and WCAG is defined over sRGB.

| Pair | Light | Dark |
| --- | --- | --- |
| Floor gap, day cell | 6.51:1 | 6.40:1 |
| Floor gap, night cell | 9.72:1 | 13.48:1 |
| Panel source line | 6.33:1 | 6.49:1 |
| Panel body | 15.32:1 | 11.65:1 |
| Row header subtitle | 5.78:1 | 4.90:1 |

All ≥ 4.5:1. The panel source line was **3.39:1 light / 3.25:1 dark and failing
in both themes** before this pass — a defect the audit did not catch and that
surfaced only while sizing the tint fix.

## What Works Well

**The floor gap solved the structural problem cleanly.** Today's column reads
`+1.1, +1.3, +1.4, +1.4, +1.5, +1.5, +1.6, +1.7` straight down, monotone with
the sort. Eight identical rows became eight that a reader can rank at a glance,
and it did it without a single new component or any change to the data layer.

**The badge inversion is a better answer than the tail it replaced.** A drawn
tail would have pointed at the wrong cell whenever `position-try` flipped the
panel. Using `:has(+ [popover]:popover-open)` on the badge's own sibling is
correct in every position the panel can take, needs no anchor arithmetic, and
degrades to nothing rather than to something wrong. See
`review-popover-last-column.png` — the filled badge in the last column is
unmistakable.

**Bounding the chart between its own viewBox width and 900px** fixed a bug that
was wrong in both directions at once, without a charting library, without
client-side measurement, and without touching the accessibility scaffolding.

**The refusal to colour the floor gap held.** It would have been easy to make
negatives green. The subtraction prints with both operands visible instead, and
weight alone marks the under-floor case — which keeps the page an observation
rather than a verdict, exactly as the existing code comments argue it must be.

**Restraint on the data files.** Every temptation to "fix" `spots.json` — invent
floors for the 18 excluded spots, reword the commit-message caveats, rebind the
tide stations — was declined and written down as out of scope.
