"""Are the shipped rate curves centred on the bench, or on the pin?

#80 section 1 flags this and says it has never been checked: `calibration/`
pulls a 0.5 km disc around each `spots.json` coordinate, and `lidar-recon`
section 7 measured those coordinates sitting 100-400 m inland of the bench. A
500 m radius is generous enough to still contain a bench 300 m away, but
"contains" and "is centred on" are different claims, and only the second one
licenses `RADIUS_KM = 0.5` as a corridor-wide constant.

Two measurements per spot, both from iNaturalist count queries -- no records are
pulled, so this costs nothing in payload and cannot leak a licence-restricted
observation:

1. **Radial profile.** Counts inside 0.1 ... 2.0 km of the pin. If the count is
   still climbing steeply at 0.5 km, the shipped disc is cutting through the
   distribution rather than containing it.
2. **Offset grid.** The count inside a 0.5 km disc centred on a 5x5 grid of
   offsets from the pin. The offset with the highest count is where the
   observations actually are. Its distance from the pin is the centring error,
   measured rather than assumed.

**What this is not.** It counts observations, not visits, and it does not apply
the pipeline's in-memory filters -- captive, geoprivacy, the taxon join, the
visit collapse. So a count here is not a denominator and no rate can be read off
it. It is a question about WHERE, and for that the unfiltered count is the right
instrument: filtering would remove records without moving the geography.

Obscured records are included and their coordinates are randomised within a
~0.2 degree cell, so they mostly land outside every disc here and add noise
rather than bias. `diagnostics.ts` already reports their share.

Standard library only.
"""
import json, math, os, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FINDINGS = os.path.join(os.path.dirname(HERE), "findings")

UA = {"User-Agent": "socal-coastal-data/0.1 "
                    "(+https://github.com/cweber12/socal-coastal-data) "
                    "lidar-recon centring audit"}

# v1 with per_page=0 returns total_results and no records. The calibration uses
# v2 because v1 serves ~75 kB per RECORD; that reasoning does not apply to a
# count query, and the two endpoints were checked to return the same
# total_results for the same query before this was written.
INAT = "https://api.inaturalist.org/v1/observations"
INTERVAL_S = 1.1                                    # config.ts REQUEST_INTERVAL_MS

RADII_KM = [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0]
SHIPPED_RADIUS_KM = 0.5                             # config.ts RADIUS_KM
OFFSETS_M = [-500, -250, 0, 250, 500]


def config():
    """Taxon ids and corpus start, read from the calibration's own config so
    this audit cannot drift from the pull it is auditing."""
    taxa = json.load(open(os.path.join(ROOT, "shared", "target_taxa.json")))
    ids = [t["taxon_id"] for t in taxa["targets"]] + \
          [t["taxon_id"] for t in taxa["denominator"]]
    src = open(os.path.join(ROOT, "tools", "calibration", "src", "config.ts")).read()
    i = src.index("export const CORPUS_START")
    year = int(src[i:i + 200].split("year:")[1].split(",")[0])
    month = int(src[i:i + 200].split("month:")[1].split(",")[0])
    day = int(src[i:i + 200].split("day:")[1].split("}")[0].strip(" ,"))
    return ids, f"{year:04d}-{month:02d}-{day:02d}", taxa["version"]


def spots():
    d = json.load(open(os.path.join(ROOT, "shared", "spots.json")))
    return [s for s in d["spots"] if s.get("tidepool_floor_ft") is not None]


def count(lat, lon, radius_km, ids, since):
    q = urllib.parse.urlencode({
        "lat": f"{lat:.6f}", "lng": f"{lon:.6f}", "radius": str(radius_km),
        "quality_grade": "research", "taxon_id": ",".join(map(str, ids)),
        "d1": since, "per_page": "0"})
    url = f"{INAT}?{q}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            d = json.load(urllib.request.urlopen(req, timeout=120))
            return d["total_results"], url
        except Exception:                            # noqa: BLE001 - retried
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def main():
    ids, since, taxa_version = config()
    out = {
        "read_date": "2026-07-29",
        "issue": 80,
        "question": "Is the shipped 0.5 km rate-curve disc centred on the "
                    "bench, or on a pin that section 7 measured 100-400 m "
                    "inland of it?",
        "query": f"{INAT}?lat&lng&radius&quality_grade=research"
                 f"&taxon_id=<13 ids>&d1={since}&per_page=0",
        "taxa_version": taxa_version, "taxon_ids": ids, "d1": since,
        "shipped_radius_km": SHIPPED_RADIUS_KM,
        "counts_are_not_rates": "Observations, unfiltered by the pipeline's "
                                "in-memory captive/geoprivacy/taxon-join/visit "
                                "steps. A question about where, not how many.",
        "spots": {},
    }
    for s in spots():
        slug, lat, lon = s["slug"], s["lat"], s["lon"]
        mx = 111320.0 * math.cos(math.radians(lat))
        my = 110540.0
        radial = {}
        for r in RADII_KM:
            n, url = count(lat, lon, r, ids, since)
            radial[str(r)] = n
            time.sleep(INTERVAL_S)
        grid = []
        for dn in OFFSETS_M:
            for de in OFFSETS_M:
                n, _ = count(lat + dn / my, lon + de / mx,
                             SHIPPED_RADIUS_KM, ids, since)
                grid.append({"de_m": de, "dn_m": dn, "count": n,
                             "offset_m": round(math.hypot(de, dn), 1)})
                time.sleep(INTERVAL_S)
        best = max(grid, key=lambda g: g["count"])
        pinned = next(g for g in grid if g["de_m"] == 0 and g["dn_m"] == 0)
        shipped = radial[str(SHIPPED_RADIUS_KM)]
        widest = radial[str(RADII_KM[-1])]
        out["spots"][slug] = {
            "lat": lat, "lon": lon,
            "radial_counts": radial,
            "shipped_disc_count": shipped,
            "frac_of_2km_inside_shipped": round(shipped / widest, 3) if widest else None,
            "frac_of_2km_inside_1km": (round(radial["1.0"] / widest, 3)
                                       if widest else None),
            "offset_grid": grid,
            "best_offset": best,
            "pin_centred_count": pinned["count"],
            "best_over_pin_ratio": (round(best["count"] / pinned["count"], 3)
                                    if pinned["count"] else None),
            "centring_error_m": best["offset_m"],
            "centring_error_bearing_deg": (
                round(math.degrees(math.atan2(best["de_m"], best["dn_m"])) % 360, 1)
                if best["offset_m"] else None),
        }
        r = out["spots"][slug]
        print(f"{slug:<20} n@0.5km={shipped:<6} n@2km={widest:<6} "
              f"inside0.5={r['frac_of_2km_inside_shipped']} "
              f"best offset {best['de_m']:+5},{best['dn_m']:+5} m "
              f"= {best['count']} ({r['best_over_pin_ratio']}x pin)", flush=True)

    dest = os.path.join(FINDINGS, "rate-curve-centring.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("wrote", dest)


if __name__ == "__main__":
    main()
