# A published value is a join result; an inferred one is a judgement

What governs who may write a field is **not whose fingers are on the keyboard**.
It is whether the value is *published* by an upstream or *inferred* from one,
crossed with whether the write is *attended*.

`status` is inferred from absence, so it is a judgement: automation reports it
and a human commits it, which is [ADR 0007](0007-polling-is-weekly-and-transition-triggered.md)
unchanged. `dead_since` is published by CDIP with a retrieval path, so it is a
join result in everything but name: it is transcribed rather than decided, it is
re-derivable, and **hand-typing it is the violation** rather than the safeguard.

## Why

**Adjacency is not a provenance class.** The rule was extended from `status` to
`dead_since` because the two sit in the same object, three lines apart —
"this is that field's neighbour", in
<https://github.com/cweber12/socal-coastal-data/issues/179>. Two fields in one
object can have opposite provenance, and these do. `spots.json` already holds
the proof next door: `county_station_scope` is written by hand in a file whose
rule forbids hand-populated values, because it is the join's *input*, while
`county_station` beside it must never be. Provenance is a property of where a
value came from, not of what it is stored next to.

**Absence is ambiguous; publication is not.** `status: dead` is read off a 404 or
an empty payload, and this whole repo exists because a 200 carrying nothing is a
dead source that looks like a passing one. That inference is a judgement with
consequences — six spots carry `wave.intended_primary: "46235"` against exactly
this call. `dead_since` is not inferred from anything: CDIP states
`time_coverage_end` as a global attribute of `155p1_d14.nc`, and the only work
between the publisher and the file is transcription.

**For published values this repo's rule runs the other way.** CLAUDE.md: *"Do
not hand-populate resolved fields… Legally load-bearing values are never typed
in by hand."* So a human typing `2026-05-03` from memory is the failure mode
actually on the books, and a transcription carrying its retrieval path is the
compliant move. The blanket reading forbids the compliant move and licenses the
forbidden one.

**Attended is the second axis, and it is the one ADR 0007 is really about.** Its
subject is the unattended weekly workflow, which commits neither kind — it opens
an issue and a human decides. Work done under direction, landing in a PR someone
reads, is attended: the review is where judgement enters, and it is the thing
the scheduled job structurally cannot have.

## Where each value falls

| value | provenance | who may commit it |
| --- | --- | --- |
| `status` | inferred from absence | a human, citing the issue. Never the scheduled workflow. |
| `dead_since` | published by the upstream | anything that transcribes it with its retrieval path, under review — and a tool re-derives it |
| `mpa`, `county_station` | join result | the join. Never typed by hand. |
| `county_station_scope` | the join's input | a human, by hand. No authority can state which spots this repo chose to ask about. |

## Considered and rejected

**Nothing automated writes anything adjacent to a status.** The reading
<https://github.com/cweber12/socal-coastal-data/issues/179> took, and it sounds
like the safer of the two. Rejected because it is safe in the wrong direction:
it leaves a published date hand-typed from recall, which is the error class this
repo has the most machinery pointed at, and it gives the value no re-run path at
all.

**Restructure `dead_since` into an object so nothing has to parse prose.** It
would make the re-derivation a field comparison instead of a pinned regex.
Deferred, not dismissed: it is a schema change to a hand-formatted file plus a
generated-types change, for a field with one occupant, and pinned parsing that
fails loudly on drift is this repo's standing treatment of undocumented shapes.
Worth revisiting when a second buoy dies.

## Consequences

- `dead_since` gains a re-derivation in `tools/cdip-station/rejoin.py`, or this
  ADR asserts a provenance nobody can re-run — the exact gap
  <https://github.com/cweber12/socal-coastal-data/issues/177> §3 names for the
  eight hand-typed `cdip` ids.
- CLAUDE.md's hand-populate rule names `dead_since` alongside `county_station`
  and `mpa`, since it is now claimed to be that kind of value.
- ADR 0007 is neither superseded nor amended. Every sentence in it is about the
  unattended workflow and stays true.
- **Unresolved remains a legitimate state.** `"unknown; realtime2 404 as of
  2026-07-27"` was an honest answer while nobody had asked CDIP. The rule
  governs values claimed to be resolved; it does not oblige anyone to resolve
  one, and the re-derivation reports a non-parsing `dead_since` rather than
  failing on it.
- Undecided, and deliberately not settled here: whether `alive=` in
  `verify_coastal_apis.py` sits on this axis. It is inferred from delivery, which
  puts it on the judgement side, but it is never committed to a file — so the
  rule does not reach it today. It becomes a real question when
  <https://github.com/cweber12/socal-coastal-data/issues/105>'s registry gives a
  scheduled job something to write.
