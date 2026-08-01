# Measured zone facts are a third provenance class

`tidepool_floor_ft` is neither resolved by an upstream join nor typed in as an
author's guess: it is produced by this repo's own instruments and carried by an
append-only evidence ledger. That is a third provenance class, it has never been
named, and it gets its own files — `shared/intertidal.json` first, one per zone
as they arrive.

## Why

The repo names two classes and silently runs three.

| class | example | rule |
| --- | --- | --- |
| Upstream join | `county_station`, `mpa` | never hand-populated; fix the join and re-run |
| Author estimate <sup>†</sup> | swell ceiling, `MIN_WINDOW_MINUTES` | a starting state, superseded through an evidence ledger |
| **Measured zone fact** | `tidepool_floor_ft` | **this repo's own instruments, with an evidence ledger** |

<sup>†</sup> **Amended by [0012](0012-threshold-is-a-role-and-author-estimate-is-a-provenance-class.md).** This class was named *author threshold* when this ADR was written, and its only stated exit was someone going there to check. 0012 renamed it and gave it a real one. This ADR's own decision — that measured zone facts are a third class with its own files — is unchanged, which is why it is amended here rather than superseded.

The missing category is why the file layout has been quietly incoherent.
`spots.json` says it holds values "resolved by join against an upstream
authority" and warns against hand-populating them — and carries the floor
anyway. `thresholds.json` had to write a `_provenance` paragraph explaining why
_it_ is not in `spots.json`. Both files were working around a class with no
home.

The floor's own schema is the proof it is class 3 and not class 2: promotion to
`verified` takes two entries from different methods agreeing within 0.3 ft, at
least one of them instrumented — lidar hypsometry, a pressure logger, or MARINe
transect topography. Author estimates are the _starting_ state of a measurement
programme, not a threshold someone chose.

A zone fact is also not an activity parameter. The floor is the tide height at
which that reef surfaces: the same number for a photographer, a MARINe surveyor
and a child with a bucket. See [0001](0001-zones-own-facts-activities-own-verdicts.md).

## Considered and rejected

**Move the floor under `activities/tidepool/data/`**, as the first draft of PRD
#101 proposed. It asserts the floor is a tidepool parameter, which it is not,
and it drags a file two Python probes read out of `shared/` and into a
TypeScript slice, across the language boundary.

**Leave it in `spots.json` and amend that file's rule** to admit class 3. Zero
migration risk, but the file keeps mixing never-hand-populate fields with a
human-set one, and the next class-3 value re-opens the same argument.

## Consequences

- `spots.json` becomes bindings and joins only, which is what its schema has
  always claimed.
- `lidar-recon/probes/osm_reef.py` and `rate_centring.py` scope themselves with
  `s.get("tidepool_floor_ft") is not None`. `.get()` returns `None` for a key
  that no longer exists, so moving the field silently reduces both probes to
  zero spots — a measured absence, which `osm_reef.py`'s own comment forbids.
  Both change to `[]` in the same PR that moves the field, so a future move
  raises `KeyError` instead of measuring nothing.
- `git log --follow` was never going to carry the `floor_evidence` history: this
  is a field extraction from a file that stays, not a rename. `git log
  -S'floor_evidence' -- shared/` works across both files and is the trail.
