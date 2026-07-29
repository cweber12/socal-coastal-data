# UX/UI audit — tide windows web app

> This is the PRE-BUILD audit: the state of the app before the polish pass.
> The post-build critique is in [DESIGN_REVIEW.md](DESIGN_REVIEW.md), and the
> `screenshots/` at the top level of this folder are the "before" set.

Audited 2026-07-28 against the running dev server (localhost:3317), Next 16 /
React 19 / Tailwind 4. Evidence in `screenshots/`: three pages × three
breakpoints, light and dark, plus popover / row-expanded / focus states.

Pages audited: `/` (grid), `/spot/[slug]`, `/spot/[slug]/[date]`.

The verdict up front: the *craft* here is genuinely high — the day/night cell
skin, the server-rendered SVG chart, the native-popover disclosure, the
tabular-figure alignment, the refusal to colour verdicts that rest on
uncalibrated estimates. None of that needs rescuing. What the audit found is
one structural problem that makes the main page nearly contentless, one real
dark-mode bug, and a set of hierarchy and density issues that read as
"unfinished" rather than "restrained".

---

## Must fix

### 1. Every row of the grid is identical

All 8 evaluable spots bind to tide station **9410230**. Verified:

```
swamis, cardiff-reef, torrey-pines-beach, la-jolla-shores,
la-jolla-cove, windansea, sunset-cliffs, cabrillo-tidepools
  → tide_station 9410230 (all)
```

So the grid's 56 cells contain **7 distinct values, repeated 8 times**. Screenshot
`review-grid-desktop-1280.png` shows eight rows of `▼2.4 2:51 pm / ▲6.1 9:04 pm`.
On mobile (`review-grid-mobile-375.png`) it is eight identical cards stacked —
the entire viewport is one fact, repeated.

The axis the table varies on (spot) carries no variation in what it displays.
The thing that *does* differ per spot is the floor — 0.7 ft at Sunset Cliffs to
1.3 ft at Cabrillo — and the floor appears nowhere on the grid. It is the
column the table is missing.

Compounding it: every row currently reads **"no windows"**, so the default
"Usable windows" sort is a no-op and the sort control does nothing observable.

This is not a styling problem and no amount of polish fixes it. It is the
first thing to decide.

### 2. Dark mode renders the SAFETY panel as a solid mustard slab

`--tint` is `0.92` in light and `0.24` in dark, and `.tint-panel` mixes
`calc((1 - var(--tint)) * 100%)` of the accent. That is 8% accent in light
(correct, a soft cream) and **76% accent in dark** — a near-fully-saturated
amber block. See `review-grid-desktop-1280-dark.png`.

Consequences: the loudest element on the dark page is a caveat panel; and its
provenance footer (`shared/spots.json 1.2.0, unresolved`, set in
`--text-dimmer`) is dim grey on saturated amber and effectively illegible.

The variable is inverted for dark. Both themes want a *low* accent mix.

---

## Should fix

### 3. The page opens with a wall of instructions

The grid's intro is six lines of 12 px dim prose, and it is the first thing
below the h1 — you read a paragraph about how to read the grid before reaching
the grid. It also holds the legend's job ("light when that low falls in
daylight…") which the legend below then repeats.

### 4. The type scale is nearly flat

`h1` is `text-base` (16 px). Body, table headers, cell contents, legend,
footnotes and the evaluation stamp are all 11–12 px. Almost every piece of text
on the page sits within a 5 px band, so nothing establishes rank and the page
reads as uniformly small rather than as deliberately dense.

### 5. Tinted panels are full-width but their text is `max-w-prose`

On the spot page, "Marine protection" fills the full column while its copy
occupies the left ~35%, leaving a large empty amber field
(`review-spot-desktop-1280.png`). The same happens to every SAFETY panel on
every page. Reads as a layout bug rather than as emphasis.

### 6. Chart labels collide

On the day page the `2.4 2:51 pm` extremum label is struck through by the red
`now` rule (`review-day-desktop-1280.png`). Extremum labels are placed without
reference to the now-line or to each other.

### 7. Chart text does not share the page's type scale

`DayChart` is a 760×280 viewBox stretched to container width. Its `fontSize="9"`
labels therefore render at ~22 px on a 1837 px-wide desktop container and shrink
proportionally on mobile — the one element on the page whose typography is
untethered from every other element's.

### 8. The popover has no tail and covers three rows

The flag popover opens `block-end span-inline-start`, so it lands over the rows
*below* its badge with no visual connector back to it
(`review-grid-popover-open.png`). Where every cell looks identical, "which cell
is this about?" is a real question the popover does not answer.

### 9. The spot page names itself twice

`h1` "Cabrillo Tidepools", then `h3` "Cabrillo Tidepools" inside the week-ribbon
panel directly below it.

---

## Consider

### 10. Caveat copy is raw file text

The SAFETY entry is rendered verbatim from `spots.json` — and it should be, per
the repo's rule against re-wording a safety caveat in a second place. But it
arrives carrying `--` em-dash substitutes, slug names (`sunset-cliffs`), and a
version number used as a subject (`the 1.2.0 shift`). It reads as a commit
message, because it is one. Worth deciding whether the *file* should carry
reader-facing prose, rather than the UI restating it.

### 11. 56 identical `i` badges

Uniform by design — the reasoning in `flag-badge.tsx` is sound. But at 56
instances on one screen the badge becomes texture rather than affordance.

### 12. Audience tags are plain text

`tidepool · bird · tide station 9410230 · coordinates are ±100 m` mixes two
taxonomies (what the spot is for, what data backs it) in one dot-separated run.

---

## What is working and should not be touched

- The day/night cell skin. Legible in both themes, ordering preserved across
  themes, and the per-skin foreground ramp genuinely solves the dark-cell
  problem it was written for.
- The decision to keep verdicts off the face of the grid.
- Tabular figures and the true U+2212 minus — the columns align.
- The day chart. It is the best screen in the app.
- Accessibility scaffolding: skip link, `aria-label`s carrying the verdict the
  visuals demote, extrema table beside the SVG, sibling (never nested)
  interactive elements, real focus-visible ring.
