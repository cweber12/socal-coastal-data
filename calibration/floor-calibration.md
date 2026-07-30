# Calibrating `tidepool_floor_ft`

How a floor moves from `confidence: low` to `confidence: verified`, and what
evidence is required to do it. The open items it belongs beside are #38 and its
child issues.

Nothing in this document sets a floor value. Floors are set by a human against
the evidence ledger below (CLAUDE.md, "Things that need a human, not a query").

---

> **Status, 2026-07-30.** Moved here from the repo root in #47 so it stops being
> an untracked working file. **§3 and §6 have since been rewritten, and every
> `DECISIONS.md` reference removed**, under #40. Everything else is as originally
> written.
>
> No known defect remains outstanding in this document.
>
> What the rewrites changed:
>
> - **§3 reports rather than proposes.** `calibration/` shipped this cross-check
>   through #30/#32/#33, with a denominator, cursor paging, visit collapsing and
>   four refusal gates. §3 now states what `shared/calibration.json` contains,
>   where the shipped method diverges from the method §3 originally specified,
>   and which of its required filters did not ship.
> - **§6 spends the NPS 0.7 ft figure once.** It previously said the pipeline is
>   wrong if it misses 0.7 ft, which invites iterating the method until it lands
>   there — `README.md` in this directory lists "Cabrillo tuned to 0.7 ft" under
>   *Not to be done*: "The NPS figure is the only independent check available,
>   and tuning against it consumes it." §6 now spends it once, against the
>   instrumented method in §2, with the outcome recorded whichever way it falls.
> - **Every `DECISIONS.md` citation is gone**, replaced by the in-repo source that
>   records the same fact. That file exists, but off-repo and as a v1.1.1-era
>   snapshot whose §9 still gives Sunset Cliffs as −0.8 ft and Cabrillo as −0.2 ft
>   — the pre-raise floors. It was therefore not committed: a companion document
>   disagreeing with `shared/spots.json` about floor values, by exactly the +1.5 ft
>   §1 is about, is the failure this repo exists to prevent. Each replacement
>   points at code, a committed artifact or an issue, so it can be checked and it
>   moves when the thing it describes moves.
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
to a foot of water the same way; that is already acknowledged by the flood trim in
`lib/windows.ts`, where `FLOOD_SIDE_TRIM = 0.6` is documented as "a safety margin,
not a measurement". A blanket offset preserves the ranking between spots
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
hypsometry in §2 would tell you without any fieldwork — **but §2 is blocked on not
knowing where any of these benches are**, and `la-jolla-cove` is the spot where that
blocker bites hardest. Treat this as deferred rather than answerable today.

---

## 2. The primary method: hypsometric curve per spot

If you know the bench's elevation relative to MLLW, the floor is not a judgment
call — it is a point on a curve.

**Inputs.** USGS CoNED 1 m topobathymetric DEM for the Southern California
coast, or NOAA Digital Coast topobathy lidar via the Data Access Viewer. Both
are open. Green-laser returns are patchy where clarity is poor. Run everything
through NOAA **VDatum** into MLLW ft before any spot is compared to any other
spot. Pin the transformation parameters in the output; an unrecorded datum
conversion is the elevation equivalent of the IBWC m³/s error.

**Correction, 2026-07-30.** This paragraph used to say that vertical reference
"differs by vintage — older tiles carry a tidal datum, newer ones the
ellipsoid," and that the difference was the whole risk. That was measured and is
wrong. `lidar-recon/` read the metadata of all seven candidate products covering
these 8 spots: **none carries a tidal datum and none carries an ellipsoidal
height. All are NAVD88**, an orthometric datum that is neither, per CoNED's own
abstract — "all tidally-referenced heights were transformed into orthometric
heights … based on the North American Vertical Datum of 1988."

The premise told a reader where to look, so the checks it implied would all have
passed while the real hazards went unexamined. The hazards that are actually
present, from `lidar-recon/README.md`:

- Two of six rasters declare no vertical datum at all — and one of them, 8684, is
  the *interpolated* product with the clean coverage, whose void-preserving twin
  2616 does declare NAVD88. The tile a coverage-optimising pipeline would reach
  for is the unsafe one.
- One product, 13968, is in **US survey feet** (`altres` exactly 1200/3937) where
  everything else is metres.
- The geoid model is ambiguous across GEOID12A/12B/18 and no raster records it.
- **VDatum's own uncertainty is ±0.299–0.313 ft at these spots**, which meets or
  exceeds §7's 0.3 ft promotion tolerance before the DEM contributes anything.
  That is #65, and it is why §4 rather than this section is now the primary route
  to `verified`.

**Computation.** Clip each spot's reef polygon, then compute exposed area as a
function of water level in 0.1 ft steps from +2.0 to −2.0 ft MLLW.

**Blocked, 2026-07-29, and not on tooling: the clip cannot be located.** No reef
polygon exists anywhere in this repo — `spots.json` carries one lat/lon per spot and
nothing else — and a buffer around that coordinate cannot stand in for one. At **3 of
the 8 spots, every one of the five decoded products agrees that the ±100 m disc the
coordinate's own error bar admits holds no pixel below 0 m NAVD88 at all.** Converted
through each spot's own VDatum offset, the lowest ground the published coordinate
reaches — as a range across those five products, because they do *not* agree closely
on the value:

| spot | VDatum offset ft | lowest ground in ±100 m | against the range above |
|---|---|---|---|
| `windansea` | +0.240 | **+8.77 to +11.74 ft MLLW** | entirely above +2.0 |
| `sunset-cliffs` | +0.240 | **+7.77 to +9.33 ft MLLW** | entirely above +2.0 |
| `la-jolla-shores` | +0.262 | **+0.96 to +1.76 ft MLLW** | inside, but nothing below +0.96 |

Raw values in `findings/coverage-measured.json` and `findings/vdatum-transforms.json`;
the column above is `min_m * 3.280833 + offset`. Two corrections to how
`lidar-recon/README.md` §7 states this, both found while writing this note:

- §7 says of these spots that "that entire range is outside the data the coordinate
  reaches." True at the two cliff spots, overstated at `la-jolla-shores`, whose lowest
  pixel does land inside the band — with the bottom 3 ft of a 4 ft band empty. There
  is no curve either way.
