# Upstream polling is weekly and transition-triggered

A workflow separate from CI runs the verifier weekly, compares reality to the
status recorded in `shared/sources.json`, and is **green when they agree** —
including a known-dead source staying dead. On a disagreement it re-probes to
filter transients, then opens a labelled issue naming the source, the direction
of the transition, and the measured evidence. It never commits a status change.

## Why

**A source's publish interval is not a probe interval,** and this is the part
most likely to be "fixed" later by someone reading `publishes_every: 30m` in the
registry and wiring a cron to it. NDBC publishes every thirty minutes. Probing
at that cadence is 48 requests per buoy per day across seven buoys, to detect a
fact that changes on a scale of months. `.github/workflows/ci.yml` already
states the constraint — running the verifier per push would be "both flaky and
rude to the upstreams" — and asks for a weekly schedule of its own.

**The transition that matters most is the good one.** Six south-corridor spots
carry `wave.intended_primary: "46235"` waiting for exactly a `REVIVED` signal. A
workflow that only goes red on failure would report the resurrection as green.
Comparing against a recorded status is what makes both directions visible, and
it is also what stops a known-dead source failing the run every week forever or
being suppressed in a second place.

**Automation must not write the status.** Marking a source dead or alive is a
judgement with consequences — a `REVIVED` NDBC 46235 means reassigning bindings
for six spots — and a bot committing `status: dead` is a machine
hand-populating a resolved field. The workflow reports; a human decides, citing
the issue.

## Considered and rejected

**Per-source cadence derived from `publishes_every`.** GitHub Actions cron is
per-workflow, so it means many workflows or bespoke scheduling logic, and it
optimises a dimension that does not matter.

**Daily run, red build only, no state comparison.** Simplest possible thing and
needs no status field. Loses the `REVIVED` signal entirely.

## Consequences

- CLAUDE.md's dead-source prose is deleted in the same PR, or the duplication
  survives the change meant to remove it.
- GitHub disables scheduled workflows after 60 days of repository inactivity.
  For a repo whose purpose is noticing slow rot, a silently disabled tripwire is
  the exact failure mode, and it is not yet solved.
