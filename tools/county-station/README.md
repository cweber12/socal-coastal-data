# tools/county-station

Re-runs the `county_station` join and diffs it against `shared/spots.json`.

```bash
python tools/county-station/rejoin.py            # exit 1 if any match moved
python tools/county-station/rejoin.py --verbose  # every spot, matched or not
```

Standard library only. Reaches data.ca.gov, so it is run deliberately rather
than in CI — same standing as `tools/verify-apis/`.

## Why this exists

`county_station` is an **upstream join**, and this repo's rule for one is that a
wrong value is fixed by fixing the join and re-running it, never by editing the
file. That rule was unsatisfiable until #125: the join had been run once, by
hand, and the record of *which spots it covered* was a sentence in
`spots.json`'s `_schema` — "ONLY for spots tagged swim, surf, dive or tidepool"
— pointing at an `audiences` field that #125 deleted.

The scope is `county_station_scope` on each spot now, and this script reads it.
That is the whole demonstration: a re-run that scopes itself from the file is
proof the record is sufficient. See
`docs/adr/0011-a-join-carries-its-own-scope.md`.

## What it pins, and what it merely reports

**Pinned — a mismatch stops the run with exit 2:** the CKAN resource id, the six
columns the join reads, the county and status strings it filters on, and the two
county-wide aggregate rows that must be dropped. A scrape that guesses at a
renamed column produces a plausible-looking wrong station, which is worse than
no answer.

**Reported, never fatal:** the record counts. Stations open and close, so 287 San
Diego rows becoming 289 is the upstream working, not drift.

**Fatal — exit 1:** the join answering differently for any in-scope spot. That
may be legitimate (a closer station opened) or a bug in the re-run, and both
need a human, so it exits non-zero with both sides printed.

## The station code is `Station_Name`, not the obvious column

`AgencyStationIdentifier` looks like the station code and holds it for 98 of the
123 Active San Diego rows. On the other 25 it is **null** and the code is in
`Station_Name` — including `FM-090` and `IB-069`, which `spots.json` binds to
Black's Beach and Silver Strand. Reading the obvious column would have dropped
both from the pool and silently matched those two spots to a station further
away. Where both columns are populated they agree on every row, and the script
asserts that rather than assuming it.

## What a clean run looks like

As of 2026-08-01, against the live resource:

```
1041 rows, 287 in San Diego, 123 Active, 2 county-wide aggregates dropped
station pool: 121
scope: 23 in, 3 out, of 26 spots
all 23 in-scope matches reproduce (station code and distance within 5 m)
```

The three out-of-scope spots are printed with the station the join *would* have
bound them to — Batiquitos to EH-440 at 236 m, San Elijo to SE-010 at 927 m,
Border Field to IB-010 at 340 m. That is deliberate: it is what shows the scope
is load-bearing rather than decorative. All three would have got a plausible
station, and none of them is a place anyone enters the water.
