"""The slope gate #80 asks for: does a coarse polygon support a SLOPE claim
even though it cannot support an absolute floor?

#63 required that perturbing a polygon by its own positional uncertainty move
the derived floor by less than 0.1 ft. VDatum's NAVD88 -> MLLW uncertainty is
+/-0.305 ft at Cabrillo (PR #61), so that test fails before geometry
contributes anything. #80 asks the narrower question: the VDatum transform is a
pure additive offset, an additive offset cannot change dA/dz, so is curve SLOPE
robust to a wrong boundary even where the absolute level is not?

One spot, two products, one mapped polygon, three perturbation kinds at three
magnitudes.

- Polygon: OSM way 975130801, `natural=reef` + `reef=rock`, traced from Mapbox
  Satellite. Fetched and provenanced by `osm_reef.py` into
  `findings/osm-reef-locator.json`. **Not an MPA boundary** -- #80 puts those
  out of scope, and `natural=reef` is a mapper's physical trace.
- Products 2616 (Merge-with-voids, 1 m) and 6260 (El-Nino 2016, 0.5 m), per
  README section 8: both UTM, both declaring NAVD88 in-raster, both range-read
  with stdlib only.
- A(w) = exposed bench area at water level w, +2.0 -> -2.0 ft MLLW, 0.1 ft steps.

**Two extents, because the mapped reef is not the spot.** Way 975130801 runs
1.5 km alongshore -- the whole west shore of the monument, not the reach one pin
refers to. The gate runs on the full mapped reef AND on the +/-250 m alongshore
reach around the pin. If those disagree about slope, extent is load-bearing and
the gate has settled nothing.

**Mosaicking is not optional here.** The `cabrillo-tidepools` pin sits 28 m east
of its own tile's western edge in both products, so every pixel seaward of the
pin -- which is every pixel that matters -- lives in the neighbouring tile. The
+/-100 m windows in `findings/coverage-measured.json` were silently truncated at
that edge, and their Cabrillo coverage figures are over the truncated window.

Masks are kept as per-row column runs rather than pixel grids. A shore-parallel
strip is 1-3 runs per row, so erode/dilate by a circular element is a few
hundred thousand interval operations instead of a Euclidean distance transform
over five million pixels. Exact, not approximate: dilation by radius u is the
union over dy in [-u, u] of the row at j+dy widened by floor(sqrt(u^2 - dy^2)),
and erosion is that on the complement.

Standard library only. Reuses `probe_dem` for the GeoTIFF plumbing.
"""
import array, itertools, json, math, os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import probe_dem                                    # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FINDINGS = os.path.join(os.path.dirname(HERE), "findings")

USFT_PER_M = 3.280833                               # README section 4
CAB_OFFSET_USFT = 0.220                             # VDatum NAVD88 0 m -> MLLW
CAB_OFFSET_UNCERT_FT = 0.305

LEVELS = [round(2.0 - 0.1 * i, 1) for i in range(41)]       # +2.0 -> -2.0 ft

# floor-calibration.md section 2 defines the floor as "the level at which
# exposed area crosses a fixed minimum of walkable bench" and never fixes the
# minimum. Several are reported. The small ones are the ones section 2 means; at
# Cabrillo they turn out to saturate above +2.0 ft, which is a finding rather
# than a reason to move them.
AREA_THRESHOLDS_M2 = [500, 2000, 10000, 20000, 40000]
PRIMARY_THRESHOLD_M2 = 2000

# A second, scale-free level metric: the level holding a fraction of the area
# exposed at the bottom of the band. It separates "the polygon got smaller",
# which any erosion does by construction, from "the curve changed shape".
FRAC_THRESHOLDS = [0.25, 0.5, 0.75]
PRIMARY_FRAC = 0.5

PERTURB_M = [10.0, 25.0, 50.0]
STATED_UNCERT_M = 25.0
UNCERT_REASONING = (
    "Mapbox Satellite is a Maxar-derived mosaic and its own georeferencing is "
    "usually within ~10 m. That is not the dominant term. A rock reef's "
    "SEAWARD edge in imagery is a water-clarity and tide-state boundary rather "
    "than a sharp feature, so where a mapper puts it moves with the image "
    "epoch. 25 m is claimed for the polygon as a whole, and 10/25/50 m are all "
    "reported, because the claim is a judgement and the gate must not depend "
    "on it.")

