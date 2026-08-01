# tools

Producers. Things this repo **runs** to make data, check an upstream, or
investigate a question — never things the app imports.

| | |
| --- | --- |
| `county-station/` | Re-runs the `county_station` nearest-neighbour join against data.ca.gov and diffs it against `shared/spots.json`, so the repo's "fix the join and re-run it" rule is executable rather than aspirational. Python, standard library only. |
| `calibration/` | The revealed-preference pipeline. Turns iNaturalist observations and CO-OPS predictions into `shared/calibration.json`, with a refusal and a reason wherever the evidence does not support a rate. |
| `lidar-recon/` | Point-cloud and DEM investigation of the intertidal benches. Produces the findings under `lidar-recon/findings/` that back `floor_evidence` entries. Python, standard library only. |
| `ui-capture/` | Captures the rendered pages before and after a refactor and diffs the text, so a behaviour-preserving move can be proved rather than asserted. Playwright, `devDependency` only. |
| `verify-apis/` | Probes every upstream the stack depends on and reports status, latency, and the age of the newest observation. Not in CI: it calls live NOAA, IBWC and USGS endpoints, so a per-push run would be both flaky and rude. |

## What belongs here, and what belongs next door

Belongs here: anything whose output is a committed artifact — a findings file, a
report, a generated dataset — and whose code no page ever loads.

Belongs next door:

- **A value the app reads** goes in `shared/`, even if a tool produced it. That
  is the whole point of `shared/`: a data file both a producer and a consumer can
  see, owned by neither. `shared/target_taxa.json` moved out of
  `calibration/` for exactly this reason — the spot day page renders its target
  count, and an app importing a producer is the edge the boundary check forbids.
- **Logic the app and a tool both need** goes in the domain layer and is imported
  by the tool. The calibration pipeline reuses the CO-OPS parser rather than
  growing a second one, which is the only reason its numbers are comparable to
  the ones a page renders.
- **A repo-wide check or generator** goes in `scripts/`. Those run in CI; these
  do not.

The direction is the rule: a tool may read the domain, and nothing may read a
tool back. It is enforced, not described — `scripts/check-boundaries.mjs` states
the edges and CI runs it. See that file's table rather than a restatement here.

## Running them

```bash
npm run calibrate                                    # offline, against committed fixtures
npm run calibrate:fetch                              # live; the only mode that may write shared/calibration.json
npm run calibrate:taxa:check                         # re-verify every taxon id upstream
python tools/verify-apis/verify_coastal_apis.py      # exits nonzero only on real failures
python tools/lidar-recon/probes/<probe>.py           # each writes one findings file
npm run ui:capture -- <out-dir>                      # needs `npm run build` first
npm run ui:compare -- <before> <after>               # non-zero on any difference
```
