# activities/surf

Surf's judgement: a tide **band**, a swell window, and the states its predicate
emits.

| | |
| --- | --- |
| `thresholds.json` | Every number a surf verdict is decided against. The band (1.5–3.5 ft MLLW), the swell minimum (1.0 ft), and the two per-spot ceilings — `blacks-beach` 2.0 ft, `tourmaline` 4.0 ft. All uncalibrated author estimates. |
| `thresholds.ts` | Reads them, asserts the two different kinds of feet separately, and falls back to the corridor default ceiling. |
| `states.ts` | The eight states, in the order they are tested. `out-of-band` and the `veto` wording are stated here; the rest come from `core/window/states.ts`. |
| `policy.ts` | The band predicate, the swell minimum, and which session the day is about. N sessions per day, not one window. |
| `verdicts.test.ts` | 476 spot-days captured from `main` before #130 and replayed field by field. Evidence, not source. |
| `grid.ts` | Composes the feeds and the predicate into what a page renders. |
| `labels.ts` | Every sentence the UI shows, so the ones a screen reader gets are tested. |
| `routes.ts` | This activity's URL segment, written down once. |
| `components/` | The cell, the badge, the chart and the row disclosure. |

## This was a copy of `activities/tidepool/`, and #130 collapsed it

Deliberately, and temporarily. #129 built this directory by copying tidepool's
predicate so that #130 could extract an engine from **two real occupants**;
pulling one out of tidepool alone would have been guessing at what a second
occupant needs.

It was not a guess, and the record of what the copy proved is worth keeping.

**Four things differed**, and they are the reason surf was chosen as the second
activity rather than dive (ADR 0008):

1. **N intervals, not one.** A band yields two or three disjoint sessions a day.
   The day's verdict is an aggregate over a list. → `core/window/solve.ts`, for
   both occupants.
2. **No anchor.** Tidepool picks a low and walks outward. This walks once and
   collects every maximal in-band run, then reports which turns each happens to
   contain — **zero, one or two**. All three occur in the committed fixture
   inside a fortnight: on 2026-07-22 one session holds a high *and* a low while
   the other holds no turn at all. → the solver takes no anchor at all, which
   **overturned PRD #101 decision 3**. ADR 0015.
3. **A two-sided predicate**, strict on both edges, with each crossing
   interpolated against the edge it actually crossed. → stayed here; the solver
   takes a predicate and does not hold one.
4. **No flood-side trim.** Tidepool's 0.6 trim is a fact about being on foot on a
   ledge system while the water returns. It has no equivalent for someone already
   in the water. → stayed in tidepool, which is where a safety judgement belongs.

**A fifth thing the copy found, after the issue was written.** A swell *ceiling*
alone called a 0.4 ft day `go`. The swell gate is a **window**, and its lower
answer is `flat` — worded as "there is nothing there" rather than "do not go",
because a reader who reads the two the same way treats a flat day as a dangerous
one. Tidepool passes no minimum and can never reach it. ADR 0016.

**And four things came across the copy unchanged**: the swell horizon, the
daylight clip, the gate clip and the minimum-duration rule. That is the other
half of the evidence, and it is why `core/window/gates.ts` exists.

`scripts/check-boundaries.mjs` still forbids the import that would collapse the
two activities into each other, and the rule is derived from the paths rather
than from a table row — so it held before this directory had a row of its own.

## What belongs here, and what belongs next door

Belongs here: anything answering *is it good* — the band, the ceilings, the
minimum, the minimum useful session, the states, and the composition that turns
feeds into a grid of verdicts for **this** activity.

Belongs next door:

- **The window engine** — the run walk, the two clips, the swell gate, the gate
  states — is `core/window/`. Nothing here re-implements one, and the sentences
  both activities word identically are built from its fragments.
- **What is physically true in the surf zone** — which spots have one — is
  `core/zones/surf.ts`. It holds membership derived from the wave binding and no
  measured fact; see ADR 0014. Nothing here may assert a zone fact.
- **A fact true of the whole spot** — daylight, gate hours, the MPA — is
  `core/spot/`.
- **Which tide station the heights came from**, and what that binding is worth,
  is `core/feeds/coops-predictions.ts` trap 4 — activity-neutral, because dive
  will read high water on the same terms. Worth knowing before touching a band
  edge: the two stations in the registry differ by a 7% **scale** term, so
  tidepool's 0.06 ft floor result does not carry up here. 79.3% of matched highs
  over 2000–2040 differ by more than the 0.3 ft promotion tolerance and not one
  low does. Measured in `tools/tide-station/`.
- **The corridor default ceiling** stays in `shared/thresholds.json`: it applies
  to every spot nothing specific has been said about.
- **Anything tidepool needs** is tidepool's.

## Everything here is uncalibrated, and that is a ship state

Not one number in `thresholds.json` has been checked against an observed session,
and the zone underneath them holds no measured fact to anchor against — no
equivalent of the intertidal floor and its ledger. ADR 0008 settles that this
ships routed with hard disclosure rather than held back, and
https://github.com/cweber12/socal-coastal-data/issues/135 is the path off it for
all of them.

The disclosure is not decoration. `unresolved` here and `SURF_ZONE_UNRESOLVED`
next door are both rendered on every page carrying a surf verdict, and `/surf`
opens with the one that matters most — that a member is a spot with a buoy
binding, not a spot with a surf break — uncollapsed, above the grid.
