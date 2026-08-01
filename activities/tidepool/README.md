# activities/tidepool

Is there workable reef time at this spot on this day, and if not, why not.

| | |
| --- | --- |
| `policy.ts` | The window predicate. Pure: no network, no ambient clock — `now` is passed in, so every state is reproducible from its inputs. |
| `states.ts` | The seven states, their order, and how each is presented. |
| `grid.ts` | Composition. Feeds plus the predicate into what a page renders. `server-only`. |
| `labels.ts` | The sentences a reader and a screen reader get. |
| `calibration.ts` | Reader over `shared/calibration.json`, the revealed-preference rates. |
| `components/` | The innards: the cell, the ribbon, the chart, the rate panel, the gallery. |

## Why these are tidepool's and not `core/`

**`calibration.ts`** reads a file whose subject is this activity.
`shared/target_taxa.json` defines its numerator as "the animals people go to a
tidepool to see — a product choice, not an ecological zonation". A rate built on
that judgement means nothing to a surfer, so the reader lives with the activity
that the judgement is about, even though the data file is produced by
`tools/calibration/` and stored in `shared/`.

**`grid.ts`** composes exactly one activity. ADR 0010 records why that is
different from the cross-activity composition `app/` does, and why it is not
being generalised before there is a second occupant.

**`labels.ts`** holds `formatSightingTide` and `describeSighting` while the
sighting-to-tide join itself stayed in `core/sightings.ts`. A sighting annotated
with the tide it was recorded at is a fact; the sentence shown about it is this
page's choice.

## The split between `policy.ts` and `states.ts`

`states.ts` says which verdicts exist and what a reader sees for each.
`policy.ts` says how a day arrives at one. The dependency runs one way — policy
imports states — and nothing in `states.ts` mentions `WindowResult`, so #130 can
lift the shared gate states into `core/window/states.ts` without first
untangling a cycle.

Only `above-floor` is genuinely tidepool's: it is what this activity's height
predicate emits. The other six — `closed`, `dark`, `veto`, `brief`, `swell-tbd`,
`go` — are gate states any activity would need, which is what makes them the
extraction target rather than the thing to keep.

## What is not here

**The floor.** It is not a tidepool parameter: it is the tide height at which
that reef surfaces — the same number for a photographer, a MARINe surveyor and a
child with a bucket — and it is a measured zone fact belonging to the
intertidal. It lives in `shared/intertidal.json` and is read through
`core/zones/intertidal.ts`, which is also where the eight-spot scope of this
grid comes from. What this activity owns is the comparison, not the number. ADR
0002 explains why it sat in `shared/spots.json` until #124 against that file's
own rule.

The swell ceiling is in `core/thresholds.ts` today, which is the pre-split
resting place rather than a claim. #128 decides that per-activity ceilings live
in `activities/<name>/thresholds.json` and moves it.
