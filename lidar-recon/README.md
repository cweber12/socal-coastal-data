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

> **Corrected 2026-07-29, and the widening is now committed.** Two defects in the
> two paragraphs above, both found while writing this finding into
> `calibration/floor-calibration.md` §2.
>
> 1. **The count is 3, not 4.** The table above carries three of the five decoded
>    products; it omits 5189 (2014 NCMP) and 6260 (El-Niño). On the full five,
>    `torrey-pines-beach` is not an agreement but a **contradiction**: four products
>    put its ±100 m minimum at +0.99 to +1.13 m with no sub-zero pixel, while **5189
>    reads −2.858 m over 8.8% of the same disc** at 93.8% coverage. Unresolved — and
>    note that 5189 is the tile shown above to be *missing its low ground* at Cabrillo
>    (47.2%) and Cardiff (49.1%), so the only product finding intertidal ground here is
>    the one least trusted to have it. `windansea`, `sunset-cliffs` and
>    `la-jolla-shores` are unanimous across all five and stand.
> 2. **"That entire range is outside the data" is overstated** for
>    `la-jolla-shores`, whose lowest pixel is +0.96 ft MLLW — inside the +2.0 → −2.0 ft
>    band, with the bottom 3 ft of it empty. Right at the two cliff spots.
>
> The ±200/300/500 m figures were prose-only when written, with no findings file behind
> them. They have now been re-derived and committed —
> `findings/coordinate-offset-widening.json`, driver `probes/widen_window.py`, product
> 2616. Every figure above reproduced. It also adds two the prose did not have:
> `torrey-pines-beach` is still entirely above 0 m at ±300 m and goes negative at
> ±500 m over only **1.2%** of the disc, and Cabrillo's median climbs
> 14.7 → 19.3 → 24.8 → **32.6 m** across ±100/200/300/500 m. Widening is not a
> workaround at any spot: it trades a window with no reef for a window that is mostly
> cliff.

Cabrillo fails the other way. Its ±100 m median is 14.7 m and *rises* to 24.8 m
at ±300 m — the disc fills with bluff going inland while the reef is a narrow
shore-parallel strip. The clip geometry has to be the bench, and nothing in the
repo knows where the bench is.

> **Corrected 2026-07-29 under #80: every Cabrillo figure in this section was
> measured over a window clipped at a tile edge, and the clipped side is the
> seaward one.** `probe_dem.probe()` clamps its window to the tile it is handed —
> `x0,y0=max(0,x0),max(0,y0); x1,y1=min(W-1,x1),min(H-1,y1)` — which is right as
> code and silent as measurement. The `cabrillo-tidepools` pin sits **28 m east
> of tile 11SMS770135's western edge**, and the same boundary falls in the same
> place in 6260, so the ±100 m window recorded `px_window` starting at column 0
> and covered 130×202 px of the 202×202 it asked for. It widened **inland only**,
> at every width. A window that can only grow one way will show a rising median
> whether or not the terrain does.
>
> Re-measured on a 2×2 tile mosaic — `probes/window_truncation.py`, full output in
> `findings/window-truncation.json`. The ±25 m windows were never truncated and
> reproduce exactly, which is what says the mosaic reader and `probe_dem` agree
> where there is nothing to disagree about:
>
> | product | half-width | coverage % | min m | median m | frac < 0 m |
> |---|---|---|---|---|---|
> | 2616 | ±25 | 96.75 → 96.75 | −0.052 → −0.052 | 0.373 → 0.373 | 0.030 → 0.030 |
> | 2616 | ±100 | 98.35 → **94.18** | −0.962 → **−2.744** | 14.708 → **6.928** | 0.025 → **0.210** |
> | 2616 | ±200 | 99.53 → **83.05** | −0.962 → **−4.880** | 19.296 → **11.153** | 0.011 → **0.254** |
> | 2616 | ±300 | 99.78 → **80.73** | −0.962 → **−6.656** | 24.841 → **14.971** | 0.006 → **0.272** |
> | 2616 | ±500 | 99.09 → **76.54** | −3.897 → **−10.604** | 32.556 → **15.937** | 0.044 → **0.310** |
> | 6260 | ±100 | 100.0 → **99.07** | −0.077 → **−0.542** | 14.229 → **2.200** | 0.001 → **0.124** |
>
> **What changes.** Cabrillo's ±100 m disc holds far more intertidal ground than
> reported: 21% of valid pixels below 0 m NAVD88 against 0.025, an eight-fold
> difference, and a minimum of −2.744 m against −0.962 m. The median at ±100 m is
> **6.9 m, not 14.7 m**. The rise going inland is real but much flatter —
> 6.9 → 11.2 → 15.0 → 15.9 m rather than 14.7 → 32.6 m — and it flattens at the
> top rather than climbing. Coverage falls with width instead of rising, which is
> the honest shape: widening reaches offshore into voids.
>
> **What stands.** The three unanimous spots are unaffected — `windansea`,
> `sunset-cliffs` and `la-jolla-shores` first reach sub-zero ground at ±200 m on
> **full, untruncated** windows, and `torrey-pines-beach` is still entirely above
> 0 m at ±300 m on a full window. Truncation reaches their ±300/±500 m rows only
> (`windansea` 84% and 57% of the window it asked for, the others 89–95%), so
> `torrey-pines-beach`'s "negative at ±500 m over only 1.2% of the disc" keeps its
> direction and loses its fraction. `la-jolla-cove`'s ±100 m CoNED window is also
> truncated, on the **east** — landward at a west-facing cove — and was not
> re-measured, because CoNED is uncompressed at one range request per raster row
> and §8 recommends dropping it anyway.
>
> The conclusion this section exists to support does not move: a point buffer is
> still not a bench, and Cabrillo's disc is still mostly bluff. The numbers it was
> argued with were wrong by up to a factor of eight.

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

