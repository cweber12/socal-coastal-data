"""What vertical datum is CA_SCRIPPS_APR_2005 on? Tie it to surveyed ground.

`scripps2005_header.py` establishes that the file declares NO vertical datum:
GeoKeys 4096-4099 absent, no `<vertdef>` in the FGDC metadata, no occurrence of
NAVD, NGVD, geoid or ellipsoid anywhere in it. An undeclared datum is not an
invitation to assume the common one, so it is measured here.

THE TIE. NPS laser-levelled 124 monitoring points at Cabrillo in 2004 and
published their heights in INCHES ABOVE MLLW at published coordinates. They are
in `findings/cabrillo-surveyed-elevations.json`, extracted under #83, and they
are the only surveyed ground truth anywhere in this corridor.

    NAVD88  -> the cloud should read -0.068 m where the survey reads 0.000 m
               MLLW (VDatum 4.8 at Cabrillo, uncertainty 0.093 m; corroborated
               at swamis 0.054 m in findings/vdatum-transforms.json and by
               CO-OPS station datums at 9410230, 0.058 m)
    NGVD29  -> about -0.87 m

WHY THE OBVIOUS COMPARISON MISLEADS, and this is the part worth reading. The
mean of (survey - lidar) over all 124 points comes to +0.45 to +0.55 m, which
matches NEITHER candidate. That number is an artifact:

    offset = mean_survey x (1 - slope) - intercept

With mean survey height 0.778 m and a regression slope near 0.45, the arithmetic
produces about 0.50 m on its own. Evaluating a slope-deficient relationship at a
nonzero mean height manufactures something that looks like a datum error. This is
almost certainly the same artifact as #89's -1.302 and -1.324 ft biases, which
were reported separately from the slopes and are the same phenomenon;
`dem_adjudication.py:686` ruled out a datum term as their cause, and this agrees
from a different direction.

WHAT WORKS INSTEAD: no regression at all. 21 of the 124 plots sit on the MLLW
datum zero, so the cloud reads the offset directly with nothing fitted. A datum
error is CONSTANT at every height; the residual here grows with height, which is
how the two are told apart. Both are reported below.

SECOND RESULT, FOR FREE. The same comparison run on RAW RETURNS -- no gridding,
no interpolation -- answers a question #89 could not. #89 got slopes of 0.45 and
0.30 from two DEM rasters and left three explanations standing, one of them
"DEMs too smooth to resolve this bench". A defect present in the returns
themselves cannot have been caused by gridding.

INPUT. This probe needs a CSV of the point cloud around Cabrillo, which is not
in this repo and should not be -- it comes from 974 MB of LAZ. Produce it with:

    pdal pipeline --stream <pipeline.json>

where the pipeline is readers.las -> filters.crop to the survey extent ->
writers.text with order X,Y,Z. Pass the result with --cloud. Without it the
probe reports what it needs and exits nonzero rather than inventing anything.

NOTHING HERE SETS OR PROMOTES A FLOOR. It reports an offset and a slope.

Standard library only, including the UTM forward projection, so this directory
stays dependency-free.
"""
import argparse
import csv
import json
import math
import os
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SURVEY = os.path.join(ROOT, "findings", "cabrillo-surveyed-elevations.json")

IN_TO_M = 0.0254
NAVD88_TO_MLLW_M = 0.068        # VDatum 4.8 at Cabrillo, uncertainty 0.093 m
NGVD29_TO_MLLW_M = 0.87         # approximate; VDatum rejects NGVD29 as a west
                                # coast source frame (errorCode 412), so this is
                                # NOT measured. It is used only to state how far
                                # away the rejected candidate sits.
DATUM_ZERO_BAND = (-0.3, 0.2)   # survey heights that bracket MLLW zero
RADII_M = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0]

# UTM 11N forward on GRS80. The survey publishes NAD83 lat/lon and the LAS
# GeoKey declares EPSG 26911 = NAD83 / UTM 11N, so the two share a datum and NO
# horizontal shift applies. Using a WGS84 pipeline here would inject a ~1 m
# offset between two datasets that are already on the same frame.
_A = 6378137.0
_F = 1 / 298.257222101
_K0 = 0.9996
_LON0 = math.radians(-117.0)
_E2 = 2 * _F - _F * _F
_EP2 = _E2 / (1 - _E2)


