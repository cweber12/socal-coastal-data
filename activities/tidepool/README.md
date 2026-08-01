# activities/tidepool

Is there workable reef time at this spot on this day, and if not, why not.

| | |
| --- | --- |
| `policy.ts` | The floor predicate, the flood-side trim, and which low the day is about. Pure: no network, no ambient clock — `now` is passed in, so every state is reproducible from its inputs. |
| `states.ts` | The seven states, their order, and how `above-floor` is presented. The other six come from `core/window/states.ts`. |
| `verdicts.test.ts` | 336 spot-days captured from `main` before #130 and replayed field by field. Evidence, not source. |
| `grid.ts` | Composition. Feeds plus the predicate into what a page renders. `server-only`. |
| `labels.ts` | The sentences a reader and a screen reader get. |
| `routes.ts` | This activity's URL segment, and the paths built from it. |
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

**`routes.ts`** holds the segment `/tidepool`, which is this activity's identity
in a URL — the same word that names this directory and the key
`app/activities.ts` routes on. Written once here and imported by the registry,
the grid's sort links, the cells that link to a day, and the day page's arrows,
so a link cannot point at another activity's verdicts by a typo. Which activities
are *routed* is `app/`'s to say, and it says it by importing this. ADR 0013.

**`labels.ts`** holds `formatSightingTide` and `describeSighting` while the
sighting-to-tide join itself stayed in `core/sightings.ts`. A sighting annotated
with the tide it was recorded at is a fact; the sentence shown about it is this
page's choice.

## The split between `policy.ts` and `states.ts`

`states.ts` says which verdicts exist and what a reader sees for each.
`policy.ts` says how a day arrives at one. The dependency runs one way — policy
imports states — and nothing in `states.ts` mentions `WindowResult`, which is
what let #130 lift the shared gate states into `core/window/states.ts` without
first untangling a cycle.

Only `above-floor` is genuinely tidepool's: it is what this activity's height
predicate emits. The other six — `closed`, `dark`, `veto`, `brief`, `swell-tbd`,
`go` — are gate states any activity would need, and they now come from
`core/window/states.ts` with this file declaring which of them it can reach and
in what order.

The seventh gate state, `flat`, is **not** reachable here and is deliberately
absent. It needs a swell minimum, and tidepool declares none: swell is a hazard
on a reef, not something to ride. ADR 0016.

## What `above-floor` is, since #130

The **absence** of a window, not a zero-length one at the low's own instant. The
placeholder had to be excluded by hand from the "is there still a window open"
selection, because a window that starts and ends at the same moment trivially
ends after now. `detail.window === null` is the state.

`detail` is also where `lowFt`, `nextHighMs`, `reachesFloor` and `floorFt` went.
They used to sit on the shared result type, where they asserted that every
activity is anchored on a low and judged against a floor — which is false of the
second occupant. ADR 0015.

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
