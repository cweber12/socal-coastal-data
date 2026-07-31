# Zone membership is three-way, and `audiences` is deleted

Whether a spot has a zone is stated in three buckets in that zone's file —
`members` with facts, `not_in_zone` with a reason, `unresolved` for present but
unmeasured — so no null carries two meanings. The `audiences` field in
`spots.json` is deleted.

## Why

The app currently tells readers that all eighteen floorless spots have an
unresolved tidepool floor:

> A null floor is unresolved, not zero, and a window cannot be computed without
> one.

Those eighteen include **Batiquitos Lagoon, San Elijo Lagoon, Oceanside Harbor
and Silver Strand**. Two lagoons and a harbor, reported as reefs nobody has
measured. It is the mirror of the rule this repo enforces everywhere else — a
null never renders as a pass, but here it renders as _unknown_ when the truth is
_no such zone exists here_.

That is not a display bug. There is no value of `tidepool_floor_ft` that
distinguishes "this spot has no rocky intertidal" from "this spot has one and
nobody has surveyed it", and both are things a reader needs told apart.

`audiences` is deleted rather than repurposed because it is a hand-populated tag
in the file whose own rule forbids them, and it has already silently duplicated
the data:

- `audiences: tidepool` and `tidepool_floor_ft != null` are the **same eight
  spots exactly**, with nothing checking it. `TIDEPOOL_SPOTS` filters on floor
  presence and ignores the tag.
- Its counts had drifted far enough that PRD #101's first draft, written from
  the file, got five of six wrong: bird is 9 not 7, dive 6 not 5, surf 18 not
  16, swim 15 not 14, tidepool 8 not 7.

Two membership axes have coexisted only because they happen to agree.

## Considered and rejected

**Rename `audiences` to `zones` and keep it on the spot.** One field renamed,
membership readable next to the coordinates. It stays hand-populated, it cannot
express present-but-unmeasured, and it can drift from the zone facts in exactly
the way it drifts today.

**Keep both axes with different jobs** — physical membership from the zone
files, `audiences` as an editorial UI filter. Honest that "who is this for" and
"what is physically here" differ, and the only option that keeps `bird` and
`sail`. Costs two membership concepts that must be kept from contradicting each
other, which is the failure already in evidence.

## Consequences

- `bird` and `sail` are activities nobody is building and are not zones. Their
  spots survive in `spots.json`; the tag content moves to `notes`, which is
  explicitly not parsed. If `swim` becomes a fifth activity, its membership
  comes from zone files like every other.
- `Audience` leaves the generated type union in `shared/spots.generated.ts`.
- The excluded-spots disclosure on the corridor page changes deliberately, and
  the committed screenshots are re-captured in the same PR.
