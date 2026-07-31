# 0010 — Activity composition belongs to the activity, not to the composition root

## Status

Accepted, 2026-07-31, in #123.

## Context

`lib/grid.ts` — 733 lines — composes the feeds, the upstream failure policy and
the window predicate into what a page renders. PRD #101's target layout does not
mention it. The layout names `app/` as "composition root; the ONLY layer that may
import every slice", and names `activities/<activity>/` as holding `policy.ts`,
`states.ts`, `labels.ts`, `thresholds.json` and `components/`. Composition
appears in neither list.

It could not stay where it was. Decision 8 forbids `core -> activities`, and this
module imports the window predicate, so filing it under `core/` would have failed
`scripts/check-boundaries.mjs` in the same commit that created the rule.

## Decision

`lib/grid.ts` becomes `activities/tidepool/grid.ts`.

Everything it imports is `core/` or tidepool's own, so it satisfies
`activities -> core, shared, self` with no concession and no temporary edge.

## Alternatives considered

**Move it to `app/`.** This is the reading #101's layout invites: composition is
the composition root's job. Rejected because it conflates two different kinds of
composition. `app/` composes **across** activities — that is what makes it the
only layer allowed to import every slice, and it is exactly what the spot page in
#133 does when it renders facts once and stacks two activities' verdicts on top.
`grid.ts` composes **within** one activity: every branch in it is about tidepool's
floor, tidepool's swell ceiling, tidepool's window states. Putting
single-activity composition in the cross-activity layer would mean the second
activity either adds a parallel file beside it or starts editing the same one,
and neither is what `app/` is for.

**Give `core/` a composer that takes a policy as an argument and never names an
activity.** This is the eventual shape and it is deliberately not built here.
There is one activity. A general composer extracted from one occupant is a guess
about what the second one needs, which is precisely the mistake decision 15
already refuses for the solver: surf is the second activity *because* it breaks
the current shape, and extracting before it exists would generalise from a sample
of one. #129 builds surf's composition by copying this one, and #130 extracts
what the two actually share. That sequence produces evidence; this one would
produce a parameter list.

## Consequences

`activities/tidepool/grid.ts` is server-only and is imported by the three route
files. The routes remain the only thing in `app/`.

When surf lands, there will briefly be two grid composers, and that duplication
is intended — it is the input to the extraction, not a defect to fix early.

Two small extractions were forced by the boundary rule and are worth recording,
because both look like tidiness and are not:

- `Notice` moved to `core/notice.ts`. `core/components/disclosure.tsx` renders
  notices and nothing else, so it is a shell with no activity in it — but it took
  the type from the composer. Four lines with no activity in them were holding a
  whole component on the wrong side of the line.
- `core/sightings.ts` kept the sighting-to-tide join, while `formatSightingTide`
  and `describeSighting` went to `activities/tidepool/labels.ts` with their tests.
  A sighting annotated with the tide it was recorded at is a fact; the sentence a
  reader is shown about it is a presentation choice belonging to the activity
  whose page shows it.