Sections 10 and 11 were added later, under #80, and §9 was written before them.

---

## 10. The slope gate: a real polygon, and slope does not survive it

#80 asked the one question §7 left open. The VDatum transform is a **pure
additive offset** (§4), an additive offset cannot change dA/dz, so is curve
*slope* robust to a wrong boundary even where the absolute level is not? If yes,
#46 has a deliverable that never needed 0.3 ft absolute. If slope moves as much
as level, #46 closes on a measured no.

**It closes on a measured no, and for a reason #80 did not anticipate: the two
products this directory recommended cannot agree on the curve even with the
polygon held fixed.**

### The polygon is not hand-traced, and that is the point

§7's open question was "who produces the reef polygons". One already exists.
OpenStreetMap carries `natural=reef` areas along this corridor, traced from
satellite imagery — the tens-of-metres class #80 asked for, and unlike a hand
trace it arrives with a version, a changeset, a mapper and the imagery it
inherits its georeferencing from. `probes/osm_reef.py`, output in
`findings/osm-reef-locator.json`.

```
way 975130801  v5  2023-06-11  changeset 137200202  mapper JRH50
  natural=reef  reef=rock  biotic_reef:type=fringing  area=yes
  252 nodes, 27.67 ha, ~1.5 km alongshore x 100-450 m cross-shore
  changeset imagery_used = "Mapbox Satellite"
  changeset comment (v2, cs110010382) = "adjusted coastline to highwater mark
                                         per OSM guidelines and added reefs"
```

**The `cabrillo-tidepools` pin sits inside it**, 13 m from the nearest vertex, on
its landward edge. Stated positional uncertainty **±25 m**, and the reasoning
matters more than the number: Mapbox Satellite is Maxar-derived and usually
georeferenced within ~10 m, but a rock reef's *seaward* edge in imagery is a
water-clarity and tide-state boundary rather than a sharp feature, so where a
mapper puts it moves with the image epoch. Every perturbation below is reported
at 10, 25 **and** 50 m so the gate does not rest on that judgement.

**This is not an MPA boundary and none was read.** `natural=reef` is a mapper's
physical trace. The Cabrillo State Marine Reserve relation is in the same
neighbourhood, #80 puts it out of scope, and the query never touched it.

**OSM has one of these, not eight.** The same sweep at 1.2 km around each of the
other seven spots returns **zero** `natural=reef` areas. Whatever the locator job
is, it is not a join.

### The polygon locates the bench; the coordinate disc does not

| clip | median elevation inside |
|---|---|
| ±100 m disc around the pin, 2616, corrected | 6.93 m NAVD88 = **+22.9 ft MLLW** |
| OSM reef ∩ ±250 m alongshore, 2616 | **−1.00 ft MLLW** |
| OSM reef ∩ ±250 m alongshore, 6260 | **+0.50 ft MLLW** |

That is the coarse-locator result in one table. A mapped outline puts the median
within a foot of the datum; the published coordinate's own error bar puts it 23 ft
above it.

### The bench is where the voids are

Coverage inside the polygon, which no ±25 m disc could have shown:

| extent | 2616 valid | 6260 valid |
|---|---|---|
| OSM reef ∩ ±250 m alongshore | 82.4% | **66.6%** |
| full mapped reef, ~1.5 km | 89.5% | **38.7%** |

And the voids are not scattered. Translating the polygon 50 m **seaward** drops
6260 to **38.0%** valid and 2616 to 66.3%; 50 m **landward** raises them to
**87.8%** and 91.6%. §7 said the 2014 NCMP voids "sit on the wet reef" from the
medians; here it is measured directly on the rock, and it is true of the two
products §8 recommended instead.

**6260 cannot produce the curve #80 specifies.** Its lowest pixel anywhere inside
the mapped bench is **−1.56 ft MLLW**. The band runs to −2.0 ft, so A(−2.0 ft)
equals its entire valid area and the bottom 0.44 ft of the band is empty. 2616
reaches −14.02 ft MLLW inside the same polygon, with 43% of its valid pixels
below −2.0 ft. **The two products do not sample the same elevation range on the
same rock**, which is the fact everything below follows from.

### The floor cannot be located in the band at all

§2 defines the floor as the level where exposed area crosses "a fixed minimum of
walkable bench" and never fixes the minimum. At a *minimum* — 500 or 2000 m² —
A(w) already exceeds it at +2.0 ft MLLW in both products, so the crossing is
above the top of the band and +2.0 is a band edge rather than a floor. The
thresholds that bite are most of the bench, not a minimum of it:

| threshold | 2616 floor | 6260 floor |
|---|---|---|
| 500 m² | +2.0 (saturated) | +2.0 (saturated) |
| 2 000 m² | +2.0 (saturated) | +2.0 (saturated) |
| 10 000 m² | +1.0 | +0.9 |
| 20 000 m² | +0.3 | +0.7 |
| 40 000 m² | never in band | 0.0 |

