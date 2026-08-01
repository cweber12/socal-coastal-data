# The surf zone is derived membership and no measured fact

`core/zones/surf.ts` states three-way membership **derived** from the wave
binding in `shared/spots.json`, holds **no measured zone fact**, and has **no
`shared/surf.json`** behind it.

A spot is a member when `wave.primary` or `wave.fallback` is non-null. That is
24 of 26; the two that are out are Batiquitos Lagoon and San Elijo Lagoon, both
carrying a deliberate null in both slots.

## Why

### The 18-spot surf set no longer exists, and reviving it would undo #125

Issue #129 asks for `/surf` to render "the spots that are surf-zone members".
Nothing defined that. The set lived in `spots.json`'s `audiences` tag, which #125
deleted **because** it was a hand-populated membership axis nothing checked —
`audiences: tidepool` and a non-null floor were the same 8 spots "with nothing
checking it", agreeing "only by luck". ADR 0008's "all eighteen spots" counts a
field that was removed two commits before #129 was written.

Recreating those 18 in a new `shared/surf.json` would rebuild the deleted axis
under a new name, and this time it would drive a rendered verdict rather than a
column filter.

It would also be wrong on its own terms. The tag excluded **Torrey Pines State
Beach, La Jolla Shores and Silver Strand** — open coast, each bound to a buoy. It
was answering *"would a surfer pick this?"*, which is an activity's judgement,
not *"does this spot have a surf zone?"*, which is a zone's fact. ADR 0001 draws
exactly that line.

### The binding is the only machine-readable surf fact this repo holds

`wave.primary` names the buoy whose WVHT is used for a spot. It is a real
statement about the coast — this stack can read a wave height here — and it is
resolved rather than authored. Every other candidate was a judgement:

| candidate | why not |
| --- | --- |
| the deleted `audiences: surf` set | hand-populated, unchecked, and an activity's question |
| a new hand-authored three-way file | 26 authored judgements with no upstream behind any of them |
| "is it a surf break" | the actual question, and nothing in this stack answers it |

Derived membership cannot drift out of step with the file it comes from, which
is the specific failure #125 was written up for.

### Three buckets, even though one is empty

`unresolved` is 0 and stays declared, per ADR 0003. An absent binding is a stated
absence, not an unmeasured one — nobody is going to survey the surf in a lagoon —
so both exclusions are `not_in_zone`. Keeping the third bucket costs a line and
means a future spot whose exposure is genuinely unknown has somewhere to go that
is not silently "member".

### No measured zone fact, which answers PRD #101's open question 2

> Does the surf zone get a measured zone fact, or only thresholds? … If the surf
> zone carries only author thresholds and no measured facts, decision 1's
> symmetry is weaker than it reads.

It carries none, and the symmetry **is** weaker. ADR 0008 said as much in its
consequences. The intertidal floor is provenance class 3 — produced by this
repo's instruments, carried by an append-only ledger, with a promotion rule to
`verified`. Nothing in the surf zone has an equivalent, and inventing a
class-3-shaped field with no instrument behind it would be worse than recording
the asymmetry.

So the split is clean rather than symmetric: the zone holds membership,
`activities/surf/thresholds.json` holds every number, and all of them are class 2
author estimates. #135 is the path off that.

## What this costs, and where it is disclosed

Membership means "a buoy reports waves here", so **Oceanside Harbor is a member
and is a harbor mouth**. That gap is real and it is not hidden:

- `SURF_ZONE_UNRESOLVED` states it first, and `app/unresolved-sources.ts` renders
  it on every page carrying a surf verdict;
- `/surf` opens with it, uncollapsed, above the grid — the one disclosure on that
  page not behind a summary, because it is not a caveat about precision but a
  statement about what the grid is a grid *of*.

## Rejected

**`shared/surf.json` with a hand-authored bucket and reason per spot.** Most
faithful to `shared/intertidal.json`'s shape. Rejected because that file's
membership is backed by measurements and this one's would be backed by nothing,
and because 26 authored judgements is the thing #125 removed.

**Restoring the deleted 18 from git.** Matches ADR 0008's count literally.
Rejected above.

**Deferring `/surf` until membership had an upstream.** There is no upstream that
enumerates surf breaks in this corridor, so this is deferral without a condition
— and ADR 0008 already decided surf ships routed with hard disclosure rather than
held back.

## Consequences

- `core/zones/surf.ts` imports `shared/spots.generated` and nothing else. The
  sibling-zone rule in `scripts/check-boundaries.mjs` keeps it from reading the
  intertidal, which is the boundary that comment was written for.
- The surf grid is 24 rows against tidepool's 8, and everything paid per row —
  the flight payload of `SpotRow`'s `detail`, the swell fetches — costs three
  times as much. `SpotDisclosure` is correspondingly smaller.
- The two zones **overlap without either containing the other**: 8 spots are in
  both, 16 in surf alone, 0 in the intertidal alone. So `/[activity]/[slug]/…`
  must resolve a slug through the activity the URL names.
  `/surf/oceanside-pier/…` renders and `/tidepool/oceanside-pier/…` is a 404.
- If an upstream that enumerates breaks ever appears, this becomes a join and the
  derivation is replaced rather than edited — the same way a wrong
  `county_station` is fixed by re-running the join.
