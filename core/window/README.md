# core/window

The engine. Given a tide series and a test on a height, when is that test
satisfied, and which gates take it away.

| | |
| --- | --- |
| `solve.ts` | The N-interval solver. Every maximal run where a height predicate holds, with the turns each one contains **reported**, never supplied. |
| `gates.ts` | Daylight · operator gate · swell window · minimum duration · unknown input. The two clips, measured separately. The shared constants and the sentences both occupants word identically. |
| `states.ts` | `CoreState` — the seven states the gates emit — their precedence, and how each is presented. |
| `day.ts` | `ActivityDay<State, Detail>` and `UsableWindow`: the shape every activity produces for one spot-day. |
| `__testing__/` | The tide builder and the fixture loaders. Test-only; nothing under `app/`, `core/` or `activities/` imports it. |

Extracted in #130 from **two real occupants**, not from one plus a guess. What
came across the #129 copy unchanged is what is here; what differed stayed with
the activity. The evidence is in the two files' own headers and in ADR 0015.

## What belongs here, and what belongs next door

Belongs here: anything that would be written identically by any activity reading
a tide, a clock and a buoy. The run walk. The daylight clip. The rule that an
unknown never renders as a pass.

Belongs next door:

- **A height predicate** — a floor, a band — is an activity's judgement about
  what is workable. This module takes one; it does not hold one.
- **A selection over the intervals** — which window a day reports on — is an
  activity's question, and the two occupants answer it differently. ADR 0015.
- **A sentence a reader is shown**, except the fragments both occupants word
  identically. "The window falls outside daylight" and "every session falls
  outside daylight" are claims about different shapes, and the activity that has
  the shape writes the claim.
- **A threshold's value.** `MIN_USABLE_MINUTES` lives here because the duration
  gate does, and it is passed in rather than read, so an activity that ever
  calibrates its own is a one-line change on its side.

## The three things this refuses to assume

**That a window has an anchor.** ADR 0015. A surf session can hold a high and a
low, or no turn at all, and both happen inside one fortnight of real predictions.

**That a level crossing can be found by searching for one.** A sample sitting
exactly *on* a level straddles nothing, so a crossing search finds nothing, falls
back to the start of the series, and invents a window running from whenever the
payload began. The run walk needs no such search. Of the 3,841 samples in the
committed 384-hour fixture, exactly one reads `1.5` — 22:36 PDT on 2026-07-21, on
the surf band's lower edge.

**That crossings near a turn belong to it.** They belong to whichever run they
bound, and for a turn that never reaches the level that is a *different* turn.
`intervalAt` returns null rather than the nearest interval, which is that stated
as a contract.

Both bugs carry named regression tests in `solve.test.ts`, and each was
demonstrated to fail against the solver with its own fix reverted.

## Where the tests live

The engine's tests are here. An activity's suite tests its predicate, its
selection and its sentences — not the walk underneath them, which is why
`activities/*/policy.test.ts` shrank in #130 rather than being duplicated again.

`activities/*/verdicts.test.ts` is the other half: 812 spot-days captured from
`main` before the extraction and replayed field by field, because "a reader sees
no difference" is a claim about the whole grid rather than about any property
somebody thought to assert.
