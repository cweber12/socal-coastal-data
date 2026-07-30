# `lidar-recon/` — what a lidar hypsometry pipeline would actually require

Reconnaissance for the tidepool floor hypsometry work. **This directory adds no
dependency and no pipeline.** It answers what the pipeline would need, so that the
decision to take on a raster dependency is made with numbers instead of
expectations.

Nothing outside this directory is touched. No floor is promoted, no
`floor_evidence` entry is written, and the NPS 0.7 ft check is **not** spent —
that comparison waits on which field it calibrates being settled.

Everything below was read from the publishers on **2026-07-29**. URLs are
recorded per row, and the machine-readable evidence is in `findings/`. The
stdlib-only probes that produced it are in `probes/` — they are the evidence
trail, not a proposed implementation.

The 8 spots in scope are the 8 in `shared/spots.json` carrying a
`tidepool_floor_ft`: `swamis`, `cardiff-reef`, `torrey-pines-beach`,
`la-jolla-shores`, `la-jolla-cove`, `windansea`, `sunset-cliffs`,
`cabrillo-tidepools`.

---

## 1. The headline: the datum premise is wrong, and the real risk is elsewhere

`floor-calibration.md` §2 and the issue both say: *"older tiles carry a tidal
datum, newer ones the ellipsoid, and the difference is the whole risk."*

**No tile covering any of the 8 spots carries a tidal datum. None carries an
ellipsoidal height either.** All seven candidate products are **NAVD88**, an
orthometric datum that is neither. CoNED's own abstract says so explicitly:

> Because bathymetric data are typically referenced to tidal datums (such as Mean
> High Water or Mean Low Water), all tidally-referenced heights were transformed
> into orthometric heights that are normally used for mapping elevation on land
> (based on the North American Vertical Datum of 1988).

That is good news for the transform and bad news for anyone who trusted the
framing: the premise that told you *where* to look was wrong, so the checks it
implied would have passed while the real hazards went unexamined. The hazards
that are actually present, in descending order of how much damage they do:

1. **Two of the six rasters do not declare a vertical datum at all** (§2 below).
   For those, "NAVD88" is a sidecar claim or a sibling's claim, not something the
   pixel container asserts.
2. **The geoid model is ambiguous and no raster records it** (§4). Up to three
   models are in play for the same data — GEOID12A, GEOID12B, GEOID18 — and the
   published metadata contradicts itself.
3. **One product is in US survey feet, not metres** (§2). Assuming metres there
   is a 3.28x error.
4. **VDatum's own uncertainty exceeds the promotion tolerance** (§4). ±0.305 ft
   at Cabrillo against §7's 0.3 ft agreement rule.
5. **One product's published acquisition window is wrong for all 8 spots** (§6).

---

## 2. The datum each tile carries, read from its own metadata

This is the column that has to be evidence. "Where read" says which artefact
asserts it — the raster's own GeoKeys, the FGDC sidecar, or the STAC record.