### The gate, level and slope reported separately

At the stated ±25 m, on the pin reach. Level in feet, slope as a percentage
change. `shape_dev` is the largest gap between the perturbed and baseline
*normalised* curves over the 41 levels — one threshold-free number for "did the
curve change shape".

| product | perturbation | Δ floor @2000 m² | Δ floor @50% | Δ prime | Δ norm slope @knee | shape_dev |
|---|---|---|---|---|---|---|
| 2616 | erode 25 m | **1.2 ft** | 0.2 | **0.0** | 25.9% | 0.246 |
| 2616 | dilate 25 m | 0.0 | 0.5 | **0.0** | 26.9% | 0.245 |
| 2616 | alongshore ±25 m | 0.0 | 0.0 | **0.0** | 0.6% | **0.035** |
| 2616 | cross-shore ±25 m | **1.0 ft** | 0.4 | **0.0** | 8.2% | 0.216 |
| 6260 | erode 25 m | **1.0 ft** | 0.1 | **0.0** | 6.0% | 0.138 |
| 6260 | dilate 25 m | 0.0 | 0.2 | **0.0** | 24.7% | 0.194 |
| 6260 | alongshore ±25 m | 0.0 | 0.1 | **0.0** | 2.8% | **0.033** |
| 6260 | cross-shore ±25 m | 0.9 ft | 0.2 | **0.0** | 15.2% | 0.189 |

Three results, in order of how much they matter.

**Slope magnitude does not hold.** Normalised slope at the knee moves 25–27% at
the stated uncertainty and up to 62% at ±50 m. The normalised curve moves by up
to 0.246 — a quarter of the bench's area arriving at a different level. #80's own
disposition applies: slope moves about as much as level does, so hand-traced
geometry cannot support the slope claim.

**Slope *location* holds perfectly.** The knee — where marginal area per 0.1 ft
of drop peaks, which is §2's `tidepool_prime_ft` — moves **0.0 ft** in every
product, every extent, every perturbation kind, at ±10 m and ±25 m, and for 2616
at ±50 m too. That is the one quantity that survived, and the next paragraph is
why it cannot be used.

**Product choice beats every perturbation.** Same polygon, same datum offset,
different DEM:

| | 2616 | 6260 | gap |
|---|---|---|---|
| prime, pin reach | **+0.3 ft** | **+0.7 ft** | 0.4 ft |
| normalised peak slope, pin reach | — | — | **+91%** |
| normalised peak slope, full reef | — | — | **+357%** |
| shape_dev, pin reach | — | — | 0.117 |
| shape_dev, full reef | — | — | 0.131 |
| median inside, full reef | −4.0 ft MLLW | +0.5 ft MLLW | 4.5 ft |

The one metric that survived geometry perturbation is **0.4 ft apart between the
two products**, and the shape deviation between products (0.117–0.131) is the
same order as the shape deviation from perturbing the polygon by its own
uncertainty. Choosing the other qualifying tile is not a smaller error than
drawing the polygon 25 m wrong.

**#63's conflation, measured, and it is backwards.** #63 assumed edge imprecision
was survivable and gross mislocation fatal. Alongshore translation is indeed
benign — `shape_dev` 0.033–0.036 at ±25 m, in all four product-and-extent
combinations, an order of magnitude below everything else. But uniform
erode/dilate, which *is* edge imprecision, is the **worst** perturbation of the
three (0.138–0.246), ahead of cross-shore mislocation (0.189–0.216). On a narrow
shore-parallel strip, moving the edges in or out changes which elevation band is
inside the polygon, and that is the curve itself.

### One disclosure, and it is not the NPS check

6260's knee lands at **+0.7 ft**, which is numerically NPS's published Cabrillo
figure. **That is not a comparison and must not be read as one.** §6's rule is
that the check is spent once, against a settled field; this is a knee and not a
floor, `nps.gov` was not read for this work, and 2616 puts the same knee at
+0.3 ft on the same polygon. A 0.4 ft spread between two qualifying products
means the coincidence carries no weight in either direction. It is recorded here
because finding it later in the JSON and wondering whether anyone noticed would be
worse.

### What this leaves

- **The blocker was never the polygons.** It is DEM void coverage on the wet
  reef, and the two products §8 recommended have 82%/67% coverage on the bench
  and disagree by 0.4 ft on the only stable metric.
- Reviving hypsometry means resolving that disagreement, not drawing seven more
  outlines. §6's unread per-point GPS times and §8's dropped CoNED are where that
  would start.
- `probes/hypsometry.py`, full output in `findings/cabrillo-slope-gate.json`:
  both products, both extents, 19 variants each, all 41 levels.

---

## 11. The rate-curve discs are centred on the pin, and at five spots that is not
where the records are

#80 §1 noted that `calibration/` pulls a 0.5 km disc around each `spots.json`
coordinate, that §7 measured those coordinates sitting 100–400 m inland of the
bench, and that "the centring is worth stating rather than assuming, and it has
never been checked". Checked now: `probes/rate_centring.py`, output in
`findings/rate-curve-centring.json`.

