# Surf is the second activity, and it is routed

Surf is built second — by copying tidepool's predicate and editing it, before
any shared solver is extracted — and it is routed to readers with hard
disclosure rather than held back until something is calibrated.

## Why

The extraction is only evidence-based if the second occupant actually breaks the
current shape. Today's solver anchors on lows inside the local day and walks a
one-sided excursion while `ft < floorFt`, returning exactly one window.

| activity | anchor | predicate | breaks it? |
| --- | --- | --- | --- |
| tidepool | low | `h < floor` | it _is_ the current solver |
| **surf** | **low and high** | **`1.5 < h < 3.5`** | **yes — band, N windows, both anchors** |
| dive | high | `h > entry` | no — a sign flip on the same one-sided walk |

A band on a semidiurnal day is crossed four times and straddles both a low and a
high, so surf alone exercises both anchor kinds and the N-interval return.
Extracting `solve(series, anchor, holds)` from tidepool plus dive would
generalise from two shapes that are really one — the guess the copy-then-extract
sequence exists to prevent.

Wind, period and direction were the stated reason to defer surf. They turn out
to be `WSPD`, `WDIR`, `DPD`/`APD` and `MWD` in a payload `lib/ndbc.ts` already
downloads and parses, so the cost that justified the deferral was not real.

## Routed, not hidden

Surf is a weaker _product_ than it is a _test_, and the honest response is
disclosure rather than delay:

- every ceiling is uncalibrated — all eighteen spots use the 3.0 ft default, and
  the two `thresholds.json` overrides are both `uncalibrated`;
- `SWELL_HORIZON_DAYS = 5` leaves the last two of seven columns permanently
  `tbd`, which is the honest answer and is meant to be visible;
- significant wave height at a buoy is not breaking height at the break, and no
  shoaling or refraction transform is applied.

A slice built but not routed is how a slice rots, and it would leave the two
`thresholds.json` overrides doing nothing after that file recorded they "become
live the moment a surf predicate exists".

## Consequences

- Dive lands after the extraction, against a shape proven twice, and becomes the
  first real test of zone composition rather than of the solver.
- The surf zone has no measured zone fact — no equivalent of the intertidal
  floor with an instrument path to `verified`. Whether it should is open.