| # | product | vertical datum | units | where read | declared **in the raster**? |
|---|---|---|---|---|---|
| 8658 | USGS CoNED SoCal TBDEM 1 m | NAVD88 | **metre** | FGDC `<vertdef>`/`<altsys>`: "North American Vertical Datum of 1988", 0.001, "meters" | **NO** — no `VerticalCSType` GeoKey. Only `VerticalUnits=9001 (metre)` + `ProjectedCSType=26911` |
| 5189 | 2014 USACE NCMP Topobathy DEM: CA | NAVD88 | metre | GeoKey `VerticalCSType=5703`; `GTCitation` "NAD83(2011) + NAVD88 height"; STAC `proj:wkt2` `COMPOUNDCRS`; FGDC `<vertdef>` | YES |
| 9488 | 2009 USACE NCMP Topobathy DEM: CA | NAVD88 | metre | GeoKey `VerticalCSType=5703`; `GTCitation` "NAD83 + NAVD88 height" | YES |
| 2616 | 2009–2011 Merged TopoBathy DEM (**with voids**) | NAVD88 | metre | GeoKey `VerticalCSType=5703`; `GTCitation` "NAD83_NSRS2007_UTM_zone_11N + NAVD88 height" | YES |
| 8684 | 2009–2011 Merged TopoBathy DEM (**interpolated**) | **not declared** | presumed metre | `GTCitation` is "NAD83(NSRS2007) / UTM zone 11N" — no vertical component; `pixel_scale` z = 0.0 | **NO** |
| 6260 | 2016 USGS West Coast El-Niño DEM | NAVD88 | metre | GeoKey `VerticalCSType=5703`; `GTCitation` "NAD83(2011) / UTM zone 11N + NAVD88 height" | YES |
| 13968 | 2014–2015 USGS QL2 DEM: San Diego (OPR) | NAVD88 | **US survey foot** | USGS FGDC `<vertdef>`: "North American Vertical Datum 1988", altres **0.30480060960121924**, "US survey foot" | not checked |

`EPSG:5703` is NAVD88 height in metres. GeoKeys were read directly out of each
GeoTIFF's `GeoKeyDirectory` (TIFF tag 34735) over HTTP range requests —
`probes/geokeys.py`, raw output in `findings/geokey-evidence.json`.

Three things in that table are load-bearing:

**8684 does not declare its vertical datum, and it is the interpolated
product.** Its void-preserving twin 2616 declares NAVD88; 8684 does not. Two
sibling products, same project, same nominal grid, and only one of them says what
its heights mean. If a pipeline picked the interpolated one for its clean 100%
coverage, it would be transforming heights whose datum nothing in the file
asserts.

**13968 is in US survey feet on State Plane.** `0.30480060960121924` is exactly
1200/3937, which is the US survey foot and not the international foot. Everything
else in the corridor is metres. This is the `spots.json` units rule in its
literal form — the unit string is the evidence, and the conversion is only safe
on an exact match.

**CoNED, the product §2 names first, is the one whose raster is silent.** It
carries `VerticalUnits` but no vertical CRS. Read the GeoTIFF alone and you learn
the heights are in metres above *something unnamed*.

---

## 3. Which tiles cover each spot

One tile per spot per product, resolved by point-in-bbox against each dataset's
own published STAC item collection (at `<bulk-prefix>/stac/`). Full per-tile
bboxes, media types, pixel shapes and download URLs are in
`findings/tile-inventory.json`; per-product publication dates, bulk prefixes and
InPort records are in `findings/dataset-metadata.json`.

| spot | CoNED 8658 (1 m) | 2009 NCMP 9488 (~1 m) | 2014 NCMP 5189 (~1 m) | Merge-voids 2616 (1 m) | El-Niño 6260 (**0.5 m**) |
|---|---|---|---|---|---|
| `swamis` | `..._1m_H_14` 1811 MiB | `2009_NCMP_CA_13` 28.5 | `2014_NCMP_CA_13` 25.2 | `11SMS725540` 7.0 | `11SMS47253654` 11.0 |
| `cardiff-reef` | `..._1m_H_14` 1811 | `2009_NCMP_CA_13` 28.5 | `2014_NCMP_CA_13` 25.2 | `11SMS725525` 6.6 | `11SMS47253652` 9.7 |
| `torrey-pines-beach` | `..._1m_I_15` 1810 | `2009_NCMP_CA_11` 31.3 | `2014_NCMP_CA_11` 34.4 | `11SMS755435` 7.2 | `11SMS47553643` 9.5 |
| `la-jolla-shores` | `..._1m_I_15` 1810 | `2009_NCMP_CA_09` 35.0 | `2014_NCMP_CA_09` 41.6 | `11SMS755345` 7.0 | `11SMS47553634` 10.8 |
| `la-jolla-cove` | `..._1m_I_14` 1811 | `2009_NCMP_CA_09` 35.0 | `2014_NCMP_CA_09` 41.6 | `11SMS740345` 7.2 | `11SMS47403634` 7.1 |
| `windansea` | `..._1m_I_14` 1811 | `2009_NCMP_CA_09` 35.0 | `2014_NCMP_CA_09` 41.6 | `11SMS725315` 6.1 | `11SMS47253631` 7.9 |
| `sunset-cliffs` | `..._1m_J_15` 1810 | `2009_NCMP_CA_06` 20.8 | `2014_NCMP_CA_06` 20.5 | `11SMS755195` 5.8 | `11SMS47553619` 10.7 |
| `cabrillo-tidepools` | `..._1m_J_15` 1810 | `2009_NCMP_CA_05` 56.5 | `2014_NCMP_CA_05` 59.3 | `11SMS770135` 6.9 | `11SMS47703613` 9.7 |

