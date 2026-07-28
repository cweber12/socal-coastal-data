# Build Tasks: Tide windows — UI/UX polish pass

Generated from: [DESIGN_BRIEF.md](DESIGN_BRIEF.md)
Also reads: [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md) · [DESIGN_TOKENS.css](DESIGN_TOKENS.css) · [DESIGN_REVIEW.md](DESIGN_REVIEW.md)
Date: 2026-07-28

**Aesthetic philosophy: instrument panel.** A calibrated scientific readout —
NOAA station page, not surf app. Established in Task 2, which is why the cell
comes before everything except the tokens it depends on.

**Nothing here creates a new component.** Every task modifies something that
exists. That is a deliberate signal about the size of this pass.

**Repo workflow gate.** Per CLAUDE.md: PRD issue published, child issues cut,
and a feature branch off an up-to-date `main` — all before Task 1. No commits
to `main`.

**Standing constraints for every task**
- Standard library / no new dependencies. The chart stays hand-rolled SVG.
- Verification means running it and looking, not reasoning about what it renders.
- `npm run test` (248 lib tests) and `npm run typecheck` stay green.
- No task may make `/spot/[slug]/[date]` crawlable — see IA, `robots.ts`.

---

## Foundation

- [x] **1. Apply the token layer.** Merge [DESIGN_TOKENS.css](DESIGN_TOKENS.css)
  into `app/globals.css`: the five-step type scale into `@theme`, the
  `--tint` → `--tint-strength` rename with the inversion deleted, and
  `--tint-text-meta`. _Modifies: `app/globals.css`._
  **Done when:** the dark-mode safety panel is a soft tinted card rather than a
  mustard slab, and `text-data` / `text-meta` utilities resolve.
  **Must verify in-browser:** the contrast targets in the token file are derived
  from a `Y ≈ L³` approximation and are *targets, not measurements*. Read the
  computed background and text colours off the rendered panel in both themes and
  adjust the two `--tint-text-meta` values until both clear 4.5:1.

---

## Core UI

- [x] **2. Floor gap in the cell.** Add an optional gap slot to `TideLine`,
  rendered inline with the low: `▼ 2.4 2:51 pm  +1.1`. Monochrome — weight
  distinguishes under-floor from over-floor, never colour. `WindowCell` passes
  `result.lowFt - result.floorFt` (both already on `WindowResult`; no data
  plumbing). _Modifies: `components/window-cell.tsx`, `lib/labels.ts`._
  **Done when:** the eight grid rows are visibly different from one another.
  **Aria:** the gap is `aria-hidden` visual duplication. Extend `cellAriaLabel`
  to state it **once** in prose and update `lib/labels.test.ts` — the failure
  mode is every cell announcing the gap twice.
  _Depends on: 1. This is the headline change and establishes the philosophy._

- [x] **3. Floor in the row header.** Show each spot's floor beside its name in
  the 11rem row header, alongside the existing usable count. Applies to both the
  ≥600px disclosure button and the <600px link, which must not drift.
  _Modifies: `components/spot-row.tsx`._
  **Done when:** a reader can see 0.7 ft at Sunset Cliffs vs 1.3 ft at Cabrillo
  without opening anything. **Watch:** 11rem is tight for name + floor + count.

- [x] **4. Make the sort control work.** Move `sortRows` out of `app/page.tsx`
  into `lib/grid.ts` so it is testable, then add the tie-break: when usable
  counts tie — the current and common case — rank by smallest week gap to floor.
  _Modifies: `app/page.tsx`, `lib/grid.ts`, `lib/grid.test.ts`._
  **Done when:** default order is Cabrillo first, Sunset Cliffs last, and a new
  test in `grid.test.ts` pins that. Today the control silently renders
  alphabetical order.
  **Direction:** a HIGHER floor is more permissive, so Cabrillo at 1.3 ft is
  nearest a window and Sunset Cliffs at 0.7 ft is furthest. Easy to invert.

- [x] **5. State the shared tide station, and cut the intro.** Add the one-line
  fact near the table caption: all spots draw on station 9410230, so the tide is
  identical everywhere and what differs is each reef's floor. Reduce the
  six-line intro paragraph to one line, moving the "light means daylight"
  sentence into `Legend`, which already repeats it. _Modifies: `app/page.tsx`._
  **Done when:** the grid is visible without scrolling past a paragraph, and the
  repetition across rows is explained rather than looking like a bug.
  _Depends on: 2, 3 — the statement is only true-sounding once rows differ._

