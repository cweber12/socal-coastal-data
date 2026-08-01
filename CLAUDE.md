# CLAUDE.md

Guidance for agents working in this repository.

## What this repo is

A coastal conditions data stack for the San Diego corridor, Oceanside Harbor
down to Border Field at the Mexican border.

- `tools/verify-apis/verify_coastal_apis.py` — probes every upstream endpoint the stack depends
  on and reports status, latency, and **the age of the newest observation**.
- `spots.json` — the spot inventory: 26 locations with their buoy, tide
  station, county water-quality station, and marine protected area bindings.

Both files are about **trusting external data that quietly rots**. Buoys get
decommissioned while their status page still returns 200. Datasets get retired
from an ERDDAP server. A gauge stops publishing and the API keeps answering
with an empty array. The conventions below exist because each one has already
bitten this repo.

## Workflow: plan, PRD, issue, branch, PR

Do not start editing files in response to a feature request. Follow this order.

### 1. Plan

Write the implementation plan first. State what changes, which files, what
could break, and how you will verify it. For anything touching an upstream
data source, verification means *actually calling the endpoint*, not reasoning
about what it probably returns.

### 2. Publish a PRD to GitHub

Publish the plan as a GitHub issue labelled `prd` before writing code.

```bash
gh label create prd --description "Product requirement doc" --color 0E8A16 2>/dev/null || true
gh issue create --title "PRD: <short title>" --label prd --body-file <path>
```

A PRD should cover: problem, proposed change, out of scope, verification plan,
and open questions. Keep it honest about what is unknown — a PRD that hides
uncertainty produces work that has to be redone.

### 3. Break into issues when the PRD needs more than one deliverable

A single-file, single-concern change can be implemented straight off the PRD.
Anything larger gets child issues, each independently shippable and each
linked back to the PRD.

```bash
gh issue create --title "<deliverable>" --body "Part of #<prd-number>"
```

### 4. Implement on a feature branch

One issue, one branch, branched from an up-to-date `main`:

```bash
git switch main && git pull
git switch -c feat/<issue-number>-<slug>     # or fix/, chore/, docs/
```

Never commit directly to `main`.

### 5. On completion: commit, push, open the PR

This is automatic. Do not wait to be asked.

```bash
git add <paths>
git commit -m "<message>"                     # see commit conventions below
git push -u origin feat/<issue-number>-<slug>
gh pr create --base main --title "<title>" --body "Closes #<issue-number>

<what changed and why, what was verified, what was left out>"
```

The PR body must state what you actually verified and what you did not. If a
part of the issue is unfinished or blocked, say so in the PR rather than
letting the reviewer discover it.

**A PR body carries one issue number — the one its closing keyword closes.
Every other issue goes in by full URL**, which cross-references without being
parsed as a keyword. Separate lines are not enough: #47 put `Closes #39.` and
`Part of #40.` two lines apart, the merge closed both, and #40 was reopened by
hand with no work in it.

**The same rule binds commit messages, and that is the half that gets missed.**
GitHub fires closing keywords from commit messages on the default branch too.
#159 wrote a clean body — one `Closes #151`, everything else by full URL — and
still closed PRD #148, because its commit said "This closes #148 open question
2". Surrounding prose does not disarm a keyword: that parses as `closes #148`,
and the PRD had five unshipped children. When you need to say a keyword-shaped
thing about an issue you are not closing, put the URL where the number was —
"closes open question 2 of `https://github.com/.../issues/148`". Long version:
`docs/concurrent-agents.md`.

### 6. Hand the PR over, and stop

Opening the PR is where the work stops being yours and starts being the
reviewer's. Say so explicitly.

**Every completion message names the PR** — number and URL, not "done". With it:
what changed, what you verified and how, and anything you left out, got wrong,
or are unsure about. A reviewer should not have to find those in the diff.

**Then say what is waiting on them**, in one line. For example:

> #27 is open and ready for review. Say the word and I'll merge and clean up.

**Do not merge.** Not the PR, not a branch deletion, not a hand-closed issue,
not a force-push. Approval to open a PR is not approval to land it, and a merge
to `main` is outward-facing and awkward to undo. Wait for the reviewer to
confirm in this conversation.

On confirmation, merge and clean up in one pass:

```bash
gh pr merge <n> --merge --delete-branch    # merge commits, matching this history
git switch main && git pull && git remote prune origin
```

Then check the ledger rather than assuming: `gh issue list --state open` should
be empty of the issues the PR claimed, and anything left open gets closed by
hand with a comment naming the PR and the merge commit. Stop any dev server or
background process you started.

Commits here are the durable record of *why* something is the way it is —
several are the only place a hard-won upstream finding is written down. Match
that standard:

- Subject line in the imperative, under ~72 characters.
- Body explains the cause, not just the change. "The API returns local time
  with no offset and the parser tagged it UTC" beats "fix timezone bug".
- Record what you verified and how, including counts and values, so a future
  reader can tell measurement from assumption.
- If you ruled something out, say so. Knowing 11013500 is the *correct* site
  that stopped publishing in 1982 is worth more than knowing it returned no data.
- End with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Data integrity rules

These are not style preferences. Violating them produces plausible-looking
wrong numbers, which is the failure mode this repo is built to prevent.

**Never assume a timezone.** Read it from the payload or the header. If a
timestamp carries no offset, find out what clock it is on and pin it, with the
evidence in a comment. Several upstream feeds publish local time with no
offset; tagging those UTC silently ages every reading by 7–8 hours.

**Never assume units.** Capture them as data. IBWC publishes the Tijuana River
in cubic metres per second, USGS in cubic feet per second, and a downstream
dashboard renders the same feed in million gallons per day. Convert only on an
exact unit-string match, and fail rather than guess when the string is
unrecognised.

**Freshness beats status.** A 200 carrying an empty payload is a dead source,
not a passing one. Checks report delivery separately from HTTP status via
`alive=`; use it whenever the check can tell the difference.

**Mark known-dead sources, never delete them.** A source written off as `DEAD`
that starts answering reports `REVIVED`, because either it came back or the
reason it was written off no longer holds. Both need a human.

**Undocumented scrapes pin everything and fail loudly.** Station id, column
names, timezone label, unit strings — all pinned, all raising on drift. A
plausible-looking wrong flow number is worse than no number. Prefer a
machine-readable product over HTML, and check for a JSON or text feed before
parsing markup.

**`null` means unresolved, never clean.** In `spots.json` a null
`county_station` must never render as a pass, and a null `mpa` with
`mpa_resolved: false` means unknown, not unprotected. When a field cannot be
resolved, leave it null, give the reason, and list it in `unresolved`.

**Do not hand-populate resolved fields.** `county_station` and `mpa` come from
joins against upstream authorities. If a join is wrong, fix the join and re-run
it. Legally load-bearing values are never typed in by hand.

**Respect the coordinate error bar.** `spots.json` coordinates are ~100 m.
MPA boundaries are legally meaningful and follow the shoreline, so a
point-in-polygon result within 150 m of a boundary is not trustworthy in either
direction and must be flagged unresolved.

## Running things

```bash
python tools/verify-apis/verify_coastal_apis.py          # exits nonzero only on real failures
EBIRD_API_KEY=xxx python tools/verify-apis/verify_coastal_apis.py   # includes the eBird check
```

Standard library only — no dependencies, and it should stay that way.

Expect `DEAD` rows for NDBC 46235, `api.open-meteo.com/v1/marine`, and the
Tijuana valley USGS bBox probe. Those are confirmed dead upstream and are
tripwires, not regressions. If one flips to `REVIVED`, that is a real signal:
update `spots.json` bindings — six south-corridor spots carry
`wave.intended_primary: "46235"` awaiting exactly that.
