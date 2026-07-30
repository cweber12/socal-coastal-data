# `probes/` — the evidence trail for `../README.md`

These are the throwaway probes that produced the numbers in the recon report.
**They are not a pipeline and are not proposed as one.** They exist so that every
figure in `../README.md` and `../findings/` can be re-derived rather than taken on
trust, per the repo's "record what you verified and how" rule.

Standard library only — `struct`, `zlib`, `math`, `json`, `urllib`, `http.client`,
`statistics`, `datetime`, `xml.etree`. No dependency is added by this directory.

| file | what it does |
|---|---|
| `probe_dem.py` | Samples a DEM window straight out of a remote GeoTIFF over HTTP range requests. Handles uncompressed single-row strips (CoNED) and tiled DEFLATE with the TIFF floating-point predictor (NCMP, Merge, El-Niño). Includes a geodetic→UTM forward projection. Produced `findings/coverage-measured.json`. |
| `geokeys.py` | Reads the GeoTIFF `GeoKeyDirectory` (TIFF tag 34735) over range requests, resolving ASCII and double params. This is what established the vertical datum **per raster** rather than from a sidecar. Produced `findings/geokey-evidence.json`. |
| `lasheader.py` | Reads the LAS 1.4 public header block from a remote COPC LAZ in one range request — bbox, Z range, point count, creation date. Used to confirm which swath covers each spot and to expose the acquisition-date contradiction. |
| `s3ls.py` | Paginated public S3 bucket listing, for exact tile counts and byte sizes. |
| `vdatum.py` | Drives the VDatum REST API for all 8 spots, including the GEOID18-vs-GEOID12B sensitivity check. Produced `findings/vdatum-transforms.json`. |
| `tides.py` | Lowest predicted tide at 9410230 inside each acquisition window, via the CO-OPS predictions API. Bounds what each campaign could have caught exposed. |
| `widen_window.py` | Re-runs `probe_dem.probe()` at ±200/300/500 m for the spots whose ±100 m disc holds no sub-zero ground, to measure how far out the bench is. Produced `findings/coordinate-offset-widening.json`. Added later than the rest — the ±200/300/500 m figures in `../README.md` §7 were prose-only with no findings file behind them, which is the thing this directory exists to prevent. |
| `osm_reef.py` | Looks for a bench outline that already exists rather than inventing one: OSM `natural=reef` areas around each spot, via Overpass, with authoritative per-way geometry and changeset `imagery_used` from the OSM API. Produced `findings/osm-reef-locator.json`. Added under #80. |
| `hypsometry.py` | The #80 slope gate. A(w) over a polygon in 0.1 ft steps from +2.0 to −2.0 ft MLLW, on a 2×2 tile mosaic, for 19 polygon variants across two products and two extents. Produced `findings/cabrillo-slope-gate.json`. |
| `window_truncation.py` | Audits every committed sample window for silent clipping at a tile edge, and re-measures the ones that were. Produced `findings/window-truncation.json`. |
| `rate_centring.py` | Whether `calibration/`'s 0.5 km discs are centred on the bench or merely contain it, from iNaturalist count queries — radial profile plus a 5×5 grid of offset disc centres. Produced `findings/rate-curve-centring.json`. |

## Notes on the ones that took real work

**The floating-point predictor.** The NOAA COGs use TIFF `Predictor=3` with
32-bit floats, which is horizontal byte differencing across byte-planes followed
by a de-interleave. `unpredict_row()` implements it per row, which matters —
decoding only the rows inside the sample window keeps a 512×512 tile cheap in
pure Python. `hypsometry.py` carries a second implementation that does the
de-interleave with strided slice assignment instead of a loop per byte, because
its window needs ~23,000 tile rows rather than a few hundred; it asserts against
`probe_dem`'s on the first row it decodes rather than being trusted.

**Range reads need a kept-alive connection.** CoNED tiles are uncompressed with
`RowsPerStrip=1`, so a 201-row window is 201 separate reads. A fresh TCP+TLS
handshake per row is the difference between ~45 s and several minutes, hence the
`http.client` connection cache in `probe_dem.py` rather than plain `urlopen`.

**Masks as run-lengths, not pixel grids.** `hypsometry.py` needs a polygon eroded
and dilated by a circular element over a 1570×3308 window. A Euclidean distance
transform over five million pixels in pure Python is minutes; a shore-parallel
strip is 1–3 column runs per row, so the same operation is a few hundred thousand
interval merges. Exact rather than approximate — dilation by radius `u` is the
union over `dy` in `[-u, u]` of the row at `j+dy` widened by
`floor(sqrt(u² - dy²))`, and erosion is that on the complement. Checked against
closed form: a 20×20 m square eroded by `u` gives exactly `(20-2u)²` pixels.

**Mosaicking, because one tile is not enough.** `probe_dem.probe()` clamps its
window to the tile it is handed. `cabrillo-tidepools` sits 28 m from a tile edge
in both recommended products, on the seaward side, so single-tile windows there
were clipped and reported as whole — see `window_truncation.py` and §7's
correction. `hypsometry.mosaic()` stitches a 2×2 block and asserts every tile onto
the first one's grid rather than resampling.

## What these read, and what they still never write

Nothing here writes anywhere but `../findings/`.

The original probes read coordinates from a hardcoded list of the 8 spots,
duplicated inline, which is fine for a throwaway probe. The ones added under #80
read instead — `shared/spots.json` for which spots carry a floor,
`calibration/target_taxa.json` and `calibration/src/config.ts` for the taxon ids
and corpus start. That is deliberate and it is the opposite of the original
reasoning: an audit of a shipped pull that keeps its own copy of that pull's
parameters can silently stop auditing it. `widen_window.py` made the same move
earlier for the same reason, reading its coordinates out of
`findings/vdatum-transforms.json` so it probes exactly the coordinate the
transform was computed for.
