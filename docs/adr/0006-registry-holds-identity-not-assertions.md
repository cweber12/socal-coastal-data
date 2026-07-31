# The source registry holds identity, not payload assertions

`shared/sources.json` carries one entry per upstream product: organisation,
endpoint, docs URL, publish cadence, forward validity, cache TTL, terms, status
with a reason, and the date each claim was measured. Column names, unit strings,
timezone labels and required request parameters stay in the parser.

## Why

The registry exists because upstream knowledge is currently duplicated in prose.
`verify_coastal_apis.py` carries `dead=` markers for NDBC 46235, open-meteo
marine and the Tijuana valley USGS bBox probe; CLAUDE.md states the same three
in its "Running things" section, with nothing keeping them in step. A `DEAD`
source flipping to `REVIVED` is supposed to be a real signal, and it currently
depends on a human reading two files and noticing they agree.

The line is drawn short of the parsers on purpose. `lib/ndbc.ts` refuses with:

> WVHT is published in "ft", not "m". Refusing to convert on an unrecognised
> unit string.

Move `'m'` into a JSON field and a config-driven validator emits "unit
mismatch". The pinning is worth more where the prose is, because the error
message and the reason for it are written by the same hand at the same time. The
registry answers _who, where, how often, and is it alive_; the parser answers
_what shape, in what units, on what clock_.

Correspondence is what makes the registry authoritative rather than decorative.
A check asserts three things, each failing by name: every entry has a probe,
every app-consumed entry has a parser, and no parser or probe exists without an
entry. Only then does CLAUDE.md's dead-source prose get deleted.

## Considered and rejected

**The registry as the full contract**, with parsers validating against it.
Single source of truth, and drift detectable by diffing the registry against a
live fetch. Rejected for the generic-error-message failure above: it trades this
repo's best feature for a property it can get another way.

**Prose docs per organisation** — `docs/sources/noaa.md` and so on. Richest for
a human reading in cold. Nothing machine-checks it, nothing enforces
correspondence with the probes, and it rots exactly the way the CLAUDE.md dead
list is already drifting.

## Consequences

- `forward_valid` lives here, which is what makes
  [0009](0009-horizon-is-a-property-of-the-input.md) implementable.
- The status field is never written by automation. A bot committing
  `status: dead` is a machine hand-populating a resolved field, which is the
  thing this repo forbids everywhere else. See
  [0007](0007-polling-is-weekly-and-transition-triggered.md).
