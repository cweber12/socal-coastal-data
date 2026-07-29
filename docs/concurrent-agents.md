# Running issues concurrently with agents

How to implement several of #38's child issues at the same time without the
agents fighting over files or closing each other's issues.

Written for PowerShell on Windows, which is what this repo is developed on.

---

## The constraint is file contention, not the dependency graph

The dependency graph says what *may* start. It does not say what may start
*together*. Four of #38's seven children write the same file:

| Issue | Writes | Blocked by |
|---|---|---|
| #40 | `calibration/floor-calibration.md` | open question 2, for the `DECISIONS.md` citations only |
| #41 | `shared/spots.json`, `shared/spots.generated.ts` | — |
| #42 | a policy statement | **a human** — see [Do not delegate #42](#do-not-delegate-42) |
| #43 | `calibration/src/config.ts`, `shared/calibration.json`, `shared/calibration.generated.ts`, `calibration/out/report.md`, `calibration/src/*.test.ts` | #42 |
| #44 | `shared/spots.json`, `shared/spots.generated.ts` | #41, #42, #43 |
| #45 | research, then `shared/spots.json` | #41, to record |
| #46 | a new pipeline, then `shared/spots.json` | #45 |

**One writer at a time for `shared/spots.json`.** Worktrees stop two agents
overwriting each other on disk. They do not stop two pull requests colliding at
merge, and `spots.generated.ts` is a generated file — reconciling a conflict in it
by hand produces a file that matches neither branch's inventory, which is the
failure `npm run gen:types:check` exists to catch.

`#45`'s dependency on `#41` is easy to miss and was published wrongly on #38 at
first. Its research half — is this spot in the MARINe network — depends on
nothing. Its deliverable is a `floor_evidence` entry, and that field does not
exist until #41 creates it. Run the research concurrently; hold the write.

### Waves that work today

**Wave 1**, three agents, no file overlap:

- **#41** — holds the `shared/spots.json` lock
- **#40** — `calibration/floor-calibration.md`, §3 and §6 only
- **#45** — research only, findings posted as an issue comment, **no file writes**

**Wave 2**, after you have settled #42: **#43**, then **#44**, then **#46**.

---

## Setup: one worktree per agent

A worktree is a second checkout sharing one `.git`. Branches and commits made in
one are visible from all of them immediately.

```powershell
cd C:\Projects\_current-projects\socal-coastal-data
git worktree add ..\scd-41 -b feat/41-floor-evidence
git worktree add ..\scd-40 -b docs/40-floor-calibration-corrections
git worktree add ..\scd-45 -b chore/45-marine-site-list
```

Branch names follow CLAUDE.md: `feat/`, `fix/`, `chore/` or `docs/`, then the
issue number, then a slug.

**`node_modules` is not shared between worktrees.** Run `npm ci` in any worktree
whose agent runs an npm script — that is any agent touching `shared/*.json`, since
`gen:types:check` and `gen:calibration:check` gate CI. A docs-only or research-only
worktree does not need it.

```powershell
cd ..\scd-41 ; npm ci
```

Put worktrees *beside* the repo, never inside it. A worktree in a subdirectory
gets swept up by globs, `npm run build`, and the agents' own file searches.

---

## Launching them

One terminal per worktree:

```powershell
cd ..\scd-41
claude
```

The prompt matters more than the mechanics. A capable agent with a clear view of
the repo will wander into an adjacent issue and fix something helpful there, which
is how two branches end up editing one file. State the lane:

```
Implement #41. Read it with `gh issue view 41`, and read #38 for context.

Follow the CLAUDE.md workflow. The branch already exists and you are on it.
Implement, commit, push, open the PR, then stop. Do not merge.

Stay in your lane: do not edit any file outside shared/spots.json and
shared/spots.generated.ts. #44, #45 and #46 also write spots.json and are
running in parallel.

In the PR body, write `Closes #41.` and reference no other issue by number.
Use full URLs for anything else you need to link.
```

That last paragraph belongs in every agent's prompt. See
[The PR body rule](#the-pr-body-rule) for why.

For #45, add:

```
Post your findings as a comment on #45. Do not edit shared/spots.json --
#41 creates the floor_evidence field and has not merged yet.
```

`--permission-mode acceptEdits` cuts the prompt volume when you are watching
three terminals at once. Do not use `--dangerously-skip-permissions` for this
work: these agents write the inventory file the entire stack trusts, and the
prompts are the last thing standing between a bad join and `main`.

---

## The PR body rule

**Write one issue reference in a PR body: the closing keyword. Link everything
else by full URL.**

PR #47 carried this, on separate lines:

```
Closes #39.

