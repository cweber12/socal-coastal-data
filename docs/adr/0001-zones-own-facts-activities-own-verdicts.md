# Zones own facts, activities own verdicts

The stack is growing from one activity to four, and the obvious slice — one
vertical slice per activity — is wrong, because activities do not partition the
domain. **A zone** (a cross-shore band: `beach`, `intertidal`, `surf`,
`subtidal`) owns activity-neutral facts and answers "what is physically true
here". **An activity** owns judgement: it composes the zones it needs plus its
own thresholds into a verdict. Zones are core data modules; activities are the
directory slice.

## Why

Tidepool is not "the intertidal activity", and the code already says so. The
seven states in `lib/windows.ts` read three different bands plus two facts that
belong to no band at all:

| state | fact |
| --- | --- |
| `above-floor` | intertidal — tide vs floor |
| `veto` | surf zone — NDBC significant wave height |
| `closed` | spot — Cabrillo gate hours |
| `dark` | spot — daylight bounds |

A shore dive is worse: surf-zone entry, subtidal visibility, beach access, and
tide across all of it. Any layout that nests an activity inside "its" zone has
nowhere to put the dive.

The import arrow follows from that. Activities compose zones, so activities
import zones and never the reverse.

```
core        -> core, shared
core/zones  -> core, shared          a zone may not import another zone
core/spot   -> core, shared          may not import a zone
activities  -> core, shared, self    may not import another activity
app         -> anything
shared      -> nothing
```

`core/spot/` exists because daylight, operator gate hours and MPA designation
are true of a whole spot regardless of band. Folding them into `beach` — the
zone that plausibly owns "the way in" — would force a subtidal dive verdict to
import the beach to discover the park gate is shut.

## Considered and rejected

**Zones emit their own verdicts, with no activity concept.** Attractive because
it claims less, which suits a stack where nothing is calibrated. It fails on the
surf zone: at 2 ft the same reading is good for a longboarder, flat for a
shortboarder and rough for a swimmer. The intertidal has an activity-neutral
binary — exposed or not — and the surf zone has no equivalent.

**Zones as the top-level slice, composed in `app/`.** Puts verdict logic (which
gates apply, state precedence, threshold ordering) in the composition root: the
one layer with no import restrictions and the hardest to test.

## Consequences

- The four zones are **functional, not a partition**. They overlap, and they are
  not all defined by the same kind of criterion — intertidal and subtidal are
  set by water level, surf by what happens there. A sandy foreshore is both
  beach and intertidal. Nothing may assume a spot's zones tile its profile.
- The spot page states facts once and layers verdicts on top, rather than
  rendering a self-contained panel per activity. A panel per activity would draw
  the same tide curve, buoy reading and MPA notice two or three times, and hide
  that two verdicts disagree because of thresholds rather than data.
- `daylightBounds` leaves `lib/tide.ts`, where a solar-position calculation with
  no upstream had ended up inside a NOAA payload parser.
