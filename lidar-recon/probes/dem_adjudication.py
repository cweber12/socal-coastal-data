"""The pre-registered DEM adjudication #89 asks for: do the surveyed Cabrillo
elevations select 2616 or 6260, or neither?

`../README.md` section 10 left hypsometry blocked on a disagreement it could not
settle. The two products section 8 recommended put the knee 0.4 ft apart on the
same polygon with the same datum offset, their normalised peak slopes differ by
91%, and 6260 cannot reach the bottom of the analysis band inside the mapped
bench at all. Nothing in the repo could say which is right.

`findings/cabrillo-surveyed-elevations.json` holds 137 NPS-surveyed monitoring
points, 126 with a published substrate height in inches above MLLW at published
coordinates. That is the only surveyed ground truth in this corridor and it is
the arbiter.

**Every parameter of the comparison was frozen before it ran**, in
`calibration/floor-calibration.md` section 6, subsection "Pre-registration:
which DEM the surveyed elevations select, written before it runs", committed in
PR #88 before any DEM was sampled at a surveyed point. This module implements
that subsection and does not revise it. In particular:

- three metrics -- RMSE, MAE, median absolute error -- all three reported, and a
  product is selected only if all three choose the same one. A split selects
  nothing and is itself the finding.
- exclusions are the report's own two and no others.
- a 95% bootstrap CI over points on the paired per-point difference in absolute
  residual. **If it spans zero the result is indeterminate and no product is
  selected.**
- the residual is regressed on plot elevation and on plot type (the sand
  confound), and residual magnitude is tested against local DEM roughness.
- **the roughness-restricted comparison is diagnostic only and can never
  override the primary.** If the two disagree the result is indeterminate.

Four mechanical choices the pre-registration does not fix are listed in
`IMPLEMENTATION_CHOICES` below and echoed into the output, because a parameter
this module chose is not a parameter that was pre-registered and the difference
has to survive into the finding.

**One post-hoc diagnostic was added after the comparison had run**, in
`post_hoc_restricted_slope`. It regresses elevation inside the
roughness-restricted set, which the run scored but never regressed. It is
labelled post-hoc everywhere it appears, the verdict block reads nothing from
it, and it cannot select a product. **It rules out less than first recorded:**
roughness is derived from the DEM, so restricting on it selects on a quantity
correlated with the elevation being tested, and
`selection_effect_on_this_diagnostic` measures how much of the steepening that
accounts for. The claim rests on the unselected `all_points` fit instead.

**The vintage gap is measured, not corrected.** The survey is February-March
2004; 2616's source lidar is a nominal 2009-2011 and 6260's is April-May 2016.
No sand offset, no epoch adjustment, and nothing that would make the two agree
better is applied anywhere in this file.

**The NPS check section 6 reserves is not spent here, its figure is not read,
and nps.gov is not fetched.** That section's conditional governs what a later
comparison is worth; it is not this module's business, and the number is
deliberately absent from this file so that nothing in it can be read as a
comparison against it.

Standard library only. Reuses `probe_dem` for the GeoTIFF plumbing and
`hypsometry` for the mosaic, the product definitions and the datum constants,
so this cannot drift from the run it adjudicates.
"""
import json, math, os, random, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hypsometry                                    # noqa: E402
import probe_dem                                     # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FINDINGS = os.path.join(os.path.dirname(HERE), "findings")
SURVEY = os.path.join(FINDINGS, "cabrillo-surveyed-elevations.json")
DEST = os.path.join(FINDINGS, "cabrillo-dem-adjudication.json")

# Read from hypsometry rather than restated, so the adjudication converts
# elevations exactly as the slope gate it is adjudicating did.
USFT_PER_M = hypsometry.USFT_PER_M                   # 3.280833
CAB_OFFSET_USFT = hypsometry.CAB_OFFSET_USFT         # NAVD88 0 m -> ft MLLW
CAB_OFFSET_UNCERT_FT = hypsometry.CAB_OFFSET_UNCERT_FT
PRODUCTS = ["2616", "6260"]

# --------------------------------------------------------------------------
# Parameters. The pre-registered ones first, and they are not tunable here.
# --------------------------------------------------------------------------

BOOTSTRAP_CONF = 0.95                                # pre-registered
BOOTSTRAP_RESAMPLES = 10000
BOOTSTRAP_SEED = 89
# A percentile bootstrap has a seed, and a seed is a number this module chose.
# The interval is re-run at five of them and all five are reported, so "spans
# zero" cannot be an artefact of the one that was picked.
SEED_STABILITY_CHECK = [89, 8901, 8902, 8903, 8904]

# The four things the pre-registration does not fix. Each is resolved toward the
# choice with no free number in it, and each is written into the finding.
IMPLEMENTATION_CHOICES = {
    "dem_sampling_rule": {
        "choice": "the single DEM cell whose footprint contains the surveyed "
                  "coordinate; no search, no interpolation, no neighbourhood.",
        "why": "It is the only sampling rule with no free parameter. Any "
               "radius would be a number chosen by this module rather than by "
               "the pre-registration, and 'widen until the answer changes' is "
               "the failure section 6 rule 2 exists to prevent.",
        "horizontal_tolerance_implied": "half a cell diagonal -- 0.71 m for "
                                        "2616 at 1 m, 0.35 m for 6260 at 0.5 m",
    },
    "horizontal_tolerance": {
        "choice": "none applied beyond the containing cell.",
        "why": "The comparison does not need one: a point is either inside a "
               "cell or inside its neighbour, and both are sampled the same "
               "way for both products. This is stated independently of the "
               "report's 'Std. Dev.' column, whose unit is UNRESOLVED "
               "(findings/cabrillo-surveyed-elevations.json, "
               "gps_std_dev_unresolved) and is neither read nor assumed to be "
               "metres anywhere in this module.",
        "sensitivity_reported": "a 3 m radius MEAN of valid cells is reported "
                                "as a diagnostic that cannot select. 3 m is "
                                "the order of a monitoring plot, not a number "
                                "derived from the unresolved GPS column, and "
                                "it is a neutral smoothing rather than a "
                                "best-match search.",
    },
    "roughness_definition": {
        "choice": "population standard deviation, in feet, of the valid DEM "
                  "cells whose centres lie within 5.0 m of the surveyed "
                  "coordinate.",
        "why": "A fixed ground radius rather than a fixed cell count, because "
               "a 3x3 window means 3 m on 2616 and 1.5 m on 6260 and the two "
               "roughnesses would then not be the same measurement. 5 m is the "
               "scale of the boulder-and-cliff-face relief confound 2 names.",
    },
    "roughness_restriction_split": {
        "choice": "the low half by the median of the two products' mean "
                  "roughness at each point.",
        "why": "A median split has no threshold to choose. Both products are "
               "then restricted to the SAME point set, so the restriction "
               "cannot favour either. Diagnostic only, per the "
               "pre-registration -- it can force indeterminate and can never "
               "select.",
    },
}