Method: iNaturalist **count** queries only — no records pulled — with the
calibration's own 13 taxon ids and corpus start, read out of
`calibration/target_taxa.json` and `calibration/src/config.ts` so the audit
cannot drift from the pull it audits. Two measurements per spot: counts at
0.1–2.0 km of the pin, and the count inside a 0.5 km disc centred on each of a
5×5 grid of offsets from −500 to +500 m.

**The instrument is validated by construction.** The 0.5 km counts reproduce the
`records` figures in `shared/calibration.json` **exactly at 7 of 8 spots** — 558,
98, 310, 545, 158, 794, 3133 — with `torrey-pines-beach` at 36 against a shipped
35, one record that reached research grade since the 2026-07-30 pull.

| spot | ≤100 m | ≤500 m (shipped) | best 500 m disc | offset | vs pin | publishes? |
|---|---|---|---|---|---|---|
| `cabrillo-tidepools` | 1983 | 3133 | 3166 | +250 E | 1.01× | **yes** |
| `sunset-cliffs` | 1 | 794 | 794 | none | 1.00× | **yes** |
| `swamis` | 258 | 558 | 560 | +250 N | 1.00× | **yes** |
| `la-jolla-shores` | 42 | 310 | 469 | 559 m SW | 1.51× | no |
| `cardiff-reef` | 20 | 98 | 157 | 707 m SE | 1.60× | no |
| `torrey-pines-beach` | 0 | 36 | 72 | 559 m NW | **2.00×** | no |
| `la-jolla-cove` | 96 | 545 | 1625 | 707 m SW | **2.98×** | no |
| `windansea` | 1 | 158 | 866 | 559 m NNW | **5.48×** | no |

**The three spots that publish are the three that are centred, and the five that
refuse are the five that are not.** Every refusing spot's best 500 m disc holds
1.5–5.5× the records the shipped disc holds.

Three things to be careful about before that is read as a cause.

- **These are lower bounds.** All five refusing spots put their best disc on the
  ±500 m grid boundary, so the real optimum is further out than this grid reaches.
- **More records is not automatically better data for this spot.** §1 of
  `calibration/floor-calibration.md` already warns that beach-level slugs cover
  multiple benches; a disc recentred 500 m away may be aggregating two of them,
  which is a different defect rather than a fix. `la-jolla-cove` and
  `la-jolla-shores` refuse on the amplitude gate — diver contamination — and a
  richer disc need not move that at all.
- **Counts are not visits,** and none of the pipeline's in-memory filters ran.
  This is a question about where, not how many.

**The same question has since been measured a second way, and the two tables are
not in conflict.** #86 re-ran the centring check inside the pipeline itself and
published it in `calibration/out/report.md` — same spots, same conclusion about
which five are off the rock, different ratios: `windansea` 3.59× there against
5.48× here, `la-jolla-cove` 1.25× against 2.98×. Two things differ and both
lower the ratio. That table counts the pipeline's **filtered records with visits
collapsed**, where this one counts raw iNaturalist **records**; and its grid
stops at a 500 m total offset, because a disc centred further hangs outside the
1000 m pull it re-uses, where this grid steps ±500 m on each axis and so reaches
707 m on the diagonals. **Both are lower bounds** — every refusing spot sits on
its own grid's boundary in both — so neither number is the optimum and neither
contradicts the other. Read this table for where the records are and that one for
what the shipped pipeline sees.

Two findings that do not depend on the correlation.

**Two independent instruments agree the pin is off the rock at the same spots.**
`torrey-pines-beach` has **0** records within 100 m of its coordinate,
`windansea` **1**, `sunset-cliffs` **1** — and those are three of the four spots
§7 found with no sub-zero pixel in their ±100 m disc. Elevation and observation
density are unrelated measurements reaching the same conclusion.

**`RADIUS_KM = 0.5` is licensed by the one spot where centring cannot bite.**
`config.ts` says the corridor-wide radius rests on #30 measuring Cabrillo's
per-bin rates as insensitive to 250/500/1000 m. Cabrillo is the best-centred spot
in the corridor — 1983 of its 3133 records are within 100 m of the pin, and no
500 m offset improves on it by more than 1.1%. A radius-insensitivity result from
the one spot whose disc is already on the rock does not transfer to a spot whose
disc is 559 m off it. `config.ts` anticipated exactly this — "It was Cabrillo-only,
which is why the sensitivity grid is re-run per spot rather than assumed from the
richest one" — and the grid it re-runs varies the radius, not the centre.

### Open questions, second round

5. **Does #46 close?** §10 says slope does not survive the polygon at either
   product, and that product choice is a bigger error term than the polygon.
   Nothing here sets or changes a floor, per #42's rule; the disposition is a
   decision.
6. **Is the centring result a defect or a diagnostic?** Recentring is out of
   scope under #80 and would mean editing `spots.json` coordinates, which #80
   forbids and the repo's own rule reserves for joins against an authority. The
   cheapest honest move is a per-spot centring diagnostic beside the existing
   radius grid, so a refusal states whether its disc is on the rock.
7. **Which of the five refusals survive a centred disc?** Untested. `windansea`
   refuses on one criterion at 1.13× against a 2.0× bar with 99 visits, and its
   best disc holds 5.5× the records. That is the cheapest test in the corridor
   and it is a `calibration/` change, not a lidar one.

---