- §7 counts **`torrey-pines-beach` as a fourth such spot on a three-product table.
  The five-product picture is a flat contradiction, not an agreement.** Four products
  put its floor at +3.50 to +3.97 ft MLLW with no sub-zero pixel; the 2014 NCMP tile
  (5189) reads **−9.11 ft MLLW over 8.8% of the same disc** at 93.8% coverage, against
  CoNED's 100%-coverage claim of a +3.50 ft minimum for the same ground. One of those
  is wrong and this document does not resolve which. Note the direction of the
  awkwardness: 5189 is the tile §7 shows *missing its low ground* elsewhere — 47.2%
  coverage on the wet reef at Cabrillo, 49.1% at Cardiff — so the one product that
  finds intertidal ground here is the one least trusted to have it.

Those coordinates sit inland of the bench by roughly **100–400 m**, measured rather
than estimated (`findings/coordinate-offset-widening.json`, product 2616): `windansea`,
`la-jolla-shores` and `sunset-cliffs` first reach any sub-zero pixel at **±200 m**, and
`torrey-pines-beach` is still entirely above 0 m at ±300 m and does not go negative
until **±500 m** — and then over only 1.2% of the disc.
`cabrillo-tidepools` fails the other way: its median *rises* going inland, and its
disc fills with bluff while the bench is a narrow shore-parallel strip. Widening the
clip is therefore not a workaround at any spot; it trades a window with no reef in it
for a window that is mostly cliff.

**Correction, 2026-07-29, under #80: the Cabrillo figures this paragraph used to
carry were wrong, and the sentence above has been rewritten to drop them.** It said
the median rises "14.7 m at ±100 m → 19.3 → 24.8 m at ±300 m → 32.6 m at ±500 m".
Every one of those windows was clipped at a tile edge and the clipped side was the
**seaward** side — the pin sits 28 m east of tile 11SMS770135's western boundary in
both products, so the window could only widen inland, and a window that can only
widen one way shows a rising median whether or not the terrain does. Re-measured on a
2×2 tile mosaic the series is **6.9 → 11.2 → 15.0 → 15.9 m**, and the ±100 m
fraction of pixels below 0 m NAVD88 is **0.21, not 0.025**. The three ±200 m results
above are on full windows and are unaffected. Detail, and what else was truncated, in
`lidar-recon/README.md` §7 and `lidar-recon/findings/window-truncation.json`. `la-jolla-cove` reaches **−15.6 ft MLLW**, which is deep water rather
than intertidal, consistent with the 1142 m conflict between its coordinate and
MARINe's published position that #45 left unresolved.

**This is upstream of every other hazard in this section.** A correct tile, a correct
datum and a correct transform still produce a meaningless curve if the clip is a
circle centred 300 m inland. The published pins are not defects — they mark surf
spots, plausibly bluff-top or parking — they are simply not on the rock, and bench
geometry is a separate field if it is anything.

**Drawing the polygons does not obviously fix it, and #63 fails its own acceptance
test.** #63 scoped the eight polygons and required that perturbing one by its stated
positional uncertainty move the derived floor by less than 0.1 ft, or the polygon is
the dominant error term and the floor is not instrumented evidence. The
±0.299–0.313 ft above fails that before a polygon contributes anything, and eight
hand-traced benches would inherit their imagery's georeferencing on top of it. #63's
own open question asked whether the work was worth doing; on the absolute floor the
answer it was measuring for is no.

**What survives is the part that needs no absolute floor.** VDatum's uncertainty is on
a **pure additive offset** — verified linear at Cabrillo over z = 0, 1, 2, −1 m, with
uncertainty constant at 0.305 ft *regardless of z*, because it is the uncertainty of
the tidal surface and not of the elevation. An additive offset does not change curve
*slope*, so the figure that kills the absolute floor does not, on its face, touch the
flood-trim result two paragraphs below or the relative shape across spots. Whether
slope also survives a wrong polygon *boundary* is an expectation and not a
measurement: a boundary drawn slightly wrong at its edges changes area magnitude while
the cross-shore gradient that dominates dA/dz survives, but a boundary in the wrong
*place* destroys both. #63 conflated edge imprecision with gross mislocation. One
perturbation test at Cabrillo settles it, and until it is run nothing in this section
is available.

**Run 2026-07-29 under #80, and slope did not survive it.** A real polygon — OSM way
975130801, `natural=reef`, traced from Mapbox Satellite, ±25 m stated — perturbed by
erosion, dilation and translation, over products 2616 and 6260. Normalised curve slope
at the knee moves **25–27%** at the stated uncertainty and the normalised curve itself
by up to **0.246**, which is the same order as the floor level's movement. The one
quantity that held perfectly was the knee's *location*, `tidepool_prime_ft`: 0.0 ft
across every product, extent and perturbation kind.

**And that one is defeated by something else.** With the polygon held fixed, the two
products §8 of the recon recommends put the knee **0.4 ft apart** (+0.3 ft against
+0.7 ft) and their normalised peak slopes differ by **91%**, because they do not
sample the same elevation range on the same rock: 6260's lowest pixel inside the
mapped bench is −1.56 ft MLLW, so it cannot produce the +2.0 → −2.0 ft curve at all,
while 2616 reaches −14.0 ft there. Coverage on the bench is 82% and 67%, and the voids
are on the wet side. **The blocker was never the polygons.** Full result in
`lidar-recon/README.md` §10 and `lidar-recon/findings/cabrillo-slope-gate.json`.
Whether #46 closes on that is a decision and is not taken here; nothing in this
section moved a floor.

One thing #63 got backwards, now measured: alongshore translation is benign
(`shape_dev` 0.033–0.036 at ±25 m) but uniform erode/dilate — edge imprecision, the
failure #63 expected to survive — is the **worst** of the three perturbations, ahead
of cross-shore mislocation. On a narrow shore-parallel strip, moving the edges changes
which elevation band is inside the polygon, and that is the curve.

**Reading the curve.**

- `tidepool_floor_ft` — the level at which exposed area crosses a fixed minimum
  of walkable bench. Absolute, not relative, so it is comparable across spots.
