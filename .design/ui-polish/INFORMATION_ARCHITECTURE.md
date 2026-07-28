# Information Architecture: Tide windows

The route structure is already correct and this pass does not change it. What
this document settles is **content placement** — specifically, where the fact
that all eight spots share one tide station gets stated, and what stops being
repeated on every page.

Companion documents: [DESIGN_BRIEF.md](DESIGN_BRIEF.md),
[DESIGN_REVIEW.md](DESIGN_REVIEW.md).

## Site Map

- **Grid** `/` — all evaluable spots × 7 days. Indexable. `?sort=geographic` toggles order.
  - **Spot** `/spot/[slug]` — one spot's week. Indexable. 8 pages, fixed set.
    - **Day** `/spot/[slug]/[date]` — one spot, one day, charted. **Not** indexable.

Bounds worth recording, because they constrain what the UI may link to:

| | Value | Enforced by |
| --- | --- | --- |
| Grid horizon | 7 days | `HORIZON_DAYS` |
| Swell horizon | 5 days | `SWELL_HORIZON_DAYS` — days 5–6 can never pass |
| Day route, backward | 30 days | `SERVABLE_DAYS_BEFORE` |
| Day route, forward | 365 days | `SERVABLE_DAYS_AFTER` |

`/spot/[slug]/[date]` is `noindex, nofollow` in metadata *and* disallowed in
`robots.ts` via `/spot/*/` (the trailing slash is load-bearing — it spares the
spot pages). Rationale: ~2,900 servable dates × 8 spots, each a distinct CO-OPS
fetch, chained by prev/next links. **No navigation change in this pass may
introduce a crawlable path into that space.**

## Navigation Model

- **Primary**: none. Three levels, all reachable by breadcrumb or by clicking a
  cell. Eight spots does not warrant a nav bar, and adding one would be chrome.
- **Secondary**: breadcrumbs on spot and day pages (`All spots / Spot / Date`).
  Sort links on the grid. Prev/next day on day pages — **dropped, never
  rendered dead, at the servable bound**, with a sentence saying why.
- **Utility**: masthead wordmark links home. Footer carries data provenance and
  the uncalibrated-estimates warning.
- **Mobile**: identical. No hamburger — there is nothing to put in it. The grid
  collapses to today's column and row headers become direct links to spot
  pages, since the row disclosure has nothing to show at that width.

## Content Hierarchy

### Grid `/` — the 80% page

1. **The grid itself.** Currently pushed below a six-line instruction
   paragraph; it moves up. Rows must be visibly different from one another,
   which is what the floor-gap column delivers.
2. **A one-line orientation**, replacing the paragraph: what the page is, how
   many spots, over how many days. The "light means daylight" explanation moves
   into the legend, which already repeats it.
3. **The shared-station statement.** *New, and the structural fix.* One line
   near the table caption: all spots draw on tide station 9410230, so the tide
   is the same everywhere — what differs is each reef's floor. This converts
   the identical rows from an apparent bug into a stated fact, and it belongs
   here because this is the only page where the repetition is visible.
4. **Legend.** Day/night skin always visible; flag meanings collapsed.
5. **Spots not in the grid** (18, null floors) — collapsed.
6. **Safety callout** — always open, verbatim, prose width.
7. **Other unresolved caveats** — collapsed.
8. **Data notices** — this render's upstream problems, kept separate from
   standing caveats so a permanent limitation never reads as a transient fault.
9. **Evaluation stamp**, then footer provenance.

### Spot `/spot/[slug]`

1. **Spot name** — once. The duplicate inside `WeekRibbon`'s `SpotHeader` is
   removed when the ribbon is rendered on a page that already names the spot.
2. **Identity line** — audiences, tide station, coordinate precision.
3. **Week ribbon** (≥600px) or vertical day list (<600px).
4. **Swell provenance** — which buoy, how old, substituted or not.
5. **Marine protection** — legally load-bearing, stays high and stays a callout.
6. **From the inventory** — the spot's own notes.
7. Safety callout → unresolved → notices → stamp.