ROUGHNESS_RADIUS_M = 5.0
SENSITIVITY_RADIUS_M = 3.0

WINDOW_MARGIN_M = 20.0                               # > both sample radii


# --------------------------------------------------------------------------
# The analysis set
# --------------------------------------------------------------------------

def load_points(survey):
    """The 126 points carrying a published height, with the accounting.

    The pre-registration fixes the exclusions as "the report's own and no
    others: Zone II M2 and the 8 February 16:20 reading". Both are already
    applied in the source finding and neither removes a point from the 126:

    - Zone II M2's height is published as 'ND' because the report withdrew it,
      so it is one of the 11 points with no published height and is already
      outside the 126.
    - the 16:20 reading is a READING-level exclusion the report made when it
      computed its own averages. The 35 affected points keep their published
      averages, which already exclude it.

    Two of the 126 -- Zone 2 L7 and Zone 2 L8 -- publish a height but no
    coordinates. They are DROPPED rather than excluded: with no coordinate
    there is no DEM cell to sample, which is an impossibility rather than an
    analytical choice. Counted and named in the output either way.
    """
    pts = survey["points"]
    with_height = [p for p in pts if p.get("height_in_above_mllw") is not None]
    usable = [p for p in with_height if p.get("latitude_deg") is not None]
    no_coords = [p["point_label"] for p in with_height
                 if p.get("latitude_deg") is None]
    m2 = [p["point_label"] for p in pts
          if "zone_ii_m2_height_omitted_by_report" in (p.get("flags") or [])]
    feb = [p["point_label"] for p in pts
           if "feb_8_1620_second_reading_excluded" in (p.get("flags") or [])]
    return usable, {
        "surveyed_points_total": len(pts),
        "points_with_published_height": len(with_height),
        "analysis_candidates": len(usable),
        "report_exclusion_1_zone_ii_m2": {
            "points": m2,
            "effect_on_the_126": "none -- its height is published as ND, so it "
                                 "is already outside the 126.",
        },
        "report_exclusion_2_feb_8_1620_reading": {
            "n_points_affected": len(feb),
            "effect_on_the_126": "none -- this is a reading-level exclusion the "
                                 "report already applied to its own published "
                                 "averages. All 35 points are retained.",
        },
        "dropped_no_published_coordinates": {
            "points": no_coords,
            "n": len(no_coords),
            "why": "a height with no coordinate cannot be sampled against a "
                   "DEM. This is an impossibility, not a further exclusion; "
                   "the pre-registration admits no further exclusions and "
                   "none is made.",
        },
        "further_exclusions_applied": 0,
    }


# --------------------------------------------------------------------------
# Sampling
# --------------------------------------------------------------------------

def valid(v, nodata):
    return not (v != v or v < -1e30 or (nodata is not None and v == nodata))


def sample_product(pid, pts):
    """Containing-cell elevation, local roughness and the 3 m mean, per point.

    One mosaic covering every surveyed point is read once and every point is
    sampled out of it, so the two products see exactly the same geometry.
    """
    es, ns = [], []
    for p in pts:
        e, n = probe_dem.ll2utm(p["latitude_deg"], p["longitude_deg"])
        es.append(e)
        ns.append(n)
    m = WINDOW_MARGIN_M
    print(f"  {pid}: mosaic over "
          f"E {min(es) - m:.0f}..{max(es) + m:.0f}  "
          f"N {min(ns) - m:.0f}..{max(ns) + m:.0f}", flush=True)
    mos = hypsometry.mosaic(pid, min(es) - m, max(es) + m,
                            min(ns) - m, max(ns) + m)
    grid, MW, MH, px = mos["grid"], mos["MW"], mos["MH"], mos["px_m"]
    ox, oy, nodata = mos["ox"], mos["oy"], mos["nodata"]

    rr = int(math.ceil(ROUGHNESS_RADIUS_M / px))
    sr = int(math.ceil(SENSITIVITY_RADIUS_M / px))
    out = []
    for e, n in zip(es, ns):
        col = int(math.floor((e - ox) / px))
        row = int(math.floor((oy - n) / px))
        rec = {"utm_e": round(e, 2), "utm_n": round(n, 2),
               "col": col, "row": row}
        if not (0 <= col < MW and 0 <= row < MH):
            rec["off_mosaic"] = True
            out.append(rec)
            continue
        v = grid[row * MW + col]
        rec["z_navd88_m"] = round(v, 4) if valid(v, nodata) else None
        rec["ft_mllw"] = (round(v * USFT_PER_M + CAB_OFFSET_USFT, 4)
                          if valid(v, nodata) else None)

        # Neighbourhood passes: roughness at 5 m, the 3 m sensitivity mean.
        for radius, npx, key in ((ROUGHNESS_RADIUS_M, rr, "rough"),
                                 (SENSITIVITY_RADIUS_M, sr, "sens")):
            vals = []
            for dj in range(-npx, npx + 1):
                j = row + dj
                if not 0 <= j < MH:
                    continue
                cy = oy - (j + 0.5) * px
                for di in range(-npx, npx + 1):
                    i = col + di
                    if not 0 <= i < MW:
                        continue
                    cx = ox + (i + 0.5) * px
                    if (cx - e) ** 2 + (cy - n) ** 2 > radius ** 2:
                        continue
                    w = grid[j * MW + i]
                    if valid(w, nodata):
                        vals.append(w * USFT_PER_M + CAB_OFFSET_USFT)
            if key == "rough":
                rec["roughness_ft"] = (round(statistics.pstdev(vals), 4)
                                       if len(vals) >= 2 else None)
                rec["roughness_n_cells"] = len(vals)
            else:
                rec["mean_3m_ft_mllw"] = (round(statistics.fmean(vals), 4)
                                          if vals else None)
                rec["mean_3m_n_cells"] = len(vals)
        out.append(rec)
    cov = sum(1 for r in out if r.get("ft_mllw") is not None)
    print(f"  {pid}: {cov}/{len(out)} points on a valid cell", flush=True)
    return out, {"grid_px": [MW, MH], "px_m": px, "nodata_value": nodata,
                 "tiles": mos["tiles"],
                 "points_on_a_valid_cell": cov}