- `tidepool_prime_ft` — the knee, where marginal area gained per 0.1 ft of drop
  peaks. Site-intrinsic. This is the number that explains why Cabrillo's
  published 0.7 ft works there and would be useless at a steeper reef.

The curve also answers the flood-trim question directly. `FLOOD_SIDE_TRIM = 0.6`
in `lib/windows.ts` is global and its own comment calls it a safety margin rather
than a measurement; curve *slope* at the floor is the per-spot version of the same
idea. A flat shelf drains and refills
slowly and forgivingly; a steep one cuts you off. Don't tune 0.6 by feel once
you have slope.

**Sand burial is the main threat to validity.** The corridor's reefs bury and
scour seasonally, and a DEM is one moment. Any floor derived from lidar carries
the acquisition date and gets re-checked against a later acquisition before it
is promoted to `verified`.

---

## 3. The independent cross-check: revealed preference from iNaturalist

**This is built.** It shipped as `calibration/` through #30/#32/#33 — see
`README.md` beside this file — and its output is committed as
`shared/calibration.json`, rendered on the day chart by #33. Nothing in this
section is work outstanding. The `calibrate_floor.py` prototype this section
originally pointed at was retired in #39; what it got wrong is recorded there.

**`calibration/` grades a day. This document gates a spot.** That directory
publishes, per spot, the observed rate at which a recorded visit logged one of a
frozen list of target species, binned by that day's lowest predicted low. It
sets no floor and makes no zonation claim. This document is about the separate
question of what floor a spot gets.

The two connect because the axes are the same quantity. `lib/windows.ts` defines
`above-floor` as "the low never reaches the floor", so a day passes the floor
gate exactly when its lowest low falls below the floor — which is the axis the
bins are on. A floor can therefore be read as *the worst day it admits*, and the
bin table says what that day's observed rate was. That is what makes a
day-grading count usable as evidence about a spot-level gate. It is not a floor:
crossing from a rate table to a number needs a declared marginal-rate policy and
a declared threshold, chosen before the rates are looked at. That is #42, and it
does not exist yet.

### What it produces

`shared/calibration.json` v1.0.0, pulled 2026-07-29: corpus from 2016-01-01,
500 m radius, predicted tide from CO-OPS 9410230 in feet above MLLW, taxa
v1.0.0, spots v1.2.0, content hash `b541c249…`. Bin edges
`[-2.5, -1.0, -0.5, 0.0, 0.5, 1.0, 3.0]`.

Cabrillo — 1,223 visits, 3,132 records, 806 observers, amplitude ratio 11.83×:

| day's lowest low (ft MLLW) | visits | hits | rate |
|---|---|---|---|
| −2.5 to −1.0 | 383 | 259 | 67.6% |
| −1.0 to −0.5 | 247 | 142 | 57.5% |
| −0.5 to 0.0 | 330 | 139 | 42.1% |
| 0.0 to 0.5 | 148 | 38 | 25.7% |
| 0.5 to 1.0 | 80 | 12 | 15.0% |
| 1.0 to 3.0 | 35 | 2 | 5.7% |

Corridor-wide, **three of eight spots publish and five refuse**, each refusal
carrying a `null_reason`:

| slug | visits | observers | amplitude | verdict |
|---|---|---|---|---|
| cabrillo-tidepools | 1223 | 806 | 11.83× | publishes |
| sunset-cliffs | 404 | 264 | 9.63× | publishes |
| swamis | 237 | 185 | 5.04× | publishes |
| la-jolla-cove | 354 | 307 | 0.85× | refuses — amplitude, not declining |
| la-jolla-shores | 239 | 115 | 0.67× | refuses — amplitude, not declining |
| windansea | 99 | 89 | 1.38× | refuses — amplitude |
| cardiff-reef | 74 | 50 | 1.00× | refuses — amplitude, too few usable bins |
| torrey-pines-beach | 31 | 28 | n/a | refuses — 3 of 4 criteria |

**The five refusals are not thin-data problems.** la-jolla-cove has 354 visits
and an amplitude ratio *below* 1.0; la-jolla-shores has 239 visits and 2 of 15
comparable bin pairs declining with height where 70% is required. More
citizen-science data does not fix a spot whose low-tide rate does not exceed its
own tide-independent background. Only elevation reaches those five, which is why
§2 is not optional.

### Where the shipped method differs from the method proposed here

Recorded because this section originally specified the method, and seven of its
particulars were settled differently on measurement in #30/#32. Read the shipped
column as authoritative.

| this section proposed | `calibration/` ships | why |
|---|---|---|
| predicted tide **at the observation timestamp** | the **minimum predicted height over the local day** in `America/Los_Angeles` | #30 measured the day's low discriminating 2–3× more strongly. Someone on the reef for ninety minutes around a −1.5 ft low sees what a −1.5 ft low uncovers, wherever their shutter fell. It is also the quantity the floor gate is on. |
| the upper **percentile** of the resulting distribution | the **per-bin rate over visits**, counts published raw | A percentile of qualifying observations has no denominator: it cannot separate "the low zone is unreachable above X" from "the tide is seldom below X" from "people visit at midday". |
| one observation, one data point | one **visit** = one `(observer login, observed_on)` pair, collapsed before anything is counted | Without it, one photo-heavy walk votes thirty times and the rate is a rate over cameras. |
| a low-zone indicator taxon list, used as a **filter** | `target_taxa.json`: 7 frozen targets as a **label**, plus 6 denominator taxa establishing that a visit happened, matched on `taxon.id` or `taxon.ancestor_ids` | Filtering to the targets makes the targets their own denominator and every rate 1.0. The list is frozen before anything is computed, and its membership is #30's probe list so #30's figures stay checkable. |
| `positional_accuracy ≤ 50 m` | **not filtered**; the null-accuracy and imprecise-accuracy fractions are reported separately | Per #32: iNat's `acc_below` silently drops null accuracy along with imprecise accuracy, and #30 measured those at Cabrillo as 21.5% and 14% — two different things arriving as one number. |
| `obscured`/`private` excluded | excluded, but **in memory rather than server-side** | #32 requires obscuring losses by taxon as a diagnostic, and a record filtered server-side cannot be counted. Identical record set, measurable this time. An obscured coordinate is randomised within a ~0.2° cell, so it is never placed and never binned. |
| `\|time_observed_at − created_at\| ≤ 48 h` | **did not ship.** `created_at` is not even requested | The predictor is the day's low, so an observer timestamp wrong by hours moves nothing unless it crosses local midnight. That is a weaker guard than a 48-hour window, not an equivalent one — see below. |