## 12. The pre-registered adjudication: the surveyed elevations select neither product

§10 left hypsometry blocked on a disagreement it could not settle — two
qualifying products, 0.4 ft apart on the only metric that survived perturbation,
and nothing in the repo able to say which was right. #89 ran the comparison that
answers it against the corridor's only surveyed ground truth.

**It returns indeterminate on two independent grounds, and that is the result.**
No product is selected. `probes/dem_adjudication.py`, full output in
`findings/cabrillo-dem-adjudication.json`.

### Every parameter was frozen before the comparison ran

This is the part that makes the answer worth anything. The metric set, the
exclusions, the indeterminacy rule and both confounds were written into
`calibration/floor-calibration.md` §6 and committed in #88 **before any DEM was
sampled at a surveyed point**. Nothing in this section revises them, and a
parameter changed after the data is visible is tuning whatever the commit
message calls it.

Four mechanical choices the pre-registration does not fix had to be made here.
Each is resolved toward the option with no free number in it, and all four are
carried in the finding rather than left in the code:

| choice | resolved as | why |
|---|---|---|
| DEM sampling rule | the single cell containing the coordinate | the only rule with no radius to pick |
| horizontal tolerance | none beyond that cell | the comparison does not need one; the report's `Std. Dev.` column is **unresolved** and is neither read nor assumed to be metres |
| roughness window | sd of valid cells within **5.0 m** | a fixed ground radius, so it means the same thing on a 1 m grid and a 0.5 m one |
| roughness restriction | the low half by median | a median split has no threshold to choose |

### Points used, and points dropped

126 of the 137 surveyed points carry a published height. The pre-registration
admits the report's own two exclusions and no others, and **neither removes a
point from the 126**: Zone II M2's height is published as `ND` because the report
withdrew it, so it was never in the 126, and the 8 February 16:20 exclusion is a
reading-level one the report already applied to its own averages, leaving all 35
affected points intact. **No further exclusion was applied.**

| step | n | why |
|---|---:|---|
| surveyed points | 137 | |
| with a published height | 126 | 11 are `ND` |
| with published coordinates | **124** | Zone 2 L7 and L8 publish a height and no coordinate — no coordinate, no cell to sample |
| valid in both products | **119** | 5 fall on 2616 voids; 6260 voids none |

The 5 voids are 2616's, and every one is a low point — 0.10 to 2.06 ft MLLW, in
Zone 2 M5 and the Zone 3 K5/K6 transect. §10 measured 2616's voids sitting on the
wet reef from area coverage; here the same thing shows up as which individual
surveyed points it cannot answer for. Each drop is applied to **both** products,
so no drop can favour either.

### The three metrics disagree, and the interval spans zero

Residual is DEM minus surveyed, in feet above MLLW, over the 119 paired points.

| product | RMSE | MAE | median abs err | mean signed | median signed |
|---|---:|---:|---:|---:|---:|
| 2616 | **2.017** | **1.602** | 1.518 | −1.302 | −1.433 |
| 6260 | 2.079 | 1.663 | **1.439** | −1.324 | −1.429 |
| chooses | 2616 | 2616 | **6260** | | |

**Two metrics choose 2616 and one chooses 6260, so nothing is selected.** The
pre-registration required all three to agree and said why: a split "would mean
the two products differ in the shape of their error rather than its size, and no
single scalar should adjudicate that." That is exactly what happened. 6260 is
closer at the centre of the distribution and 2616 is closer in the tail, which is
a difference in error shape, and it was pre-registered as a non-answer rather
than discovered as one.

**The bootstrap agrees, independently.** 95% percentile bootstrap over points on
the paired per-point difference in absolute residual, 10,000 resamples:

```
mean |resid 2616| - |resid 6260|  =  -0.062 ft
95% CI                            =  [-0.160, +0.034] ft   spans zero
```

Re-run at five seeds the interval moves in the third decimal and spans zero at
every one. The three metric-difference intervals, reported as description and
never allowed to select, span zero too. **On the pre-registration's own rule the
result is indeterminate and no product is selected.**

**The bigger number is the one neither product wins.** Both sit about **1.3 ft
below** the surveyed heights, while they differ from each other by 0.06 ft — a
factor of twenty. Whatever separates these two products is small against what
separates both of them from the survey, and the paired comparison is blind to it
by construction: any datum term is additive and identical for both, so VDatum's
±0.305 ft and the MLLW realisation gap between NOAA 9410170 and 9410230 cancel
exactly in the difference and cannot bias the choice. They also cannot explain a
1.3 ft common-mode bias, and this section does not claim to know what does.

### Confound 1 — sand, measured and left in

Regressing the signed residual on plot elevation gives a strong, tight slope in
both products, and it is not the pattern the pre-registration expected to find.

| product | slope, ft per ft of elevation | 95% CI | r² | intercept |
|---|---:|---|---:|---:|
| 2616 | −0.546 | [−0.695, −0.394] | 0.378 | +0.130 |
| 6260 | −0.704 | [−0.822, −0.567] | 0.579 | +0.521 |

Binned, which is the same fit read directly:

| surveyed band, ft MLLW | n | 2616 mean residual | 6260 mean residual |
|---|---:|---:|---:|
| −1 … 0 | 7 | **+0.55** | **+0.99** |
| 0 … +1 | 15 | −0.03 | +0.32 |
| +1 … +2 | 19 | −0.47 | −0.34 |
| +2 … +3 | 33 | −1.57 | −1.58 |
| +3 … +4 | 18 | −2.02 | −2.31 |
| +4 … +5 | 16 | −1.44 | −1.43 |
| +5 … +8 | 11 | **−3.47** | **−4.19** |

**Sand explains the low end's sign and not the high end's size.** Below 0 ft both
DEMs read *higher* than the 2004 survey, which is the direction burial predicts
and is where burial happens. But sand does not remove rock, and by +5 ft the DEMs
read 3.5–4.2 ft *below* surveyed heights that were taken with a laser level on
cliff faces and boulder tops. The residual is neither "concentrated low and flat"
nor "uniform across elevation and type" — it is a slope across the whole range,
which is a third outcome, and it is reported as one rather than pushed into
whichever box it half fits.

**Plot type is mostly elevation in disguise.** By type alone the mean residual is
−2.35 ft on Circular Plots, −1.52 on Photoplots and −0.50 on Line Transects
(2616; 6260 is within 0.25 ft of each). But Circular Plots average 4.14 ft MLLW
and Line Transects 1.15 ft, and in the joint model the type coefficients collapse
to +0.26/+0.30 ft (2616) and +0.01/+0.30 ft (6260) while r² barely moves —
0.378 → 0.382 and 0.579 → 0.586. The type effect is the elevation effect.

**No correction was applied.** Not a sand offset, not an epoch adjustment,
nothing. The gap is a confound to measure, and the residuals carry it.

### Confound 2 — point against cell, diagnostic and never selecting

Absolute residual against local DEM roughness — the sd of valid cells within 5 m:

| product | Pearson r | 95% CI | OLS slope | r² |
|---|---:|---|---:|---:|
| 2616 | 0.265 | [−0.016, +0.500] | 0.258 | 0.070 |
| 6260 | **0.370** | [+0.112, +0.583] | 0.335 | 0.137 |

The confound is real, and it is clearer in the finer product: a laser level read
the top of a boulder, and a DEM cell reports the cell. For 6260 the interval
excludes zero.

**The roughness-restricted comparison names no product either.** Restricted to
the 61 points below the median of the two products' 5 m roughness (0.209 ft), the
three metrics split 6260 / 2616 / 6260 and the paired interval is
[−0.143, +0.057] ft, spanning zero. It **cannot** override the primary and it did
not need to: it does not point anywhere. The pre-registration's ambiguity about
whether a restricted comparison that names nothing counts as "disagreeing" is
moot — both readings return indeterminate, and both are reported in the finding.

The same is true of the one sensitivity check that is not pre-registered at all:
sampling a 3 m neighbourhood mean instead of the containing cell reproduces the
metric split exactly, 2616 / 2616 / 6260. **The verdict does not turn on sub-cell
placement.**

### The vintage gap, reported and not corrected

| | acquired | published | gap to the survey |
|---|---|---|---|
| the survey | 2004-02-07 … 2004-03-19 | 2006-06 | — |
| 2616 | nominal 2009-01-01 … 2011-01-01 | 2014-03 | ~5–7 years |
| 6260 | 2016-04-28 … 2016-05-28 | 2017-04 | ~12 years |

**The pre-registration's "roughly 2014" is loose, and the correction is worth
recording.** 2616's source lidar is a nominal 2009–2011 and publishes no finer
date; 6260's is one month in spring 2016. The two products are **five years apart
from each other** on a bench that buries and scours seasonally, which is a
confound between them and not only between each and 2004. It makes the
indeterminate verdict easier to believe and it is not a reason to adjust
anything.

### Post-hoc, and it cannot select: both DEMs reproduce a fraction of the surveyed relief

**Everything from here to the end of this subsection was computed after the
comparison above had run and returned indeterminate.** It is not in the
pre-registration, it contributed nothing to the verdict, and it selects no
product. It is recorded for what it rules out.

The run scored the roughness-restricted set but never regressed elevation inside
it. Doing so asks one question: is the confound-1 slope really the
point-against-cell confound wearing a disguise? If rough ground were producing
it, restricting to smooth ground should **weaken** it.

| set | 2616 slope | r² | 6260 slope | r² |
|---|---:|---:|---:|---:|
| all 119 points | −0.547 | 0.378 | −0.704 | 0.579 |
| shared restricted set, n = 61 | **−0.859** | 0.930 | **−0.985** | 0.957 |
| each product on its own roughness median, n = 60 | −0.858 | 0.948 | −0.966 | 0.971 |

**It strengthens, in both products and under both ways of drawing the
restriction.** The second convention is reported because it restricts each
product to the ground *that* product resolves smoothly; it gives two different
point sets, so it can never be a paired comparison, which is why it appears only
here.

**Correction, under #93: that strengthening does not mean what this section
first said it meant.** Roughness is computed *from* the DEM, so restricting on it
is not an independent slice — it selects on a quantity correlated with the very
elevation under test. Measured over all 119 paired points:

| product | corr(roughness, DEM elevation) | DEM sd, all → restricted | survey sd, all → restricted |
|---|---:|---|---|
| 2616 | **+0.697** | 1.446 → 0.362 (**−75.0%**) | 1.732 → 1.316 (−24.0%) |
| 6260 | **+0.674** | 1.160 → 0.275 (**−76.3%**) | 1.732 → 1.316 (−24.0%) |

