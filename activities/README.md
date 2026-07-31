# activities

A reason to go, and the unit that owns **judgement**. An activity composes the
`core/` facts it needs plus its own thresholds into a verdict.

| | |
| --- | --- |
| `tidepool/` | The only one built. Reads the intertidal and the surf zone. |

`surf` is next — #129 — and it is second because it is the only candidate that
breaks the current solver: a tide *band* is crossed four times on a semidiurnal
day and straddles both a low and a high, which is two sessions rather than one
window anchored on a low. See ADR 0008.

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

## No activity may import another

`scripts/check-boundaries.mjs` declares a row per activity, and an entry permits
itself and everything beneath it — so `activities/tidepool` permits
`activities/tidepool` and not `activities/surf`. The check fails the moment a
cross-activity import is written, which matters most in #129, where surf is built
by **copying** tidepool's predicate on purpose. That duplication is the input to
the extraction in #130, not a defect to fix early.

The table there is the one statement of the import rules; this file does not
restate it.