def utm11n(lon, lat):
    p, l = math.radians(lat), math.radians(lon)
    n = _A / math.sqrt(1 - _E2 * math.sin(p) ** 2)
    t = math.tan(p) ** 2
    c = _EP2 * math.cos(p) ** 2
    a = (l - _LON0) * math.cos(p)
    m = _A * ((1 - _E2 / 4 - 3 * _E2 ** 2 / 64 - 5 * _E2 ** 3 / 256) * p
              - (3 * _E2 / 8 + 3 * _E2 ** 2 / 32 + 45 * _E2 ** 3 / 1024) * math.sin(2 * p)
              + (15 * _E2 ** 2 / 256 + 45 * _E2 ** 3 / 1024) * math.sin(4 * p)
              - (35 * _E2 ** 3 / 3072) * math.sin(6 * p))
    x = _K0 * n * (a + (1 - t + c) * a ** 3 / 6
                   + (5 - 18 * t + t * t + 72 * c - 58 * _EP2) * a ** 5 / 120) + 500000.0
    y = _K0 * (m + n * math.tan(p) * (a * a / 2
               + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24
               + (61 - 58 * t + t * t + 600 * c - 330 * _EP2) * a ** 6 / 720))
    return x, y


def ols(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((v - mx) ** 2 for v in xs)
    sxy = sum((v - mx) * (w - my) for v, w in zip(xs, ys))
    slope = sxy / sxx
    intercept = my - slope * mx
    resid = [w - (slope * v + intercept) for v, w in zip(xs, ys)]
    sse = sum(e * e for e in resid)
    sst = sum((w - my) ** 2 for w in ys)
    se_b = math.sqrt(sse / (n - 2) * (1 / n + mx * mx / sxx)) if n > 2 else float("nan")
    return {"n": n, "slope": slope, "intercept": intercept,
            "se_intercept": se_b, "r_squared": (1 - sse / sst) if sst else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cloud", required=True,
                    help="CSV with X,Y,Z columns in EPSG:26911, cropped to the "
                         "Cabrillo survey extent. See the module docstring.")
    args = ap.parse_args()

    if not os.path.exists(args.cloud):
        sys.exit("cloud CSV not found: %s\nSee the module docstring for how to "
                 "produce it. Nothing is inferred without it." % args.cloud)

    with open(SURVEY, encoding="utf-8") as f:
        survey = json.load(f)
    pts = [p for p in survey["points"]
           if p.get("height_in_above_mllw") is not None
           and p.get("latitude_deg") and p.get("longitude_deg")]
    for p in pts:
        p["_x"], p["_y"] = utm11n(p["longitude_deg"], p["latitude_deg"])
        p["_mllw"] = p["height_in_above_mllw"] * IN_TO_M
    print("%d surveyed points with a height and coordinates (of %d published)"
          % (len(pts), len(survey["points"])))

    cloud = []
    with open(args.cloud, newline="") as f:
        for row in csv.DictReader(f):
            try:
                cloud.append((float(row["X"]), float(row["Y"]), float(row["Z"])))
            except (ValueError, KeyError):
                continue
    if not cloud:
        sys.exit("no usable rows in %s (need X,Y,Z columns)" % args.cloud)
    cx = [c[0] for c in cloud]
    cy = [c[1] for c in cloud]
    area = (max(cx) - min(cx)) * (max(cy) - min(cy))
    distinct_xy = len({(c[0], c[1]) for c in cloud})
    print("%d lidar points, %d distinct XY, %.2f distinct XY per m2 of bbox\n"
          % (len(cloud), distinct_xy, distinct_xy / area))

    # ---- the test that needs no regression ---------------------------------
    band = {}
    for R in (2.0, 5.0):
        zs, hs = [], []
        for p in pts:
            if not DATUM_ZERO_BAND[0] <= p["_mllw"] < DATUM_ZERO_BAND[1]:
                continue
            near = [c[2] for c in cloud
                    if (c[0] - p["_x"]) ** 2 + (c[1] - p["_y"]) ** 2 <= R * R]
            if len(near) >= 3:
                zs.append(statistics.median(near))
                hs.append(p["_mllw"])
        if len(zs) < 3:
            continue
        mean_z = sum(zs) / len(zs)
        se = statistics.pstdev(zs) / math.sqrt(len(zs))
        band["%.1f" % R] = {
            "plots": len(zs), "mean_survey_m_mllw": sum(hs) / len(hs),
            "mean_lidar_z_m": mean_z, "sd": statistics.pstdev(zs), "se": se,
            "navd88_residual_m": mean_z + NAVD88_TO_MLLW_M,
            "navd88_residual_se": abs(mean_z + NAVD88_TO_MLLW_M) / se if se else None,
            "ngvd29_residual_m": mean_z + NGVD29_TO_MLLW_M,
            "ngvd29_residual_se": abs(mean_z + NGVD29_TO_MLLW_M) / se if se else None,
        }
        b = band["%.1f" % R]
        print("R=%.1f m | %d plots on the MLLW datum zero" % (R, b["plots"]))
        print("   mean surveyed height : %+.3f m MLLW" % b["mean_survey_m_mllw"])
        print("   mean lidar Z         : %+.3f m   sd %.3f   se %.3f"
              % (b["mean_lidar_z_m"], b["sd"], b["se"]))
        print("   vs NAVD88 (-0.068)   : %.3f m = %.1f se"
              % (abs(b["navd88_residual_m"]), b["navd88_residual_se"]))
        print("   vs NGVD29 (-0.870)   : %.3f m = %.1f se\n"
              % (abs(b["ngvd29_residual_m"]), b["ngvd29_residual_se"]))

    # ---- regression, and the residual-by-height that exposes the artifact ---
    regs = {}
    for R in RADII_M:
        xs, ys = [], []
        for p in pts:
            near = [c[2] for c in cloud
                    if (c[0] - p["_x"]) ** 2 + (c[1] - p["_y"]) ** 2 <= R * R]
            if len(near) >= 3:
                xs.append(p["_mllw"])
                ys.append(statistics.median(near))
        if len(xs) >= 5:
            regs["%.1f" % R] = ols(xs, ys)

    print("%6s %5s %7s %10s %8s %7s" % ("R (m)", "n", "slope", "intercept",
                                        "se(b)", "R2"))
    for k, v in regs.items():
        print("%6s %5d %7.3f %+10.3f %8.3f %7.3f"
              % (k, v["n"], v["slope"], v["intercept"], v["se_intercept"],
                 v["r_squared"]))

    bands = []
    for lo, hi in ((-0.3, 0.2), (0.2, 0.6), (0.6, 1.0), (1.0, 1.4),
                   (1.4, 1.8), (1.8, 2.4)):
        zs, hs = [], []
        for p in pts:
            if not lo <= p["_mllw"] < hi:
                continue
            near = [c[2] for c in cloud
                    if (c[0] - p["_x"]) ** 2 + (c[1] - p["_y"]) ** 2 <= 4.0]
            if len(near) >= 3:
                zs.append(statistics.median(near))
                hs.append(p["_mllw"])
        if len(zs) >= 3:
            bands.append({"band_m_mllw": [lo, hi], "plots": len(zs),
                          "mean_survey": sum(hs) / len(hs),
                          "mean_lidar_z": sum(zs) / len(zs),
                          "survey_minus_lidar": sum(hs) / len(hs) - sum(zs) / len(zs)})

    print("\nresidual by height band, R = 2 m. A DATUM error is constant down")
    print("this column; a SLOPE deficiency grows. It grows.\n")
    print("%16s %6s %11s %13s %10s" % ("band", "plots", "mean survey",
                                       "mean lidar Z", "difference"))
    for b in bands:
        print("%7.1f..%-7.1f %6d %+11.3f %+13.3f %+10.3f"
              % (b["band_m_mllw"][0], b["band_m_mllw"][1], b["plots"],
                 b["mean_survey"], b["mean_lidar_z"], b["survey_minus_lidar"]))

    out = {
        "probe": os.path.basename(__file__),
        "product": "USGS LPC CA_SCRIPPS_APR_2005 (legacy)",
        "ground_truth": "findings/cabrillo-surveyed-elevations.json (#83)",
        "surveyed_points_used": len(pts),
        "cloud_points": len(cloud),
        "distinct_xy": distinct_xy,
        "distinct_xy_per_m2_of_bbox": distinct_xy / area,
        "navd88_to_mllw_m": NAVD88_TO_MLLW_M,
        "navd88_to_mllw_provenance": ("VDatum 4.8 at Cabrillo, uncertainty "
                                      "0.093 m; corroborated at swamis 0.054 m "
                                      "and by CO-OPS station datums at 9410230, "
                                      "0.058 m"),
        "ngvd29_to_mllw_m_APPROXIMATE": NGVD29_TO_MLLW_M,
        "ngvd29_note": ("NOT measured. VDatum rejects NGVD29 as a west coast "
                        "source frame with errorCode 412. Used only to state "
                        "how far the rejected candidate sits."),
        "datum_zero_band": band,
        "regressions_by_radius": regs,
        "residual_by_height_band": bands,
        "not_claimed": [
            "No floor is set, promoted or moved. No floor_evidence entry "
            "follows from this probe.",
            "The datum is established at Cabrillo, the only spot in the "
            "corridor with surveyed ground truth. GeoKeys are identical across "
            "all tiles, which is suggestive and is not the same as measured.",
            "The cloud does not reproduce bench relief at any radius, so it is "
            "not usable for hypsometry regardless of its datum.",
        ],
    }
    dst = os.path.join(ROOT, "findings", "scripps2005-cabrillo-tie.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print("\nwrote %s" % dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
