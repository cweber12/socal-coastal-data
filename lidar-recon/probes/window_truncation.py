"""Which committed windows were clipped at a tile edge, and what the numbers are
without the clip.

`probe_dem.probe()` clamps its sample window to the tile it was handed:

    x0,y0=max(0,x0),max(0,y0); x1,y1=min(W-1,x1),min(H-1,y1)

That is correct as code and silent as measurement. A spot near a tile boundary
gets a window cut off on one side, and every statistic -- coverage, minimum,
median -- is then over the surviving part, reported as though it were the whole
window. Nothing in `findings/coverage-measured.json` records that it happened.

Two jobs:

1. **Audit.** Re-read every `px_window` in `coverage-measured.json` and flag the
   ones touching a raster edge.
2. **Re-measure.** `cabrillo-tidepools` sits 28 m east of its own tile's western
   edge in both 2616 and 6260 -- so the clipped side is the SEAWARD side, the
   side the reef is on. Re-measured on a 2x2 tile mosaic at the same widths.

This matters beyond bookkeeping. `README.md` section 7 and
`calibration/floor-calibration.md` section 2 both carry "Cabrillo's median
climbs 14.7 -> 19.3 -> 24.8 -> 32.6 m across +/-100/200/300/500 m", read as the
disc filling with bluff while the bench stays a narrow shore-parallel strip.
Those windows were clipped on the west at every width, so they widened INLAND
ONLY. A widening that can only go one way will show a rising median whether or
not the terrain does.

Standard library only. Uses `hypsometry.mosaic` for the stitched read.
"""
import json, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hypsometry as HY                             # noqa: E402
import probe_dem                                    # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FINDINGS = os.path.join(os.path.dirname(HERE), "findings")

HALFS = [25, 100, 200, 300, 500]
SLUG = "cabrillo-tidepools"


def audit(cov):
    """Windows in coverage-measured.json whose px_window touches a raster edge."""
    rows = []
    for slug, prods in cov.items():
        for pid, v in prods.items():
            for key in ("w100", "w25"):
                r = v.get(key) or {}
                if "px_window" not in r:
                    continue
                x0, x1, y0, y1 = r["px_window"]
                W, H = r["W"], r["H"]
                sides = [s for s, hit in (("west", x0 == 0), ("east", x1 == W - 1),
                                          ("north", y0 == 0), ("south", y1 == H - 1))
                         if hit]
                if not sides:
                    continue
                rows.append({
                    "spot": slug, "product": pid, "window": key,
                    "px_window": [x0, x1, y0, y1], "raster_px": [W, H],
                    "actual_px": [x1 - x0 + 1, y1 - y0 + 1],
                    "edges_touched": sides,
                    "reported_coverage_pct": r.get("coverage_pct"),
                    "reported_min_m": r.get("min_m"),
                    "reported_median_m": r.get("median_m"),
                })
    return rows


def audit_widening(widen):
    """The same defect in coordinate-offset-widening.json, which keeps no
    px_window. Its `pixels` is the count INSIDE the clamped window, so a
    shortfall against the window the half-width asks for is the truncation.

    Both products there are 1 m, so a half-width h asks for (2h+2)^2 pixels --
    the +2 is probe_dem's floor/ceil on each side."""
    rows = []
    for slug, s in widen["spots"].items():
        for h, r in s.get("by_half_m", {}).items():
            n = r.get("pixels")
            if not n:
                continue
            want = (2 * int(h) + 2) ** 2
            if n >= want:
                continue
            rows.append({
                "spot": slug, "product": widen["product"], "half_m": int(h),
                "pixels_reported": n, "pixels_window_asks_for": want,
                "fraction_of_window": round(n / want, 3),
                "carried_from": r.get("carried_from"),
                "reported_coverage_pct": r.get("coverage_pct"),
                "reported_min_m": r.get("min_m"),
                "reported_median_m": r.get("median_m"),
                "reported_frac_below_0m": r.get("frac_below_0m"),
            })
    rows.sort(key=lambda r: (r["spot"], r["half_m"]))
    return rows


