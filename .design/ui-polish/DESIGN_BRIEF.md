# Design Brief: Tide windows — UI/UX polish pass

Scope: a polish pass over the three existing pages (`/`, `/spot/[slug]`,
`/spot/[slug]/[date]`). The information model, the data layer and the window
predicate are not changing. Findings and evidence: [DESIGN_AUDIT.md](DESIGN_AUDIT.md).

## Problem

Someone is deciding whether to drive to a reef in the San Diego corridor
tomorrow morning. They open the grid and see eight spots × seven days of tide
readings — and every row is identical, because all eight evaluable spots bind
to the same tide station (9410230). The page presents a table whose rows do
not differ, and the one number that *does* differ per spot — the reef floor,
0.7 ft at Sunset Cliffs to 1.3 ft at Cabrillo — is not on the page.

So the reader cannot answer the question they came with: *which of these is
closest to working?* They get eight copies of one answer, all reading "no
windows", sorted by a control that silently does nothing.

Underneath that, the page has no rank. The tide readings are 11.5 px and the
legal disclaimers are 12 px — the caveats are literally set larger than the
data they qualify. And in dark mode the safety panel renders as a saturated
mustard slab with unreadable provenance text, making the loudest element on
the page a footnote.

## Solution

Make the grid's rows actually differ, by putting each spot's distance from its
own floor into the cell beside the tide it is measured against. Give the page
a type hierarchy where the data outranks its footnotes. Fix the dark-mode
tint inversion. Set the safety caveats as designed callouts rather than raw
slabs — without changing a word of them.

The reader should be able to scan one column and see that Cabrillo is 1.1 ft
off a workable window while Sunset Cliffs is 1.7 ft off, and understand from
the page itself that both numbers rest on an estimate nobody has verified.

Note the direction, because it inverts the intuition: a HIGHER floor is more
permissive. spots.json says the 1.2.0 shift moved every floor in the permissive
direction and that Sunset Cliffs at 0.7 ft is deliberately the strictest of the
eight. So the deepest-looking number is the easiest spot, not the hardest.

## Experience Principles

1. **Observation over verdict** — The grid prints measurements and the
   arithmetic between them. It does not colour-code conclusions. A reader sees
   `2.4 ft` and `1.1 over a 1.3 ft floor` and can check the subtraction; they
   never see a green cell that hides which operand was a guess. This is the
   repo's existing principle and this pass must not erode it.

2. **The data outranks its caveats** — Uncertainty is disclosed in full and
   never hidden, but it is set as apparatus: smaller, dimmer, secondary. The
   tide reading is the largest text in a cell; the disclaimer about it is the
   smallest text on the page. Loudness must track importance, not anxiety.

3. **Difference is the point of a row** — Every row in a table exists to be
   compared with the others. Any content identical across all rows belongs in
   a header, a caption, or a footnote — not repeated eight times.

## Aesthetic Direction

- **Philosophy**: Instrument panel. A calibrated scientific readout — dense,
  monospaced where numbers align, generous only where reading is hard. Closer
  to a tide table or a NOAA product than to a consumer weather app.
- **Tone**: Precise, sober, unhurried. Quietly authoritative about what it
  measured; plainly humble about what it estimated.
- **Reference points**: NOAA CO-OPS station pages, Windy's data panels,
  Berkshire-plain government data tables, the typographic density of a
  Bloomberg terminal without the colour.
- **Anti-references**: Surf-forecast apps with green/amber/red day pills.
  Anything that renders a confidence-free guess as a traffic light. Consumer
  weather UI with hero imagery and rounded pastel cards.

## Existing Patterns

Everything below stays. This pass extends it.

- **Typography**: system UI stack; `--font-mono` custom stack
  (`ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Menlo`).
  `font-feature-settings: 'tnum'` globally so tide heights align. Current sizes
  span only 0.68rem–1rem — this is what the pass widens.
- **Colors**: OKLCH throughout. Surfaces `--surface` / `-raised` / `-sunken`;
  borders `--border` / `-strong`; text ramp `--text` / `-dim` / `-dimmer`.
  Four semantic accents, none of them a window verdict: `--color-accent`
  (focus, floor line), `--color-alert` (upstream failure, now-rule),
  `--color-caution` (MPA restriction), `--color-window` (chart window band).
  Separate day/night cell skins, each carrying its own foreground ramp.
- **Spacing**: Tailwind 4 defaults. One custom breakpoint,
  `--breakpoint-wide: 600px` — deliberately not Tailwind's `sm` (640px),
  because 600px is where the seven-column grid stops fitting a phone.