Part of #40.
```

The merge closed **both**. #40 had to be reopened by hand, and it had no work in
it. CLAUDE.md says issue-closing keywords need a line of their own; separate
lines are not sufficient, so that guidance describes a fix that does not work.

The form that is known to be safe:

```
Closes #41.

Part of https://github.com/cweber12/socal-coastal-data/issues/38.
```

A full URL still renders as a link and still shows up in the issue's timeline as
a cross-reference. It is not parsed as a closing keyword.

After the merge, check rather than assume:

```powershell
gh issue list --state open
```

Anything that closed and should not have gets reopened immediately, with a comment
saying it was closed by a merge and not by work. An issue silently closed with
nothing in it is worse than one left open — it disappears from the ledger.

---

## Merging

Merge the `shared/spots.json` writer first, then rebase everything else before it
merges:

```powershell
cd ..\scd-45
git fetch origin
git rebase origin/main
```

CI is `concurrency: cancel-in-progress` grouped by ref, so parallel pull requests
each get their own run and do not cancel one another. Both legs — `ubuntu-latest`
and `windows-latest` — must pass. The Windows leg exists because this repo is
developed with `core.autocrlf=true` and a line-ending mismatch once made
`gen:types:check` fail on a file that was current; a Linux-only run would have
stayed green through all of it.

Clean up per merge:

```powershell
cd C:\Projects\_current-projects\socal-coastal-data
git worktree remove ..\scd-41
git worktree prune
git switch main ; git pull ; git remote prune origin
```

`git worktree remove` refuses if the worktree has uncommitted changes. That is a
feature — look at them before forcing it.

---

## Subagents are the wrong tool for parallel edits

Subagents inside one session share one working directory. Two of them editing
files concurrently collide, and neither can open its own pull request from a
branch the other is also on.

They are the right tool for read-only fan-out. #45 is a natural fit: one subagent
per spot checking the MARINe site list, results collected and written once by the
parent. Anything that commits wants a separate session in a separate worktree.

---

## Do not delegate #42

Issue #42 asks for the value of **X**, the marginal sighting rate below which a
day is not worth a drive. An agent told to choose it will choose it by looking at
rate table in the issue — which is choosing X from the output, the tuning
`calibration/README.md` lists under *Not to be done*, and precisely what #42
exists to prevent.

Write X yourself. Commit it. Then let an agent have #43.

Keep #40's `DECISIONS.md` question too. An agent can rewrite §3 and §6 from the
evidence already gathered, but only a human knows whether that file exists
somewhere off-repo, and inventing a plausible §-reference to a file nobody can
open is the documentation equivalent of a plausible-looking wrong flow number.

---

## What this does not solve

- **Two agents needing `shared/spots.json` at once.** There is no locking
  mechanism here beyond sequencing it by hand. If that becomes common, the answer
  is a narrower file, not a cleverer process.
- **Reviewing three pull requests at once.** The bottleneck moves to you. Three
  agents finishing together is not obviously faster than three finishing in
  sequence.
- **Agents that verify by reasoning rather than by calling.** Nothing in the
  worktree setup enforces CLAUDE.md's rule that verification means calling the
  endpoint. That is still read in the pull request.

---

## One thing to know before running #43 or #46

`calibration/cache/` is **gitignored**, so it exists only in the clone that wrote
it. A fresh worktree starts with no cache and re-pulls eleven years of CO-OPS for
nothing. Copy it in:

```powershell
Copy-Item -Recurse ..\socal-coastal-data\calibration\cache .\calibration\cache
```

And the cache is **not date-stable**, which `calibration/README.md` currently
implies it is when it calls re-binning "a re-run, not a re-fetch". That holds for
the tide half only:

| Pull | Cache key | Survives a new day? |
|---|---|---|
| CO-OPS tide | URL hash alone — `run.ts:160` | **yes**, indefinitely. This is the bulk of the ~38 MB. |
| iNaturalist, per spot | `pull <slug> <PULLED_AT>` — `run.ts:180` | **no** |

`PULLED_AT` is today's date from `Date.now()` with no override (`run.ts:121`), so
the eight per-spot iNat pulls miss on any day after the one that wrote them.
Budget for eight live pulls whenever a re-bin runs, and do not retry them in a
loop.

---

## Appendix: the prompts

One per delegatable issue. The guardrails in each are the repo rules an agent
would otherwise breach while doing exactly what it was asked — they are not
deducible from the issue text.

Every one of them ends with the same PR-body rule. It is not boilerplate; it is
the trap in [The PR body rule](#the-pr-body-rule).

### #41 — `feat/41-floor-evidence`

```
Implement #41. Read it with `gh issue view 41`, and read #38 for context.

