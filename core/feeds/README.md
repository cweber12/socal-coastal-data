# core/feeds

One parser per upstream **product**, not per organisation.

| | |
| --- | --- |
| `coops-predictions.ts` | NOAA CO-OPS tide predictions — the request contract and the series parser. |
| `ndbc-realtime2.ts` | NDBC `realtime2`, the pinned 19-column header. |
| `inat-observations.ts` | iNaturalist observations, with licence and obscuration handling. |
| `__fixtures__/` | Captured payloads, byte-for-byte as the endpoint served them. Evidence, not source — `linguist-vendored`. |

## Why product and not organisation

NOAA CO-OPS serves predictions and observations as different payloads with
different fields. NDBC serves `realtime2` and the spectral files. A file named
for the organisation would carry two header contracts, two unit vocabularies and
two drift checks, and the first one to change would be reconciled against the
wrong set of assumptions. The drift discipline — header shape, column names, unit
strings, timezone label — is a property of the **product**, so the file is too.

## What belongs here, and what belongs next door

Belongs here: turning bytes from one upstream product into typed values, and
refusing loudly when the payload is not what was pinned. Every parser is offline
and pure; the fixtures are what it is tested against.

Belongs next door:

- **Fetching, caching and deciding what a failure means** is `core/upstream.ts`.
  A parser that knew about retries could not be tested against a committed file.
- **Anything with no upstream at all** is not a feed. `daylightBounds` lived in
  the CO-OPS parser until #122 and is now `core/spot/daylight.ts`; there is no
  sun API in this stack and there should not be.
- **A judgement about whether a reading is workable** belongs to an activity.

## The rule these files exist to enforce

Never assume a unit and never assume a timezone — read both from the payload or
the header, and fail rather than guess on an unrecognised string. A plausible
wrong number is worse than no number. Each file's header comment records what it
pins and what it has been measured against; that is the place for it, not here.