Unchanged and shipped as written: `quality_grade=research` only, sent
server-side with its attrition measured by a separate count query; UTC stored
and converted at render; CO-OPS requested with `time_zone=gmt`, which is visible
in every query string recorded in `shared/calibration.json`. A
`time_observed_at` carrying no explicit UTC offset **raises** rather than being
dropped, and is never defaulted to noon. A date-only `observed_on` is now usable
rather than unusable, because the predictor no longer needs the instant.

### This method inherits a known-bad input — read this before trusting it

iNaturalist has been observed returning an observation timestamped 4.6 hours in the
future, from a hand-entered date — a permanent property of citizen-science data
rather than a one-off. #30 measured the attrition and found zero future-dated
records across every filtered spot-zone in the historical corpus, against a
14-day recent window where they do appear. The filter that resulted is in the
repo: `calibration/src/acquire.ts:264` counts them, `:340` documents why, the
`future-dated dropped` diagnostic is emitted at `calibration/run.ts:285`, and
`calibration/src/acquire.test.ts:286` holds the regression test.

Future-dated records are dropped and counted in `acquire.ts`. #30 measured
**zero** of them across every filtered spot-zone, and the check stays anyway,
because "we measured zero once" is not "this cannot happen" and a count of zero
is itself the finding.

The rest of the four-hour problem is blunted rather than filtered. Joining at
the instant, a timestamp wrong by four hours is wrong by several feet of water at
San Diego's tidal rate; joining on the local day's low, it is wrong only when the
error crosses midnight. That is the substitute the 48-hour `created_at` guard
never got, and it is genuinely weaker: a hand-entered date wrong by a whole day
lands the visit in the wrong day's bin and nothing in the pipeline notices.

### A second inherited input, measured 2026-07-29: the disc is centred on the pin

The pull is a 0.5 km disc around each `spots.json` coordinate, and §2 above
measures those coordinates sitting 100–400 m inland of the bench. 500 m is wide
enough to *contain* a bench 300 m away, which is not the same as being centred on
it, and it had never been checked. It has now — `lidar-recon/probes/rate_centring.py`,
iNaturalist count queries only, reproducing this file's own `records` figures
exactly at 7 of 8 spots.

**The three spots that publish are the three whose disc is centred. The five that
refuse are the five whose disc is not.** Recentring a 0.5 km disc within ±500 m of
the pin finds 1.5× the records at `la-jolla-shores`, 1.6× at `cardiff-reef`, 2.0× at
`torrey-pines-beach`, 3.0× at `la-jolla-cove` and **5.5× at `windansea`**, against
1.00–1.01× at `swamis`, `sunset-cliffs` and `cabrillo-tidepools`. All five best
offsets sit on the search grid's boundary, so those are lower bounds.

This is not licence to move a coordinate — that is a join against an authority, not
a fit to observation density — and it does not overturn any refusal. Three cautions
carry equal weight: counts are observations rather than visits and skip every
in-memory filter; a disc recentred 500 m away may be aggregating two benches, which
§1 already flags as its own defect rather than a fix; and `la-jolla-cove` and
`la-jolla-shores` refuse on the amplitude gate, which more records need not move.

What it does mean is that **"thin data here" and "the disc is in the wrong place"
are not currently distinguishable at five spots**, and the pipeline reports the
first. `windansea` is the cheapest test in the corridor: it refuses on one criterion
at 1.13× against a 2.0× bar with 99 visits, and its best disc holds 5.5× the
records. `lidar-recon/README.md` §11 has the table and the open questions.

**Status of the output: evidence, never the number.** It is a cross-check
against the lidar-derived floor of §2. Agreement raises confidence; disagreement
means one of them is wrong and neither ships. By §7's promotion rule this route
cannot promote a floor on its own at any sample size — two agreeing
citizen-science estimates are one method run twice. And it is **not** what the
NPS 0.7 ft figure gets compared against; see §6.

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
against rule 3, on the one gate where exceeding it disqualifies outright rather
than downgrading — `lib/windows.ts` ranks `veto` below `brief` precisely because
"a swell over the ceiling is a settled no".

Use it to rank spots by relative tolerance (Cabrillo's shelf vs a Sunset Cliffs
ledge), which is what `shared/thresholds.json` records as missing: "Every one of
the 8 spots the grid does render uses `default_swell_ceiling_ft`. No per-spot
swell calibration exists for any of them." `lib/thresholds.ts` says the same in
its header — "Nothing here is calibrated." Do not use it to set the absolute
number. That still needs local knowledge.

---

## 6. The NPS 0.7 ft check, spent once, at Cabrillo

NPS publishes an operational tide threshold for the Cabrillo tidepools and
enforces it. It is the same number everywhere it appears and it does not appear
with the same meaning. Every statement of it on nps.gov, all read 2026-07-29:

| page | what it says about 0.7 | page last updated |
|---|---|---|
| `/thingstodo/visit-the-cabrillo-tidepools.htm` | "At Cabrillo, a 0.7 tide or lower will give you the **best ability to explore** the actual tidepools." | 2025-12-17 |
| `/cabr/learn/nature/full-year-tide-table.htm` and the twelve monthly `<month>-tide-table.htm` pages | that same sentence verbatim as the standing header above each table — 13 pages, one occurrence each | — |
| `/cabr/learn/nature/tidepools.htm` | "At Cabrillo, a tide of 0.7 or lower provides the **best opportunity** to explore the tidepools." … "ensuring your visit coincides with the **optimal conditions** for tidepool exploration." | 2026-06-30 |
| `/articles/000/cabr-tidepools-top-10-tips.htm` | "A tide of 0.7 or below **should expose the tidepools**." | 2024-02-03 |
| `/cabr/learn/management/compendium.htm` — Superintendent's Compendium, 36 CFR §1.5(d) public use limit, approved by the Superintendent 2025-12-17 | "The use of the tidepools by groups is not to exceed 120 persons per day on weekdays, and 40 persons per day on weekends and holidays, **any time the low tide is 0.7 or lower** during park hours." | 2026-05-27 |
| `/thingstodo/visit-the-cabrillo-tidepools.htm`, Details → Reservations | "Large groups must request a reservation for a visit to the tidepools when tides are **lower than 0.7 feet above sea level**." | 2025-12-17 |
| `/cabr/planyourvisit/tidepool-permits.htm` | still a placeholder: "This page is currently being worked on. Please check back later." | — |

