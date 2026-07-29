# Calibrating `tidepool_floor_ft`

How a floor moves from `confidence: low` to `confidence: verified`, and what
evidence is required to do it. Companion to `DECISIONS.md` §9 open items.

Nothing in this document sets a floor value. Floors are set by a human against
the evidence ledger below (CLAUDE.md, "Things that need a human, not a query").

---

> **Status, 2026-07-29.** Moved here from the repo root so it stops being an
> untracked working file. The prose below is **as written, uncorrected**. Three
> known defects are tracked in #40 and are *not* fixed here — do not read this
> document without them:
>
> 1. **§3 proposes a pipeline that already exists.** `calibration/` shipped
>    through #30/#32/#33 and performs this join with a denominator, cursor
>    paging, visit collapsing and four refusal gates. Read §3 as a statement of
>    intent, not as work outstanding.
> 2. **§6 invites tuning against the only independent check available.**
>    `README.md` in this directory lists "Cabrillo tuned to 0.7 ft" under *Not to
>    be done*: "The NPS figure is the only independent check available, and
>    tuning against it consumes it." Where §6 says the pipeline is wrong if it
>    misses 0.7 ft, the settled position is that 0.7 ft is spent **once**,
>    against the instrumented method, and the outcome recorded whichever way it
>    falls.
> 3. **`DECISIONS.md` is cited in six places and does not exist in this
>    repository.** `find . -iname 'DECISIONS*'` returns nothing. Whether it
>    exists off-repo is open question 2 of #38, so every §-reference to it below
>    is unverified — including §3's account of the observation timestamped 4.6
>    hours in the future, which is load-bearing for filters that shipped.
>
> Not in dispute, and the reason this was kept rather than deleted: §1's
> diagnosis of the +1.5 ft blanket raise, §2 and §4 as the instrumented methods,
> §5's refusal to gate swell on survivor-biased data, and §7's evidence ledger
> and promotion rule. #38 builds on all four.

---

## 1. What is wrong with the current values

### The +1.5 ft raise is a placeholder, not a calibration

v1.2.0 raised all 8 floors by exactly 1.5 ft. The symptom was real — 49 of 56
grid cells reading `above-floor` over a week is not what a week of San Diego
tides looks like. The fix is not.

A single constant applied to 8 spots asserts that every reef in the corridor has
the same shape. Cabrillo's broad shelf and a Sunset Cliffs ledge do not respond
to a foot of water the same way; that is already acknowledged in the flood-trim
note in DECISIONS §6. A blanket offset preserves the ranking between spots
exactly as the author's original estimates had it, which means the ranking has
never actually been tested. It just moved.

Treat 1.2.0 as "the grid now produces plausible output," not as a measurement.

### One field is doing two jobs

The 1.1.x values encoded **excellent** tidepooling. The 1.2.x values encode
**workable** tidepooling. Both are real quantities and users want both — but
one field can only hold one, and which one it holds silently changed between
versions with no schema signal.

Both fall out of the same artifact (§2), so this is cheap to fix:

| Field | Meaning | Role |
|---|---|---|
| `tidepool_floor_ft` | workable — bench is walkable, pools are readable | **gate**, unchanged |
| `tidepool_prime_ft` | excellent — low zone exposed, surfgrass out | **grade**, display only |

`tidepool_prime_ft` must not become a fifth gate. The predicate stays at four.
It renders as a badge on cells already passing the floor.

**Schema change — needs your call before implementation.**

### Beach-level slugs cover multiple benches

`la-jolla-cove` carries one floor. Three named tidepool benches sit inside it,
roughly 700 m apart end to end:

| Bench | lat, lon | Provenance |
|---|---|---|
| Shell Beach | 32.8488, −117.2762 | Google Places centroid |
| South Casa Beach | 32.8464, −117.2787 | Google Places centroid |
| "La Jolla Tide Pools" (Coast Blvd) | 32.8411, −117.2817 | Google Places centroid |

`la-jolla-shores` has the same issue — its tidepool audience is Dike Rock at the
north end, ~1 km from the pin, and Dike Rock does not resolve as a distinct
Places record at all.

These coordinates are **not inventory-grade.** They are third-party POI
centroids at roughly the same ~100 m precision the file already declares, from
an aggregator rather than a survey. They are listed to scope the problem, not to
be pasted into `spots.json` — and note that `la-jolla-cove` and
`la-jolla-shores` are already two of the 7 spots with `mpa_resolved: false`
*because* of coordinate precision. Adding more imprecise coordinates makes that
worse.

