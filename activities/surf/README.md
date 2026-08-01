# activities/surf

Surf's judgement: a tide **band**, a swell window, and the states its predicate
emits.

| | |
| --- | --- |
| `thresholds.json` | Every number a surf verdict is decided against. The band (1.5–3.5 ft MLLW), the swell minimum (1.0 ft), and the two per-spot ceilings — `blacks-beach` 2.0 ft, `tourmaline` 4.0 ft. All uncalibrated author estimates. |
| `thresholds.ts` | Reads them, asserts the two different kinds of feet separately, and falls back to the corridor default ceiling. |
| `states.ts` | The eight states, in the order they are tested, and how each is worded. |
| `policy.ts` | The band predicate. Returns N sessions per day, not one window. |
| `grid.ts` | Composes the feeds and the predicate into what a page renders. |
| `labels.ts` | Every sentence the UI shows, so the ones a screen reader gets are tested. |
| `routes.ts` | This activity's URL segment, written down once. |
| `components/` | The cell, the badge, the chart and the row disclosure. |

## Why this is a copy of `activities/tidepool/`

Deliberately, and temporarily. #130 extracts a general solver from **two real
occupants**; pulling one out of tidepool alone would be guessing at what a second
occupant needs. Two copies is the intended end state of #129.

`scripts/check-boundaries.mjs` forbids the import that would collapse them, and
the rule is derived from the paths rather than from a table row — so it held
before this directory had a row of its own.

## What actually differs, which is the evidence #130 is waiting on

Four things, and they are the reason surf was chosen as the second activity
rather than dive (ADR 0008):

1. **N intervals, not one.** A band yields two or three disjoint sessions a day.
   The day's verdict is an aggregate over a list.
2. **No anchor.** Tidepool picks a low and walks outward. This walks once and
   collects every maximal in-band run, then reports which turns each happens to
   contain — **zero, one or two**. All three occur in the committed fixture
   inside a fortnight: on 2026-07-22 one session holds a high *and* a low while
   the other holds no turn at all.
3. **A two-sided predicate**, strict on both edges, with each crossing
   interpolated against the edge it actually crossed.
4. **No flood-side trim.** Tidepool's 0.6 trim is a fact about being on foot on a
   ledge system while the water returns. It has no equivalent for someone already
   in the water, and copying it would have been the clearest possible case of
   generalising one occupant's safety judgement into a solver.

The swell horizon, the daylight clip, the gate clip and the minimum-duration rule
came across **unchanged**. That is the other half of the evidence: those four are
gate behaviour and belong in `core/window/gates.ts`.

## What belongs here, and what belongs next door

Belongs here: anything answering *is it good* — the band, the ceilings, the
minimum, the minimum useful session, the states, and the composition that turns
feeds into a grid of verdicts for **this** activity.

Belongs next door:

- **What is physically true in the surf zone** — which spots have one — is
  `core/zones/surf.ts`. It holds membership derived from the wave binding and no
  measured fact; see ADR 0014. Nothing here may assert a zone fact.
- **A fact true of the whole spot** — daylight, gate hours, the MPA — is
  `core/spot/`.
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
