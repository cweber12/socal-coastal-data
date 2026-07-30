# calibration/

Joins iNaturalist observations to predicted tide and emits, per spot, **the
observed rate at which a recorded visit logged one of a frozen list of target
species, binned by that day's lowest predicted tide** — with the raw counts, not
a fitted threshold.

The published claim is a checkable statement about a record:

> Of 383 recorded visits to Cabrillo on days whose low was between −2.5 and
> −1.0 ft, 68% logged one of these seven species.

No model output, no confidence interval on a derived quantity, no ecological
assertion, **no zonation claim**. An estimate has to defend its level; a count
does not.

Full evidence and rationale: [#30](https://github.com/cweber12/socal-coastal-data/issues/30).
This directory is the build described in [#32](https://github.com/cweber12/socal-coastal-data/issues/32).

`floor-calibration.md`, beside this file, is the adjacent and separate question of
how `tidepool_floor_ft` itself gets set. This directory **grades a day**; that
document is about **gating a spot**. Read its status block before its prose — its
§3 and §6 were wrong and have been rewritten, and one defect remains open there:
it cites a `DECISIONS.md` that does not exist in this repository. Tracked in
[#40](https://github.com/cweber12/socal-coastal-data/issues/40).

## Running it

```bash
npm run calibrate           # offline, against committed fixtures
npm run calibrate:fetch     # live; writes shared/calibration.json
npm run gen:calibration     # shared/calibration.json -> shared/calibration.generated.ts
npm run calibrate:taxa:check  # re-resolve every taxon id against the API
```

Standard library only. TypeScript run under `node --experimental-strip-types`,
with `calibration/loader.mjs` registering a resolve hook so Node can load `lib/`'s
extensionless imports — see `calibration/ts-resolve.mjs` for why that is a hook
rather than a dependency or a rewrite of nine application modules.

**Offline is the default.** The committed fixtures are a deliberate `cc0`/`cc-by`-only
capture of a single year, so the offline run's numbers are **not** the published
ones — roughly a tenth of the corpus licences that way. What it proves is that
the pipeline runs end to end. Correctness is proved by the unit tests over the
pure modules. Only `--fetch` may write `shared/calibration.json`.

## What is committed, and what is not

| | |
|---|---|
| `target_taxa.json` | **Frozen.** The list, its split into targets and denominator, a rationale per entry, and what was rejected. |
| `__fixtures__/` | A `cc0`/`cc-by`-only capture, byte-for-byte, `linguist-vendored`. |
| `out/report.md` | Every diagnostic, per spot. Written by the live run. |
| `../shared/calibration.json` | The counts, the queries, the content hash, and a `null_reason` for every refusal. |
| `cache/` | **Gitignored**, so it exists only in the clone that wrote it. Raw upstream payloads, not joined rows — and only half of it survives a new day, see below. Roughly a third of the corpus is All Rights Reserved or No Derivatives and cannot be redistributed. |

Filtering the committed rows to CC-only while computing on everything was
rejected: the committed artifact would then not reproduce the published number,
which is worse than committing nothing because it looks like it should.

### The cache is only half date-stable

`cache/` holds raw upstream payloads rather than joined rows, and its two halves
key differently:

| Pull | Cache key | Survives a new day? |
|---|---|---|
| CO-OPS tide | the URL hash alone (`run.ts:160`) | **yes**, indefinitely — and it is the bulk of the bytes |
| iNaturalist, per spot | `pull <slug> <PULLED_AT>` (`run.ts:180`) | **no** |

`PULLED_AT` is today's date from `Date.now()` with no override (`run.ts:121`),
so the eight per-spot iNat pulls miss on any day after the one that wrote them.
Re-binning the next morning is therefore a re-run for the tide and a **re-fetch**
for iNaturalist: budget eight live pulls, and do not retry them in a loop. This
is the behaviour as it stands, not a defect being worked around — giving
`Date.now()` an override would change what the run is deterministic in, and that
is a decision for whoever next re-bins, not a caching tweak.

Because the directory is gitignored, a fresh clone or worktree starts with no
cache at all and re-pulls both halves — eleven years of CO-OPS (`CORPUS_START`
is 2016) for nothing. Copy it across rather than re-pulling it.

## The standing constraints

- **No change is justified by "this turns more cells green."** Stricter results
  are valid results.
- **A refusal is a valid output.** Five of eight spots refuse on the current
  corpus, each for a stated reason. Thin or contaminated data yields a `null`
  rate and a reason, never a number with a wide error bar.
- **No per-spot tunables.** One corridor-wide radius, one bin scheme, one
  amplitude gate. Every constant is in `src/config.ts`.
- **The taxa list is frozen before anything is computed**, and never revised
  within a run. Reassigning taxa by their observed tide distribution and then
  deriving a tide statistic from them is circular.

## The method, in one screen

**Predictor.** The minimum predicted height over the local day in
`America/Los_Angeles`, from station 9410230. *Not* the observation timestamp:
#30 measured the day's low discriminating 2–3× more strongly, because a person
on the reef for ninety minutes around a −1.5 ft low sees what a −1.5 ft low
uncovers wherever their shutter happened to fall.

**Visit.** One visit = one `(observer login, observed_on)` pair, collapsed before
anything is counted. A filter stage, not a diagnostic — without it one
photo-heavy walk votes thirty times and the rate is a rate over cameras.

**Label.** The visit recorded ≥1 target taxon, matched on `taxon.id` **or**
`taxon.ancestor_ids` so the one genus target catches species-level records.

**Bins.** `[-2.5,-1.0) [-1.0,-0.5) [-0.5,0.0) [0.0,0.5) [0.5,1.0) [1.0,3.0)`,
feet above MLLW. A display choice: no published number depends on them, because
the published number *is* the per-bin count.

**Refusals**, each producing a `null_reason`:

| criterion | threshold |
|---|---|
| too few usable bins (≥15 visits each) | < 3 |
| rates not declining with height | < 70% concordant pairs |
| amplitude ratio | < 2.0× |
| single-observer share | > 30% |

The **amplitude gate is the contamination detector**, and its bar is stated a
priori. The **background band** measures that spot's tide-independent background
— surge-channel photos, wrong camera clocks, washed-up specimens — and a spot
must show a low-tide rate at least double its own background to claim a distinct
low zone. The bar comes from that reasoning, **not** from the observed gap
between spots.

The background band is the highest usable bin **pooled with every bin above it**.
It was the highest usable bin alone until [#72](https://github.com/cweber12/socal-coastal-data/issues/72):
once [#43](https://github.com/cweber12/socal-coastal-data/issues/43) cut the
decision region to 0.25 ft, the bins above the highest usable one were
individually thin and so were discarded outright, which let the denominator land
in the middle of the range while real high-tide visits sat above it unread. At La
Jolla Cove that read 4.50× on a table flat across 3.25 ft of tide, against 0.85×
on the previous edges.

Pooling fixes the discarding; it does **not** make the gate fully invariant to
bin width, because which bin is "highest usable" still depends on the widths.
Where the lowest slice of the old top band is itself usable the pooled band is
exactly the old band — Cabrillo and La Jolla Shores return to 11.83× and 0.67×,
their pre-re-bin figures to the digit. Where no slice of it is usable the pool
falls a band lower and measures background over *more* visits at a *higher* rate,
so the ratio falls. Stricter, never looser. The bar did not move, and pooling is
**upward only** — the numerator is the low-tide rate, and pooling downward could
only raise the ratio. `backgroundBand` in `src/join.ts` carries the full
reasoning, including why full width-invariance was not attempted.

## Not to be done

- A rate published without the amplitude gate applied.
- Per-spot radius, bin scheme or amplitude bar tuned until outputs look
  reasonable.
- Hand-typed taxon ids.
- Cabrillo tuned to 0.7 ft. The NPS figure is the only independent check
  available, and tuning against it consumes it.
- Pooling, shrinkage, or a corridor fallback for refused spots — rejected on
  evidence in #30.
- Any commit message citing green-cell counts as evidence.