**Recommendation: do not fork sub-slugs.** Slugs are permanent primary keys and
data accumulates against them; forking is irreversible and doubles the
calibration burden before a single floor is verified. Instead, define a
beach-level floor as the **minimum across its benches** — the value that
requires the deepest tide.

That is rule 3, applied to elevation. Publishing the mean or the most generous
bench sends someone to Shell Beach on a window computed for a bench that
surfaces earlier. Publishing the minimum costs a marginal trip. The asymmetry
runs one way.

Revisit only if a bench turns out to be >0.5 ft off its neighbours, which the
hypsometry in §2 will tell you without any fieldwork.

---

## 2. The primary method: hypsometric curve per spot

If you know the bench's elevation relative to MLLW, the floor is not a judgment
call — it is a point on a curve.

**Inputs.** USGS CoNED 1 m topobathymetric DEM for the Southern California
coast, or NOAA Digital Coast topobathy lidar via the Data Access Viewer. Both
are open. Green-laser returns are patchy where clarity is poor, and vertical
reference differs by vintage — older tiles carry a tidal datum, newer ones the
ellipsoid. Run everything through NOAA **VDatum** into MLLW ft before any spot
is compared to any other spot. Pin the transformation parameters in the output;
an unrecorded datum conversion is the elevation equivalent of the IBWC m³/s
error.

**Computation.** Clip each spot's reef polygon, then compute exposed area as a
function of water level in 0.1 ft steps from +2.0 to −2.0 ft MLLW.

**Reading the curve.**

- `tidepool_floor_ft` — the level at which exposed area crosses a fixed minimum
  of walkable bench. Absolute, not relative, so it is comparable across spots.
- `tidepool_prime_ft` — the knee, where marginal area gained per 0.1 ft of drop
  peaks. Site-intrinsic. This is the number that explains why Cabrillo's
  published 0.7 ft works there and would be useless at a steeper reef.

The curve also answers the flood-trim question in DECISIONS §6 directly. The
0.6 factor is currently global and admitted to be crude; curve *slope* at the
floor is the per-spot version of the same idea. A flat shelf drains and refills
slowly and forgivingly; a steep one cuts you off. Don't tune 0.6 by feel once
you have slope.

**Sand burial is the main threat to validity.** The corridor's reefs bury and
scour seasonally, and a DEM is one moment. Any floor derived from lidar carries
the acquisition date and gets re-checked against a later acquisition before it
is promoted to `verified`.

---

## 3. The independent cross-check: revealed preference from iNaturalist

This runs on sources already verified live in this repo — iNaturalist (8,239
observations in the corridor bbox over 14 days) and CO-OPS 9410230. No new
dependency, no fieldwork. Built as `calibration/` — see `README.md` beside this
file. The `calibrate_floor.py` prototype this line originally pointed at was
retired in #39; what it got wrong is recorded there.

**Method.** For each qualifying low-zone observation, look up the predicted tide
at its timestamp. The resulting per-spot distribution answers "at what water
levels do people actually reach low-zone organisms here." The upper percentile
is an empirical workable ceiling derived from thousands of real visits.

### This method inherits a known-bad input — read this before trusting it

DECISIONS §3 already records iNaturalist returning an observation timestamped
4.6 hours in the future, from a hand-entered date, and files it as a permanent
property of citizen-science data rather than a one-off.

The tide join keys on exactly that field. An observer-supplied timestamp that is
wrong by four hours is, at San Diego's tidal rate, wrong by several feet of
water. Unfiltered, this method will confidently produce a floor from noise.

Required filters, all of them:

- `quality_grade=research` only
- `time_observed_at` present **with a timezone offset** — a date-only
  `observed_on` is unusable here and must be dropped, not defaulted to noon
- `|time_observed_at − created_at| ≤ 48 h`
- future-clamped: any `time_observed_at` after `created_at` is dropped outright
- `positional_accuracy ≤ 50 m`, and `obscured`/`private` coordinates excluded —
  iNat fuzzes threatened taxa to a 0.2° cell, which is larger than the corridor
- restricted to a low-zone indicator taxon list (surfgrass, low-zone anemones,
  articulated coralline turf, seastars)

Store UTC, convert at render. Request CO-OPS with `time_zone=gmt` — the
`lst_ldt` trap is documented and this join is exactly where it would bite again.

**Status of the output: evidence, never the number.** It is a cross-check
against the lidar-derived floor. Agreement raises confidence; disagreement means
one of them is wrong and neither ships.

---

## 4. Ground truth: pressure logger

A water-level logger left in a target pool through one spring-tide cycle gives
two things nothing else does: the pool's sill elevation directly, and the local
offset between the 9410230 prediction and what the water actually does at that
rock. That offset is unmeasured today and is probably not zero at any spot in
the corridor.