Two properties of that record before any of it is used. The same rule is stated
with two different boundaries — the compendium binds at "0.7 or lower" and the
Details block at "lower than 0.7", so they disagree about 0.7 itself. And the
published viewing window is not consistent across pages either: "approximately
two hours before low tide time … and two hours after", "An hour before and an
hour after the peak of the low tide", "an hour or more before and after the low
tide time". These are separately authored pages, not one calibrated standard,
which is why the differences in wording below cannot be adjudicated by reading
them more closely.

That is a defended, externally-authored number for one of the 8 spots in scope,
and it is the only one in the corridor. No other spot here has an external
threshold to check against, so this figure is not a repeatable test — it is a
**single-use** one, and how it is spent determines whether it is worth anything.

### The rules for spending it

1. **It is compared against the instrumented method of §2, at
   `cabrillo-tidepools`, and against nothing else.** Not against §3's output.
   `README.md` in this directory lists "Cabrillo tuned to 0.7 ft" under *Not to
   be done*: "The NPS figure is the only independent check available, and tuning
   against it consumes it."
2. **§2's parameters are frozen in writing before the comparison runs** — DEM
   tile and acquisition date, VDatum version and the exact transform, the
   exposed-area minimum that defines "walkable", the 0.1 ft step. A parameter
   revised after seeing the comparison is tuning, whatever the commit message
   calls it.
3. **The outcome is recorded whichever way it falls**, as a `published_threshold`
   entry in §7's `floor_evidence` alongside the `lidar_hypsometry` entry, with
   the read date and the URL. A disagreement is a result, and the entry recording
   it is worth as much as an agreement.
4. **Agreement within 0.3 ft** satisfies clause 1 of §7's promotion rule with an
   instrumented method on one side, so Cabrillo becomes the first spot that can
   move to `verified`.
5. **Disagreement is a finding, not a defect to iterate away.** It is recorded,
   and the other seven spots are not computed until it is understood — one of the
   two is wrong, and computing seven more from the wrong one wastes the work. What
   disagreement does *not* license is returning to §2 to re-fit it: the check has
   been spent, and a second pass against the same number measures nothing.
6. **Which of §2's two outputs 0.7 is compared against is declared in writing
   before the comparison runs.** §2 reads two numbers off the same curve: the
   floor, where exposed area crosses the walkable minimum, and the knee, where
   marginal area per 0.1 ft peaks. Compared against the wrong one, the difference
   has a magnitude but no interpretation — and rule 5 would then halt the other
   seven spots over a field mismatch dressed as a measurement disagreement.
   **This is not currently settled**, and the first bullet below is why.

The earlier version of this section said the pipeline is wrong if lidar and the
iNaturalist distribution do not both land near 0.7 ft. That is the failure mode
above: a stated licence to keep adjusting until the number appears, which would
convert the corridor's only independent check into a fitted constant.

**On the resemblance already in the open.** #38 notes that at Cabrillo a 0.7 ft
floor admits a marginal band whose observed rate is 15.0%, and that the NPS line
therefore falls where the curve sits at roughly 2.6× its own background. That
arithmetic is published and cannot be unseen, but noticing it is not the same as
checking anything: one side is a citizen-science count and the other a published
operator threshold, with no instrument between them. It must not be used to
choose X in #42 — choosing X because it reproduces 0.7 ft is choosing X from the
output, and it would spend the check on the wrong method into the bargain. Note
also what that arithmetic assumes: "a 0.7 ft floor admits a marginal band" reads
0.7 as a floor, which is the very thing the first bullet below finds unsettled.
It is not a check, and it is not even a well-posed resemblance until the field is
known.

### Three things to be careful about

- **Which field 0.7 calibrates is unresolved, and the published record cannot
  resolve it.** An earlier version of this bullet asserted that 0.7 ft is a
  *workable* threshold — "the access and permit line, not the 'excellent' knee" —
  calibrating `tidepool_floor_ft` rather than the `tidepool_prime_ft` of §1. The
  record above does not support that. It does not support the opposite either:

  - **Three of the statements are superlatives** — "best ability to explore",
    "best opportunity", "optimal conditions" — and the first of them stands as
    the header on all 13 of the park's own tide tables. That is §1's
    *excellent*, not the level at which the bench first becomes worth the trip.
  - **One is an exposure threshold.** "A tide of 0.7 or below should expose the
    tidepools" is §1's *workable*, stated about as plainly as NPS states it
    anywhere.
  - **The permit clause is evidence for neither.** It fires on tides *lower* than
    0.7 — the good ones — and the compendium supplies its own reason: "Group
    sizes are limited to preserve the natural resources … on high visitation
    days, which include weekends and holidays", and the limit "also assists in
    maintaining a positive visitor experience for the general public." (The
    elision is a parenthetical reading "rocky intertidal habitat", set off by a
    dash character this fetch could not decode; it is elided rather than
    reproduced for that reason.) That is a §1.5(d) public use
    limit pegged to the days people turn up. An accessibility floor would gate
    the other direction.

  So the workable/prime distinction is **§1's, not NPS's**. One number does three
  jobs — the best conditions, the level that uncovers the bench, and the crowd
  trigger — which is what an operator with a single rule of thumb would publish,
  and it means the publisher never drew the line we need it to have drawn.
  Assigning 0.7 to one of our two fields would be our choice, not theirs, and by
  rule 1 the entire worth of this figure is that it is externally authored.
  Choosing its meaning to fit our schema destroys the thing being spent.

  Neither reading reconciles with this file's own history, which is informative in
  itself: read as prime, 0.7 ft sits 0.9 ft from the −0.2 ft that `spots.json`'s
  `unresolved` array says encoded excellent tidepooling; read as workable, it sits
  0.6 ft from the current +1.3 ft. Both exceed the 0.3 ft of §7's promotion rule,
  so no reading makes the existing author estimates agree with NPS. That is
  arithmetic on values already published in #38, not a comparison against §2, and
  it does not spend anything.

  Recording this does not require `tidepool_prime_ft` to exist — the §1 schema
  split stays out of scope. It requires only that the field be named, or named as
  unknown, before the comparison runs. That is rule 6.
