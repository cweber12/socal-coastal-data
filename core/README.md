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
  fact, but a fact about one cross-shore band. It belongs to `core/zones/`, which
  does not exist yet; #124 creates it with the intertidal.

`core/` may not import `lib/`. Today `lib/` still holds the window predicate and
the grid, and they import `core/` — a temporary edge declared in
`scripts/check-boundaries.mjs` and removed by #123. The table there is the one
statement of the import rules; this file does not restate it.

## Why `feeds/` and `spot/` are separate

A feed can rot: the endpoint changes its header, its units, its timezone label,
or it starts serving 200s over an empty array. Everything in `feeds/` is written
against that. A spot fact cannot — sunset is computed offline from a solar
algorithm, and gate hours come from an operator's published rule. Filing them
together put the one thing in this repo that *cannot* go stale under the same
header comment as the discipline for the things that do.