# --------------------------------------------------------------------------
# Metrics, bootstrap, regression -- all plain arithmetic
# --------------------------------------------------------------------------

def metrics(res):
    """The three the pre-registration fixes, and nothing else."""
    if not res:
        return None
    a = [abs(r) for r in res]
    return {
        "n": len(res),
        "rmse_ft": round(math.sqrt(sum(r * r for r in res) / len(res)), 4),
        "mae_ft": round(sum(a) / len(a), 4),
        "median_abs_err_ft": round(statistics.median(a), 4),
        "mean_signed_bias_ft": round(sum(res) / len(res), 4),
        "median_signed_bias_ft": round(statistics.median(res), 4),
    }


METRIC_KEYS = ["rmse_ft", "mae_ft", "median_abs_err_ft"]


def winner(ma, mb, a="2616", b="6260"):
    """Which product each of the three metrics chooses, and whether they agree.

    Lower is better on all three. A split names no product and is the finding.
    """
    per = {}
    for k in METRIC_KEYS:
        if ma[k] == mb[k]:
            per[k] = None
        else:
            per[k] = a if ma[k] < mb[k] else b
    picks = set(per.values())
    agree = len(picks) == 1 and None not in picks
    return {"per_metric": per, "agreement": agree,
            "selected": per[METRIC_KEYS[0]] if agree else None}


def percentile_ci(vals, conf):
    v = sorted(vals)
    lo = v[int(math.floor((1 - conf) / 2 * len(v)))]
    hi = v[min(len(v) - 1, int(math.ceil((1 - (1 - conf) / 2) * len(v))) - 1)]
    return lo, hi


def bootstrap_paired(d, seed, B=BOOTSTRAP_RESAMPLES, conf=BOOTSTRAP_CONF):
    """95% percentile bootstrap over POINTS on the paired per-point difference
    in absolute residual. Spanning zero is the pre-registered indeterminacy
    condition and is computed, not judged."""
    rnd = random.Random(seed)
    n = len(d)
    means = []
    for _ in range(B):
        s = 0.0
        for _ in range(n):
            s += d[rnd.randrange(n)]
        means.append(s / n)
    lo, hi = percentile_ci(means, conf)
    return {
        "statistic": "mean of the paired per-point difference in absolute "
                     "residual, |resid 2616| - |resid 6260|. Negative means "
                     "2616 is closer to the surveyed heights.",
        "n_points": n,
        "point_estimate_ft": round(sum(d) / n, 4),
        "ci_lo_ft": round(lo, 4), "ci_hi_ft": round(hi, 4),
        "conf": conf, "resamples": B, "seed": seed,
        "spans_zero": lo <= 0.0 <= hi,
    }


def bootstrap_stat(vals, fn, seed, B=2000, conf=BOOTSTRAP_CONF):
    """Percentile bootstrap of an arbitrary statistic over rows of `vals`."""
    rnd = random.Random(seed)
    n = len(vals)
    out = []
    for _ in range(B):
        s = fn([vals[rnd.randrange(n)] for _ in range(n)])
        if s is not None:
            out.append(s)
    if len(out) < B // 2:
        return None
    lo, hi = percentile_ci(out, conf)
    return {"ci_lo": round(lo, 5), "ci_hi": round(hi, 5),
            "conf": conf, "resamples": B, "seed": seed,
            "spans_zero": lo <= 0.0 <= hi}


def ols(rows, ncoef):
    """Least squares by normal equations with Gaussian elimination.

    `rows` is [(design vector, y), ...]. Returns coefficients and r-squared, or
    None if the design is singular -- a dummy level absent from a bootstrap
    resample is normal and is dropped rather than fudged.
    """
    A = [[0.0] * (ncoef + 1) for _ in range(ncoef)]
    for x, y in rows:
        for i in range(ncoef):
            for j in range(ncoef):
                A[i][j] += x[i] * x[j]
            A[i][ncoef] += x[i] * y
    for c in range(ncoef):
        p = max(range(c, ncoef), key=lambda r: abs(A[r][c]))
        if abs(A[p][c]) < 1e-12:
            return None
        A[c], A[p] = A[p], A[c]
        for r in range(ncoef):
            if r == c:
                continue
            f = A[r][c] / A[c][c]
            for k in range(c, ncoef + 1):
                A[r][k] -= f * A[c][k]
    b = [A[i][ncoef] / A[i][i] for i in range(ncoef)]
    ys = [y for _, y in rows]
    ybar = sum(ys) / len(ys)
    sst = sum((y - ybar) ** 2 for y in ys)
    sse = sum((y - sum(bi * xi for bi, xi in zip(b, x))) ** 2 for x, y in rows)
    return {"coef": [round(v, 5) for v in b],
            "r2": round(1 - sse / sst, 4) if sst else None,
            "_raw": b}


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return None
    return sxy / math.sqrt(sxx * syy)


# --------------------------------------------------------------------------