- **Read it from nps.gov, not from a republisher — and read past the visitor
  pages.** A travel site quoting nps.gov is not the publisher. The obvious page,
  `/cabr/planyourvisit/tidepool-permits.htm`, was still a placeholder on
  2026-07-29; re-verified, unchanged. The correction this bullet needs is the
  reverse of the one it used to carry. It said the published rule gives "large
  groups" with **no number**, and that an earlier "groups of ten or more" was
  unsupported. The ten was indeed unsupported — but the numbers are published:
  the Superintendent's Compendium sets **120 persons per day on weekdays and 40
  on weekends and holidays**, and requires groups to car pool on weekends and
  holidays. It was missed because it sits in the regulatory instrument rather
  than on any visitor page, which is the general lesson. The compendium is where
  this park's thresholds are actually defended, and it is the document to read
  first next time.
- **The datum is not published, and the whole comparison turns on it.** The
  permit sentence says "0.7 feet above sea level". This stack works in feet above
  **MLLW** at 9410230, and `shared/calibration.json` bins in the same units. NPS
  names no datum on any of those pages, including its own full-year tide table.
  Read literally, "above sea level" would be MSL, which at 9410230 stands 2.73 ft
  above MLLW — CO-OPS station datums, 1983–2001 epoch: MSL 7.10 ft, MLLW 4.37 ft
  on the station datum. A literal reading would put the threshold at 3.43 ft
  MLLW, not 0.7, and would compare the wrong quantity by more than the entire
  decision region. Against that: `/cabr/learn/nature/tidepools.htm` quotes "high
  tide was 7.3ft at 8:00am and low tide was a -2.0 at 3:08pm", and referenced to
  MSL that high would be 10.0 ft MLLW — 3.1 ft above the highest high water in a
  full year of 9410230 predictions (6.909 ft MLLW, 2016, `interval=hilo`) and
  4.7 ft above MHHW. So the NPS figures are consistent with MLLW and inconsistent
  with MSL, and "above sea level" is loose phrasing rather than a datum
  declaration. **That is an inference, recorded as one, and an inference is not
  good enough for a check that can only be spent once.** Confirm the datum with
  NPS before spending it.

  Two observations from the 2026-07-29 read point the same way and neither closes
  it. First, the regulatory text does not say "feet" or "above sea level" at all —
  the compendium binds on "the low tide is 0.7 or lower", units and datum
  unstated — so the one phrasing that generates the MSL problem is a paraphrase in
  a Details block on a non-regulatory page. Second, the tables beside the
  `/cabr/learn/nature/tidepools.htm` quotation are NOAA's, credited to
  `tidesandcurrents.noaa.gov` and linked as `noaatideannual.html?id=9410230` —
  station 9410230, "La Jolla" in the CO-OPS metadata, the Scripps wharf, which is
  the station `spots.json` already binds `cabrillo-tidepools` to and the one
  `shared/calibration.json` predicts from. The page says so: the chart gives
  "predictions for the Scripps Pier in La Jolla" and "there is only a slight
  difference for the times at Cabrillo". That removes a confound this section
  never listed — the comparison is not against a different tide series. It still
  does not name a datum: across all 13 tide-table pages, "MLLW", "mean lower low"
  and "datum" occur zero times, and the compendium's only low-water reference is
  the garbled "300 yards below mean low tide lower water level" in the south
  tidepools closure. The inference stands as an inference and the question still
  has to be asked.

### What would settle the field question

1. **NPS says which it is.** The answerable form is not the abstract question but
   the zone question, because NPS already publishes the vocabulary:
   `/cabr/learn/nature/tidepools.htm` divides the bench into High, Middle and Low
   and says the Low zone "is accessible only during the lowest tides". Which zone
   0.7 uncovers maps the figure directly — low zone is §1's *excellent*, middle
   zone its *workable*. No nps.gov page ties the number to a zone; checked
   `/cabr/learn/nature/tidepools.htm`,
   `/cabr/learn/education/tidepool-zonation.htm` (renders empty),
   `/places/tidepools-rocky-intertidal.htm` and
   `/articles/tidepooling-in-cabrillo-national-monument.htm`. So it has to be
   asked, and a ranger can answer it in a sentence.
2. **Or spend the check on identification instead of verification.** §2's curve
   yields both numbers at Cabrillo. If exactly one lands within 0.3 ft of 0.7 ft
   and the other does not, that is evidence about which field NPS's number is on
   — but it is the same single comparison, so the figure would then be spent
   identifying the field with nothing left to verify the floor. That trade may be
   worth making. It is a human's decision, taken in writing before §2 runs, and
   never a discovery made afterwards.
3. **Nothing else in the published record.** Every nps.gov statement of the
   figure is inventoried above. A further phrasing would not help; the ones
   already there disagree.

### One email, two questions, and it is not sent here

The two questions this section leaves open are one ask to one office and must not
go as two:

1. Does 0.7 mark the level at which the tidepools become *workable* — bench
   walkable, pools readable — or the level at which they are *best*? Concretely:
   which zone is uncovered at 0.7, and is the 0.7 in the §1.5(d) public use limit
   the same quantity as the 0.7 in "best ability to explore"?
2. What vertical datum is "0.7 feet above sea level" — MLLW, MSL, or something
   else? Concretely: is 0.7 a height read off the NOAA annual table for 9410230
   that the park publishes beside the sentence?

The MARINe transect-topography request in §8 is a third ask, to a different
organisation, and is tracked separately rather than folded into this one.

**Sending it is a human action and is not done here.** Neither question closes
from the published record. Until both are answered — or until a human explicitly
takes route 2 above and accepts that the figure is spent identifying its own field
— the check in this section is not ready to be spent.

