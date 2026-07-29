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
document is about **gating a spot**. Read its status block before its prose — two
of its sections are known wrong and are tracked in
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
| `cache/` | **Gitignored.** Raw joined rows. Roughly a third of the corpus is All Rights Reserved or No Derivatives and cannot be redistributed. |

Filtering the committed rows to CC-only while computing on everything was
rejected: the committed artifact would then not reproduce the published number,
which is worse than committing nothing because it looks like it should.

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
priori. The highest usable bin measures that spot's tide-independent background
— surge-channel photos, wrong camera clocks, washed-up specimens — and a spot
must show a low-tide rate at least double its own background to claim a distinct
low zone. The bar comes from that reasoning, **not** from the observed gap
between spots.

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