def confound_sand(rows, types, seed):
    """Confound 1: the residual regressed on plot elevation and on plot type.

    "Sand buries low, flat, sand-adjacent bench and does not move cliff faces
    or boulder tops, so the residual is regressed on plot elevation and on plot
    type. Residuals concentrated low and flat indicate sand; residuals uniform
    across elevation and type indicate the DEM."

    Circular Plot is the reference level -- it is the type the report places
    "three on cliff faces and three on boulders", so a dummy coefficient reads
    as "this type against the rock-mounted one".
    """
    base = "Circular Plot"
    levels = [t for t in types if t != base]

    def design(row):
        elev, resid, typ = row
        return [1.0, elev] + [1.0 if typ == L else 0.0 for L in levels], resid

    elev_rows = [([1.0, r[0]], r[1]) for r in rows]
    type_rows = [([1.0] + [1.0 if r[2] == L else 0.0 for L in levels], r[1])
                 for r in rows]
    joint_rows = [design(r) for r in rows]

    def slope_of(sub):
        m = ols([([1.0, r[0]], r[1]) for r in sub], 2)
        return m["_raw"][1] if m else None

    by_type = {}
    for t in types:
        v = [r[1] for r in rows if r[2] == t]
        if v:
            by_type[t] = {
                "n": len(v),
                "mean_residual_ft": round(sum(v) / len(v), 4),
                "median_residual_ft": round(statistics.median(v), 4),
                "mean_abs_residual_ft": round(sum(abs(x) for x in v) / len(v), 4),
            }

    e_only = ols(elev_rows, 2)
    t_only = ols(type_rows, 1 + len(levels))
    joint = ols(joint_rows, 2 + len(levels))
    return {
        "model": "signed residual (DEM ft MLLW - surveyed ft MLLW) on plot "
                 "elevation (surveyed ft MLLW) and plot type. OLS. Reference "
                 "level for the type dummies is 'Circular Plot'.",
        "on_elevation_alone": {
            "intercept_ft": e_only["coef"][0],
            "slope_ft_per_ft": e_only["coef"][1],
            "r2": e_only["r2"],
            "slope_ci95": bootstrap_stat(rows, slope_of, seed),
        },
        "on_plot_type_alone": {
            "levels_in_order": [base] + levels,
            "coef": t_only["coef"], "r2": t_only["r2"],
            "group_summary": by_type,
        },
        "joint": {
            "terms": ["intercept", "plot_elevation_ft"] +
                     [f"type={L}" for L in levels],
            "coef": joint["coef"], "r2": joint["r2"],
        },
    }


ELEV_BANDS = [(-1, 0), (0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 8)]


def residual_structure(paired):
    """The same residuals the confound-1 regression fits, binned, so the shape
    the slope reports can be read directly rather than inferred from a
    coefficient. Descriptive: no test, no selection, nothing new measured."""
    by_band = []
    for lo, hi in ELEV_BANDS:
        sub = [r for _, r in paired if lo <= r["surveyed_ft_above_mllw"] < hi]
        if not sub:
            continue
        by_band.append({
            "band_ft_mllw": [lo, hi], "n": len(sub),
            **{pid: {"mean_residual_ft": round(
                statistics.fmean([r[pid]["residual_ft"] for r in sub]), 4)}
               for pid in PRODUCTS}})
    by_type = {}
    for t in sorted({r["plot_type"] for _, r in paired}):
        v = [r["surveyed_ft_above_mllw"] for _, r in paired
             if r["plot_type"] == t]
        by_type[t] = {"n": len(v),
                      "mean_surveyed_ft": round(statistics.fmean(v), 3),
                      "median_surveyed_ft": round(statistics.median(v), 3),
                      "range_ft": [round(min(v), 3), round(max(v), 3)]}
    return {"residual_by_surveyed_elevation_band": by_band,
            "surveyed_elevation_by_plot_type": by_type,
            "why_this_is_here": "the two regressions are not independent: plot "
                                "type is largely elevation in disguise, and "
                                "these two tables are how a reader sees that "
                                "without refitting anything."}


