# SoCal Coastal Data

Conditions for the San Diego coastal corridor, Oceanside Harbor down to Border
Field. This file is a glossary and nothing else — no thresholds, no file paths,
no implementation. When a word here conflicts with a word in the code, the code
is wrong.

## Places

**Spot**:
A place a person goes. 26 of them, keyed by an append-only `slug` that is never
reused or changed.
_Avoid_: site, location, beach, break

**Station**:
An upstream monitored point that publishes readings — a NOAA tide station, an
NDBC buoy, a county water-quality station. A spot is bound to stations; it is
never one.
_Avoid_: site, gauge, sensor

**Corridor**:
The stretch of coast this stack covers, and the geographic order spots are
listed in: north to south.

## Zones and activities

**Zone**:
A cross-shore band at a spot, and the unit that owns activity-neutral facts. The
four are **beach**, **intertidal**, **surf** and **subtidal**. A zone answers
"what is physically true here", never "is it good".
_Avoid_: area, region, section

These four are **functional, not a partition**. They overlap, and they are not
all defined by the same kind of criterion: intertidal and subtidal are set by
water level, surf by what happens there. A sandy foreshore is both beach and
intertidal. The surf zone is subtidal water, and its position moves with the
tide and the swell while the intertidal's does not. Nothing may assume a spot's
zones tile its profile, or that a fact belongs to exactly one zone.

**Beach**:
Dry sand and the way in — access, parking, hours, and the water quality of what
you would wade into.

**Intertidal**:
Exposed and re-covered by the tide. Where a reef surfaces.

**Surf**:
Where waves break.

**Subtidal**:
Never exposed by the tide — what a diver means by "past the break". Named for
the water level, matching the intertidal it pairs with and the language MARINe
and the MPA regulations use.
_Avoid_: nearshore, outside, offshore, past the break

**Activity**:
A reason to go, and the unit that owns judgement. An activity composes the zones
it needs plus its own thresholds into a verdict. Tidepooling reads the
intertidal and the surf zone; a shore dive reads the surf zone and the
nearshore. No activity owns a zone.
_Avoid_: audience, use, sport

**Zone fact**:
Something physically true of one zone at one spot, independent of why anyone is
there — the tide height at which a reef surfaces, whether a break exists. Same
value for a photographer, a surveyor and a child with a bucket.

**Spot fact**:
Something true of a whole spot regardless of band — daylight, the operator's
gate hours, the marine protected area it falls in. A shut park gate keeps you
out of every zone at once, so a spot fact is never a zone's property.

**Membership**:
Whether a spot has a zone at all, stated three ways and never as a bare null: a
**member** with facts, **not in zone** with a reason, or **unresolved** —
present but unmeasured. A lagoon is not in the surf zone; that is a different
fact from a reef nobody has measured.

## Verdicts

**Window**:
A contiguous span of time on one day when an activity's conditions hold at a
spot. A day may have several, or none.

**Gate**:
A constraint that can close a window regardless of how good conditions are —
daylight, an operator's gate hours, a duration minimum, an unknown required
input. Gates are shared across activities and own their own states.

**Floor**:
A tide height a reading must fall _below_ for a zone to be usable. The
intertidal's floor is the level at which enough reef is out of the water to be
worth the trip — workable, not optimal.

**Ceiling**:
A reading above which an activity is called off regardless of everything else.

**State**:
The single verdict for one spot, one activity, one day. An unknown input can
never render as a pass; uncertainty always sorts above `go`.

## Provenance

Three classes, and every number in this repo is exactly one of them. Mixing them
is the failure mode the whole stack is built against.

**Upstream join**:
Resolved by joining against an external authority — a water-quality station, an
MPA polygon. Never hand-populated. If it is wrong, the join is fixed and re-run.

**Author threshold**:
A judgement someone wrote down — a swell ceiling, a minimum useful window.
Uncalibrated until a person who goes there confirms it, and never presented as
measured.

**Measured zone fact**:
Produced by this repo's own instruments — lidar hypsometry, a pressure logger, a
MARINe transect — and carried by an append-only evidence ledger. Neither joined
from anyone nor guessed. A value is promoted to `verified` only by two entries
from different methods agreeing, at least one of them instrumented.