Sizes in MiB. NCMP tile names end `_BareEarth_1mGrid`. Bulk prefix for all NOAA
products is
`https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/<dataset-dir>/`.

**Acquisition and publication dates, which §2 requires to travel with any floor:**

| product | acquisition | published | note |
|---|---|---|---|
| 8658 CoNED | **1930-03-03 – 2014-12-31** | 2018-08-13 | 49 sources merged; topography 2005–2014, bathymetry 1930–2014, nearshore voids filled with NOS surveys from **1967** and 2013 |
| 9488 2009 NCMP | 2009-09-30 – 2009-10-28 | — (none published) | |
| 5189 2014 NCMP | stated 2014-09-08 – 2014-10-05 | 2016-11-15 | **contradicted — see §6** |
| 2616 / 8684 Merge | 2009-01-01 – 2011-01-01 (nominal only) | 2014-03 | no finer date published |
| 6260 El-Niño | 2016-04-28 – 2016-05-28 | 2017-04-12 | |
| 13968 USGS QL2 | 2014-10-27 – 2015-02-17 | 2026 | topo only, no green laser |

**CoNED's date is a range, and that disqualifies it for this use as published.**
A floor has to carry an acquisition date. CoNED's is "1930 to 2014", and which of
its 23 source surveys contributed the pixels on a given reef is only recorded in
`Southern_California_Topobathy_Spatial_Metadata_gdb.zip` (8.1 MB) — an Esri File
Geodatabase, which is an undocumented proprietary binary format needing GDAL/OGR
to read. The `socal.kmz` alongside it is an image overlay and contains no source
information. So the single most complete product is the one that cannot carry a
defensible date without the dependency this PR is asking about. The 2009 and 2014
NCMP tiles, with 4-week windows and per-swath dates, are worse-covered and better
provenanced.

---

## 4. The exact VDatum transform, and whether it can be driven non-interactively

**Yes — two independent non-interactive interfaces, both verified.**

**REST API.** `https://vdatum.noaa.gov/vdatumweb/api/convert`, documented at
`https://vdatum.noaa.gov/docs/services.html`. Returns JSON including an
`uncertainty` field. Per-point.

**Bundled Java CLI.** `java -jar vdatum.jar <georeferencing_parameters>
[point_conversion] [file_conversion] region:<n>`, documented at
`https://vdatum.noaa.gov/docs/userguide_cmd.html`. Accepts **LAS/LAZ 1.0–1.4 and
ESRI ASCII Raster (.ASC)** as file input, per the homepage. OpenJDK 11.0.2 ships
inside the VDatum package. This is a batch path that needs no Python raster stack
at all — it needs a JRE.

**Version: VDatum 4.8**, from the vdatum.noaa.gov homepage title
("NOAA/NOS's VDatum 4.8: Vertical Datums Transformation"). Regional tidal grid:
**"California - Southern California, Version 01"**, from
`vdatum.noaa.gov/download.php`.