def post_hoc_restricted_slope(paired, low_idx, split):
    """POST-HOC. Added after the pre-registered comparison had run and returned
    indeterminate, and it CANNOT change that verdict.

    The run reported metrics for the roughness-restricted set but never
    regressed elevation inside it. Doing so asks whether the confound-1 slope is
    the point-against-cell confound in disguise: if rough ground were producing
    it, restricting to smooth ground should WEAKEN it.

    It strengthens, in both products and under both ways of drawing the
    restriction. That was first read as ruling roughness out. It does not:
    roughness is computed FROM the DEM, so restricting on it selects on a
    quantity correlated with the elevation under test, and where rough ground is
    also high ground the restriction strips the DEM's range while leaving the
    survey's intact -- which pushes this very regression toward slope -1 and
    r2 -> 1 on its own. `selection_effect_on_this_diagnostic` measures that, and
    the unselected `all_points` fit is what the finding rests on.

    Two conventions are reported because they answer slightly different
    questions and neither is more correct:

    - `shared_set` is the restriction the finding already defines -- one point
      set from the median of the two products' mean roughness, so both products
      are scored on identical points and the restriction cannot favour either.
      This is the set the pre-registered restricted comparison used.
    - `per_product` splits each product on its OWN roughness median, so each is
      restricted to the ground that product resolves smoothly. Two different
      60-point sets, which is why it cannot be used for a paired comparison, and
      exactly why it is reported only here.
    """
    def fit(sub, pid):
        sur = [r["surveyed_ft_above_mllw"] for r in sub]
        res = [r[pid]["residual_ft"] for r in sub]
        dem = [r[pid]["cell_ft_mllw"] for r in sub]
        m = ols([([1.0, x], y) for x, y in zip(sur, res)], 2)
        b = m["_raw"][1]
        return {
            "n": len(sub),
            "slope_ft_per_ft": round(b, 4),
            "r2": m["r2"],
            "intercept_ft": m["coef"][0],
            # residual = DEM - survey, so d(resid)/d(survey) = d(DEM)/d(survey) - 1
            "d_dem_d_survey": round(1.0 + b, 4),
            "surveyed_span_ft": round(max(sur) - min(sur), 3),
            "dem_span_ft": round(max(dem) - min(dem), 3),
            "corr_survey_dem": round(pearson(sur, dem), 4),
        }

    rows = [r for _, r in paired]
    out = {
        "status": "POST-HOC AND CANNOT SELECT. Computed after the "
                  "pre-registered comparison returned indeterminate. It is not "
                  "in the pre-registration, it did not contribute to the "
                  "verdict, and it could not have: no product is selected "
                  "either way.",
        "question": "is the confound-1 elevation slope the point-against-cell "
                    "confound in disguise? If rough ground produced it, "
                    "restricting to smooth ground would weaken it.",
        "answer": "The slope STRENGTHENS on smooth ground, in both products and "
                  "under both restriction conventions. But this test cannot "
                  "carry the weight originally put on it: roughness is derived "
                  "from the DEM, so restricting on it is not an independent "
                  "slice. See selection_effect_on_this_diagnostic below, and "
                  "read the headline off all_points, which involves no "
                  "selection.",
        "read_this_one": "all_points. It is unselected, and a DEM reproducing "
                         "a third to a half of the surveyed relief is the "
                         "finding on its own.",
        "all_points": {pid: fit(rows, pid) for pid in PRODUCTS},
        "shared_set": {
            "definition": "the finding's own restriction -- points at or below "
                          f"the median ({round(split, 4)} ft) of the two "
                          "products' mean 5 m roughness. One point set, "
                          "identical for both products.",
            **{pid: fit([rows[i] for i in low_idx], pid) for pid in PRODUCTS}},
    }
    per = {"definition": "each product split on its OWN 5 m roughness median. "
                         "Two different point sets, so this is NOT a paired "
                         "comparison and is reported for this diagnostic only."}
    for pid in PRODUCTS:
        rg = [r[pid]["roughness_ft"] for r in rows
              if r[pid]["roughness_ft"] is not None]
        med = statistics.median(rg)
        sub = [r for r in rows if r[pid]["roughness_ft"] is not None
               and r[pid]["roughness_ft"] <= med]
        per[pid] = {"roughness_median_ft": round(med, 4), **fit(sub, pid)}
    out["per_product"] = per

    # Why this diagnostic cannot rule roughness out, measured rather than
    # asserted. Roughness is computed FROM the DEM, so the restriction selects
    # on a quantity correlated with the elevation being tested. Where that
    # correlation is high, restricting compresses the DEM's spread while leaving
    # the survey's alone, and a regression of (DEM - survey) on survey is then
    # driven toward slope -1 and r2 -> 1 whether or not anything is wrong.
    sel = {
        "why_it_matters": "roughness is derived from the DEM, so the restricted "
                          "set is not an independent slice. Rough ground is "
                          "also high ground here, at r ~ 0.68-0.70, so "
                          "restricting to smooth ground strips far more of the "
                          "DEM's range than of the survey's, and the slope is "
                          "pushed toward -1 and r2 toward 1 mechanically. That "
                          "is the direction this diagnostic reports, so it "
                          "cannot distinguish the two explanations. Compare "
                          "the two sd pairs below rather than either alone: "
                          "the asymmetry between them is the effect.",
        "restricted_set": "shared_set (n=%d)" % len(low_idx),
    }
    low_rows = [rows[i] for i in low_idx]
    sur_all = [r["surveyed_ft_above_mllw"] for r in rows]
    sur_low = [r["surveyed_ft_above_mllw"] for r in low_rows]
    for pid in PRODUCTS:
        rg = [(r[pid]["roughness_ft"], r[pid]["cell_ft_mllw"]) for r in rows
              if r[pid]["roughness_ft"] is not None]
        dem_all = [r[pid]["cell_ft_mllw"] for r in rows]
        dem_low = [r[pid]["cell_ft_mllw"] for r in low_rows]
        sel[pid] = {
            "corr_roughness_dem_elevation": round(
                pearson([a for a, _ in rg], [b for _, b in rg]), 4),
            "dem_sd_all_ft": round(statistics.pstdev(dem_all), 4),
            "dem_sd_restricted_ft": round(statistics.pstdev(dem_low), 4),
            "survey_sd_all_ft": round(statistics.pstdev(sur_all), 4),
            "survey_sd_restricted_ft": round(statistics.pstdev(sur_low), 4),
        }
    out["selection_effect_on_this_diagnostic"] = sel

    # The one result the restriction DOES show cleanly. Both products are scored
    # on the identical shared set, so whatever the selection does to the DEM's
    # spread it does to both -- which means the difference between them survives
    # an effect that the absolute values do not.
    out["the_differential_the_restriction_does_show"] = {
        "claim": "on the shared restricted set both products face the same "
                 "selection, so the DIFFERENCE between their survey-DEM "
                 "correlations is not explained by it.",
        "corr_survey_dem_on_shared_set": {
            pid: out["shared_set"][pid]["corr_survey_dem"] for pid in PRODUCTS},
        "why_it_is_worth_keeping": "none of the three pre-registered metrics "
                                   "captured it. RMSE, MAE and median absolute "
                                   "error all measure the size of the error; "
                                   "this measures whether the product tracks "
                                   "the bench's shape at all on ground it "
                                   "resolves smoothly.",
    }

    out["what_it_rules_out"] = {
        "roughness / point-against-cell": "NOT ruled out. This was previously "
                                          "recorded as ruled out because the "
                                          "slope steepens on smooth ground. "
                                          "That inference does not hold: the "
                                          "restriction selects on a "
                                          "DEM-derived quantity, and "
                                          "selection_effect_on_this_diagnostic "
                                          "shows it strips about three "
                                          "quarters of the DEM's spread "
                                          "against about a quarter of the "
                                          "survey's -- an asymmetry that "
                                          "drives this regression toward slope "
                                          "-1 on its own. "
                                          "The test cannot separate 'roughness "
                                          "is not the cause' from 'restricting "
                                          "on a DEM-derived quantity induced "
                                          "the steepening'.",
        "sand": "ruled out as the cause. Sand buries low ground; it cannot "
                "lower high rock, and the slope is driven by the DEM reading "
                "several feet BELOW surveyed cliff faces and boulder tops.",
        "any datum term": "ruled out as the cause. A datum error is additive: "
                          "it moves the intercept of this regression and "
                          "cannot produce a slope in it. It is also identical "
                          "for both products and so cancels exactly in the "
                          "paired difference.",
    }
    out["what_survives_untested"] = [
        "coordinates that do not locate the plots on a 1 m grid -- the survey's "
        "horizontal is a 2004 Trimble fix whose published accuracy claim and "
        "'Std. Dev.' column cannot be reconciled (that column's unit is "
        "UNRESOLVED and is not read here). A metre-class horizontal error on a "
        "bench with metre-class relief lands the sample on the wrong feature.",
        "a scale problem in the surveyed heights -- the report ties its stadia "
        "readings to MLLW through a conversion formula it attributes to UCSC "
        "and a still-water line read by eye, and a scale error there would "
        "stretch the surveyed range against a DEM that is correct.",
        "DEMs that do not resolve this bench -- both products may simply be "
        "too smooth here, which the void coverage in README section 10 already "
        "makes plausible.",
    ]
    out["not_tested_here"] = ("None of the three is tested, none is preferred, "
                              "and nothing is adjusted to close the gap. "
                              "Separating them is new work, not a repair.")
    out["consequence_for_the_adjudication"] = (
        "The adjudication could not have selected a product whichever way the "
        "metrics fell. A comparison can only rank two products by how well they "
        "reproduce ground truth if at least one of them reproduces it; over the "
        "119 paired points corr(survey, DEM) is 0.44-0.54, and on smooth ground "
        "d(DEM)/d(survey) falls to 0.01-0.14 against the 1.0 a faithful DEM "
        "would give. Neither product tracks the surveyed relief, so a metric "
        "win would have been a win on noise. The indeterminate verdict is not a "
        "near miss between two close candidates; it is what a comparison "
        "returns when neither candidate is measuring the thing.")
    return out


