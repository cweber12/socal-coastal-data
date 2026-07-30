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

## Notes on the two that took real work

**The floating-point predictor.** The NOAA COGs use TIFF `Predictor=3` with
32-bit floats, which is horizontal byte differencing across byte-planes followed
by a de-interleave. `unpredict_row()` implements it per row, which matters —
decoding only the rows inside the sample window keeps a 512×512 tile cheap in
pure Python.

**Range reads need a kept-alive connection.** CoNED tiles are uncompressed with
`RowsPerStrip=1`, so a 201-row window is 201 separate reads. A fresh TCP+TLS
handshake per row is the difference between ~45 s and several minutes, hence the
`http.client` connection cache in `probe_dem.py` rather than plain `urlopen`.

## One thing these do not do

They read coordinates from a hardcoded list of the 8 spots and their `spots.json`
lat/lon, duplicated inline. That is deliberate for a throwaway probe — nothing
here imports from or writes to `shared/`, `lib/`, `app/` or `calibration/`.

`widen_window.py` is the one exception and reads its coordinates out of
`findings/vdatum-transforms.json` instead, so that it probes exactly the coordinate
the transform was computed for rather than a second inline copy of it. It still
touches nothing outside `lidar-recon/`.