### The West Coast requires two non-obvious parameters

Both of these are required, and getting either wrong fails loudly rather than
silently, which is the one piece of luck in this section:

- `region=westcoast`. With `region=contiguous` (the documented **default**) the
  API returns `errorCode 412, "Uncaught error, please contact NOAA VDatum Program
  Support team."`
- `t_h_frame=IGS14`. With `NAD83_2011` it returns `errorCode 412, "For West Coast
  Region, Target Horizontal Frame should be IGS14 for Tidal"`. The West Coast
  tidal grids are IGS14-referenced, so **a NAVD88→MLLW conversion here also
  changes the horizontal frame**, which drags in plate motion and epoch.

### The transform

Verified linear at `cabrillo-tidepools` by transforming z = 0, 1, 2 and −1 m:
t_z = 0.220, 3.501, 6.781, −3.061 us_ft. So it is a **pure additive offset**:

```
MLLW_usft = NAVD88_m * 3.280833 + offset_usft
```

`3.280833` is the US survey foot per metre. The uncertainty is **constant at
0.305 ft regardless of z**, because it is the uncertainty of the tidal surface,
not of the elevation.

| spot | NAVD88 0 m → MLLW (us_ft) | VDatum uncertainty (ft) | same via GEOID12B | Δ geoid18−12b (ft) |
|---|---|---|---|---|
| `swamis` | +0.177 | ±0.313 | +0.151 | 0.026 |
| `cardiff-reef` | +0.194 | ±0.313 | +0.151 | 0.043 |
| `torrey-pines-beach` | +0.266 | ±0.307 | +0.180 | **0.086** |
| `la-jolla-shores` | +0.262 | ±0.299 | +0.223 | 0.039 |
| `la-jolla-cove` | +0.249 | ±0.301 | +0.210 | 0.039 |
| `windansea` | +0.240 | ±0.303 | +0.213 | 0.027 |
| `sunset-cliffs` | +0.240 | ±0.305 | +0.217 | 0.023 |
| `cabrillo-tidepools` | +0.220 | ±0.305 | +0.207 | 0.013 |

Every request URL and full response is in `findings/vdatum-transforms.json`.
US survey foot vs international foot was also queried and differs by ~2 ppm —
irrelevant at 0.1 ft, but recorded rather than assumed.

### Two things here that matter more than the offsets

**VDatum's stated uncertainty is larger than the promotion tolerance.** §7
promotes a floor when two methods from different families agree **within
0.3 ft**. The datum transform alone carries ±0.299 to ±0.313 ft at these spots.
The transform consumes the entire agreement budget before the DEM's own vertical
accuracy, the sand-burial question, or the walkable-area threshold contribute
anything. This is a §7 problem, not a §2 problem, and it does not go away by
choosing a better tile.

**The geoid model is unrecorded and it is worth up to 0.086 ft.** GEOID18 and
GEOID12B disagree by 0.013–0.086 ft here. Which is correct depends on which
geoid produced the tile's NAVD88 heights, and no raster records that — see §5.

---

## 5. The geoid model, which is where the IBWC-class error actually lives

For the 2014 NCMP data, three geoid models are named across the published record
for the same heights:

- The point-cloud FGDC says the processing step used **GEOID12A**: *"PFM_ABE
  software then converts all valid data from ellipsoid to orthometric heights
  based on the NGS' GEOID12A model"*.
- Two sentences later the **same document** says delivery was **GEOID12B**:
  *"vertical heights were referenced to Geoid12b ellipsoid in meters"* — which is
  also internally confused, since a geoid model is not an ellipsoid.
- NOAA redistributes every LAZ swath under a path segment that asserts a third:
  `s3://noaa-nos-coastal-lidar-pds/laz/geoid18/4912/`.