One logger, one spot, one fortnight is enough to validate the whole pipeline.
Do it at Cabrillo (§6) before spending effort on the other seven.

---

## 5. `swell_ceiling_ft` — available from the same corpus, with a caveat that
disqualifies it as a gate

The §3 join can be run a second time against CDIP significant wave height
instead of tide. The upper percentile of Hs at which people were still on the
reef is a first estimate of that spot's swell tolerance.

**It is biased permissive and must not be wired to gate 3 as-is.** The corpus
contains only trips that happened. Every visit someone aborted from the parking
lot, and every visit that ended badly enough that nobody uploaded a photo, is
absent. The method therefore reports the ceiling of *observed survivors*, which
is at or above the true safe ceiling — it fails **away** from the restriction,
against rule 3, on the one gate where DECISIONS §6 says exceeding it
disqualifies outright rather than downgrading.

Use it to rank spots by relative tolerance (Cabrillo's shelf vs a Sunset Cliffs
ledge), which is what §9 says is missing. Do not use it to set the absolute
number. That still needs local knowledge.

---

## 6. Validate against Cabrillo first

NPS publishes an operational threshold for the Cabrillo tidepools of 0.7 ft or
lower, and enforces it — groups of ten or more need a permit for visits at or
below that level. That is a defended, externally-authored number for one of the
8 spots in scope.

Run the full pipeline at `cabrillo-tidepools` and compare. If lidar hypsometry
and the iNaturalist distribution do not land near 0.7 ft, the pipeline is wrong
and the other seven spots are not worth computing yet.

Two things to be careful about:

- 0.7 ft is a **workable** threshold — it is the access/permit line, not the
  "excellent" knee. It calibrates `tidepool_floor_ft`, not `tidepool_prime_ft`.
- NPS publishes it as its own operator. Read it from nps.gov, not from a travel
  site quoting nps.gov. A republisher is not the publisher.

**Related, and cheap:** Google Places currently reports the Point Loma tidepool
area as 9:00 AM – 4:30 PM daily, which would resolve the `access_hours` open
item in DECISIONS §9. Same rule applies — confirm against nps.gov before storing
it, and treat gate hours as a fifth constraint on Cabrillo only, not a new
global gate.

---

## 7. Evidence ledger

Floors stop being author estimates when they carry provenance. Proposed block,
attached per spot:

```jsonc
"floor_evidence": [
  {
    "method": "lidar_hypsometry",   // | inat_revealed | pressure_logger
                                    // | marine_topography | published_threshold
    "source": "USGS CoNED SoCal TBDEM 1m",
    "source_date": "2014-01-01",    // acquisition, not download
    "value_ft": null,               // MLLW, per file conventions
    "datum_transform": "VDatum <version>, <input datum> -> MLLW",
    "n": null,                      // sample count where applicable
    "run_date": "2026-07-28",
    "note": ""
  }
]
```

`value_ft: null` means the method has not been run. It does not mean the method
found nothing — if a method runs and produces no usable result, that is a
populated entry with a note, exactly as `county_station_null_reason` works.

### Promotion rule

`tidepool_floor_confidence` moves `low` → `verified` only when:

1. Two or more entries from **different** methods agree within 0.3 ft, and
2. at least one of them is instrumented — lidar hypsometry, a pressure logger,
   or MARINe transect topography. Two agreeing estimates from citizen-science
   inference are one method run twice.

Anything else stays `low`. A floor with three pieces of weak evidence is still
weak, and the enum only has two values, so there is nowhere to put "better than
an author estimate but not surveyed."

**Open question for you:** does `FloorConfidence` need a middle value? Adding
one touches `spots.generated.ts`, the window predicate, and every UI surface
that renders confidence, so it is not a drive-by change. The alternative is to
let `floor_evidence` carry the nuance and leave the enum binary. I'd lean
binary, but it's your call.

---

## 8. Also worth pulling: MARINe

MARINe's Biodiversity Surveys sample four components along the same transects,
one of which is topography — elevation relative to MLLW — across 200+ rocky
intertidal sites from Alaska to Mexico. If any corridor spot is in the network,
the surveyed elevation already exists and §2 is unnecessary there.

Worth an hour to check the site list before modelling anything.

---

## 9. What this does not solve

- Sand burial state at time of use. A verified floor is verified for a bed
  configuration, not forever.
- The 0.6 flood trim, until curve slope replaces it.
- `swell_ceiling_ft` absolute values (§5).
- Surveyed coordinates for the 7 `mpa_resolved: false` spots. Unrelated problem,
  same root cause: nobody has stood at these places with a survey-grade receiver.