ALONGSHORE_HALF_M = 250.0

# Histogram bins for the elevation distribution inside a mask: 0.1 ft from
# -10 to +30 ft MLLW, plus catch-alls. Wide enough that the bluff behind the
# bench lands in a bin rather than in the overflow.
HIST_LO, HIST_HI, HIST_STEP = -10.0, 30.0, 0.1
NBINS = int(round((HIST_HI - HIST_LO) / HIST_STEP))

# The 2x2 tile block each product needs, resolved by reading tie points rather
# than by trusting the names. Both grids are 1500 m tiles on the same origins --
# 2616 names a tile (easting/100 - 4000) + (northing/100 - 36000) of its SW
# corner, 6260 names it (easting/100) + floor(northing/1000), which look alike
# and step differently. `mosaic` asserts every tile onto the first one's grid.
PRODUCTS = {
    "2616": {
        "name": "2009-2011 Merged TopoBathy DEM (with voids)",
        "pixel_m": 1.0,
        "base": "https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/"
                "California_Topobathy_DEM_2011_2616/ca_topo_bathy/block_1a/"
                "SMOOTHED_VOIDS/",
        "tiles": ["11SMS770135", "11SMS755135", "11SMS770150", "11SMS755150"],
    },
    "6260": {
        "name": "2016 USGS West Coast El-Nino DEM",
        "pixel_m": 0.5,
        "base": "https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/"
                "West_Coast_El_Nino_DEM_2016_6260/UTM11/",
        "tiles": ["11SMS47703613", "11SMS47553613", "11SMS47703615",
                  "11SMS47553615"],
    },
}


# --------------------------------------------------------------------------
# GeoTIFF: header, and a rectangular block of pixels
# --------------------------------------------------------------------------

_RASTERS = {}
_CHECKED_PREDICTOR = [False]


def open_raster(url):
    if url in _RASTERS:
        return _RASTERS[url]
    en, big, tags = probe_dem.tiff_tags(url)
    G = lambda k, first=None: (probe_dem.tval(url, en, *tags[k], first=first)
                               if k in tags else None)
    nd = G(42113)
    scale, tie = G(33550), G(33922)
    r = {
        "url": url, "en": en, "tags": tags,
        "W": G(256)[0], "H": G(257)[0],
        "bps": G(258)[0] // 8, "comp": G(259)[0], "pred": (G(317) or [1])[0],
        "sx": scale[0], "sy": scale[1], "ox": tie[3], "oy": tie[4],
        "nodata": float(nd) if nd else None,
        "tw": G(322)[0] if 322 in tags else None,
        "th": G(323)[0] if 323 in tags else None,
    }
    assert r["comp"] in (8, 32946) and r["tw"], (
        f"{url}: only tiled DEFLATE is decoded here (comp={r['comp']}, "
        f"tiled={r['tw'] is not None}). CoNED's single-row strips cost one "
        f"range request per raster row, impractical at this window size.")
    assert r["bps"] == 4, f"{url}: {r['bps'] * 8}-bit samples, expected 32"
    assert r["en"] == "<", f"{url}: big-endian, unpredict assumes little"
    _RASTERS[url] = r
    return r


def unpredict_row(buf, off, rowbytes, bps=4):
    """TIFF predictor 3 (floating-point) for one tile row.

    Equivalent to `probe_dem.unpredict_row`, which is asserted against on the
    first row decoded. This form does the byte-plane de-interleave with strided
    slice assignment rather than a Python loop per byte, which is the difference
    between seconds and minutes over the ~23,000 tile rows this window needs.
    """
    b = bytes(itertools.accumulate(buf[off:off + rowbytes],
                                   lambda a, x: (a + x) & 0xFF))
    wc = rowbytes // bps
    out = bytearray(rowbytes)
    for k in range(bps):
        out[k::bps] = b[(bps - k - 1) * wc:(bps - k) * wc]
    return struct.unpack(f"<{wc}f", bytes(out))


