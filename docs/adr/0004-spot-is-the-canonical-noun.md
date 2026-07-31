# `spot` is the canonical noun for a place a person goes

`spots.json`, `Spot`, `SPOTS`, `spot.slug` stay. `site` is rejected as a rename
target, and `station` is reserved for an upstream monitored point.

## Why

This is recorded because `site` reads more neutral than surf slang and will be
proposed again.

**`site` is already taken, inside this repo, in the file CLAUDE.md holds up as
the reference for upstream discipline.** `verify_coastal_apis.py` uses `site` as
a parameter name in two places — for NWS product locations and for USGS gauge
numbers — and CLAUDE.md uses it the same way: "11013500 is the _correct_ site".
NOAA and the county call theirs `station`. The corridor already has three nouns
for a monitored point and exactly one for a place a person goes.

**The cost is measured.** 1,906 occurrences of "spot" across 94 files —
TypeScript, Python, JSON and Markdown — most of them inside the dense comment
blocks that are this repo's actual documentation. Two Python probes read
`shared/spots.json` by path. `.gitattributes` pins fixture paths by name.

**The felt problem is real but smaller than the rename.** "Spot" is surf slang,
and the corridor now includes two lagoons and a harbor where it reads oddly.
That is display copy — roughly ten strings — not a key namespace.

## Consequences

- `slug` values are untouched under any reading of this. The schema pins them as
  an append-only primary key: never changed after first write, because data
  accumulates against them.
- `CONTEXT.md` lists `site` under `_Avoid_` for both `spot` and `station`, so
  the ambiguity is stated rather than discovered.
