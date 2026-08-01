# activities

A reason to go, and the unit that owns **judgement**. An activity composes the
`core/` facts it needs plus its own thresholds into a verdict.

| | |
| --- | --- |
| `tidepool/` | Reads the intertidal and the surf zone. 8 spots. |
| `surf/` | Reads the surf zone. 24 spots, every number uncalibrated. |

`surf` is second because it is the only candidate that breaks the one-window
solver: a tide *band* is crossed four times on a semidiurnal day and straddles
both a low and a high, which is N sessions rather than one window anchored on a
low. See ADR 0008. #130 extracted `core/window/` from these two, so `dive` and
`beach` land against an engine proven against two shapes rather than one.

The two overlap without either containing the other — 8 spots are in both, 16 in
surf alone — because the zones they read overlap. Nothing may assume a spot's
zones tile its profile, and a route that resolves a slug has to resolve it
through the activity the URL names.

## What belongs here, and what belongs next door

Belongs here: anything that answers *is it good* — a floor, a ceiling, a minimum
useful duration, the states a verdict can take, the sentences a reader is shown
about them, and the composition that turns feeds into a grid of verdicts for
**this** activity.

Belongs next door:

- **A fact** goes to `core/`. The tide height at 14:20, sunset, whether the gate
  is shut, what the buoy reported — identical for a tidepooler and a diver
  reading the same numbers, so no activity owns them.
- **A measured zone fact** — the tide height at which a reef surfaces — is a fact
  about one cross-shore band and belongs to `core/zones/`, which #124 creates.
  It is emphatically not a tidepool parameter: the same number serves a
  photographer, a MARINe surveyor and a child with a bucket.
- **Composition across activities** — rendering one spot's facts once and
  stacking several activities' verdicts on top — belongs to `app/`. Composition
  *within* one activity lives here; ADR 0010 records why the two are different.

## What an activity holds, now that the engine is next door

#130 pulled the solver, the gates and the gate states into `core/window/` out of
**two real occupants**. What is left in each activity is what only it can answer:

| | tidepool | surf |
| --- | --- | --- |
| height predicate | `ft < floorFt` | `minFt < ft < maxFt`, strict both ends |
| its own state | `above-floor` | `out-of-band` |
| the selection | today: the next low whose window has not shut. Otherwise: the best daylight low. | most decisive minutes, then most usable, then earliest |
| a judgement of its own | `FLOOD_SIDE_TRIM = 0.6` — getting off a reef while the water returns | a swell **minimum**, so a flat day does not read `go` |

The two selection rules are the reason the solver takes no anchor: they answer
different questions and neither is more correct. ADR 0015.

## No activity may import another

`scripts/check-boundaries.mjs` derives the rule from the paths, so it holds for
an activity that has no row of its own — and each activity has one anyway, which
states its *other* edges. The check fails the moment a cross-activity import is
written. That is what made the duplication in `surf/` safe while it lasted: it
was built by **copying** tidepool's predicate on purpose, and that duplication
was the input to #130's extraction rather than a defect to fix early.

Demonstrated rather than asserted, on a deliberately introduced import:

```
check-boundaries: 1 forbidden edge

  activities/surf -> activities/tidepool is not an allowed edge
    activities/surf/policy.ts:65
    imports '../tidepool/policy'
    activities/surf may import: activities/surf, core, shared
```

The table there is the one statement of the import rules; this file does not
restate it.
