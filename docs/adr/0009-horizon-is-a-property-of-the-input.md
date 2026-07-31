# Forecast horizon is a property of the input, not the activity

Each upstream product declares its forward validity in `shared/sources.json`.
The grid stays seven columns for every activity, and a cell reads `tbd` when an
input that activity requires has expired — with the disclosure naming which one.

## Why

The two existing constants are different kinds of thing, and reading them as one
is what produced the question "is `HORIZON_DAYS` per-activity?".
`HORIZON_DAYS = 7` is a grid width. `SWELL_HORIZON_DAYS = 5` is how long an
input stays valid, and `lib/windows.ts` is explicit that it is a proxy-decay
judgement rather than a data limit: the stack has no swell forecast, only a live
buoy reading, and using it as a proxy is "defensible for a few days and
indefensible beyond that".

Forward validity belongs to the feed:

| input | forward validity |
| --- | --- |
| CO-OPS predictions | months — astronomical |
| daylight | unbounded — computed |
| NDBC realtime2 | ~5 days as a decaying proxy, 0 as a forecast |
| county water quality | **negative** — a sample describes the past |

Read that way the question dissolves. Tidepool and surf go `tbd` on the same
column not because they are similar activities but because they share an input.

Water quality is the case this framing exists for. It is not a shorter horizon
but a different sign, and no per-activity `HORIZON_DAYS` can express it — which
makes the `beach` zone's constraint visible now rather than discovered when
someone tries to build it.

## Considered and rejected

**`HORIZON_DAYS` per activity** — tidepool 7, surf 5, beach 1. Every cell a
reader sees would carry a real verdict. It hides that surf and tidepool go dark
on the same day for the same reason, and it trades away visible honesty the
current design chose deliberately.

**Keep both constants global** and defer until a third activity disagrees. Zero
work now, and it fails on the retrospective case above.

## Consequences

- A `tbd` cell names the expired input — "swell unknown beyond day 4" — rather
  than rendering a bare unknown.
- The repo-wide invariant is unaffected: an unknown never renders as a pass, so
  `tbd` still sorts above `go`.
