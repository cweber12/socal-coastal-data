# core

Activity-neutral facts. What is physically true, what an upstream actually said,
and what is true of a whole spot — never whether any of it is *good*.

| | |
| --- | --- |
| `time.ts` | Local dates and day bounds in a named zone. No ambient clock: callers pass `now`. |
| `format.ts` | Rendering a measured value at the precision it actually carries. |
| `feeds/` | One parser per upstream **product**. See its README. |
| `upstream.ts` | Fetch, cache and failure policy. `server-only`. |
| `spot/` | Facts true of a whole spot regardless of cross-shore band. See its README. |
| `zones/` | Facts true of one cross-shore band. One module per zone; the intertidal is the only one with facts today. See its README. |
| `window/` | The window engine: the N-interval solver, the gates, and the states they emit. Shared by every activity; owned by none. See its README. |

## What belongs here, and what belongs next door

Belongs here: anything that answers *what is true*, identically for every reason
a person might be there. The tide height at 14:20, sunset, whether the park gate
is shut, what the buoy reported.

Belongs next door:

- **A judgement** — a floor, a ceiling, a minimum useful duration, a verdict —
  belongs to an activity. `core/` may not decide whether conditions are good,
  because "good" differs between a tidepooler and a diver reading the identical
  numbers.
- **Composition** — assembling feeds and a predicate into what a page renders —
  belongs to the composition root.
- **A measured zone fact** — the tide height at which a reef surfaces — is a
  fact, but a fact about one cross-shore band, so it goes to `core/zones/` and
  not to the root of this directory.
- **A height predicate, a selection rule, or a verdict's sentence** — `window/`
  runs the machinery an activity's judgement is expressed through, and holds
  none of the judgement. ADR 0015 records where the line fell when the engine was
  extracted from two occupants.

`scripts/check-boundaries.mjs` is the one statement of the import rules; this
file does not restate it.

## Why `feeds/` and `spot/` are separate

A feed can rot: the endpoint changes its header, its units, its timezone label,
or it starts serving 200s over an empty array. Everything in `feeds/` is written
against that. A spot fact cannot — sunset is computed offline from a solar
algorithm, and gate hours come from an operator's published rule. Filing them
together put the one thing in this repo that *cannot* go stale under the same
header comment as the discipline for the things that do.