### Pre-registration: which DEM the surveyed elevations select, written before it runs

The slope gate run under #80 left hypsometry blocked on a question it could not
answer: **the two products the recon recommended disagree with each other, and
nothing in the repo can say which is right.** They put the knee 0.4 ft apart —
+0.3 ft for 2616
against +0.7 ft for 6260 — their normalised peak slopes differ by 91%, and 6260
cannot reach the analysis band at all inside the mapped bench.

The 137 surveyed Cabrillo elevations landed in
`findings/cabrillo-surveyed-elevations.json` are the only surveyed ground truth in
this corridor, and they are the obvious arbiter. **The trap is that 6260's knee is
numerically the NPS figure.** If NPS-surveyed elevations select the product, and
the selected product's knee reproduces the NPS threshold, then NPS is on both sides
of this section's check.

Rule 2 above requires the comparison's parameters be frozen in writing before it
runs. This subsection is that freeze, written while the outcome is unknown. Nothing
in it is a number chosen by preference: each rule is either a measurement or a
default that fails toward *no result*.

**How independent the two NPS artifacts are, measured rather than assumed.** The
2006 report is the document that *contains* the survey, so if the threshold were
derived from it the link would most likely show there. Searched 2026-07-30 over the
extracted text: **29 tokens matching `0.7*` across 24 lines — every one a
regression coefficient, an r², a p-value, a percent-cover figure or a size-table
entry, and not one on a line that also contains "tide", "tidal", "feet", "foot",
"ft", "MLLW", "threshold" or "lower".** There is no 0.7 tide value in it.

What the report does state, three times, is its own operational criterion:

> Bird and visitor censuses were conducted more often, ideally every negative tide
> (less than or equal to 0, mean lower low water [MLLW]) that occurred between 10AM
> and 4PM.
>
> Bird and visitor census were conducted on days when the tide was negative (<0
> MLLW) between 10am and 4pm.
>
> Ideally, these "Bird and People Counts" were to be conducted on all days when
> tides that are 0.0 feet or lower (relative to mean low lower water, MLLW), and
> fall between 1000 and 1600 hours

(The third's "mean low lower water" is the report's own transposition, reproduced
verbatim.) **The park's science programme worked to 0.0 ft MLLW. The visitor-facing
0.7 ft appears nowhere in it.** That does not prove the two are independent — an
undocumented channel between the 2004 survey and a later visitor page cannot be
ruled out from here — but it replaces "unknown, assume the worst" with "no link
visible, and they do not even agree on the number."

**The metric set is fixed at three, and agreement is required.** RMSE, mean
absolute error and median absolute error, computed over the 126 points carrying a
published height, all three reported. A product is selected only if **all three
choose the same one**. A split selects nothing and is itself the finding — it would
mean the two products differ in the shape of their error rather than its size, and
no single scalar should adjudicate that. Fixing three in advance is what stops the
metric being chosen after its answer is visible.

**Exclusions are the report's own and no others.** Zone II M2 and the 8 February
16:20 reading, both already flagged in the finding. Any further exclusion is a
change to this pre-registration and is made in writing, before re-running, with the
reason.

**Indeterminacy is computed, not judged.** A 95% bootstrap confidence interval over
points on the paired per-point difference in absolute residual. **If the interval
spans zero the result is indeterminate and no product is selected.** #46 does not
proceed on a coin flip dressed as a measurement.

**Confound 1 — sand, and it is measurable.** The survey is spring 2004; the DEMs
are roughly 2014. These reefs bury and scour seasonally, so a poor match may be a
decade of sand rather than DEM error, and it will not announce which. Sand buries
low, flat, sand-adjacent bench and does not move cliff faces or boulder tops, so
the residual is regressed on plot elevation and on plot type — both already columns
in the finding. Residuals concentrated low and flat indicate sand; residuals
uniform across elevation and type indicate the DEM. Reported either way.

**Confound 2 — point against cell, and the restricted comparison may never
select.** These are Long-Term Monitoring plots, and the report places circular plots
"three on cliff faces and three on boulders". A 1 m cell sampled where a laser level
read the top of a boulder disagrees for reasons that are not DEM accuracy. Residual
magnitude is therefore tested against local DEM roughness. **The primary comparison
is all points; the roughness-restricted comparison is diagnostic only, reported
beside it, and can never override it.** If the two disagree, the result is
indeterminate. Otherwise "restrict until the answer changes" is available, and it
is the same fitting this section exists to prevent.

**The conditional on 0.7, committed here rather than afterwards:**

- **2616 selected** — nothing in this section changes. Its knee is +0.3 ft, so no
  independence question arises and the check is untouched.
- **6260 selected** — the subsequent 0.7 ft comparison is recorded as
  **corroboration, not independent verification**, because NPS data chose the
  product whose knee reproduces the NPS number. It may not then satisfy clause 1 of
  §7's promotion rule on its own.
- **Indeterminate** — no product is selected, nothing is recorded against 0.7, and
  the check stays unspent.

Deciding this after seeing which product wins would be exactly what rule 2
forbids, and it costs nothing to decide now.

**What this subsection does not do.** It does not run the comparison, set or change
any floor, or answer the field question — whether 0.7 marks the floor or the knee
is still unresolved above and still needs the ask. And the adjudication itself does
not spend the check: validating a DEM against surveyed heights is model selection
against ground truth, not a comparison against the published threshold. What it can
degrade is what a later comparison is *worth*, which is why the conditional is
written above.

**Related, and cheap:** the tidepool area's gate hours are #59, and nps.gov
publishes them itself —
"The park opens at 9 am every day", and "Most of the year the tidepools close at
4:30 P.M. If the park is operating during extended summer hours, the tidepools
close 30 minutes before sunset or at 7:30 P.M., whichever is earlier" (read
2026-07-29). Worth noting because Google Places reports the same area as a flat
9:00 AM – 4:30 PM daily, which is wrong for the summer months — which is the
whole reason for confirming against the operator before storing it. Treat gate
hours as a fifth constraint on Cabrillo only, not a new global gate.

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

