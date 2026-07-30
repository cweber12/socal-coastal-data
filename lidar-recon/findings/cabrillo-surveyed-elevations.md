# Provenance — `cabrillo-surveyed-elevations.json`

Surveyed elevations for the 137 CRIMP monitoring points in Cabrillo National
Monument Zones I–III, as published by the National Park Service. **Heights are in
inches above MLLW.** Nothing in this finding is compared to anything.

## Source

| | |
|---|---|
| URL | `https://marine.ucsc.edu/files/2025/09/cabrillo_report.pdf` |
| **Retrieved** | **2026-07-30**, HTTP 200, 6,870,599 bytes |
| sha256 | `83da0764f29059b5f9242dca09e0907b0d6fdeacc0e058f86586b0aa5281e608` |
| Linked from | `https://marine.ucsc.edu/sites/cabrillo1/` |
| Citation | Becker, Bonnie J. 2006. *Status and Trends of Ecological Health and Human Use of the Cabrillo National Monument Rocky Intertidal Zone (1990–2005).* Natural Resource Technical Report NPS/PWR/CABR/NRTR--2006/03. National Park Service, Seattle, Washington. |
| Elevations from | Tables 8/9/10 (report pp. 55–57) and Appendix E incl. Table E-1 (pp. 191–195), *Tidal Height Study by L.A. Victoria, SDSU Special Study, Spring 2004* |

## How it was extracted

A **one-time out-of-band step**, xpdf `pdftotext` 4.00, result committed as JSON.
No parser is added to `probes/` — that directory is standard-library-only — and no
dependency is added to the repo.

```bash
curl -sSL -o cabrillo_report.pdf https://marine.ucsc.edu/files/2025/09/cabrillo_report.pdf
pdftotext -raw   -f 63  -l 65  cabrillo_report.pdf   # Tables 8, 9, 10
pdftotext -table -f 63  -l 65  cabrillo_report.pdf   # cross-check
pdftotext -raw   -f 199 -l 203 cabrillo_report.pdf   # Appendix E prose + Table E-1
pdftotext -table -f 202 -l 203 cabrillo_report.pdf   # Table E-1 by column position
```

**`-layout` mode is wrong here and must not be used.** It slides the Plot ID
column against the rest, splicing each output row from two or three different
plots. The sample row quoted in issue #82 §5 and repeated in #83 —

```
L3     284    Circular Plot  Owl Limpets   32.669396  -117.245625  0.235812   61.47
```

— is such a splice and **does not exist in the report**. Its plot id comes from
Table 8's L3 row, its site id and coordinates from L2, its GPS std dev from L3 and
its tidal height from L1. The report's actual rows are `L1 280 … 61.47`,
`L2 284 … 52.22`, `L3 283 … 51.22`.

Three things establish the correct alignment:

1. **`-raw` emits each data row as a single text run** — the grouping is the PDF's
   own content stream, not a reconstruction from coordinates. `-table` reproduces
   it token for token.
2. **The plot-id prefix encodes the target species**, and the alignment reproduces
   it exactly: `L`=Owl Limpets, `B`=Barnacles, `M`=Mussels, `Pe`=rockweed,
   `Po`=Goose Barnacles, `T`=Red Algal Turf, `G`=Surfgrass, `K`=Boa Kelp. Under
   `-layout` that mapping is scrambled.
3. **Appendix E is an independent listing of the same heights.** All 126 published
   heights reconcile against it.

Table E-1 was parsed **by column position**, because which of its three
`Substrate Height` slots is *empty* is itself evidence. Offsets are measured from
the **start** of the date token: the column is left-aligned and `3/4/2004` and
`3/19/2004` differ in length, so anchoring on its end shifts every 19 March row by
one character.

Dates are US month/day/year. That is not assumed — `3/19/2004` is only valid
month-first. Table E-1 publishes no time of day, so no timezone question arises for
the table; the one clock time the report states, *4:20pm* on 8 February 2004, is
local with no offset given and is not used as data.

## Units

Heights are **inches above MLLW as published** — the legend of Tables 8–10 says
"Tidal height measured in inches above MLLW" and Table E-1's caption says "All
heights are in inches above MLLW".

Feet are also emitted, and **every derived field is named `*_DERIVED`**. The only
derivation is inches → feet at exactly 12 in = 1 ft, rounded to 4 decimals; the
published inch value is carried unrounded beside it. `*_as_published` holds the
exact printed string, including the report's `ND` and `n/a` sentinels.

## What the report itself flags

**The GPS standard-deviation column has no unit, and is left unresolved.**
Tables 8–10 carry a `Std. Dev.` column, defined in each legend as "the standard
deviation of the GPS measurements". **No unit is stated anywhere in the report.**
Across all three tables it runs **0.044647 – 0.521161** (95 numeric values, 42
`n/a`). Against that, Appendix E states:

> Each location was recorded within six centimeters of accuracy. This Trimbel
> device used more than six satellites to fix the position.

