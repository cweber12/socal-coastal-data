# The swell gate is a window, not a ceiling

`core/window/gates.ts` reads swell against `{ ceilingFt, minimumFt }`, where the
minimum is nullable. Over the ceiling emits `veto`; under the minimum emits
`flat`; a null minimum is a one-sided gate that can never emit `flat`.

This **amends** PRD #101 decision 4, which said "a ceiling emits `veto`" and
listed no lower answer.

## Why

A ceiling alone calls a flat day `go`. #129 found it with a real reading: 0.4 ft
at the buoy, inside the swell horizon, tide in the band, daylight left — every
gate cleared and the cell read as a pass. Nothing was wrong with any gate; the
gate set was incomplete.

The two answers are deliberately worded as different **kinds** of answer:

| | says | wording |
| --- | --- | --- |
| `veto` | do not go | "Called off regardless of the tide." |
| `flat` | there is nothing there | "The tide works and there is nothing to ride." |

A reader who reads the two the same way treats a flat day as a dangerous one,
which is worse than either message alone. `activities/surf/policy.test.ts`
asserts the `flat` sentence carries neither "called off" nor "veto".

## Why the minimum is nullable rather than shared

Tidepool reads swell as a **hazard only**. Over the ceiling and you should not be
on the reef; there is no lower bound below which a reef stops being worth
visiting, because the thing you went for is the reef and not the wave. So it
passes no minimum, `flat` is unreachable, and its states list is six gate states
rather than seven.

That is the asymmetry ADR 0001 predicts: the gate is activity-neutral machinery,
and which end of it applies is the activity's judgement.

## Considered and rejected

**A `flat` state owned by surf**, alongside `out-of-band`. It reads as a
predicate state and it is not — surf's predicate is the tide band, and this is
about the buoy. Filing it with `out-of-band` would put two unrelated facts under
one heading, and dive would have to invent its own copy the moment it wants a
lower bound on anything.

**One `swell` state with a direction field.** Collapses the two sentences into
one row and re-opens the exact confusion the wording exists to prevent.

**A minimum of 0 for tidepool.** Numerically equivalent and a lie: it asserts
that tidepool has a lower bound and that it happens to be zero, when the truth is
that the question does not apply. Null is unresolved-or-inapplicable everywhere
else in this repo and it means the same thing here.

## Consequences

- `readSwell` refuses a window whose minimum is not strictly below its ceiling.
  `veto` and `flat` are mutually exclusive only while that holds, and the state
  precedence is ordered on it being true.
- `veto` sits above `flat` in `CORE_STATES` — a hazard outranks an absence if
  both could somehow be true.
- Surf overrides `veto`'s label to "Too big". Over the ceiling is a hazard on a
  reef and a size call in the water, and the same state is read differently by
  the two readers.
