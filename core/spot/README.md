# core/spot

Facts true of a **whole spot**, regardless of cross-shore band.

| | |
| --- | --- |
| `daylight.ts` | Sunrise, sunset and solar noon. NOAA's solar position algorithm, offline. |
| `access.ts` | Operator gate hours — one spot of 26 publishes any today. |

## What belongs here, and what belongs next door

A spot fact applies to every zone at once. A shut park gate keeps you out of the
intertidal, the surf zone and the subtidal simultaneously, so it is never a
zone's property. Darkness is the same. So is the marine protected area a spot
falls in — `protection.ts` will land here when there is logic to move; today MPA
handling lives entirely in the component that renders it, and inventing a module
to fill the slot would be worse than leaving it out.

Belongs next door:

- **A fact about one band** goes to `core/zones/` — the tide height at which a
  reef surfaces is true of the intertidal, not of the spot.
- **A judgement built on these facts** belongs to an activity. `dark` and
  `closed` are *states*, and states are the window predicate's, not this
  directory's. What lives here is the bound and the rule, not the verdict.

## Why daylight is here and not in the tide parser

It was in `core/feeds/coops-predictions.ts` until #122, which had it backwards
twice over. It is not a NOAA CO-OPS product — it shares a file with one only
because tides and daylight are read together. And it is the one input in this
stack with **no upstream at all**: computed offline, so it is the one thing that
cannot rot, sitting under a header comment about payload drift.

Its accuracy is checked against USNO rather than against whichever sun API
answered first — `daylight.ts`'s own header records why that choice mattered and
what the three candidate oracles disagreed about.