Rough ground is high ground here. Restricting to smooth ground therefore strips
about three quarters of the DEM's spread against about a quarter of the survey's,
and a regression of `DEM − survey` on `survey` under that asymmetry is pushed
toward slope −1 and r² → 1 **mechanically**, whether or not anything is wrong. It
is also why r² *rises* on a truncated range, where it would normally fall. **The
headline therefore rests on the unselected `all 119` row, which involves no
selection at all**, and the restricted rows are read as illustration rather than
as evidence.

Read as a transfer function the unselected numbers are still stark. Residual is
DEM minus survey, so the all-points slopes of −0.547 and −0.704 mean
`d(DEM)/d(survey)` of **0.45** and **0.30** — a faithful DEM would give 1.0 — and
`corr(survey, DEM)` over those same 119 points is only **0.54** and **0.44**. A
DEM reproducing a third to a half of the surveyed relief is the finding, and it
needs no restricted set to make it.

**One thing the restriction does show cleanly**, because both products are scored
on the identical shared set and so face the same selection: on those 61 points
2616 holds `corr(survey, DEM)` at **0.513** while 6260 falls to **0.070**. The
selection cannot explain a *difference* it applies equally to both. None of the
three pre-registered metrics captured this — RMSE, MAE and median absolute error
all measure the size of the error, and this measures whether a product tracks the
bench's shape at all on ground it resolves smoothly.

**Two explanations are ruled out by this, one is not, and none of them is the one
left standing:**

- **Roughness / point against cell.** **Not ruled out.** This subsection
  previously recorded it as ruled out, on the grounds that the slope steepens on
  smooth ground. That inference does not hold, for the reason given above: the
  restriction selects on a DEM-derived quantity and induces the same direction of
  effect. The test cannot separate *roughness is not the cause* from *restricting
  on a DEM-derived quantity produced the steepening*.
- **Sand.** Ruled out as the cause. Sand buries low ground and cannot lower high
  rock, and this slope is driven by the DEM reading feet below surveyed cliff
  faces and boulder tops.
- **Any datum term.** Ruled out as the cause. A datum error is additive: it moves
  this regression's *intercept* and cannot produce a *slope* in it. It is also
  identical for both products, so it cancels exactly in the paired difference.

**Three candidates survive, and this section chooses between none of them.**

1. **Coordinates that do not locate the plots on a 1 m grid.** The survey's
   horizontal is a 2004 Trimble fix whose accuracy claim and `Std. Dev.` column
   cannot be reconciled — that column's unit is **unresolved** and is not read
   here. Metre-class horizontal error on a bench with metre-class relief samples
   the wrong feature.
2. **A scale problem in the surveyed heights.** The report ties stadia readings
   to MLLW through a conversion formula it attributes to UCSC and a still-water
   line read by eye. A scale error there stretches the surveyed range against a
   DEM that is correct.
3. **DEMs that do not resolve this bench.** Both products may simply be too
   smooth here, which §10's void coverage already makes plausible.

None is tested here, none is preferred, and **nothing was adjusted to close the
gap**. Separating them is new work, not a repair.

**What it means for the adjudication, plainly: no product could have been
selected whichever way the metrics fell.** A comparison can rank two products by
how well they reproduce ground truth only if at least one of them reproduces it.
Neither tracks the surveyed relief — over all 119 points, with no selection
involved, `corr(survey, DEM)` is 0.44–0.54 and `d(DEM)/d(survey)` is 0.30–0.45
against an ideal 1.0. A metric win would have been a win on noise. **The indeterminate verdict is not a near
miss between two close candidates; it is what a comparison returns when neither
candidate is measuring the thing.** That does not change the verdict — the
pre-registered rules returned it on their own terms and stand as run — but it
changes what the verdict was ever capable of being.

### What this leaves

- **Indeterminate, no product selected**, on a metric split and a bootstrap
  interval that spans zero, either of which was sufficient alone.
- **No floor is set or changed**, `shared/spots.json` is untouched, and the §6
  check stays unspent with nothing recorded against it — which is the branch §6
  committed to for this outcome before it knew which branch it would be taking.
- **The blocker moved, and the post-hoc diagnostic says how far.** It is no
  longer "which of these two products is right": they are indistinguishable
  against 126 surveyed heights, both are ~1.3 ft off, and on smooth ground
  neither DEM tracks the surveyed relief at all — `d(DEM)/d(survey)` of
  0.01–0.14 against an ideal 1.0. Choosing between them was never a question the
  data could answer.
- Re-running the slope gate on a bench-scale polygon, §10's obvious next step,
  still has no product to prefer, and now has a measured reason why not.

### Open questions, third round

8. **What is the 1.3 ft, given that it is not a constant?** Both products sit
   that far below the survey on average, more than VDatum's ±0.305 ft — but the
   post-hoc diagnostic shows the gap is not an offset at all. It is ~0 near
   datum and 3.5–4.2 ft at the top of the range, so any candidate that is a
   *constant* is thereby excluded as the whole story: the 9410170-vs-9410230
   realisation gap and the VDatum transform are both constants and both move the
   intercept only. What remains has to be something that scales with height, and
   the 2006 report never made the station comparison that would retire the
   constant part.