The LAZ's own `LASF_Projection` WKT VLR (record 2112) declares
`VERT_CS["NAVD88 height", VERT_DATUM["North American Vertical Datum 1988", 2005],
UNIT["metre",1], AUTHORITY["EPSG","5703"]]` — NAVD88, and **no geoid model
named**. The DEM GeoKeys likewise give `VerticalCSType=5703` and no geoid.

So the datum is knowable and the *realisation* of it is not. This is the
elevation equivalent of the m³/s-versus-ft³/s problem: not a wrong unit, a
correct unit with an unrecorded conversion behind it. Any `datum_transform`
string that says only `"VDatum 4.8, NAVD88 -> MLLW"` is under-specified — it
needs the geoid, the region, the target horizontal frame, and it should carry the
uncertainty.

A defensible string for these spots looks like:

```
VDatum 4.8; region=westcoast; grid "California - Southern California v01";
NAVD88(geoid18) m -> MLLW us_ft; t_h_frame=IGS14; offset +0.220 us_ft
at 32.669,-117.245; uncertainty +/-0.305 ft
```

...with the honest note that `geoid18` is NOAA's redistribution assertion and the
source FGDC says GEOID12A/12B. **That contradiction should be resolved with
NOAA/JALBTCX before any floor ships**, not papered over by picking one.

---

## 6. Sand burial: the acquisition date, prominently, and one that is published wrong

§2 is right that a DEM is one moment and these reefs bury and scour seasonally.
Two findings.

### The 2014 NCMP DEM's published acquisition window is wrong for all 8 spots

The DEM metadata states **2014-09-08 – 2014-10-05**. The point-cloud swaths are
date-stamped in their filenames and span **2014-08-28 – 2014-10-13** across 117
swaths and 16 distinct dates. The swaths covering these spots are:

| swath date | spots |
|---|---|
| **2014-08-28** | `cabrillo-tidepools`, `sunset-cliffs`, `windansea`, `la-jolla-cove`, `la-jolla-shores`, `torrey-pines-beach` |
| **2014-08-30** | `swamis`, `cardiff-reef` |

**Every one of the 8 was flown before the published window opens** — 11 days
before, at the start. A floor stamped with the DEM's own metadata date would
carry a date on which none of these reefs was flown, and would be compared
against a later acquisition on a false baseline.

Verified by reading each swath's LAS 1.4 public header over a single range
request. The bbox is in `EPSG:6339` NAD83(2011) / **UTM zone 10N** + NAVD88
height — zone **10**, not the zone 11 the DEMs use, which is a trap of its own:
reading those bboxes as zone 11 puts them ~560 km off. Each spot converted to
zone 10 falls inside its swath bbox. Details in
`findings/acquisition-dates.json`, probe in `probes/lasheader.py`.

One honest limit: swath index was matched to DEM tile index by identical
numbering, and confirmed only in the sense that the like-numbered swath does
contain the spot. NOAA publishes no tile-to-swath provenance table, so *"the DEM
pixel here came from that swath"* is a well-supported inference, not a fact. The
date-range contradiction is a fact either way — no swath in the dataset predates
2014-08-28.

### Could each campaign have caught the reef exposed?

Lowest predicted tide at 9410230 inside each acquisition window, MLLW ft, from
the CO-OPS predictions API (`probes/tides.py`):

| campaign | lowest low | lows ≤ 0.0 ft | lows ≤ 0.7 ft |
|---|---|---|---|
| 2009 NCMP (2009-09-30 – 10-28) | −0.51 | 4 | 25 |
| 2014 NCMP (2014-09-08 – 10-05) | −0.54 | 3 | 20 |
| 2009–2011 Merge (nominal 2 yr) | −1.92 | 369 | 621 |
| 2016 El-Niño (2016-04-28 – 05-28) | −1.41 | 16 | 33 |
| 2014–15 USGS QL2 (2014-10-27 – 2015-02-17) | −1.53 | 60 | 88 |