**The 0.3 ft in clause 1 is now known to be unsatisfiable by clause 2's first
method.** VDatum's own uncertainty for NAVD88 → MLLW at these spots is
±0.299–0.313 ft, so a lidar-derived floor spends the whole budget on its datum
transform. Revising this is #65; until it is revised, the only instrumented
method that can meet the rule as written is a pressure logger, which measures
against the 9410230 prediction directly and performs no datum transform at all.

### Permissiveness rule

Declared 2026-07-30, before any re-binned rate was computed, per #42.

> **No `tidepool_floor_ft` may admit a marginal band whose observed sighting rate
> is below 2× that spot's own tide-independent background.**

Four things this rule is, and one it is not.

**It is a ceiling on the floor, not an estimate of one.** It says "no more
permissive than this" and nothing about where the floor actually is. That is
rule 3's asymmetry applied to elevation: it fails toward the restriction.

**It is computed per spot, from that spot's own background.** Never a
corridor-wide rate. The **background band** measures each spot's own
tide-independent background — surge-channel photos, wrong camera clocks,
washed-up specimens — and doubling that is a different number at every spot.

> **Mechanism corrected 2026-07-30, #72.** This clause read "the highest usable
> bin measures each spot's own tide-independent background". That is how
> `amplitudeRatio` computed it until #43's 0.25 ft edges made the bins above the
> highest usable one individually thin, at which point they were discarded and
> the denominator could land mid-range. Background is now the highest usable bin
> pooled with every bin above it. **The rule itself is unchanged** — 2× that
> spot's own tide-independent background — and so is the number it produces at
> Cabrillo, because the pooled band there is exactly the old 1.0–3.0 ft band.
> Only this description of how background is measured was stale.

**The 2× comes from a bar that predates this data.** `MIN_AMPLITUDE_RATIO = 2.0`
in `calibration/src/config.ts` already requires a spot to show a low-tide rate at
least double its own background before it may claim a distinct low zone, and
`calibration/README.md` states that bar "comes from that reasoning, **not** from
the observed gap between spots." Applying the same test to the marginal admitted
band extends a pre-committed bar rather than choosing a new number after seeing
output.

**It binds only where `shared/calibration.json` publishes.** Three spots today —
`cabrillo-tidepools`, `sunset-cliffs`, `swamis`. The five that refuse have no
trustworthy background to double; that is what refusal means. They keep their
current values with the refusal recorded in `floor_evidence`, which is already
the state as of `spots.json` 1.3.0.

**It is not a promotion input.** A `floor_evidence` entry derived from this rule
says so in its `note`, and is never one side of a clause-1 agreement comparison
at any tolerance. An upper bound from citizen-science inference and a measurement
are not two estimates of one quantity. `tidepool_floor_confidence` stays `low`
regardless of how many spots the rule moves.

What it fixes is falsified rather than merely disputed. At Cabrillo the
1.0–3.0 ft band sits at 5.7%, which is that spot's background, and the floor in
force is +1.3 ft — so the gate currently admits days whose marginal band is
indistinguishable from noise. 2 × 5.7% = 11.4%; the 0.5–1.0 band clears it at
15.0% and the 1.0–3.0 band does not, which puts the ceiling near 1.0 ft. The
current bins cannot separate 11.4% from 15.0%, both falling in one 0.5 ft band —
locating the crossing is #43.

**Located, 2026-07-30, #43.** The decision region is binned at 0.25 ft and the
crossings are these, each computed against that spot's own background band:

| spot | background | 2× bar | ceiling | marginal band | visits |
|---|---|---:|---|---|---:|
| `cabrillo-tidepools` | 1.00–3.00 ft, 5.71% | 11.4% | **1.00 ft** | 0.75–1.00 ft, 13.3% | **30, usable** |
| `sunset-cliffs` | 0.50–3.00 ft, 12.5% | 25.0% | bracketed 0.25–0.50 ft | 0.25–0.50 ft, 42.9% | 14, **thin** |
| `swamis` | 0.25–3.00 ft, 6.25% | 12.5% | bracketed 0.00–0.25 ft | 0.00–0.25 ft, 25.0% | 8, **thin** |

Only Cabrillo's crossing is *located*. Its marginal band holds 30 visits and the
band above it is also usable and fails the bar, so the crossing is measured on
both sides — the +1.3 ft in force was too permissive and the ceiling is 1.00 ft.
The other two are bracketed rather than located, because the band that decides
each holds fewer than the 15 visits `USABLE_BIN_MIN_VISITS` requires — Sunset
Cliffs' by a single visit.

**Correction, 2026-07-30.** This paragraph used to end: "A ceiling resting on a
band no gate may read is not a ceiling, so #44 has one spot to act on and two to
record as unresolved." That was wrong, and #44 acted on all three.

It conflated *where the crossing is* with *what ceiling has a usable marginal
band*. A bracket has two ends. Its permissive end does rest on a thin band and is
unusable — but its **conservative end rests on the band below**, which at Sunset
Cliffs holds 31 visits and at Swami's holds 51. Those are settable, and the rule
fails toward the restriction, so the conservative end is the one the rule
selects. All three ceilings were set, all three downward: Cabrillo 1.00 ft,
Sunset Cliffs 0.25 ft, Swami's 0.00 ft.

What a bracket changes is the strength of the claim, not whether one can be made.
A located crossing says the reef's behaviour was measured on both sides of the
value. A bracket's conservative end says only that the rule is satisfied at or
below it, and that the band which would justify going higher was too thin to
read. Both are ceilings; only the first is evidence about where this reef
actually surfaces. `floor_evidence` records which of the two each value is, and
the two brackets say so in their notes.

An X of roughly 15% would land near the NPS 0.7 ft figure. That is not a reason
to choose anything: §6 records that the published record cannot say which field
0.7 calibrates, and this rule is immune by construction because it is computed
from each spot's own background and 0.7 plays no part in it.

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
- Surveyed coordinates for the 7 `mpa_resolved: false` spots. Same root cause:
  nobody has stood at these places with a survey-grade receiver. **Not an unrelated
  problem, which this line used to claim** — §2's clip cannot be located for exactly
  that reason, so the coordinate imprecision that leaves those 7 MPA bindings
  unresolved is also what blocks the primary method.