9. **Why does `d(DEM)/d(survey)` collapse to 0.01–0.14 on smooth ground?** This
   is the sharpest unexplained result in the directory, and the post-hoc
   diagnostic narrowed it rather than answering it. The elevation slope
   *strengthens* under roughness restriction — −0.547/−0.704 over all points
   against −0.859/−0.985 on the smooth half — which rules out the
   point-against-cell confound, sand, and any additive datum term as the cause.
   Three candidates survive and are listed above: horizontal coordinates that do
   not locate the plots on a 1 m grid, a scale error in the surveyed heights, or
   DEMs that do not resolve this bench. Separating them is the work; **the
   consequence for §8's recommendation is already in hand, because a product
   chosen between these two was never going to be chosen on this evidence.**
10. **Does anything select a product?** Not these 126 points. If a product must
    be chosen, it is chosen on grounds this comparison did not supply, and that
    should be said out loud rather than inherited from §8's recommendation.

Section 12 was added under #89, and §9 was written before it.

---

## 13. A different product entirely: `CA_SCRIPPS_APR_2005`, a point cloud

Added under [#109](https://github.com/cweber12/socal-coastal-data/issues/109),
for [#108](https://github.com/cweber12/socal-coastal-data/issues/108). Read
2026-07-31. Full record in `findings/scripps2005-acquisition.json`.

**Sections 1–12 all read derived DEM rasters.** This one is an airborne
**point cloud** — 43 legacy LAZ tiles, LAS 1.1, point format 1 — which is what
makes it able to test whether §12's slope deficiency survives with no gridding
in the path.

**It declares no vertical datum, and that is worse than §2's worst case.** The
GeoKeyDirectory carries `GTModelType`, `GTRasterType` and
`ProjectedCSType = 26911` and nothing else; keys 4096–4099 are absent. The FGDC
metadata's `<spref>` holds `<horizsys>` only, with no `<vertdef>`, and the whole
11.6 kB file contains no occurrence of NAVD, NGVD, geoid, ellipsoid, meters or
feet. For product 8684 the datum was at least a sibling's claim. Here neither
the container nor the sidecar asserts anything.

**So it was measured.** Tied to the 124 NPS laser-levelled points from §12,
using the test that needs no regression: 21 of them sit on the MLLW datum zero,
so the cloud reads the offset directly with nothing fitted.

| | R = 2 m | R = 5 m |
|---|---:|---:|
| plots on the MLLW datum zero | 21 | 21 |
| mean lidar Z | −0.019 m | −0.013 m |
| se | 0.022 | 0.019 |
| vs NAVD88 (−0.068) | **2.3 se** | **2.9 se** |
| vs NGVD29 (≈ −0.870) | 39.5 se | 44.5 se |

**NAVD88.** The residual sits inside VDatum's own 0.093 m uncertainty at
Cabrillo.

**The obvious comparison would have given the wrong answer.** Mean
(survey − lidar) over all 124 points is +0.45 to +0.55 m, matching neither
candidate — because `offset = mean_survey × (1 − slope) − intercept`, and at a
mean height of 0.778 m with slope ≈0.45 that is ≈0.50 m of pure artifact. This
is almost certainly what §12's −1.302 and −1.324 ft biases are; they were
reported separately from the slopes and are the same phenomenon.
`dem_adjudication.py:686` ruled out a datum term as their cause, and this agrees
from a different direction. **A datum error is constant at every height. This
residual grows with height, from +0.059 m at the bottom to +1.534 m at the top.**

**§12's "DEMs too smooth" explanation is falsified as a *processing* artifact.**
Same 124 points, raw returns, no gridding anywhere:

| radius | slope | | radius | slope |
|---:|---:|---|---:|---:|
| 1.0 m | 0.607 | | 5.0 m | 0.420 |
| 1.5 m | 0.460 | | 10.0 m | 0.395 |
| 2.0 m | 0.495 | | 20.0 m | 0.338 |

§12 got **0.45 and 0.30** from the two rasters. The cloud gives 0.34–0.61 over
the same points. A defect present in the returns cannot have been caused by
gridding. Measured density is **1.04 distinct XY per m²** — sparse sampling of a
rough surface systematically misses narrow high features, which is exactly the
growing-under-read-with-height above. §12's other two explanations, coordinates
and survey scale, are untouched.

**Acquisition, and why it does not rescue the floor route.** The corridor was
flown **Monday 4 April 2005, 12:19–13:44 PDT**, sitting on the day's low, with
observed water at **−0.88 to −0.54 ft MLLW** — below all eight floors in force.
That sounds ideal and is not sufficient: NDBC 46224 and 46225 both read
**1.10 m at 14.0 s** during the sortie, and at 14 s a modest swell drives large
runup. Stockdon puts the dense-return level at **+1.80 to +3.42 ft MLLW**
depending on foreshore slope, which is above every floor. Stockdon is a sandy
beach parameterisation applied to a reef, so that is an upper bound of unknown
tightness — but still water is not the floor of what this product can see.

**What it settles for §8 and §9.** Floor calibration from this product is dead
for a third independent reason, alongside VDatum's ±0.299–0.313 ft and the
missing reef polygons at 7 of 8 spots. Zone extent is a different and much
coarser question, and the datum result unblocks it.
