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

#42 asks for the value of **X**, the marginal sighting rate below which a day is
not worth a drive. An agent told to choose it will choose it by looking at the
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
