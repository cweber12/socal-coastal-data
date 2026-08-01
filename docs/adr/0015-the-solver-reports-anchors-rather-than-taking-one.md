# The solver reports the extrema an interval contains, rather than taking one

`core/window/solve.ts` is `solve(series, predicate, window) -> Interval[]`. It
walks the series once and returns every maximal run where the predicate holds,
with the turning points each run happens to contain reported as a property of
the interval — zero, one or two.

This **supersedes** PRD #101 decision 3, which specified
`solve(series, anchor, holds)`: "anchors on extrema of a declared kind and walks
outward while a height predicate holds".

## Why

The copy-then-extract sequence existed to catch exactly this, and it did. #129
built `activities/surf/` by copying tidepool's predicate; #130 extracted from the
two together, and the specified signature did not survive contact with the second
occupant.

**Surf sessions do not have an anchor.** An anchor-first solver has to name one
extremum per interval *before* it knows whether the interval contains one. Two
real days from the committed 384-hour fixture for station 9410230, against the
1.5–3.5 ft band:

| day | first interval | second interval |
| --- | --- | --- |
| 2026-07-22 | the 2.816 ft **high** at 05:51 *and* the 2.503 ft **low** at 09:30 | **no turn at all** — a pass-through on the ebb off the 5.017 ft high at 16:53, which sits above the band and outside the interval entirely |
| 2026-07-21 | a high and a low, again | |

On 2026-07-22 an anchor-first solver would have to name two extrema for one
interval and none for the other. All three counts — zero, one, two — occur inside
one fortnight of real predictions, which is not a corner case being designed
around; it is the ordinary shape of a band on a mixed-semidiurnal coast.

`activities/surf/policy.ts` carried the count as `SurfSession.anchors` from the
day it was written, documented as being *reported rather than used*, precisely so
this decision would have the number in front of it.

## Tidepool's anchor did not disappear, it moved up

"Which low is this day about" is a **selection over the intervals**, and it
belongs in `activities/tidepool/policy.ts` because it is that activity's
judgement. The tell is that the two occupants already disagree about it:

| | rule |
| --- | --- |
| tidepool | today: the next low whose window has not shut. Other days: the best daylight low. |
| surf | most decisive minutes, then most usable minutes, then earliest. |

Neither is more correct. They answer different questions — "how much of today's
window is left" against "which of today's sessions is the better one" — and a
solver that picked one would be imposing an activity's judgement on the other.
That is ADR 0001 applied to a function signature: the solver states what is
physically true, the activity decides what is good.

`intervalAt(intervals, tMs)` is the primitive that selection is written on, and
it returns **null** for an instant inside no interval rather than the nearest
one. That is the phantom window's fix stated as a contract.

## Considered and rejected

**Keep the specified signature and let surf pass a synthetic anchor.** Whatever
was passed for the 2026-07-22 pass-through would be a turn the session does not
contain, and the reported window would then be anchored on it. This is the shape
the phantom window bug already has.

**Two solvers, one per shape.** That is #129's state of the world, and it is the
duplication #130 exists to remove. Six of eight states and all four gate
behaviours came across the copy unchanged; the anchor was the only part that did
not generalise, and it generalised by being removed.

**A solver that returns intervals AND picks one.** Requires a ranking, and there
is no activity-neutral ranking — see the table above.

## Consequences

- The solver has no opinion about which interval matters, so an activity that
  wants one writes its own rule. Dive and beach inherit a choice rather than a
  default.
- `WindowResult` stops naming `lowFt`, `nextHighMs`, `reachesFloor` and
  `floorFt`; those are tidepool's answer to a question the shared shape no longer
  asks, and they live in an activity-typed `detail`.
- `above-floor` is now the absence of a window rather than a zero-length one at
  the low's own instant. The selection no longer has to exclude a placeholder
  that trivially satisfies "ends after now".
- Both documented bugs became solver-level properties with named regression
  tests, and each was demonstrated to fail against the solver with its own fix
  reverted rather than assumed to.
