# tools/mpa

Re-runs the `mpa` point-in-polygon join against CDFW ds582 and diffs it against
`shared/spots.json`.

```bash
python tools/mpa/rejoin.py            # exit 1 if any binding moved or the layer was re-issued
python tools/mpa/rejoin.py --verbose  # every spot and every corridor area
```

Standard library only. Reaches `services2.arcgis.com`, so it is run deliberately
rather than in CI — same standing as `tools/county-station/` and
`tools/verify-apis/`.

## Why this exists

`mpa` is an **upstream join**, and this repo's rule for one is that a wrong value
is fixed by fixing the join and re-running it, never by editing the file. That
rule was unsatisfiable until #165: the join had been run once and no record of
*how* survived it. `grep -r ds582` returned four sentences of prose and **not one
URL**, so nobody who had not run it could run it again.

The layer, now pinned in `shared/spots.json` under `joins.mpa`:

```
https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds582_fpu/FeatureServer/0
```

## What it pins, and what it merely reports

**Pinned — a mismatch stops the run with exit 2:** the service URL, the four
attributes the join reads (`NAME`, `Type`, `CCR`, `CCR_Int`), the corridor
envelope, and the set of `Type` values the layer publishes for this corridor. A
join that guesses at a renamed attribute produces a plausible-looking wrong
designation for a field `spots.json` calls legally load-bearing.

**Reported, never fatal:** the corridor feature count and the per-area table.
CDFW may add or retire an area, and that is the upstream doing its job.

**Exit 1, because a human has to decide:** any spot whose binding moved, and any
drift in the layer's own vintage. The second is not cosmetic — `lastEditDate`
moving means the polygons served today are not the ones this repo resolved
against, whether or not any of these 26 coordinates noticed.

## Two dates, and neither one is "the pull date"

The layer description states its data are California's MPAs **"as January 1,
2019."** `editingInfo.lastEditDate` is **2024-01-09.** Content date and service
edit date are five years apart, so recording one and calling it the layer's age
misrepresents it in whichever direction you picked. Both are committed and both
are checked.

The consequence is worth stating rather than leaving for a reader to notice: a
2023–26 petition proposing boundary changes at Swami's **could not** be reflected
in a 2019 snapshot. The join is not wrong; it is a dated snapshot that did not
say so before 3.1.0.

## The type is an attribute, and it is deliberately not parsed from the name

Every corridor area's `NAME` ends in its designation — "Cabrillo SMR", "Swami's
SMCA". Reading the type off the name would work today and is exactly the rule
this repo forbids: `Type` is what the authority publishes, and deriving it by
string-matching a display name is hand-populating a join result in a different
costume.

`CCR` and `CCR_Int` carry the same subsection in two forms, and the script
asserts they agree rather than assuming it — the same check
`tools/county-station/rejoin.py` runs on `Station_Name` against
`AgencyStationIdentifier`.

## Why the envelope reaches past the northernmost MPA

`ENVELOPE` spans the whole corridor including every spot, not just the areas.
Batiquitos (137) is the northernmost MPA at 33.09 and the envelope runs to 33.30,
covering the Oceanside stretch as well. It still returns exactly 11 areas — which
is what *"there is no MPA between the Oceanside city line and Batiquitos Lagoon"*
looks like when it is measured rather than quoted.

Two invariants follow, and both are asserted: every spot lies inside the
envelope, and every area a spot resolves into is one the envelope enumerated. The
first caught a real defect while this was being written — the envelope was
originally sized to the MPAs, and four Oceanside-area spots fell outside it.

## What a clean run looks like

As of 2026-08-01, against the live service:

```
11 MPAs in the corridor envelope, CCR 137-147
types published: SMCA, SMCA (No-Take), SMR
3 of 26 spots inside a polygon; 7 carry mpa_resolved false
all 26 bindings reproduce, and the layer's vintage is unchanged (2024-01-09, v12)
```

The three spots inside a polygon are `cardiff-reef` → Swami's SMCA (138),
`tourmaline` → South La Jolla SMR (143), and `cabrillo-tidepools` → Cabrillo SMR
(146). Two of the three carry `mpa_resolved: false` on the 150 m rule, so only
`tourmaline` renders as resolved.

**Three designations, not two.** The corridor holds 3 SMRs, 5 SMCAs and 3 SMCA
(No-Take). An `SMCA (No-Take)` prohibits take the way a reserve does while not
being one, so a renderer that splits only reserve-from-not, or only
take-from-no-take, is wrong either way. That set is emitted as the `MpaType`
union and this script is what keeps it honest.
