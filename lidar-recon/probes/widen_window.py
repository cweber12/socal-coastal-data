"""How far the published coordinate has to widen before it reaches intertidal
ground. Standard library only.

`probe_dem.py` answers "is there data on the reef" in the +/-100 m disc that
spots.json's coordinate error bar admits. This answers the follow-on question
that disc raised: when the disc holds no sub-zero ground at all, how far out is
the bench? The answer is the distance the clip geometry would have to reach, and
it is the evidence for floor-calibration.md section 2's "inland by roughly
100-400 m".

Product 2616 only -- the 2009-2011 Merged TopoBathy DEM, with voids. It is tiled
DEFLATE, so a window costs a few tile reads. CoNED (8658) is uncompressed
single-row strips, one range read per raster row, which is fine at 100 m and
impractical at 500 m: a 1001x1001 window is ~1000 sequential range requests per
spot per width. 2616 also declares NAVD88 in-raster rather than in a sidecar,
per README section 2.

Five spots: the four whose +/-100 m disc holds no pixel below 0 m NAVD88, plus
cabrillo-tidepools, which fails the opposite way -- its median RISES going
inland because the disc fills with bluff while the bench is a narrow
shore-parallel strip.

Not an implementation. See README in this directory.
"""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import probe_dem

HERE = os.path.dirname(os.path.abspath(__file__))
FINDINGS = os.path.join(os.path.dirname(HERE), "findings")

SPOTS = ["windansea", "sunset-cliffs", "torrey-pines-beach", "la-jolla-shores",
         "cabrillo-tidepools"]
PID = "2616"
HALFS = [200, 300, 500]
KEEP = ("coverage_pct", "min_m", "median_m", "frac_below_0m", "pixels")


def main():
    cov = json.load(open(os.path.join(FINDINGS, "coverage-measured.json")))["measured"]
    vd = json.load(open(os.path.join(FINDINGS, "vdatum-transforms.json")))["transforms"]

    out = {
        "read_date": "2026-07-29",
        "product": PID,
        "product_name": "2009-2011 Merged TopoBathy DEM (with voids)",
        "why_this_product": (
            "Tiled DEFLATE, so a 500 m window is a few tile reads rather than "
            "~1000 sequential range requests. Declares NAVD88 in-raster "
            "(GeoKey VerticalCSType=5703) rather than in a sidecar."),
        "method": (
            "probe_dem.probe() unchanged, at half-widths 200/300/500 m. The 100 m "
            "row is carried verbatim from coverage-measured.json for continuity, "
            "not re-measured. Values are metres in the tile's own NAVD88, NOT "
            "MLLW feet -- convert with vdatum-transforms.json as "
            "min_m * 3.280833 + offset."),
        "reading_it": (
            "first_negative_half_m is the smallest tested half-width whose window "
            "contains any pixel below 0 m NAVD88. It is a lower bound on how far "
            "the bench is from the published coordinate, resolved only to the "
            "tested widths, and it says nothing about direction."),
        "spots": {},
    }

    for slug in SPOTS:
        t = vd[slug]
        href = cov[slug][PID]["href"]
        rows = {"100": {k: cov[slug][PID]["w100"].get(k) for k in KEEP}}
        rows["100"]["carried_from"] = "coverage-measured.json"
        for h in HALFS:
            r = probe_dem.probe(href, t["lat"], t["lon"], half_m=float(h))
            if "error" in r:
                rows[str(h)] = {"error": r["error"]}
            else:
                rows[str(h)] = {k: r.get(k) for k in KEEP}
            print(slug, h, json.dumps(rows[str(h)]), flush=True)

        neg = [int(h) for h in sorted(rows, key=int)
               if rows[h].get("frac_below_0m")]
        out["spots"][slug] = {
            "lat": t["lat"], "lon": t["lon"],
            "tile": cov[slug][PID]["tile"], "href": href,
            "first_negative_half_m": neg[0] if neg else None,
            "by_half_m": rows,
        }

    dest = os.path.join(FINDINGS, "coordinate-offset-widening.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("wrote", dest)


if __name__ == "__main__":
    main()