- [x] **6. Migrate to the type scale.** Replace the 79 arbitrary font-size
  declarations (9 distinct values) across the three pages and nine components
  with the five scale steps. Data → `text-data`, caveats and stamps →
  `text-meta`, page titles → `text-title`. _Modifies: all three pages, all
  components carrying text._
  **Done when:** no `text-[Nrem]` arbitrary sizes remain, and the tide reading
  in a cell is measurably larger than the footer disclaimer — the inversion in
  the brief's principle 2, corrected. _Depends on: 1._

---

## Interactions & States

- [x] **7. Give the popover a tail.** Add a visual connector from the flag
  popover to its badge, and check placement so it does not bury the cell it
  describes. Keep the native `popover` attribute, the top-layer escape from the
  `overflow-x` container, and platform light-dismiss / Escape / focus-return —
  all of which currently work and none of which should become JavaScript.
  _Modifies: `components/flag-badge.tsx`, `app/globals.css`._
  **Done when:** with a popover open you can tell which of 56 near-identical
  cells it belongs to. Verify in the **last column**, which is the case the
  top-layer positioning exists for.

- [x] **8. Restyle the tinted panels.** Constrain to `--panel-measure` so a
  panel no longer full-bleeds around `max-w-prose` text, add a real heading to
  the safety callout, body to `text-meta`, provenance line to
  `--tint-text-meta`. **The caveat text itself does not change by one word** —
  `unresolved.tsx` argues correctly that re-wording a safety caveat in a second
  place is how two versions drift apart. Setting is in scope; wording is not.
  _Modifies: `components/unresolved.tsx`, `components/spot-protection.tsx`,
  `components/disclosure.tsx`._ _Depends on: 1._

- [x] **9. Stop the spot page naming itself twice.** `SpotHeader` suppresses its
  own spot name when the host page already carries it as `h1`. Grid row
  disclosure keeps the name — there it is the only label.
  _Modifies: `components/spot-summary.tsx`, `app/spot/[slug]/page.tsx`._

---

## Responsive & Polish

- [x] **10. Fix the day chart's typography and label collisions.** Two separate
  problems: the `2.4 2:51 pm` extremum label is struck through by the red `now`
  rule, and SVG text at `fontSize="9"` inside a 760×280 viewBox stretched to
  container width renders ~22px at 1280px and shrinks on mobile — the only type
  on the page untethered from the scale. _Modifies: `components/day-chart.tsx`._
  **Done when:** no label overlaps the now-rule, another label, or the axis, at
  375 / 768 / 1280; and chart text is within one step of `text-meta` at every
  width. **Keep:** `role="img"`, the prose label, and the extrema table.

- [x] **11. Mobile pass at 375px.** The single visible column is the only place
  rows can differ below 600px, so the floor gap matters most there and must
  survive the collapse. Also re-check the legend, which currently wraps so that
  "low after dark" separates from its swatch. Breakpoints: 375, 600 boundary,
  768. _Modifies: `app/page.tsx`, `components/window-cell.tsx`._
  _Depends on: 2, 6._

- [x] **12. Accessibility pass.** Specific checks, not a general sweep:
  - Contrast ≥ 4.5:1 in **both** themes for: `--tint-text-meta` on every tinted
    panel, small dim type on both cell skins, and the new floor gap on both.
  - The floor gap is announced **once**, not twice (see Task 2).
  - Keyboard: tab through a grid row — link, badge, toggle are siblings and must
    stay so; `:focus-visible` ring survives the type migration.
  - No data or interactive text below 11px.
  - `prefers-reduced-motion` still honoured after the popover tail lands.

---

## Review

- [ ] **13. Design review.** Re-run the Playwright capture across three pages ×
  three breakpoints × both themes plus interaction states, then run
  `/design-review` against the brief. Compare directly to the before/ shots in
  `screenshots/`.

- [ ] **14. Ship it.** Commit per the repo's convention — body explains cause
  not change, records what was verified with counts and values, ends with the
  `Co-Authored-By` trailer. Push, open the PR against `main`, and state plainly
  in the PR body what was verified and what was not.

---

## Explicitly not tasks

Carried from the brief's out-of-scope, restated here because these are the
things most likely to get picked up mid-build:

- Editing `shared/spots.json` or `shared/thresholds.json` — including rewording
  the `unresolved` entries, however much they read like commit messages.
- Giving the 18 null-floor spots estimated floors.
- Re-binding tide stations so rows would differ naturally.
- Colour-coding window states. Rejected twice in code comments; upheld here.
- Adding a swell forecast, or changing the 45-minute minimum / 0.6 flood trim.
