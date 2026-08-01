# "Threshold" is a role; the provenance class is "author estimate"

`CONTEXT.md` used "threshold" for two different things. It now uses it for one:
the **role** a number plays in a predicate. The provenance class formerly called
*author threshold* is **author estimate**, which is what the evidence ledgers
already called it — `author_estimate` is the method name in all eight
`floor_evidence` entries.

Per-activity thresholds live in `activities/<name>/thresholds.json`;
`shared/thresholds.json` keeps only what is corridor-wide.

## Why the rename is not cosmetic

The glossary collapsed two orthogonal axes:

| axis | question | values |
| --- | --- | --- |
| **role** | what does this number *do* in a predicate | floor, ceiling |
| **provenance** | where did this number *come from* | upstream join, author estimate, measured zone fact |

Read in the provenance sense, the sentence "the tide floor is a threshold"
**reclassifies `tidepool_floor_ft` from measured zone fact to author estimate**
— reversing ADR 0002, decision 5 of PRD #101, and the file migration in #124
that gave the measured class its own home. That is not a hypothetical
misreading; it is what the words said. The floor is threshold-*shaped* and
measured-*provenance*, and a glossary that cannot express that has to be fixed
before anything is filed against it.

`CONTEXT.md`'s own preamble says "when a word here conflicts with a word in the
code, the code is wrong". Here the word conflicted with itself, so the glossary
is what got fixed.

## The author-estimate class had no exit

As written, the class was "uncalibrated until a person who goes there confirms
it". That is the *only* stated way out, and it is not a route this project
takes — so every swell ceiling in the repo was permanently uncalibrated by
definition, while the measured class next to it had a real promotion rule.

An author estimate is now a **starting** state that leaves through an evidence
ledger, by an entry that supersedes it. The entry may come from an instrument,
from a corpus, or from a person who goes there. What it may not come from is
another author writing a different number down — two estimates are one method
run twice, which is the same clause the measured class already carries.

**The measured-zone-fact promotion rule is untouched**: two entries from
different methods agreeing within 0.3 ft, at least one instrumented. Nothing in
this ADR loosens it, and no floor is promoted by it.

## Where the numbers went

| value | home | why |
| --- | --- | --- |
| default swell ceiling 3.0 ft | `shared/thresholds.json` | corridor-wide: it applies to every spot nothing specific has been said about, and all eight rendered spots use it |
| `blacks-beach` 2.0 ft, `tourmaline` 4.0 ft | `activities/surf/thresholds.json` | judgements about how those two *breaks* differ; both spots are surf-only and outside the intertidal grid |
| `MIN_WINDOW_MINUTES` = 45 | `activities/tidepool/policy.ts` | already there, beside the gate that reads it |

The tiebreaker for the default was the boundary table, as #128 asked. Moving it
to an activity would drag `core/thresholds.ts` with it, and
`core/components/unresolved.tsx` reads that module — `core` may not import an
activity, so the corridor default staying shared is the arrangement the table
supports.

## A moved file must not take its caveats off the page

`core/components/unresolved.tsx` exists because eleven recorded caveats were
being loaded and dropped, and the surf overrides carried one of the four entries
in `shared/thresholds.json`. Filing them under `activities/surf/` while the
component could only see two hard-coded `shared/` files would have re-created
that bug by a better-intentioned route: correctly filed values, and a reader
told less than the day before.

So the component takes its sources as a **prop**, and `app/unresolved-sources.ts`
assembles them. The composition root is the only layer allowed to import every
slice, so it is the layer that can say which files a reader is owed disclosure
from. This is the shells-plus-slots pattern `core/components/` is built on,
applied to data rather than markup. It is not #132 — the list is still written
out by hand — but it is now written where the imports are legal.

## Considered and rejected

**One shared file, per-activity keys inside it.** No new files, one import. It
keeps a corridor-wide file holding judgements about individual activities and
individual spots, which is what made the surf overrides look corridor-wide for
months; and it gives an activity no place to put a value the corridor has no
opinion on.

**Leave the two overrides in `shared/` until #129 exists to own them.** Smallest
diff, and it defers exactly the decision this issue was opened to make — while
leaving `shared/thresholds.json` as the counter-example to its own new rule.

**Rename the role instead**, keeping *author threshold* and calling floors and
ceilings something else. Rejected: "floor" and "ceiling" are the words the code,
the UI and the upstream literature all use, and `author_estimate` is already
written into eight evidence ledgers that are append-only. Renaming the role
would mean changing the words in the ledgers or accepting a second mismatch.

## Consequences

- `shared/thresholds.json` 0.2.0 holds one number and three caveats.
  `activities/surf/thresholds.json` 0.1.0 holds two overrides and two.
- `swellCeilingFor` in `core/thresholds.ts` returns the corridor default for
  every spot, and `isDefault` is true on every answer — which is what the UI
  already rendered for all eight spots, because neither override was ever in
  scope.
- `activities/surf/` exists, holding data and a reader and no predicate. #129
  builds the predicate on top rather than deciding where its thresholds live.
- ADR 0002's provenance table uses the old name and is amended in place with a
  pointer here, rather than being superseded: its decision — that measured zone
  facts are a third class — is unchanged, and only the second class's name moved.