def stats(m, half_m, pin):
    """probe_dem.probe()'s statistics over a square window on the mosaic."""
    MW, MH, px, ox, oy = m["MW"], m["MH"], m["px_m"], m["ox"], m["oy"]
    grid, nodata = m["grid"], m["nodata"]
    i0 = max(0, int(math.floor((pin[0] - half_m - ox) / px)))
    i1 = min(MW - 1, int(math.ceil((pin[0] + half_m - ox) / px)))
    j0 = max(0, int(math.floor((oy - (pin[1] + half_m)) / px)))
    j1 = min(MH - 1, int(math.ceil((oy - (pin[1] - half_m)) / px)))
    vals, nod = [], 0
    unfilled = 0
    for j in range(j0, j1 + 1):
        base = j * MW
        for i in range(i0, i1 + 1):
            v = grid[base + i]
            if v != v:
                # NaN here is a mosaic hole (no tile covered it), which is a
                # different thing from a nodata pixel and must not be counted
                # as one.
                unfilled += 1
            elif v < -1e30 or (nodata is not None and v == nodata):
                nod += 1
            else:
                vals.append(v)
    tot = len(vals) + nod
    vs = sorted(vals)
    out = {"px_window": [i0, i1, j0, j1],
           "actual_px": [i1 - i0 + 1, j1 - j0 + 1],
           "pixels": tot, "nodata": nod, "outside_mosaic": unfilled,
           "coverage_pct": round(100.0 * len(vs) / tot, 2) if tot else None}
    if vs:
        out.update({"min_m": round(vs[0], 3), "max_m": round(vs[-1], 3),
                    "median_m": round(statistics.median(vs), 3),
                    "p05_m": round(vs[int(.05 * len(vs))], 3),
                    "p95_m": round(vs[int(.95 * len(vs))], 3),
                    "frac_below_0m": round(sum(1 for v in vs if v < 0) / len(vs), 3)})
    return out


def main():
    cov = json.load(open(os.path.join(FINDINGS, "coverage-measured.json")))["measured"]
    vd = json.load(open(os.path.join(FINDINGS, "vdatum-transforms.json")))["transforms"]
    widen = json.load(open(os.path.join(FINDINGS,
                                        "coordinate-offset-widening.json")))

    out = {
        "read_date": "2026-07-29",
        "issue": 80,
        "defect": "probe_dem.probe() clamps its window to the tile it is given "
                  "and reports the statistics of the surviving part with no "
                  "record that anything was cut.",
        "truncated_windows": audit(cov),
        "truncated_widening_windows": audit_widening(widen),
        "what_still_stands": (
            "The three 'first reaches any sub-zero pixel at +/-200 m' results "
            "-- windansea, sunset-cliffs, la-jolla-shores -- are on FULL "
            "windows and are unaffected. So is torrey-pines-beach's 'still "
            "entirely above 0 m at +/-300 m'. Its +/-500 m row is truncated, so "
            "the direction of that finding stands and the '1.2% of the disc' "
            "figure does not."),
        "re_measured": {},
        "not_re_measured": [],
    }

    t = vd[SLUG]
    pin = probe_dem.ll2utm(t["lat"], t["lon"])
    offset = t["navd88_geoid18_to_mllw_usft"]["response"]["t_z"]
    for pid in ("2616", "6260"):
        e = 520.0 + 5.0
        m = HY.mosaic(pid, pin[0] - e, pin[0] + e, pin[1] - e, pin[1] + e)
        print(f"  {pid} mosaic {m['MW']}x{m['MH']} @ {m['px_m']} m", flush=True)
        rows = {}
        for h in HALFS:
            s = stats(m, float(h), pin)
            key = "w100" if h == 100 else ("w25" if h == 25 else None)
            was = (cov[SLUG][pid].get(key) if key else
                   (widen["spots"].get(SLUG, {}).get("by_half_m", {}).get(str(h))
                    if pid == "2616" else None))
            s["previously_reported"] = ({k: was.get(k) for k in
                                         ("coverage_pct", "min_m", "median_m",
                                          "frac_below_0m", "pixels")}
                                        if was else None)
            s["min_ft_mllw"] = (round(s["min_m"] * HY.USFT_PER_M + float(offset), 3)
                                if "min_m" in s else None)
            s["median_ft_mllw"] = (round(s["median_m"] * HY.USFT_PER_M +
                                         float(offset), 3)
                                   if "median_m" in s else None)
            rows[str(h)] = s
            print(f"    +/-{h:>3} m  {s['actual_px'][0]}x{s['actual_px'][1]} px  "
                  f"cov={s['coverage_pct']}%  min={s.get('min_m')}  "
                  f"median={s.get('median_m')}  "
                  f"frac<0={s.get('frac_below_0m')}  "
                  f"(was {s['previously_reported']})", flush=True)
        out["re_measured"][pid] = {
            "spot": SLUG, "lat": t["lat"], "lon": t["lon"],
            "tiles": m["tiles"], "pixel_m": m["px_m"],
            "vdatum_offset_usft": float(offset),
            "by_half_m": rows,
        }

    out["not_re_measured"].append({
        "spot": "la-jolla-cove", "product": "8658",
        "window": "w100",
        "why": "CoNED is uncompressed with RowsPerStrip=1, one range request "
               "per raster row, and the mosaic reader here decodes tiled "
               "DEFLATE only. The truncation is on the EAST -- landward at a "
               "west-facing cove -- so it clips the bluff rather than the reef, "
               "and README section 8 recommends dropping CoNED anyway. "
               "Recorded rather than worked around.",
    })

    dest = os.path.join(FINDINGS, "window-truncation.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("wrote", dest)


if __name__ == "__main__":
    main()
