# A join carries its own scope, in the file, per spot

`county_station_scope` is a required field on every spot, `"in"` or `"out"`. It
records which spots the `county_station` join covers, it is an input to the join
rather than a result of it, and `tools/county-station/rejoin.py` reads it to
re-run the join and diff the answer.

## Why

`county_station` is an upstream join, and this repo's rule for one is absolute:
a wrong value is fixed by fixing the join and re-running it, never by hand.
`shared/spots.json` says so about this very field.

That rule was unsatisfiable. Re-running the join requires knowing which spots it
covered, and the only record of that was a sentence in the file's own `_schema`:

> Resolved by nearest-neighbour against Active, located stations only, and
> **ONLY for spots tagged swim, surf, dive or tidepool**.

Prose, evaluated against `audiences` — a field #125 deletes. Decision 6 of
PRD #101 sends the tag's content to `notes`, which is explicitly *not parsed*,
so following it literally would have deleted the join's scoping input and left
a rule the repo enforces everywhere with no way to satisfy it.

The set itself was never at risk. `county_station_null_reason` is already
required whenever the station is null and already distinguishes out-of-scope
from unresolved, so the 23/3 split was exactly recoverable with nothing guessed.
What needed a home was the *scope* as a thing a future run can evaluate.

## The predicate is preserved as history, not as a rule

`county_station_scope` records **the set**. The predicate — "swim, surf, dive or
tidepool" — is preserved in the field's schema entry as the historical scope
that produced that set, and is deliberately not re-expressed as something
evaluable.

Three of its four terms have no referent in the vocabulary that replaced
`audiences`. `dive` and `swim` are not activities this stack computes and may
never be; `surf` only becomes one at #129; only `tidepool` survives, and its
membership is a zone property now. Rewriting the predicate against the new
vocabulary would mean inventing referents for activities that do not exist, and
a scope that names three phantoms is worse than a recorded set with its history
attached.

If `swim` becomes a fifth activity (#101 open question 3), the scope of a spot
added then is a decision made then, stated in the field, and re-run.

## Per spot, not one list

The alternative shape was a single `in_scope: [...]` list in the file header.
Rejected because a spot added later would simply be absent from it, and absent
reads as out-of-scope with nothing complaining. A required per-spot field cannot
be forgotten: `scripts/gen-spots-types.mjs` fails on a spot without it, which is
the same device the three-way zone membership uses to stop a spot falling
through a gap.

## It is hand-written, in a file whose rule forbids that

`spots.json` says its values are resolved by join and never hand-populated, and
this one is typed in. The distinction is the point of this ADR: **that rule
governs what an upstream authority resolves.** No authority can state which
spots this repo chose to ask about. The scope is a decision made here, it is an
input, and the value it produces — `county_station` — remains untouchable by
hand. The generator enforces the half of that which is decidable: a spot marked
`out` may not carry a station.

## Considered and rejected

**The tag's content moves to `notes`**, per decision 6 read literally. `notes`
is free text and explicitly not parsed, so the join's scope would have become
unreadable to anything but a person. This is the option that motivated the ADR.

**Derive the scope from the result** — in scope iff `county_station` is
non-null. Zero new fields, and circular: the join's scope would be read off the
join's output, so a re-run could never discover it had been asked about a spot
that legitimately resolves to nothing. It also cannot express a genuinely
unresolved in-scope spot, which is a state the union still models.

**Keep `audiences` and change nothing.** Leaves a hand-populated tag in the file
whose rule forbids them, and leaves two membership axes — the tag and the zone
files — agreeing only by luck. ADR 0003 sets out why that is the state being
left behind.

## Consequences

- The join is re-runnable and, for the first time, has been re-run: 23 of 23
  in-scope matches reproduce against the live resource, station code and
  distance, with the pool filtered to the documented 121.
- `tools/county-station/rejoin.py` prints the station each out-of-scope spot
  *would* have matched, which is what shows the scope is load-bearing: all three
  would have bound to a station within 1 km.
- `Audience` leaves the generated types with the field. `bird` and `sail` are not
  activities this stack computes; their spots stay, only the tag goes.
- The spot page's subtitle loses its audience list and gains nothing. That page
  exists only for spots carrying a floor, so `tidepool` was true of all eight and
  distinguished none.