def confound_roughness(rough, absres, seed):
    """Confound 2: residual MAGNITUDE against local DEM roughness."""
    def r_of(sub):
        return pearson([s[0] for s in sub], [s[1] for s in sub])
    pairs = list(zip(rough, absres))
    r = pearson(rough, absres)
    m = ols([([1.0, x], y) for x, y in pairs], 2)
    return {
        "model": "absolute residual (ft) against local DEM roughness (ft), "
                 f"roughness = population sd of valid cells within "
                 f"{ROUGHNESS_RADIUS_M:.0f} m.",
        "n": len(pairs),
        "pearson_r": round(r, 4) if r is not None else None,
        "pearson_r_ci95": bootstrap_stat(pairs, r_of, seed),
        "ols_intercept_ft": m["coef"][0],
        "ols_slope_ft_per_ft_roughness": m["coef"][1],
        "ols_r2": m["r2"],
        "roughness_median_ft": round(statistics.median(rough), 4),
        "roughness_range_ft": [round(min(rough), 4), round(max(rough), 4)],
    }


# --------------------------------------------------------------------------

def main():
    survey = json.load(open(SURVEY))
    pts, accounting = load_points(survey)
    print(f"analysis candidates: {len(pts)} of "
          f"{accounting['points_with_published_height']} with a published height",
          flush=True)

    sampled, grids = {}, {}
    for pid in PRODUCTS:
        sampled[pid], grids[pid] = sample_product(pid, pts)

    # ---- the paired set -------------------------------------------------
    # Every metric below is computed on points where BOTH products deliver a
    # value. A point voided in one product is dropped from both, so no drop can
    # favour either, and the bootstrap the pre-registration specifies is paired
    # and requires it. Per-product figures over each product's own valid points
    # are reported separately, and are descriptive only.
    per_point, paired = [], []
    for i, p in enumerate(pts):
        surveyed_ft = p["height_in_above_mllw"] / 12.0
        rec = {
            "point_label": p["point_label"], "zone": p["zone"],
            "plot_id": p["plot_id"], "plot_type": p["plot_type"],
            "target_species": p["target_species"],
            "date_recorded": p["date_recorded"],
            "surveyed_in_above_mllw": p["height_in_above_mllw"],
            "surveyed_ft_above_mllw": round(surveyed_ft, 4),
            "surveyed_height_std_dev_in": p.get("height_std_dev_in"),
            "latitude_deg": p["latitude_deg"],
            "longitude_deg": p["longitude_deg"],
            "flags": p.get("flags") or [],
        }
        ok = True
        for pid in PRODUCTS:
            s = sampled[pid][i]
            rec[pid] = {
                "utm_e": s["utm_e"], "utm_n": s["utm_n"],
                "cell_ft_mllw": s.get("ft_mllw"),
                "z_navd88_m": s.get("z_navd88_m"),
                "roughness_ft": s.get("roughness_ft"),
                "roughness_n_cells": s.get("roughness_n_cells"),
                "mean_3m_ft_mllw": s.get("mean_3m_ft_mllw"),
            }
            if s.get("ft_mllw") is None:
                rec[pid]["void"] = True
                ok = False
            else:
                rec[pid]["residual_ft"] = round(s["ft_mllw"] - surveyed_ft, 4)
        rec["in_paired_set"] = ok
        per_point.append(rec)
        if ok:
            paired.append((p, rec))

    n_paired = len(paired)
    print(f"paired set: {n_paired} points valid in both products", flush=True)

    resid = {pid: [r[pid]["residual_ft"] for _, r in paired] for pid in PRODUCTS}
    prim = {pid: metrics(resid[pid]) for pid in PRODUCTS}
    prim_winner = winner(prim["2616"], prim["6260"])

    d = [abs(a) - abs(b) for a, b in zip(resid["2616"], resid["6260"])]
    boot = bootstrap_paired(d, BOOTSTRAP_SEED)
    boot["seed_stability"] = [
        {"seed": s, **{k: v for k, v in bootstrap_paired(d, s, B=2000).items()
                       if k in ("ci_lo_ft", "ci_hi_ft", "spans_zero")}}
        for s in SEED_STABILITY_CHECK]

    # Descriptive only: the same interval on each of the three metric
    # differences. It cannot select -- the pre-registered interval is the one
    # above, and any of these spanning zero can only reinforce indeterminacy.
    def metric_diff(key):
        def f(sub):
            a = metrics([x for x, _ in sub])
            b = metrics([y for _, y in sub])
            return a[key] - b[key]
        return f
    rows = list(zip(resid["2616"], resid["6260"]))
    metric_diff_ci = {k: bootstrap_stat(rows, metric_diff(k), BOOTSTRAP_SEED)
                      for k in METRIC_KEYS}

    # ---- confounds ------------------------------------------------------
    types = sorted({p["plot_type"] for p, _ in paired})
    sand = {}
    for pid in PRODUCTS:
        rows_s = [(r["surveyed_ft_above_mllw"], r[pid]["residual_ft"],
                   r["plot_type"]) for _, r in paired]
        sand[pid] = confound_sand(rows_s, types, BOOTSTRAP_SEED)

    rough = {}
    for pid in PRODUCTS:
        rr = [(r[pid]["roughness_ft"], abs(r[pid]["residual_ft"]))
              for _, r in paired if r[pid]["roughness_ft"] is not None]
        rough[pid] = confound_roughness([x for x, _ in rr],
                                        [y for _, y in rr], BOOTSTRAP_SEED)

    # ---- the roughness-restricted comparison: DIAGNOSTIC ONLY -----------
    combo = []
    for _, r in paired:
        a, b = r["2616"]["roughness_ft"], r["6260"]["roughness_ft"]
        combo.append(None if a is None or b is None else (a + b) / 2.0)
    have = [c for c in combo if c is not None]
    split = statistics.median(have) if have else None
    low = [i for i, c in enumerate(combo) if c is not None and c <= split]
    restricted = None
    if len(low) >= 10:
        rm = {pid: metrics([resid[pid][i] for i in low]) for pid in PRODUCTS}
        rw = winner(rm["2616"], rm["6260"])
        rd = [d[i] for i in low]
        restricted = {
            "status": "DIAGNOSTIC ONLY. The pre-registration makes the primary "
                      "comparison all points; this one is reported beside it, "
                      "can never override it, and can only force indeterminate.",
            "restriction": f"points at or below the median of the two "
                           f"products' mean {ROUGHNESS_RADIUS_M:.0f} m "
                           f"roughness ({split:.4f} ft)",
            "n_points": len(low),
            "metrics": rm, "winner": rw,
            "bootstrap": bootstrap_paired(rd, BOOTSTRAP_SEED, B=2000),
        }

    # Post-hoc, and deliberately computed AFTER the verdict block below reads
    # nothing from it. It is in the output and in no decision.
    post_hoc = (post_hoc_restricted_slope(paired, low, split)
                if split is not None and len(low) >= 10 else None)

    # ---- the verdict ----------------------------------------------------
    reasons = []
    verdict, selected = "indeterminate", None
    if not prim_winner["agreement"]:
        reasons.append(
            "the three metrics do not agree on a product. The pre-registration: "
            "'A product is selected only if all three choose the same one. A "
            "split selects nothing and is itself the finding.'")
    if boot["spans_zero"]:
        reasons.append(
            "the 95% bootstrap CI on the paired per-point difference in "
            "absolute residual spans zero. The pre-registration: 'If the "
            "interval spans zero the result is indeterminate and no product is "
            "selected.'")
    restricted_disagrees = (
        restricted is not None
        and restricted["winner"]["selected"] is not None
        and prim_winner["selected"] is not None
        and restricted["winner"]["selected"] != prim_winner["selected"])
    if restricted_disagrees:
        reasons.append(
            "the roughness-restricted comparison names a different product "
            "than the primary. The pre-registration: 'If the two disagree, the "
            "result is indeterminate.'")
    if not reasons:
        verdict, selected = "selected", prim_winner["selected"]

    # Where the two readings of "disagree" could differ, both are reported
    # rather than one being chosen silently. They coincide unless the primary
    # selects and the restricted comparison splits.
    strict = verdict
    if (verdict == "selected" and restricted is not None
            and restricted["winner"]["selected"] is None):
        strict = "indeterminate"

    out = {
        "read_date": "2026-07-30",
        "issue": 89,
        "question": "Do the 2004 NPS-surveyed Cabrillo elevations select DEM "
                    "product 2616 or 6260 for the hypsometric curve, under the "
                    "rules frozen before the comparison ran?",
        "verdict": {
            "result": verdict,
            "product_selected": selected,
            "reasons": reasons or ["all three metrics agree, the bootstrap "
                                   "interval excludes zero, and the "
                                   "roughness-restricted diagnostic does not "
                                   "contradict."],
            "under_strict_reading_of_disagree": strict,
            "strict_reading_note": "'Disagree' is read as 'the restricted "
                                   "comparison names a different product'. The "
                                   "stricter reading, in which a restricted "
                                   "comparison that names NO product also "
                                   "fails to agree, is reported beside it. "
                                   "Where the two coincide the ambiguity is "
                                   "moot.",
        },
        "not_claimed": [
            "No floor is set, changed or proposed, and this is not a "
            "floor_evidence entry.",
            "The NPS check reserved in calibration/floor-calibration.md "
            "section 6 is NOT spent. Its figure is not read, cited or compared "
            "against anywhere in this finding, and it does not appear in it. "
            "That section's conditional governs what a later comparison is "
            "worth, and the branch it commits to for an indeterminate result "
            "is that nothing is recorded against the figure and the check "
            "stays unspent.",
            "No sand correction, epoch adjustment or any other offset that "
            "would make the two products agree better is applied. The vintage "
            "gap is measured as a confound and left in the residuals.",
            "The GPS 'Std. Dev.' column is not read and its unit is not "
            "assumed. No horizontal tolerance derived from it is used.",
            "shared/spots.json is not read from or written to.",
            "This does not re-run the slope gate, and it does not decide "
            "whether issue 46 closes.",
            "post_hoc_elevation_slope_in_the_restricted_set was computed AFTER "
            "the verdict and contributed nothing to it. It selects no product, "
            "tests none of the three candidates it leaves standing, and no "
            "value anywhere in this finding was adjusted to close the gap it "
            "measures.",
        ],
        "pre_registration": {
            "document": "calibration/floor-calibration.md",
            "section": "6, subsection 'Pre-registration: which DEM the "
                       "surveyed elevations select, written before it runs'",
            "committed_before_the_comparison_ran": True,
            "rules_implemented": [
                "three metrics -- RMSE, MAE, median absolute error -- all "
                "reported, agreement required, a split selects nothing",
                "exclusions are the report's own two and no others",
                "95% bootstrap CI over points on the paired per-point "
                "difference in absolute residual; spanning zero is "
                "indeterminate",
                "residual regressed on plot elevation and plot type",
                "residual magnitude against local DEM roughness, restricted "
                "comparison diagnostic only and never able to select",
            ],
        },
        "implementation_choices_the_pre_registration_does_not_fix":
            IMPLEMENTATION_CHOICES,
        "ground_truth": {
            "source_finding": "lidar-recon/findings/cabrillo-surveyed-elevations.json",
            "survey": survey["source"]["elevation_appendix"],
            "citation": survey["source"]["citation"],
            "vertical_datum": survey["datum_and_method"]["vertical_datum"],
            "reported_height_uncertainty":
                survey["datum_and_method"]["reported_height_uncertainty"],
            "unit_conversion": "published inches above MLLW / 12 = feet above "
                               "MLLW. The report's foot is not declared as US "
                               "survey or international; the two differ by 2 "
                               "ppm, which is 1.6e-5 ft on an 8 ft stadia pole "
                               "and is below every other term here.",
            "tide_station_the_survey_used": survey["tide_reference"]["station_used_by_the_report"],
            "tide_station_this_repo_binds": survey["tide_reference"]["station_bound_by_this_repo_for_cabrillo_tidepools"],
            "why_that_does_not_select": "A difference between the two MLLW "
                                        "realisations is a constant applied to "
                                        "every surveyed height, so it shifts "
                                        "both products' residuals identically "
                                        "and cancels exactly in the paired "
                                        "difference. It biases the ABSOLUTE "
                                        "residuals and cannot bias the choice "
                                        "between products.",
        },
        "point_accounting": accounting,
        "vintage_gap": vintage(),
        "datum_conversion": {
            "navd88_m_to_ft_mllw": f"ft = z_m * {USFT_PER_M} + {CAB_OFFSET_USFT}",
            "source": "VDatum, findings/vdatum-transforms.json; the same "
                      "constants hypsometry.py used for the slope gate",
            "offset_uncertainty_ft": CAB_OFFSET_UNCERT_FT,
            "why_the_uncertainty_does_not_select": "the offset is additive and "
                                                   "identical for both "
                                                   "products, so it cancels in "
                                                   "the paired difference. It "
                                                   "is a floor under the "
                                                   "absolute residuals, not a "
                                                   "term in the choice.",
        },
        "grids": grids,
        "primary_comparison": {
            "point_set": "points valid in BOTH products, so every drop is "
                         "applied to both and no drop can favour either",
            "n_points": n_paired,
            "metrics": prim,
            "winner": prim_winner,
            "bootstrap_ci": boot,
            "metric_difference_ci_descriptive_only": metric_diff_ci,
        },
        "per_product_over_own_valid_points_descriptive_only": {
            pid: metrics([r[pid]["residual_ft"] for r in per_point
                          if r[pid].get("residual_ft") is not None])
            for pid in PRODUCTS},
        "sensitivity_3m_mean_cannot_select": sensitivity(per_point, paired),
        "confound_1_sand": sand,
        "confound_1_structure_descriptive": residual_structure(paired),
        "confound_2_roughness": rough,
        "roughness_restricted_comparison": restricted,
        "post_hoc_elevation_slope_in_the_restricted_set": post_hoc,
        "per_point": per_point,
    }
    with open(DEST, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("wrote", DEST)
    print(f"VERDICT: {verdict}"
          + (f" -> {selected}" if selected else "") )
    for r in reasons:
        print("  -", r)


def sensitivity(per_point, paired):
    """The same three metrics off a 3 m neighbourhood mean instead of the
    containing cell. Reported so a reader can see whether the answer turns on
    sub-cell placement. It cannot select: the pre-registration's primary
    comparison is the one above and this is not in it."""
    out = {"status": "DIAGNOSTIC ONLY -- cannot select, and is not part of the "
                     "pre-registered rule set.",
           "radius_m": SENSITIVITY_RADIUS_M}
    res = {}
    n = 0
    for _, r in paired:
        if any(r[p]["mean_3m_ft_mllw"] is None for p in PRODUCTS):
            continue
        n += 1
        for p in PRODUCTS:
            res.setdefault(p, []).append(
                r[p]["mean_3m_ft_mllw"] - r["surveyed_ft_above_mllw"])
    if n >= 10:
        m = {p: metrics(res[p]) for p in PRODUCTS}
        out["n_points"] = n
        out["metrics"] = m
        out["winner"] = winner(m["2616"], m["6260"])
    return out


def vintage():
    """The gap, measured and left in. Dates come from the recon's own metadata
    finding rather than from memory."""
    meta = json.load(open(os.path.join(FINDINGS, "dataset-metadata.json")))
    d = meta["datasets"]
    return {
        "survey": "2004-02-07 .. 2004-03-19 (Appendix E field dates); the "
                  "pre-registration calls it spring 2004",
        "2616_acquisition": d["2616"]["acquisition"],
        "2616_publication": d["2616"]["publication_date"],
        "6260_acquisition": d["6260"]["acquisition"],
        "6260_publication": d["6260"]["publication_date"],
        "gap_2616": "roughly 5 to 7 years after the survey",
        "gap_6260": "roughly 12 years after the survey",
        "read_carefully": "The pre-registration describes the DEMs as "
                          "'roughly 2014'. Measured against the recon's own "
                          "metadata that is loose: 2616's source lidar is a "
                          "nominal 2009-2011 and 6260's is April-May 2016. The "
                          "two products are NOT the same age relative to the "
                          "survey, which is itself a confound -- they are five "
                          "years apart from each other on a bench that buries "
                          "and scours seasonally. Recorded, not corrected.",
        "correction_applied": "NONE. No sand offset, no epoch adjustment, no "
                              "term of any kind that would make the two "
                              "products agree better with the survey or with "
                              "each other.",
    }


if __name__ == "__main__":
    main()