### Day `/spot/[slug]/[date]`

1. **Spot, date, today-badge, and the thresholds line.**
2. **The four facts** — Low / Next high / Window / Remaining.
3. **The chart.** The best artefact in the app; it keeps the most space.
4. **Turning points table** — the chart's content for anyone the SVG cannot serve.
5. **Swell provenance and the flood-trim explanation.**
6. Safety callout → unresolved → notices → stamp.

## User Flows

### Choosing a spot for the week

1. Land on `/`.
2. Scan the leftmost data column; rows are ordered by usable windows, then —
   when those tie, the current case — by smallest gap to floor.
3. Read a cell: low height, clock time, and distance from that spot's floor.
   - Gap is negative → the reef surfaces; the flag explains for how long.
   - Gap is positive → covered; the magnitude says by how much.
4. Open a flag badge for the verdict and its provisional caveat, **or** click
   the cell to go to that day's chart.
5. Click the spot name (≥600px expands provenance in place; <600px navigates).

### Checking one day in detail

1. From any cell → `/spot/[slug]/[date]`.
2. Read the four facts, then the chart: floor line, night shading, window band,
   and the `now` rule if today.
3. Step to an adjacent day with prev/next — **available only inside the
   servable window**; at a bound the link is absent, with a sentence explaining.

### Returning to a stale tab

1. Local midnight passes; `MidnightNotice` appears fixed to the bottom.
2. Nothing moves on its own — the first column is still the evaluated day.
3. Reader chooses "Roll the window forward".

## Naming Conventions

Consistency here is a data-integrity concern, not a style one — two words for
one threshold is how a safety number gets misread.

| Concept | Label in UI | Notes |
| --- | --- | --- |
| Tide height below which reef is workable | **floor** | Never "minimum tide", never "threshold". Matches `tidepool_floor_ft`. |
| Significant wave height above which the day is off | **swell ceiling** | Always paired with "uncalibrated" or "corridor default" where true. |
| Distance between the low and the floor | **over / under floor** | New this pass. "Under" is the good direction. Never "above/below" — ambiguous about water vs. rock. |
| Usable daylight sub-floor interval | **window** | The product's name for itself. |
| Time left in today's window | **remaining** | Distinct from window length. |
| A day the predicate could not judge | **not evaluated** | Never "unavailable", never blank. An absence, not a seventh state. |
| A value that could not be resolved | **unresolved** | Never "unknown" for `null` fields; matches the data files. |
| Wave height with no reading | **swell unknown** | Explicitly "unknown is not calm". |
| Past the 5-day swell horizon | **no swell** | Column-header note; a data limit, not an alarm. |
| Spots with `null` floor | **not in this grid** | Named, never silently absent. |

## Component Reuse Map

| Component | Used on | Behavior differences |
| --- | --- | --- |
| `RootLayout` | all | None. |
| `CellShell` + `TideLine` | grid, week ribbon, mobile day list | Single source for a tide reading — the three views must not drift. Gains the floor-gap slot once, here. |
| `FlagBadge` | grid, ribbon, day list, day-page facts panel | Same glyph and position everywhere; `id` must be unique and stable per instance. |
| `SpotHeader` | week ribbon (spot page), row disclosure (grid) | **New difference**: suppresses its own spot name when the host page already carries it as `h1`. |
| `SwellProvenance` | spot page, day page, row disclosure | None. |
| `UnresolvedDisclosure` | all three | None — the safety entry appears on every page by design. |
| `Notices` | all three | None. |
| `EvaluationStamp` | all three | `extra` varies: grid adds the date, day adds station and sample count. |
| `MidnightNotice` | grid, spot | Not on day pages — a dated URL does not go stale. |
| `WeekRibbon` | spot page only | ≥600px only. No longer used by the grid's row disclosure. |