Follow the CLAUDE.md workflow. The branch feat/41-floor-evidence already exists
and you are on it. Implement, commit, push, open the PR, then stop. Do not merge.

Stay in your lane: do not edit any file outside shared/spots.json and
shared/spots.generated.ts. #44, #45 and #46 also write spots.json and are running
in parallel.

This issue adds a field and records history. It changes no floor value and no
confidence value -- tidepool_floor_confidence stays "low" on all 8 spots. If you
find yourself editing a number, you have left the issue.

The 1.1.1 values in the issue's table came from
`git show cb2a81d~1:shared/spots.json`. Re-read them from there rather than
trusting the table -- CLAUDE.md forbids hand-populating resolved fields.

Run `npm run gen:types` then `npm run gen:types:check` before committing. CI
checks the generated file on both ubuntu and windows.

In the PR body write `Closes #41.` and reference no other issue by number; use
full URLs for anything else. A `Part of #NN` line closed the wrong issue on PR 47.
```

### #40 — `docs/40-floor-calibration-corrections`

```
Implement the unblocked part of #40. Read it with `gh issue view 40`, read its
comments, and read #38 for context.

Follow the CLAUDE.md workflow. The branch docs/40-floor-calibration-corrections
already exists and you are on it. Commit, push, open the PR, then stop. Do not
merge.

Stay in your lane: calibration/floor-calibration.md. Touch calibration/README.md
only if a cross-reference genuinely breaks.

Two of the three defects are yours:

- Section 3: rewrite it to report what calibration/ already produces instead of
  proposing a pipeline to build. Read calibration/README.md and
  shared/calibration.json first. The split to state: calibration/ grades a day,
  this document is about gating a spot.
- Section 6: rewrite so the NPS 0.7 ft figure is spent ONCE, against the
  instrumented method in section 2, with the outcome recorded whichever way it
  falls. As written it invites iterating the method until it lands near 0.7, which
  calibration/README.md lists under "Not to be done".

The third defect is NOT yours. DECISIONS.md is cited six times and does not exist
in this repository. Whether it exists off-repo is open question 2 of #38 and needs
a human. Do not resolve those citations, do not delete them, and above all do not
invent a plausible section reference to a file nobody can open.

When you fix sections 3 and 6, update the status block at the top so it no longer
claims they are wrong, and leave its DECISIONS.md item standing. A document whose
header contradicts its body is worse than the original.

This PR does not close #40 -- the DECISIONS.md citations remain. Write no closing
keyword. Link the issue by full URL and state plainly what is left.
```

### #45 — `chore/45-marine-site-list`

```
Implement #45. Read it with `gh issue view 45`, and read #38 for context.

This one writes NO files and opens NO PR. Post your findings as a comment with
`gh issue comment 45`, then stop. Do not edit shared/spots.json -- #41 creates the
floor_evidence field your findings will eventually live in and it has not merged.

The task: for each of the 8 spots in shared/spots.json whose audiences contains
"tidepool", determine whether it is in the MARINe Biodiversity Surveys network,
and if so the site name, its coordinates, and its distance from the spot
coordinate.

Verification means actually reading MARINe's site list, not reasoning about which
famous reefs are probably in it. Record the source URL you read.

Two CLAUDE.md rules bite here:

- spots.json coordinates carry a ~100 m error bar. A MARINe site more than a few
  hundred metres from the spot is a different reef and must not be reported as
  that spot's elevation. State the distance and let a human judge.
- Do not transcribe any elevation without its survey date and the datum it is
  published in. An elevation with no datum is unusable; a wrong one is worse than
  none.

"Not in the network" is a finding, not a failure. Five of the eight refuse on
citizen-science data, so a negative result for those tells us whether #46 is the
only route to them.
```

### #43 — `feat/43-rebin-decision-region`, after #42

```
Implement #43. Read it with `gh issue view 43`, and read #38 and #42 for context.
Do not start until #42 is merged and X is written down. If it is not, stop and say
so.

Follow the CLAUDE.md workflow. The branch feat/43-rebin-decision-region already
exists and you are on it. Commit, push, open the PR, then stop. Do not merge.