def read_block(r, x0, x1, y0, y1):
    """Rows of floats for the inclusive pixel box, nodata left as the raw
    sentinel. Each intersecting tile is decompressed once."""
    url, en, tags = r["url"], r["en"], r["tags"]
    tw, th, bps, pred = r["tw"], r["th"], r["bps"], r["pred"]
    across = (r["W"] + tw - 1) // tw
    toff, tcnt = tags[324], tags[325]
    w = x1 - x0 + 1
    rows = [array.array("f", bytes(4 * w)) for _ in range(y1 - y0 + 1)]
    for ty in range(y0 // th, y1 // th + 1):
        for tx in range(x0 // tw, x1 // tw + 1):
            ti = ty * across + tx
            o = probe_dem.arr_at(url, en, toff[0], toff[2], toff[3], ti)
            c = probe_dem.arr_at(url, en, tcnt[0], tcnt[2], tcnt[3], ti)
            if c == 0:
                continue
            raw = probe_dem.zlib.decompress(probe_dem.rng(url, o, o + c - 1))
            rowbytes = tw * bps
            for y in range(max(y0, ty * th), min(y1, ty * th + th - 1) + 1):
                ry = y - ty * th
                if pred == 3:
                    src = unpredict_row(raw, ry * rowbytes, rowbytes, bps)
                    if not _CHECKED_PREDICTOR[0]:
                        ref = probe_dem.unpredict_row(raw, ry * rowbytes,
                                                      rowbytes, bps)
                        assert src == ref, "fast unpredict disagrees with probe_dem"
                        _CHECKED_PREDICTOR[0] = True
                else:
                    src = struct.unpack(f"{en}{tw}f",
                                        raw[ry * rowbytes:(ry + 1) * rowbytes])
                lo, hi = max(x0, tx * tw), min(x1, tx * tw + tw - 1)
                rows[y - y0][lo - x0:hi - x0 + 1] = array.array(
                    "f", src[lo - tx * tw:hi - tx * tw + 1])
    return rows


def mosaic(pid, e0, e1, n0, n1):
    """Elevations on the product's own grid over a UTM box, from whichever tiles
    cover it. No resampling: the mosaic grid IS the first tile's grid and every
    other tile is asserted onto it."""
    spec = PRODUCTS[pid]
    rs = [open_raster(spec["base"] + t + ".tif") for t in spec["tiles"]]
    ref = rs[0]
    sx, sy = ref["sx"], ref["sy"]
    assert abs(sx - spec["pixel_m"]) < 1e-9 and abs(sy - spec["pixel_m"]) < 1e-9, \
        f"{pid}: pixel scale {sx}x{sy} contradicts the declared {spec['pixel_m']} m"
    for r in rs[1:]:
        assert abs(r["sx"] - sx) < 1e-9 and abs(r["sy"] - sy) < 1e-9, "scale mismatch"
        assert r["nodata"] == ref["nodata"], "nodata sentinel differs across tiles"
        dx, dy = (r["ox"] - ref["ox"]) / sx, (r["oy"] - ref["oy"]) / sy
        assert abs(dx - round(dx)) < 1e-6 and abs(dy - round(dy)) < 1e-6, \
            f"{r['url']} is off {ref['url']}'s grid by ({dx}, {dy}) px"

    gx0 = int(math.floor((e0 - ref["ox"]) / sx))
    gx1 = int(math.ceil((e1 - ref["ox"]) / sx)) - 1
    gy0 = int(math.floor((ref["oy"] - n1) / sy))
    gy1 = int(math.ceil((ref["oy"] - n0) / sy)) - 1
    MW, MH = gx1 - gx0 + 1, gy1 - gy0 + 1
    NAN = float("nan")
    grid = array.array("f", [NAN]) * (MW * MH)
    used = []
    for r in rs:
        offx = int(round((r["ox"] - ref["ox"]) / sx))
        offy = -int(round((r["oy"] - ref["oy"]) / sy))
        tx0, tx1 = max(0, gx0 - offx), min(r["W"] - 1, gx1 - offx)
        ty0, ty1 = max(0, gy0 - offy), min(r["H"] - 1, gy1 - offy)
        if tx0 > tx1 or ty0 > ty1:
            used.append({"tile": r["url"].rsplit("/", 1)[-1],
                         "used": False, "why": "no overlap with the window"})
            continue
        rows = read_block(r, tx0, tx1, ty0, ty1)
        for j, row in enumerate(rows):
            base = (ty0 + j + offy - gy0) * MW + (tx0 + offx - gx0)
            grid[base:base + len(row)] = row
        used.append({"tile": r["url"].rsplit("/", 1)[-1], "used": True,
                     "src_px_box": [tx0, tx1, ty0, ty1]})
        print(f"      {used[-1]['tile']}: {tx1 - tx0 + 1}x{ty1 - ty0 + 1} px",
              flush=True)
    return {"grid": grid, "MW": MW, "MH": MH, "px_m": sx,
            "nodata": ref["nodata"], "ox": ref["ox"] + gx0 * sx,
            "oy": ref["oy"] - gy0 * sy, "tiles": used}


# --------------------------------------------------------------------------
# Masks as per-row column runs
# --------------------------------------------------------------------------

def merge(iv):
    if not iv:
        return iv
    iv.sort()
    out = [list(iv[0])]
    for a, b in iv[1:]:
        if a <= out[-1][1] + 1:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def rasterise(ring, m):
    """Even-odd scanline fill at pixel centres -> runs per mosaic row."""
    MW, MH, px, ox, oy = m["MW"], m["MH"], m["px_m"], m["ox"], m["oy"]
    n = len(ring)
    runs = []
    for j in range(MH):
        yc = oy - (j + 0.5) * px
        xs = []
        for i in range(n):
            ax, ay = ring[i]
            bx, by = ring[(i + 1) % n]
            if (ay > yc) != (by > yc):
                xs.append(ax + (yc - ay) * (bx - ax) / (by - ay))
        row = []
        if xs:
            xs.sort()
            for k in range(0, len(xs) - 1, 2):
                a = max(0, int(math.ceil((xs[k] - ox) / px - 0.5)))
                b = min(MW - 1, int(math.floor((xs[k + 1] - ox) / px - 0.5)))
                if a <= b:
                    row.append((a, b))
        runs.append(merge(row))
    return runs


def complement(runs, MW):
    out = []
    for row in runs:
        cur, res = 0, []
        for a, b in row:
            if a > cur:
                res.append((cur, a - 1))
            cur = b + 1
        if cur <= MW - 1:
            res.append((cur, MW - 1))
        out.append(res)
    return out


def dilate(runs, u_px, MW, MH):
    """Union over dy of the row at j+dy widened by floor(sqrt(u^2 - dy^2))."""
    u = int(math.floor(u_px))
    widths = [(dy, int(math.floor(math.sqrt(max(0.0, u_px * u_px - dy * dy)))))
              for dy in range(-u, u + 1)]
    acc = [[] for _ in range(MH)]
    for j, row in enumerate(runs):
        if not row:
            continue
        for dy, w in widths:
            t = j + dy
            if 0 <= t < MH:
                acc[t].extend((max(0, a - w), min(MW - 1, b + w)) for a, b in row)
    return [merge(r) for r in acc]


def erode(runs, u_px, MW, MH):
    return complement(dilate(complement(runs, MW), u_px, MW, MH), MW)


def intersect(a, b):
    out = []
    for ra, rb in zip(a, b):
        row, i, j = [], 0, 0
        while i < len(ra) and j < len(rb):
            lo, hi = max(ra[i][0], rb[j][0]), min(ra[i][1], rb[j][1])
            if lo <= hi:
                row.append((lo, hi))
            if ra[i][1] < rb[j][1]:
                i += 1
            else:
                j += 1
        out.append(row)
    return out


def touches_edge(runs, MW, MH):
    if any(runs[0]) or any(runs[MH - 1]):
        return True
    return any(r and (r[0][0] == 0 or r[-1][1] == MW - 1) for r in runs)


def band_runs(m, axis, centre_s, half_m):
    """The +/-half_m alongshore band around centre_s, as runs."""
    MW, MH, px, ox, oy = m["MW"], m["MH"], m["px_m"], m["ox"], m["oy"]
    ax, ay = axis
    out = []
    for j in range(MH):
        yc = oy - (j + 0.5) * px
        if abs(ax) < 1e-9:                           # band is a row strip
            s = yc * ay
            out.append([(0, MW - 1)] if abs(s - centre_s) <= half_m else [])
            continue
        lo = (centre_s - half_m - yc * ay) / ax
        hi = (centre_s + half_m - yc * ay) / ax
        if lo > hi:
            lo, hi = hi, lo
        a = max(0, int(math.ceil((lo - ox) / px - 0.5)))
        b = min(MW - 1, int(math.floor((hi - ox) / px - 0.5)))
        out.append([(a, b)] if a <= b else [])
    return out


# --------------------------------------------------------------------------
# The curve
# --------------------------------------------------------------------------

def curve(m, runs):
    grid, MW, nodata = m["grid"], m["MW"], m["nodata"]
    cell = m["px_m"] ** 2
    hist = [0] * (NBINS + 2)                         # [0] below, [-1] above
    inside = nod = 0
    lo_ft, hi_ft = float("inf"), float("-inf")
    for j, row in enumerate(runs):
        base = j * MW
        for a, b in row:
            inside += b - a + 1
            for idx in range(base + a, base + b + 1):
                v = grid[idx]
                if v != v or v < -1e30 or (nodata is not None and v == nodata):
                    nod += 1
                    continue
                ft = v * USFT_PER_M + CAB_OFFSET_USFT
                if ft < lo_ft:
                    lo_ft = ft
                if ft > hi_ft:
                    hi_ft = ft
                k = int((ft - HIST_LO) / HIST_STEP) + 1
                hist[0 if k < 1 else (NBINS + 1 if k > NBINS else k)] += 1
    n = inside - nod
    # A(w) = area of valid pixels at or above w.
    A, ge = [], hist[NBINS + 1]
    k = NBINS
    for w in LEVELS:
        edge = int(round((w - HIST_LO) / HIST_STEP)) + 1
        while k >= edge:
            ge += hist[k]
            k -= 1
        A.append(round(ge * cell, 1))
    med = None
    if n:
        half, run = n / 2.0, 0
        for i, c in enumerate(hist):
            run += c
            if run >= half:
                med = (None if i in (0, NBINS + 1)
                       else round(HIST_LO + (i - 1) * HIST_STEP, 2))
                break
    below0 = sum(hist[:int(round((0.0 - HIST_LO) / HIST_STEP)) + 1])
    return {
        "mask_px": inside, "nodata_px": nod, "valid_px": n,
        "coverage_pct": round(100.0 * n / inside, 2) if inside else None,
        "mask_area_m2": round(inside * cell, 1),
        "valid_area_m2": round(n * cell, 1),
        "min_ft_mllw": round(lo_ft, 3) if n else None,
        "max_ft_mllw": round(hi_ft, 3) if n else None,
        "median_ft_mllw": med,
        "frac_below_0ft": round(below0 / n, 4) if n else None,
        "A_m2": A,
    }


def derive(c):
    """Floor level, slope at the floor, and the knee.

    Slope is reported twice: absolute m^2/ft, and normalised by the polygon's
    own valid area. The normalised one is what the flood-trim question needs --
    `FLOOD_SIDE_TRIM` is a dimensionless fraction of the flood span, so its
    per-spot replacement is a SHAPE, and an absolute m^2/ft necessarily shrinks
    when a polygon is eroded whether or not the shape moved at all.
    """
    A = c["A_m2"]
    tot = c["valid_area_m2"] or 1.0

    def slope(i):                                    # m^2 gained per ft of drop
        if i == 0:
            return (A[1] - A[0]) / 0.1
        if i == len(A) - 1:
            return (A[i] - A[i - 1]) / 0.1
        return (A[i + 1] - A[i - 1]) / 0.2

    def at(i, extra=None):
        s = slope(i)
        return {"floor_ft": LEVELS[i], "area_at_floor_m2": A[i],
                "slope_m2_per_ft": round(s, 1),
                "slope_norm_per_ft": round(s / tot, 5), **(extra or {})}

    out = {"floors_abs": {}, "floors_frac": {}}
    for T in AREA_THRESHOLDS_M2:
        i = next((i for i, a in enumerate(A) if a >= T), None)
        out["floors_abs"][str(T)] = at(i) if i is not None else {
            "floor_ft": None,
            "why": f"A(w) never reaches {T} m2 between +2.0 and -2.0 ft"}
        if i == 0:
            out["floors_abs"][str(T)]["saturated"] = (
                f"A(+2.0) is already >= {T} m2, so the crossing is above the "
                f"top of the band and +2.0 is a band edge, not a floor")
    for f in FRAC_THRESHOLDS:
        T = f * A[-1]                                # A at the bottom of the band
        i = next((i for i, a in enumerate(A) if a >= T), None)
        out["floors_frac"][str(f)] = (
            at(i, {"threshold_m2": round(T, 1)}) if i is not None
            else {"floor_ft": None, "threshold_m2": round(T, 1)})
    ks = [slope(i) for i in range(len(A))]
    kmax = max(range(len(A)), key=lambda i: ks[i])
    out["knee"] = {"prime_ft": LEVELS[kmax],
                   "slope_m2_per_ft": round(ks[kmax], 1),
                   "slope_norm_per_ft": round(ks[kmax] / tot, 5)}
    out["slope_m2_per_ft"] = [round(s, 1) for s in ks]
    out["slope_norm_per_ft"] = [round(s / tot, 5) for s in ks]
    return out


def gate(variants, u):
    """How far LEVEL and SLOPE move under u m of perturbation, reported
    separately. That separation is the whole question in #80.

    Three level metrics and three slope metrics, because both words are
    ambiguous and the answer differs by which one is meant:

      level  floor_abs   the section 2 definition, a fixed area threshold
             floor_frac  the same crossing at a fraction of the band's area
             prime       where slope peaks -- threshold-free
      slope  abs         m2/ft at the frac floor
             norm        the same divided by the variant's own area
             norm@knee   normalised slope at the peak
    """
    tag = f"{u:g}m"
    names = [n for n in variants if n != "baseline" and n.endswith(tag)]
    base = variants["baseline"]
    ba = base["floors_abs"][str(PRIMARY_THRESHOLD_M2)]
    bf = base["floors_frac"][str(PRIMARY_FRAC)]
    bk = base["knee"]

    def delta(x, b):
        return None if (x is None or b is None) else round(x - b, 1)

    def pct(x, b):
        return None if (x is None or not b) else round(100.0 * (x / b - 1), 1)

    def shape_dev(v):
        """Largest gap between the two variants' normalised curves, over the 41
        levels. One number for "did the curve change shape", independent of any
        threshold and of the polygon's size."""
        a, b = v["A_m2"], base["A_m2"]
        if not a[-1] or not b[-1]:
            return None
        return round(max(abs(a[i] / a[-1] - b[i] / b[-1])
                         for i in range(len(a))), 4)

    rows = {}
    for kind in ("erode", "dilate", "along", "cross"):
        sel = [n for n in names if n.startswith(kind)]
        cols = {k: [] for k in ("d_floor_abs_ft", "d_floor_frac_ft", "d_prime_ft",
                                "d_slope_abs_pct", "d_slope_norm_pct",
                                "d_slope_norm_at_knee_pct", "d_area_pct",
                                "shape_dev")}
        for n in sel:
            v = variants[n]
            a = v["floors_abs"][str(PRIMARY_THRESHOLD_M2)]
            f = v["floors_frac"][str(PRIMARY_FRAC)]
            cols["d_floor_abs_ft"].append(delta(a["floor_ft"], ba["floor_ft"]))
            cols["d_floor_frac_ft"].append(delta(f["floor_ft"], bf["floor_ft"]))
            cols["d_prime_ft"].append(delta(v["knee"]["prime_ft"], bk["prime_ft"]))
            cols["d_slope_abs_pct"].append(
                pct(f.get("slope_m2_per_ft"), bf.get("slope_m2_per_ft")))
            cols["d_slope_norm_pct"].append(
                pct(f.get("slope_norm_per_ft"), bf.get("slope_norm_per_ft")))
            cols["d_slope_norm_at_knee_pct"].append(
                pct(v["knee"]["slope_norm_per_ft"], bk["slope_norm_per_ft"]))
            cols["d_area_pct"].append(
                pct(v["valid_area_m2"], base["valid_area_m2"]))
            cols["shape_dev"].append(shape_dev(v))
        row = {"variants": sel, **cols}
        for k, vs in cols.items():
            row[k + "_max_abs"] = max((abs(x) for x in vs if x is not None),
                                      default=None)
        rows[kind] = row
    return rows


def main():
    loc = json.load(open(os.path.join(FINDINGS, "osm-reef-locator.json")))
    bench = loc["cabrillo_bench"]
    ring_ll = bench["ring"][:-1] if bench["closed"] else bench["ring"]
    ring_utm = [probe_dem.ll2utm(la, lo) for la, lo in ring_ll]
    cab = loc["spots"]["cabrillo-tidepools"]
    pin = probe_dem.ll2utm(cab["lat"], cab["lon"])

    # Alongshore direction = the outline's major axis. A 1.5 km shore-parallel
    # strip has an unambiguous one; asserted rather than assumed.
    cx = sum(p[0] for p in ring_utm) / len(ring_utm)
    cy = sum(p[1] for p in ring_utm) / len(ring_utm)
    sxx = syy = sxy = 0.0
    for x, y in ring_utm:
        dx, dy = x - cx, y - cy
        sxx += dx * dx
        syy += dy * dy
        sxy += dx * dy
    th = 0.5 * math.atan2(2 * sxy, sxx - syy)
    axis = (math.cos(th), math.sin(th))
    lam = [0.5 * (sxx + syy) + s * 0.5 * math.hypot(sxx - syy, 2 * sxy)
           for s in (1, -1)]
    assert lam[0] > 4 * lam[1], f"outline has no clear major axis: {lam}"
    pin_s = pin[0] * axis[0] + pin[1] * axis[1]

    margin = max(PERTURB_M) + 5.0
    e0 = min(p[0] for p in ring_utm) - margin
    e1 = max(p[0] for p in ring_utm) + margin
    n0 = min(p[1] for p in ring_utm) - margin
    n1 = max(p[1] for p in ring_utm) + margin

    variants = [("baseline", 0.0, (0.0, 0.0))]
    for u in PERTURB_M:
        variants += [
            (f"erode_{u:g}m", -u, (0.0, 0.0)),
            (f"dilate_{u:g}m", +u, (0.0, 0.0)),
            (f"along_+{u:g}m", 0.0, (axis[0] * u, axis[1] * u)),
            (f"along_-{u:g}m", 0.0, (-axis[0] * u, -axis[1] * u)),
            # Not in #80's list. It is the discriminating case: #63 conflated
            # edge imprecision with gross mislocation, and cross-shore is the
            # direction that mislocates a shore-parallel strip.
            (f"cross_+{u:g}m", 0.0, (-axis[1] * u, axis[0] * u)),
            (f"cross_-{u:g}m", 0.0, (axis[1] * u, -axis[0] * u)),
        ]

    out = {
        "read_date": "2026-07-29",
        "issue": 80,
        "question": ("Does perturbing a coarse bench polygon by its own stated "
                     "positional uncertainty move curve SLOPE as much as it "
                     "moves the derived floor LEVEL?"),
        "polygon": {
            "source": "OpenStreetMap way 975130801 (ODbL)",
            "version": bench["version"], "timestamp": bench["timestamp"],
            "changeset": bench["changeset"],
            "imagery_used": bench["changeset_detail"]["tags"].get("imagery_used"),
            "changeset_comment": bench["changeset_detail"]["tags"].get("comment"),
            "tags": bench["tags"], "nodes": len(ring_ll),
            "stated_uncertainty_m": STATED_UNCERT_M,
            "uncertainty_reasoning": UNCERT_REASONING,
            "alongshore_axis_utm11": [round(axis[0], 6), round(axis[1], 6)],
            "not_an_mpa": "natural=reef is a mapper's physical trace. #80 puts "
                          "MPA boundaries out of scope and none was read.",
        },
        "datum": {
            "transform": "NAVD88(geoid18) m -> MLLW us_ft; VDatum 4.8; "
                         "region=westcoast; t_h_frame=IGS14",
            "formula": f"MLLW_usft = NAVD88_m * {USFT_PER_M} + {CAB_OFFSET_USFT}",
            "uncertainty_ft": CAB_OFFSET_UNCERT_FT,
            "why_it_does_not_enter_slope": "An additive offset slides A(w) along "
                                           "w; it cannot change dA/dw.",
        },
        "method": {
            "levels_ft_mllw": LEVELS,
            "A_definition": "A(w) = area of valid pixels whose elevation is at "
                            "or above water level w, i.e. exposed bench.",
            "slope_definition": "central difference of A over 0.2 ft, m2 gained "
                                "per ft of tide drop; slope_norm divides by the "
                                "variant's own valid area.",
            "floor_definition": f"floors_abs: highest w with A(w) >= a fixed "
                                f"area, which is section 2's definition; "
                                f"primary {PRIMARY_THRESHOLD_M2} m2. "
                                f"floors_frac: highest w with A(w) >= a "
                                f"fraction of A(-2.0 ft), primary "
                                f"{PRIMARY_FRAC}, which is scale-free and so "
                                f"separates a smaller polygon from a different "
                                f"curve shape.",
            "nodata": "excluded from A and reported as coverage. Voids in 2616 "
                      "sit on wet reef (README section 7), so a void biases A "
                      "downward at the levels that matter most.",
            "extents": {
                "full_mapped_reef": "OSM way 975130801 as mapped, ~1.5 km alongshore",
                "pin_reach": f"the same polygon clipped to +/-{ALONGSHORE_HALF_M:g} m "
                             f"alongshore of the spots.json pin",
            },
        },
        "results": {},
    }

    for pid in PRODUCTS:
        print(f"  {pid} {PRODUCTS[pid]['name']}", flush=True)
        m = mosaic(pid, e0, e1, n0, n1)
        MW, MH = m["MW"], m["MH"]
        print(f"      mosaic {MW}x{MH} px @ {m['px_m']} m", flush=True)
        band = band_runs(m, axis, pin_s, ALONGSHORE_HALF_M)
        res = {"name": PRODUCTS[pid]["name"],
               "mosaic": {"px": [MW, MH], "pixel_m": m["px_m"],
                          "cell_area_m2": m["px_m"] ** 2,
                          "nodata_value": m["nodata"], "tiles": m["tiles"]},
               "full_mapped_reef": {}, "pin_reach": {}}
        for name, dil, shift in variants:
            ring = [(x + shift[0], y + shift[1]) for x, y in ring_utm]
            runs = rasterise(ring, m)
            assert not touches_edge(runs, MW, MH), \
                f"{pid} {name}: mask reaches the window edge, morphology unsound"
            if dil:
                u_px = abs(dil) / m["px_m"]
                runs = (dilate(runs, u_px, MW, MH) if dil > 0
                        else erode(runs, u_px, MW, MH))
            for ext, sel in (("full_mapped_reef", runs),
                             ("pin_reach", intersect(runs, band))):
                c = curve(m, sel)
                c.update(derive(c))
                res[ext][name] = c
            p = res["pin_reach"][name]
            a = p["floors_abs"][str(PRIMARY_THRESHOLD_M2)]
            f = p["floors_frac"][str(PRIMARY_FRAC)]
            print(f"      {name:<14} A={p['valid_area_m2']:>8.0f} m2 "
                  f"cov={p['coverage_pct']}% med={p['median_ft_mllw']} "
                  f"abs={a['floor_ft']} frac={f['floor_ft']} "
                  f"prime={p['knee']['prime_ft']} "
                  f"slope={f.get('slope_m2_per_ft')} "
                  f"norm={f.get('slope_norm_per_ft')}", flush=True)
        for ext in ("full_mapped_reef", "pin_reach"):
            res[ext]["_gate"] = {f"{u:g}m": gate(res[ext], u) for u in PERTURB_M}
        out["results"][pid] = res

    # A perturbation figure means nothing without a reference for how much else
    # moves. Same polygon, same datum offset, different DEM.
    out["between_products"] = {}
    for ext in ("full_mapped_reef", "pin_reach"):
        a = out["results"]["2616"][ext]["baseline"]
        b = out["results"]["6260"][ext]["baseline"]
        ca, cb = a["A_m2"], b["A_m2"]
        out["between_products"][ext] = {
            "prime_ft": {"2616": a["knee"]["prime_ft"], "6260": b["knee"]["prime_ft"],
                         "d_ft": round(b["knee"]["prime_ft"] -
                                       a["knee"]["prime_ft"], 1)},
            "floor_frac_ft": {
                "2616": a["floors_frac"][str(PRIMARY_FRAC)]["floor_ft"],
                "6260": b["floors_frac"][str(PRIMARY_FRAC)]["floor_ft"]},
            "coverage_pct": {"2616": a["coverage_pct"], "6260": b["coverage_pct"]},
            "median_ft_mllw": {"2616": a["median_ft_mllw"],
                               "6260": b["median_ft_mllw"]},
            "valid_area_m2": {"2616": a["valid_area_m2"], "6260": b["valid_area_m2"]},
            "shape_dev": (round(max(abs(ca[i] / ca[-1] - cb[i] / cb[-1])
                                    for i in range(len(ca))), 4)
                          if ca[-1] and cb[-1] else None),
            "d_slope_norm_at_knee_pct": (
                round(100.0 * (b["knee"]["slope_norm_per_ft"] /
                               a["knee"]["slope_norm_per_ft"] - 1), 1)
                if a["knee"]["slope_norm_per_ft"] else None),
        }

    dest = os.path.join(FINDINGS, "cabrillo-slope-gate.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("wrote", dest)


if __name__ == "__main__":
    main()