Every campaign contained sub-zero lows, so each *could* have caught exposed reef.
Whether any given swath *did* needs the per-point GPS time inside the LAZ, which
this recon did not decode. Until that is read, "the reef was exposed when it was
flown" is an assumption, and it is the assumption on which the whole intertidal
part of the DEM rests.

---

## 7. Whether green-laser returns actually reach the intertidal — measured, not assumed

A tile that exists is not a tile with data on the reef, so this was measured. For
each spot and product, elevations were sampled straight out of the published
GeoTIFF over HTTP range requests, in a disc of half-width **100 m** (the
`spots.json` coordinate error bar — the disc the published coordinate actually
admits) and **25 m**. Values are metres in each tile's own NAVD88, not MLLW feet.
Full output in `findings/coverage-measured.json`; probe in `probes/probe_dem.py`.

**Valid-pixel coverage %, ±100 m / ±25 m:**

| spot | CoNED | 2009 NCMP | 2014 NCMP | Merge-voids | El-Niño 2016 |
|---|---|---|---|---|---|
| `swamis` | 100 / 100 | 99.6 / 100 | 89.6 / 99.5 | 100 / 100 | 99.4 / 100 |
| `cardiff-reef` | 100 / 100 | 82.7 / 99.0 | 73.1 / **49.1** | 93.0 / 100 | 95.6 / 100 |
| `torrey-pines-beach` | 100 / 100 | 71.0 / 100 | 93.8 / 100 | 72.3 / 100 | 34.3 / **0.0** |
| `la-jolla-shores` | 100 / 100 | 100 / 100 | 98.6 / 100 | 100 / 100 | 100 / 100 |
| `la-jolla-cove` | 100 / 100 | 99.9 / 100 | 75.5 / 100 | 100 / 100 | 100 / 100 |
| `windansea` | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 |
| `sunset-cliffs` | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 |
| `cabrillo-tidepools` | 100 / 100 | 82.5 / 93.5 | 66.3 / **47.2** | 98.4 / 96.8 | 100 / 100 |

**Yes, coverage is patchy, and it is patchy exactly where it hurts.** The 2014
NCMP tile — the most recent true topobathy product — has **47.2%** coverage in
the 25 m disc at Cabrillo and **49.1%** at Cardiff Reef. Its voids are not
scattered: they sit on the wet reef. The proof is in the medians. At Cabrillo the
2014 tile's ±100 m median is **13.93 m** against CoNED's **2.20 m** for the same
ground; at ±15 m the five products agree to within 0.26 m (medians 0.19–0.45 m).
The 2014 tile is not offset — it is missing its low ground, so the survivors are
bluff. A hypsometry computed from it would be a hypsometry of the cliff.

**CoNED's 100% everywhere is not 100% lidar.** It is a void-filled merge of 49
sources, some of it 1967 NOS soundings. Complete coverage and instrumented
coverage are different claims, and only the second one supports a floor.

**The 2016 El-Niño DEM has a hole precisely at `torrey-pines-beach`** — 0.0%
valid in the 25 m disc, 34.3% at 100 m. The finest product (0.5 m) is the one
with no data at that spot.

### The larger problem this surfaced: there is no reef polygon, and a point buffer is not one

§2 says *"clip each spot's reef polygon"*. **No reef polygon exists anywhere in
the repo** — `spots.json` carries one lat/lon per spot and nothing else. Point
buffers cannot stand in, and the measurements say so plainly.

Minimum elevation in the ±100 m disc, and the fraction of valid pixels below 0 m
NAVD88:

| spot | CoNED min / frac<0 | 2009 NCMP | Merge-voids |
|---|---|---|---|
| `swamis` | −1.33 / 0.11 | −1.41 / 0.11 | −1.33 / 0.11 |
| `cardiff-reef` | −1.65 / 0.17 | −1.63 / 0.16 | −1.57 / 0.18 |
| `torrey-pines-beach` | **+0.99 / 0.00** | +0.99 / 0.00 | +0.99 / 0.00 |
| `la-jolla-shores` | **+0.21 / 0.00** | +0.22 / 0.00 | +0.22 / 0.00 |
| `la-jolla-cove` | −4.84 / 0.23 | −6.03 / 0.23 | −5.99 / 0.23 |
| `windansea` | **+2.77 / 0.00** | +2.77 / 0.00 | +2.79 / 0.00 |
| `sunset-cliffs` | **+2.73 / 0.00** | +2.77 / 0.00 | +2.73 / 0.00 |
| `cabrillo-tidepools` | −2.76 / 0.26 | −2.78 / 0.15 | −0.96 / 0.03 |

**At 4 of 8 spots the ±100 m disc around the published coordinate contains no
pixel below 0 m NAVD88 at all.** The hypsometry §2 asks for runs from +2.0 to
−2.0 ft MLLW, and at `windansea`, `sunset-cliffs`, `torrey-pines-beach` and
`la-jolla-shores` that entire range is outside the data the coordinate reaches.
Widening the window (`probes/probe_dem.py`, ±200/300/500 m) shows how far off
they are: `windansea` and `la-jolla-shores` first reach negative elevations at
±200 m, `sunset-cliffs` at ±200 m, and `torrey-pines-beach` not until **±500 m**.
Those coordinates sit inland of the bench by roughly 100–400 m.

Cabrillo fails the other way. Its ±100 m median is 14.7 m and *rises* to 24.8 m
at ±300 m — the disc fills with bluff going inland while the reef is a narrow
shore-parallel strip. The clip geometry has to be the bench, and nothing in the
repo knows where the bench is.

This is the real long pole, and it is upstream of every tooling question below. A
correct DEM, a correct datum and a correct transform still produce a meaningless
curve if the polygon is a circle centred 300 m inland. **`la-jolla-cove` deserves
a specific flag**: #45 left its coordinate unresolved with MARINe's published
position and its own prose 1142 m apart, and the ±100 m disc here reaches
−4.8 m — deep water, not intertidal. Whatever that coordinate is, it is not a
reef bench.

---

## 8. Tooling: what the clip-and-hypsometry step needs, and what is avoidable

### Avoidable, and demonstrated so in this PR

**Bulk download is avoidable.** Every NOAA product is a public S3 dataset with
per-tile objects and a published STAC item collection. Tile selection is
point-in-bbox against JSON. No download needed to choose a tile.

**Reading pixels needs no raster library.** Every number in §7 was read out of
the published GeoTIFFs with `struct`, `zlib` and `http.client` — 201×201 windows
extracted from tiles up to 1.77 GiB without downloading one of them. The NCMP,
Merge and El-Niño tiles are cloud-optimised GeoTIFFs (DEFLATE + floating-point
predictor); CoNED is uncompressed single-row strips, which range-reads even more
directly. `probes/probe_dem.py` is ~150 lines of standard library.

**The datum transform needs no Python raster stack.** VDatum's transform is a
per-location additive offset (§4), obtainable from the REST API, and its CLI
takes LAZ and ASCII raster directly. For a fixed reef polygon the offset is one
constant per spot plus a recorded uncertainty.

**Hypsometry itself is arithmetic.** Counting cells above a threshold across 41
levels from +2.0 to −2.0 ft in 0.1 ft steps is a histogram. The only geometric
subtlety is cell ground area, and for the projected UTM products (2616, 6260,
8658) that is exactly 1.0 m² and 0.25 m².

### Not avoidable with the standard library

**Reading the CoNED source-footprint geodatabase.** `.gdb` is undocumented Esri
binary; GDAL/OGR or `fiona` is the only realistic reader. Without it CoNED cannot
carry an acquisition date (§3), which under §2's own rule disqualifies it. **This
is the one hard dependency the recon found, and it exists only to date CoNED.**
Dropping CoNED in favour of the NCMP tiles removes it entirely, at the cost of
the coverage in §7.