Stay in your lane: calibration/src/config.ts, calibration/src/*.test.ts,
shared/calibration.json, shared/calibration.generated.ts,
calibration/out/report.md. Do not touch shared/spots.json -- setting a floor is
#44's issue, not this one.

Do not choose or revise X. It is fixed by #42. If the re-binned output makes X
look wrong, say so in the PR and stop; do not adjust it.

Nothing is relaxed to make output look better. USABLE_BIN_MIN_VISITS stays 15,
MIN_AMPLITUDE_RATIO stays 2.0. Narrower bins will move amplitude ratios and some
new bins will fall below 15 visits and drop out -- that is the honest answer, not
a reason to widen them. One corridor-wide bin scheme; per-spot bins are forbidden.

Report publish/refuse verdicts for all 8 spots before AND after. Three publish
today (cabrillo-tidepools, sunset-cliffs, swamis) and five refuse. A spot changing
verdict in either direction is a finding to explain in the PR body, not a result
to accept quietly.

On running it: `npm run calibrate` is the offline fixture run and its numbers are
NOT publishable -- roughly a tenth of the corpus licenses that way. Producing
shared/calibration.json needs `npm run calibrate:fetch`. Copy calibration/cache
into this worktree first, but note the cache keys the iNaturalist pulls on the run
date (run.ts:180), so those 8 pulls WILL go live however fresh the cache looks.
The CO-OPS tide fetches key on URL alone and will hit the cache. Budget for 8 live
iNat pulls; do not loop them or retry on a timeout without saying so.

Run `npm run gen:calibration`, `npm run gen:calibration:check` and `npm run test`
before committing.

PR body: `Closes #43.` and no other issue referenced by number.
```

### #44 — `feat/44-set-floors`, after #41, #42 and #43

```
Implement #44. Read it with `gh issue view 44`, and read #38, #41, #42 and #43.
Do not start until #41, #42 and #43 are all merged. If any is open, stop and say
so.

Follow the CLAUDE.md workflow. The branch feat/44-set-floors already exists and
you are on it. Commit, push, open the PR, then stop. Do not merge.

Stay in your lane: shared/spots.json and shared/spots.generated.ts.

Set tidepool_floor_ft for exactly the spots that publish in
shared/calibration.json. Re-read which those are from that file rather than
trusting this prompt.

Do not set a floor for any refusing spot, for any reason. la-jolla-cove has 354
visits and an amplitude ratio below 1.0 -- that is a refusal, not a thin-data
problem awaiting a judgement call.

Do not set a floor whose marginal bin holds fewer than 15 visits. State each new
floor in the PR with its marginal band and that band's visit count.

tidepool_floor_confidence stays "low" on all 8, including the spots that move.
Promotion needs an instrumented method and there is none until #46.

Say the limitation in the PR body rather than letting a reviewer find it: sighting
rate is not walkability. The curve's shape is trustworthy; its level is an
assumption.

Report grid output before and after as a fact, not as justification. "This turns
more cells green" is not an argument for any value here, stricter results are
valid results, and no commit message cites a green-cell count.

Run `npm run gen:types` and `npm run gen:types:check` before committing.

PR body: `Closes #44.` only.
```

### #46 — `feat/46-lidar-hypsometry`, after #45

```
Implement #46. Read it with `gh issue view 46`, read #45's findings comment first,
and read #38 plus calibration/floor-calibration.md sections 2, 6 and 7.

Do not start until #45's findings are posted. If a corridor spot is in the MARINe
network its surveyed elevation already exists and this pipeline is unnecessary
there.

Follow the CLAUDE.md workflow. Branch feat/46-lidar-hypsometry exists and you are
on it. Do not merge.

This is the long pole and may need more than one PR. If so, open the first for the
acquisition and datum layer alone and say in the body what remains.

Stay in your lane: a new directory for the pipeline. Do not write
shared/spots.json in the same PR as the pipeline -- a floor value is a separate,
reviewable change.

The datum is the whole risk. Everything goes through NOAA VDatum into MLLW ft
before any spot is compared to any other, and the transformation parameters are
pinned in the output. An unrecorded datum conversion is the elevation equivalent
of the IBWC cubic-metres-per-second error in CLAUDE.md. Fail loudly on an
unrecognised vertical reference; never guess a scale factor.

Every derived floor carries its lidar acquisition date. A DEM is one moment and
these reefs bury and scour seasonally.

Cabrillo first, and the 0.7 ft comparison happens ONCE. Read 0.7 ft from nps.gov
itself, not from a site quoting nps.gov -- a republisher is not the publisher.
Record the outcome whichever way it falls. If it disagrees, do not compute the
other seven and do not adjust the method to close the gap. That consumes the only
independent check available and calibration/README.md lists it under "Not to be
done".

Use a closing keyword only if the pipeline is actually complete; otherwise link
#46 by full URL and state what remains.
```

### #42 has no prompt, deliberately

See [Do not delegate #42](#do-not-delegate-42). An agent given it will read X off
the rate table in the issue, which is choosing X from the output — the one thing
that issue exists to prevent.