These cannot be reconciled. Centimetres would mean sub-millimetre GPS from a 2004
mapping-grade Trimble; metres would put values up to 0.52 m at eight times the
stated six-centimetre accuracy. Both readings conflict with the six-centimetre
claim, in opposite directions. So `gps_std_dev.unit` is `null` and
`unit_status` is `unknown_unresolved` on every point. **Do not assume metres.**

(#82 §5 gives the range as 0.067–0.521. That is Zone I only.)

**The tide reference is NOAA 9410170 (San Diego) — not the 9410230 this repo binds
to `cabrillo-tidepools`.** These heights are referenced to MLLW as realised at
9410170. The report's justification, verbatim:

> To be sure that these data were within our accuracy requirements, the predicted
> tidal heights for this San Diego location and the study area were compared. The
> difference in measurements for this comparison was less than one inch and fell
> with the range of accuracy for the study data.

Read that carefully. The heights themselves were calibrated against **verified**
(observed) water levels at 9410170. The "less than one inch" figure is a comparison
of **predicted** heights between the San Diego station and the study area — the
report's own justification for using a gauge ~6 km away. **It is not a measured
offset between 9410170 and 9410230**, and no such comparison is made here.

**Zone II M2 was mis-recorded and its height omitted.**

> When the data were analyzed it was determined that the point height for Zone II
> M2 was not recorded correctly on the original field sheets, this value is omitted
> from the final data.

Appendix E row 44 publishes average and standard deviation as `n/a` while still
printing its raw readings −24.09 and −20.14; Table 9 prints its height as `ND`. The
point is **retained** with `height_in_above_mllw: null`, its raw readings intact,
and flags `height_not_determined` + `zone_ii_m2_height_omitted_by_report`.

**One 8 February 16:20 reading was dropped.**

> It was also determined that the second substrate height on February 8th at 4:20pm
> was not accurate and this value was excluded when calculating the average
> substrate height and the standard deviation.

This survives **structurally, not as an assertion**. Table E-1 has three reading
slots, and on **all 36 rows dated 8 February 2004 the second slot is empty** while
the first and third are filled. No row on any other date has that pattern
(4 Mar: 37 rows all three-filled; 7 Feb: 8/25/18 across one/two/three; 19 Mar:
2 two-filled, 4 three-filled). Affected points carry `null` in reading position 2
and the flag `feb_8_1620_second_reading_excluded` — 35 points, because one of the
36 rows was superseded by a 19 March re-measurement.

**Height uncertainty.** Tables 8–10 state "Standard deviation of the tidal height
measurement is approximately 4 inches". Table E-1's per-session values are finer:

| date | σ (in) | σ (ft, derived) | rows |
|---|---|---|---|
| 2004-02-07 | 3.08 | 0.257 | 18 |
| 2004-02-07 | 3.53 | 0.294 | 25 |
| 2004-02-07 | `n/a` | — | 8 (single-reading points) |
| 2004-02-08 | 2.79 | 0.233 | 35 |
| 2004-02-08 | `n/a` | — | 1 (Zone II M2) |
| 2004-03-04 | 3.94 | 0.328 | 37 |
| 2004-03-19 | 0.03 | 0.003 | 1 |
| 2004-03-19 | 2.45 | 0.204 | 1 |
| 2004-03-19 | 4.37 | 0.364 | 4 |

## Other anomalies carried through rather than tidied away

- **Four averages don't match their own readings.** Appendix E rows 61, 62, 64, 65
  (Zone II B3, B4, PE4, PE5). Row 65's readings are also identical to row 46's.
  The published averages are what Table 9 carries forward, so they are what
  `height_in_above_mllw` holds; **no attempt is made to decide which side is wrong.**
- **Four points were measured twice**; the tables use the later value. Superseded
  rows are retained and named in `superseded_appendix_e_rows`.
- **Zone I T2 S and K6 N are one physical point** — identical coordinates, GPS std
  dev and height, and Appendix E row 25 labels it `Area 1 T2s, K6n`. The report's
  own bookkeeping, not a duplicate from extraction.
- **Zone II L7 and L8 have no published coordinates** (lat `n/a`, long `ND`) but do
  carry heights (48.26 and 70.26 in).
- **Zone III T2's north bolt is keyed `B` not `N`** in Appendix E row 93.
- The report's prose says each zone has "17 photoplots"; the tables list 21, and
  Zone II lists 8 circular limpet plots against the prose's 6.

## What was not done

- **No DEM comparison.** None computed, none implied.
- **No floor set or changed.** This is not a `floor_evidence` entry.
- **The NPS 0.7 ft check is not spent.** Extracting NPS-published elevations is not
  spending it; nothing here is compared to it.
- **The page images were never rendered** — no `pdftoppm` was available. Alignment
  rests on the PDF content stream, which is stronger evidence for row grouping than
  a visual read, but no human eye has checked the typeset page.
- **Whether any of these points can still be found on the rock** is unknown. These
  are 2004 measurements on reefs that bury and scour seasonally, published 22 years
  before this retrieval, from CRIMP/NPS Long-Term Monitoring — **not** MARINe
  Coastal Biodiversity Survey topography.