**LZW-compressed 8684.** Decodable in pure Python but not worth writing, and it
is the interpolated product with an undeclared datum — the one to skip anyway.

**Per-point GPS time in the LAZ**, needed to pin the tide at overflight (§6).
Requires a LAZ decoder (`laspy` + `lazrs`, or PDAL). Alternatively the COPC STAC
sidecars NOAA publishes may carry a time range; not checked.

**Reprojection, if the geographic-grid products are used.** 5189 and 9488 are on
geographic grids where the cell is 0.995 m N-S and 0.843 m E-W at 32.7°N. Area
sums need either a `cos(lat)` correction, which is a few lines, or real
reprojection, which is `pyproj`/GDAL. Preferring the UTM products (2616, 6260)
sidesteps it.

### The recommendation, since the question is a human decision

**No dependency is needed to answer #46, and one is needed to use CoNED.** The
honest split:

- Use **2616 (Merge, with voids)** and **6260 (El-Niño 2016, 0.5 m)** — both UTM,
  both declaring NAVD88 in-raster, both COGs, both range-readable. Between them
  they give 100% coverage in the ±25 m disc at **all 8** spots: 2616 is 100%
  everywhere except Cabrillo (96.8%), 6260 is 100% everywhere except Torrey Pines
  (0.0%), and each covers the other's single gap. Stdlib only.
- Add **5189/9488 NCMP** as the date-provenanced cross-check, accepting the
  `cos(lat)` correction and the void problem.
- **Drop CoNED unless someone accepts GDAL**, and if it is used, say in the
  evidence entry that its date is a 1930–2014 range.

If GDAL is added anyway, `rasterio` + `pyproj` would make §7 shorter and would
unlock CoNED's provenance. That is a real gain, and it is a change to a repo whose
Python is standard-library-only and whose `calibration/` has no runtime
dependency — which is why it is being put to you rather than taken.

---

## 9. What was deliberately not done

- **The NPS 0.7 ft comparison was not run, and nps.gov was not read.** That check
  is spent once and which field it calibrates is still being decided. Spending it
  against the wrong field wastes the corridor's only independent number.
- **No dependency installed, no pipeline written, no `floor_evidence` entry
  emitted, no floor promoted.** Nothing outside this directory was touched.
- **8684 was not decoded** (LZW). Recorded rather than worked around.
- **Per-point GPS times were not read**, so tide-at-overflight is bounded (§6)
  and not determined.
- **The GEOID12A/12B/18 contradiction was not resolved.** It needs NOAA/JALBTCX.
- **13968's raster GeoKeys were not read** — its datum and units come from the
  USGS FGDC only. It is topo-only and misses 2 of 8 spots, so it was not pursued.
- **The DAV custom-download route was not established as scriptable.** The
  Data Access Viewer offers server-side datum choice, which would be attractive,
  and `https://coast.noaa.gov/dataviewer/api` does answer with a health check.
  Every endpoint probed beneath it (`datasets`, `footprints`, `orders/new`,
  `datums`, `projections`, `v1/datasets`) returned 404. Recorded as an unverified
  lead, not a route.

### Open questions for you

1. **§7's 0.3 ft tolerance versus VDatum's ±0.305 ft.** The transform alone
   consumes the promotion budget. Does the tolerance widen, does the rule carry
   the datum uncertainty explicitly, or does an instrumented method need a
   tighter datum path than VDatum offers here?
2. **Who produces the reef polygons?** Eight bench polygons are a prerequisite
   for §2 and do not exist. This is a bigger task than the DEM work and blocks it.
3. **GDAL: yes or no** — and if no, is CoNED dropped, or shipped with a
   1930–2014 range as its date?
4. **Does the 2014 NCMP date discrepancy get reported upstream?** NOAA's DEM
   metadata contradicts its own swath filenames.