- **Components**: `window-cell` (CellShell / TideLine / WindowCell /
  UnevaluatedCell), `spot-row`, `flag-badge`, `disclosure`
  (EvaluationStamp / Notices / UpstreamFailure), `unresolved`,
  `spot-summary` (SpotHeader / SwellProvenance / SpotDisclosure),
  `spot-protection`, `week-ribbon`, `day-chart`, `midnight-notice`.
- **Constraint**: no new runtime dependencies. The chart is hand-rolled SVG and
  stays that way.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| `globals.css` tokens | Modify | Widen type scale; fix inverted `--tint` in dark; add spacing/scale tokens |
| `TideLine` | Modify | Accept an optional floor-gap slot rendered inline with the low, monochrome |
| `WindowCell` | Modify | Pass `lowFt - floorFt` through to `TideLine`; promote cell type to 13px |
| `SpotRow` | Modify | Show each spot's floor in the row header alongside the name |
| `lib/grid.ts` `sortRows` | Modify | Tie-break on smallest week gap-to-floor when usable counts tie |
| `UnresolvedDisclosure` | Modify | Prose-width panel, real heading, 11px body, tightened accent. Text unchanged |
| `SpotProtection` | Modify | Same panel treatment; stop full-bleed with `max-w-prose` contents |
| `DayChart` | Modify | Resolve extremum/now-line label collision; decouple SVG type from viewBox scaling |
| `FlagBadge` | Modify | Add a tail/connector to the popover; verify it does not obscure its own cell |
| Spot page `h1` | Modify | Remove the duplicate spot name inside `WeekRibbon`'s `SpotHeader` |
| Page intro copy | Modify | Shorten; move the light/dark explanation into the legend that already repeats it |
| `Legend` | Modify | Absorb the day/night sentence; align to new type scale |

## Key Interactions

- **Scanning for the best spot.** Default sort ranks by usable windows, then —
  when those tie, which is the current and common case — by smallest gap to
  floor across the week. The top row is the spot nearest to workable. No new
  control; the existing one starts producing a meaningful order.
- **Reading a cell.** The low, its clock time, and its distance from that
  spot's floor sit on one line; the following high sits below. The gap is
  monochrome — weight, not colour, marks a low that gets under the floor —
  so the cell stays an observation.
- **Opening a flag.** Unchanged behaviour (native popover, light dismiss,
  Escape, focus return). Adds a visual tail to its badge so the reader can
  tell which cell it describes — necessary now and doubly so while cells
  resemble each other.
- **Expanding a row.** Unchanged. Discloses location, thresholds and swell
  provenance — the things a table cell has nowhere to put.
- **Date rollover.** Unchanged. `MidnightNotice` stays fixed-position and
  leaves the refresh decision to the reader.

## Responsive Behavior

- **≥ 600px (`wide:`)**: full seven-day grid; row disclosure available; week
  ribbon shown on spot pages.
- **< 600px**: grid collapses to today's column only; row header becomes a
  direct link to the spot page rather than a disclosure toggle; week ribbon
  replaced by a vertical day list. All collapsing is done in CSS so server and
  client markup match.
- The floor gap must survive the mobile collapse — at 375px the single visible
  column is the only place rows can differ at all, so it matters most there.
- Chart SVG type must hold a legible size at 375px without ballooning at
  1280px, which the current viewBox scaling does not manage.

## Accessibility Requirements

Current scaffolding is strong and is a floor, not a ceiling:

- Skip link; `aria-label`s on cells carrying the full verdict that the visuals
  deliberately demote; `role="img"` + prose label on the chart with the extrema
  repeated as a real table; interactive elements always siblings, never nested;
  `:focus-visible` ring on `--color-accent`; `prefers-reduced-motion` honoured.
- **Must hold through this pass**: the floor gap is decorative duplication for
  screen readers — it goes in `aria-hidden` visual markup, and the existing
  `cellAriaLabel` prose is extended to state it once, not twice.
- **Contrast**: all text ≥ 4.5:1 in both themes, including small dim type on
  both cell skins. The dark `--tint` fix must be verified against the
  provenance line specifically — that is the pair that currently fails.
- Type-size floor: no interactive or data text below 11px.

## Out of Scope

- **Any change to `shared/spots.json` or `shared/thresholds.json`.** Including
  rewording the `unresolved` entries, however much they read like commit
  messages. That is a data change against legally load-bearing fields and needs
  its own PRD.
- **Populating the 18 spots with null floors.** They stay excluded and named.
- **Adding a swell forecast**, or otherwise changing why days past the 5-day
  horizon cannot pass.
- **Re-binding tide stations.** That all eight spots share 9410230 is an
  upstream fact this pass presents honestly; it does not try to fix it.
- **Changing the window predicate**, the 45-minute minimum, or the 0.6 flood
  trim.
- **Colour-coding window states.** Explicitly rejected, twice, in the code
  comments; this pass upholds that.
- New dependencies, client-side charting, or converting server components to
  client components.
