# Architecture decision records

Decisions that were hard to reverse, surprising without context, and the result
of a real trade-off. If any of those three is missing, it does not belong here.

## Where knowledge lives

Four homes, and the boundaries between them are the point. A fact written in two
of them will drift, and the copy nobody runs is the one that goes stale.

| kind of knowledge | home |
| --- | --- |
| Why a decision was made, when there were alternatives | `docs/adr/` |
| What a directory is for, and what belongs next door instead | that directory's `README.md` |
| What a file does, what it refuses to assume, measured against what | that file's header comment |
| The evidence behind a measured value | that value's evidence ledger |

What the domain words mean is a fifth thing and lives in `CONTEXT.md`, which is
a glossary and nothing else.

An ADR does not restate a header comment. `lib/ndbc.ts` opens with a measured
header dump across seven buoys and three named refusals; that is where payload
discipline is documented, and it is better there than anywhere else because the
error message and the reason for it sit next to each other.

## Numbering

Sequential, `NNNN-slug.md`. Scan for the highest and increment. Numbers are
never reused, and a superseded ADR is marked rather than deleted — on the same
terms as a `DEAD` upstream source, because the reason something was written off
is worth as much as the fact that it was.

## Index

| # | decision |
| --- | --- |
| [0001](0001-zones-own-facts-activities-own-verdicts.md) | Zones own facts, activities own verdicts |
| [0002](0002-measured-zone-facts-are-a-third-provenance-class.md) | Measured zone facts are a third provenance class |
| [0003](0003-zone-membership-is-three-way.md) | Zone membership is three-way, and `audiences` is deleted |
| [0004](0004-spot-is-the-canonical-noun.md) | `spot` is the canonical noun for a place a person goes |
| [0005](0005-one-parser-per-upstream-product.md) | One parser per upstream product |
| [0006](0006-registry-holds-identity-not-assertions.md) | The source registry holds identity, not payload assertions |
| [0007](0007-polling-is-weekly-and-transition-triggered.md) | Upstream polling is weekly and transition-triggered |
| [0008](0008-surf-is-the-second-activity.md) | Surf is the second activity |
| [0009](0009-horizon-is-a-property-of-the-input.md) | Forecast horizon is a property of the input |
| [0010](0010-activity-composition-belongs-to-the-activity.md) | Activity composition belongs to the activity, not the composition root |
