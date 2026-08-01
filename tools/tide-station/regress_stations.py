#!/usr/bin/env python3
"""Measure what changes if a tide height is read from 9410170 instead of 9410230.

Both stations are in shared/spots.json's tide_stations registry. 9410230 La Jolla
carries every spot; 9410170 San Diego Bay is "bay side only" and carries none. The
question this answers is what a predicate INHERITS from that binding -- and the
answer is different at the daily low, where the two agree to hundredths, and at
high water, where they do not.

Three measurements, all from NOAA CO-OPS predictions:

  1. REGRESSION. Paired hi/lo predictions at both stations, matched by nearest
     same-type event within 60 minutes, fitted h_9410170 = m * h_9410230 + c.
     Run per year so the coefficient's own stability can be seen; that turned out
     to matter, see the README.

  2. DERIVED POINT LOMA. The same pairs against 0.92 * h_9410170, which is CO-OPS
     subordinate station TWC0405 Point Loma. This is the only PUBLISHED route from
     9410170 to the open coast, so it -- not raw 9410170 -- is what a considered
     station change would actually read.

  3. BAND MEMBERSHIP. The 6-minute product over one fortnight, counting how many
     samples fall inside activities/surf/thresholds.json's tide band under each
     station. The regression isolates amplitude by matching turning points; this
     one deliberately does not, because a predicate reading a series inherits the
     bay's phase lag as well as its range.

Standard library only, and it reaches CO-OPS, so it is run deliberately rather
than in CI -- same standing as tools/verify-apis/ and tools/county-station/.

    python tools/tide-station/regress_stations.py            # 2000-2040, full table
    python tools/tide-station/regress_stations.py --years 2016
    python tools/tide-station/regress_stations.py --check    # exit 1 if the
                                                             # committed findings
                                                             # no longer reproduce
    python tools/tide-station/regress_stations.py --write    # rewrite findings/

Year payloads are cached under cache/, which is gitignored on the same terms as
tools/calibration/cache/: what is committed is findings/, which carries the
numbers, the queries and the counts needed to check any of this without
republishing 41 years of payloads.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, "cache")
FINDINGS = os.path.join(HERE, "findings", "9410230-9410170-scale-term.json")

API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
APPLICATION = "socal-coastal-data-tide-station"

OPEN_COAST = "9410230"  # La Jolla (Scripps Pier). Every spot binds this.
BAY = "9410170"  # San Diego Bay. Bound by nothing; "bay side only".

# CO-OPS subordinate station TWC0405 Point Loma, whose reference station is
# 9410170. Fetched live by --check rather than trusted from here.
TWC0405_RATIO = 0.92

SURF_THRESHOLDS = os.path.join(HERE, "..", "..", "activities", "surf", "thresholds.json")

# The window a paired event must fall inside. Generous on purpose -- the observed
# offsets top out at 42 minutes over 41 years, so the window never binds.
MATCH_WINDOW_S = 3600

# The fortnight core/feeds/__fixtures__/coops-9410230-20260713-384h.json covers.
BAND_BEGIN, BAND_HOURS = "20260713", 384

PACIFIC = ZoneInfo("America/Los_Angeles")


def read_surf_band() -> tuple[float, float]:
    """The band, from the file that owns it. Never a second copy of the numbers.

    This tool measures what a band INHERITS from a station binding and has no
    opinion about where the band should sit, so it reads
    activities/surf/thresholds.json rather than restating it. If the band moves,
    every figure here follows without an edit.

    The datum and unit are asserted rather than assumed, because that file
    deliberately carries two different kinds of feet -- `units` is wave height at
    a buoy and `tide_units` is height above a vertical datum -- and reading the
    wrong one would compare a swell ceiling against a tide prediction.
    """
    with open(SURF_THRESHOLDS, encoding="utf-8") as handle:
        thresholds = json.load(handle)

    if thresholds.get("tide_datum") != "MLLW":
        raise SystemExit(
            f"surf thresholds declare tide_datum={thresholds.get('tide_datum')!r}; this tool "
            "requests datum=MLLW and a mismatch would compare heights on two different zeroes."
        )
    if thresholds.get("tide_units") != "ft":
        raise SystemExit(
            f"surf thresholds declare tide_units={thresholds.get('tide_units')!r}; this tool "
            "requests units=english. A metric band would be read as feet."
        )

    band = thresholds["tide_band"]
    return float(band["min_ft"]), float(band["max_ft"])


BAND_MIN_FT, BAND_MAX_FT = read_surf_band()


# ---------------------------------------------------------------------------
# Fetching, with the request contract pinned in the same place as the parser
# ---------------------------------------------------------------------------


def _get(url: str, retries: int = 5) -> dict:
    """CO-OPS 504s under load on multi-year spans. Retry, then give up loudly."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=180) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
    raise SystemExit(f"CO-OPS request failed after {retries} attempts: {url}\n  {last}")


def _predictions(payload: dict, url: str) -> list[dict]:
    """Every way CO-OPS can answer without giving predictions, refused.

    Mirrors core/feeds/coops-predictions.ts. Errors arrive at HTTP 200 here, so a
    status check is not enough: freshness beats status.
    """
    if "error" in payload:
        raise SystemExit(f"CO-OPS returned an error body (at HTTP 200): {payload['error']}\n  {url}")
    rows = payload.get("predictions")
    if not isinstance(rows, list):
        raise SystemExit(
            f"CO-OPS: no 'predictions' array. Top-level keys: "
            f"{', '.join(payload.keys()) or '(none)'}\n  {url}"
        )
    if not rows:
        raise SystemExit(f"CO-OPS: 'predictions' is empty. A 200 carrying no rows is dead.\n  {url}")
    return rows


def _parse_gmt(stamp: str) -> datetime.datetime:
    """'YYYY-MM-DD HH:MM' under time_zone=gmt.

    The timestamps carry NO offset. They are UTC only because the request said
    gmt, and reading them any other way ages every value by 7-8 hours.
    """
    return datetime.datetime.strptime(stamp, "%Y-%m-%d %H:%M").replace(
        tzinfo=datetime.timezone.utc
    )


def fetch_hilo(station: str, year: int) -> list[tuple[datetime.datetime, float, str]]:
    """One year of labelled highs and lows, ft above MLLW."""
    path = os.path.join(CACHE_DIR, f"{station}-hilo-{year}.json")
    params = {
        "product": "predictions",
        "application": APPLICATION,
        "station": station,
        "begin_date": f"{year}0101",
        "end_date": f"{year}1231",
        "interval": "hilo",
        "datum": "MLLW",
        "units": "english",
        "time_zone": "gmt",
        "format": "json",
    }
    url = f"{API}?{urllib.parse.urlencode(params)}"

    if os.path.exists(path):
        payload = json.load(open(path, encoding="utf-8"))
    else:
        payload = _get(url)
        _predictions(payload, url)
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)

    events = []
    for index, row in enumerate(_predictions(payload, url)):
        kind = row.get("type")
        if kind not in ("H", "L"):
            raise SystemExit(
                f"{station} {year} row {index}: expected type 'H' or 'L', got {kind!r}. "
                "Without it a high cannot be told from a low."
            )
        events.append((_parse_gmt(row["t"]), float(row["v"]), kind))
    return events


def fetch_series(station: str, begin: str, hours: int) -> dict[str, float]:
    """The 6-minute product, keyed by its own timestamp string."""
    path = os.path.join(CACHE_DIR, f"{station}-6min-{begin}-{hours}.json")
    params = {
        "product": "predictions",
        "application": APPLICATION,
        "station": station,
        "begin_date": begin,
        "range": str(hours),
        "datum": "MLLW",
        "units": "english",
        "time_zone": "gmt",
        "format": "json",
    }
    url = f"{API}?{urllib.parse.urlencode(params)}"

    if os.path.exists(path):
        payload = json.load(open(path, encoding="utf-8"))
    else:
        payload = _get(url)
        _predictions(payload, url)
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)

    out = {}
    for index, row in enumerate(_predictions(payload, url)):
        if "type" in row:
            raise SystemExit(
                f"{station} {begin} row {index}: row carries type={row['type']!r}, so this is "
                "the interval=hilo product. Four daily peaks are not a series."
            )
        out[row["t"]] = float(row["v"])
    return out


# ---------------------------------------------------------------------------
# Matching and fitting
# ---------------------------------------------------------------------------


def match(
    left: list[tuple[datetime.datetime, float, str]],
    right: list[tuple[datetime.datetime, float, str]],
) -> tuple[list[tuple[float, float, str, float]], int, int]:
    """Pair each left event with the nearest SAME-TYPE right event in the window.

    Same-type is the load-bearing half. A high paired with a low inverts the
    comparison, and near a shallow turn the two can be under an hour apart.

    Returns (pairs, unmatched, reused) -- `reused` counts right events claimed by
    more than one left event, which would mean the pairing is not one-to-one and
    the fit is reading one prediction twice.
    """
    pairs: list[tuple[float, float, str, float]] = []
    claimed: dict[datetime.datetime, int] = {}
    unmatched = 0

    for stamp, height, kind in left:
        best: tuple[float, float, datetime.datetime] | None = None
        for other_stamp, other_height, other_kind in right:
            delta = (other_stamp - stamp).total_seconds()
            if delta < -MATCH_WINDOW_S:
                continue
            if delta > MATCH_WINDOW_S:
                break
            if other_kind != kind:
                continue
            if best is None or abs(delta) < best[0]:
                best = (abs(delta), other_height, other_stamp)
        if best is None:
            unmatched += 1
            continue
        claimed[best[2]] = claimed.get(best[2], 0) + 1
        pairs.append((height, best[1], kind, best[0]))

    return pairs, unmatched, sum(1 for count in claimed.values() if count > 1)


def ols(xs: list[float], ys: list[float]) -> tuple[float, float, float, float]:
    """Ordinary least squares. Returns (slope, intercept, r2, max |residual|)."""
    n = len(xs)
    mean_x, mean_y = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    syy = sum((y - mean_y) ** 2 for y in ys)
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x
    r2 = (sxy * sxy) / (sxx * syy)
    worst = max(abs(y - (slope * x + intercept)) for x, y in zip(xs, ys))
    return slope, intercept, r2, worst


def spread(values: list[float]) -> dict:
    ordered = sorted(values)
    n = len(ordered)
    return {
        "n": n,
        "min": round(ordered[0], 4),
        "p05": round(ordered[int(n * 0.05)], 4),
        "median": round(ordered[n // 2], 4),
        "mean": round(sum(ordered) / n, 4),
        "p95": round(ordered[int(n * 0.95)], 4),
        "max": round(ordered[-1], 4),
        "over_0_3_ft_pct": round(100 * sum(1 for v in ordered if abs(v) > 0.3) / n, 2),
    }


# ---------------------------------------------------------------------------
# The three measurements
# ---------------------------------------------------------------------------


def regress(years: list[int], quiet: bool = False) -> dict:
    per_year = []
    pooled_x: list[float] = []
    pooled_y: list[float] = []
    pooled_kind: list[str] = []
    offsets: list[float] = []
    total_unmatched = total_reused = 0
    n_open = n_bay = 0

    if not quiet:
        print(
            f"{'year':>5} {'n':>6} {'slope':>8} {'intcpt':>8} {'r2':>9} "
            f"{'d@1.5':>7} {'d@3.5':>7} {'d@7.0':>7}"
        )

    for year in years:
        open_coast = fetch_hilo(OPEN_COAST, year)
        bay = fetch_hilo(BAY, year)
        n_open += len(open_coast)
        n_bay += len(bay)

        pairs, unmatched, reused = match(open_coast, bay)
        total_unmatched += unmatched
        total_reused += reused

        xs = [p[0] for p in pairs]
        ys = [p[1] for p in pairs]
        pooled_x += xs
        pooled_y += ys
        pooled_kind += [p[2] for p in pairs]
        offsets += [p[3] for p in pairs]

        slope, intercept, r2, _ = ols(xs, ys)
        at = lambda h: slope * h + intercept - h  # noqa: E731
        per_year.append(
            {
                "year": year,
                "n": len(pairs),
                "slope": round(slope, 5),
                "intercept": round(intercept, 5),
                "r2": round(r2, 6),
                "diff_at_band_min_ft": round(at(BAND_MIN_FT), 4),
                "diff_at_band_max_ft": round(at(BAND_MAX_FT), 4),
                "diff_at_7ft": round(at(7.0), 4),
            }
        )
        if not quiet:
            print(
                f"{year:5d} {len(pairs):6d} {slope:8.4f} {intercept:8.4f} {r2:9.5f} "
                f"{at(BAND_MIN_FT):+7.3f} {at(BAND_MAX_FT):+7.3f} {at(7.0):+7.3f}"
            )

    slope, intercept, r2, worst = ols(pooled_x, pooled_y)

    highs = [(x, y) for x, y, k in zip(pooled_x, pooled_y, pooled_kind) if k == "H"]
    lows = [(x, y) for x, y, k in zip(pooled_x, pooled_y, pooled_kind) if k == "L"]
    in_band = [
        (x, y, k)
        for x, y, k in zip(pooled_x, pooled_y, pooled_kind)
        if BAND_MIN_FT < x < BAND_MAX_FT
    ]

    slopes = [row["slope"] for row in per_year]
    ordered_offsets = sorted(offsets)

    return {
        "years": [years[0], years[-1]],
        "n_events_9410230": n_open,
        "n_events_9410170": n_bay,
        "n_pairs": len(pooled_x),
        "unmatched_9410230_events": total_unmatched,
        "reused_9410170_partners": total_reused,
        "match_window_minutes": MATCH_WINDOW_S // 60,
        "match_offset_minutes": {
            "median": round(ordered_offsets[len(ordered_offsets) // 2] / 60, 1),
            "p99": round(ordered_offsets[int(len(ordered_offsets) * 0.99)] / 60, 1),
            "max": round(ordered_offsets[-1] / 60, 1),
        },
        "pooled": {
            "slope": round(slope, 5),
            "intercept": round(intercept, 5),
            "r2": round(r2, 6),
            "max_abs_residual_ft": round(worst, 4),
            "inverse_slope": round(1 / slope, 5),
        },
        "per_year": per_year,
        "slope_extremes": {
            "min": {"year": per_year[slopes.index(min(slopes))]["year"], "slope": min(slopes)},
            "max": {"year": per_year[slopes.index(max(slopes))]["year"], "slope": max(slopes)},
        },
        "diff_stability_ft": {
            f"at_{h}": round(
                max(r["slope"] * h + r["intercept"] - h for r in per_year)
                - min(r["slope"] * h + r["intercept"] - h for r in per_year),
                4,
            )
            for h in (BAND_MIN_FT, BAND_MAX_FT, 7.0)
        },
        "raw_9410170_minus_9410230_ft": {
            "all": spread([y - x for x, y in zip(pooled_x, pooled_y)]),
            "highs": spread([y - x for x, y in highs]),
            "lows": spread([y - x for x, y in lows]),
            "in_band": spread([y - x for x, y, _ in in_band]),
            "in_band_highs": spread([y - x for x, y, k in in_band if k == "H"]),
            "in_band_lows": spread([y - x for x, y, k in in_band if k == "L"]),
        },
        "derived_point_loma_minus_9410230_ft": {
            "_definition": f"{TWC0405_RATIO} * h_9410170 - h_9410230, CO-OPS subordinate "
            "station TWC0405 Point Loma against the station every spot binds",
            "highs": spread([TWC0405_RATIO * y - x for x, y in highs]),
            "lows": spread([TWC0405_RATIO * y - x for x, y in lows]),
        },
    }


def daily_minimum_check(year: int) -> dict:
    """Reproduce https://github.com/cweber12/socal-coastal-data/issues/102 Finding 3.

    The quantity there is the MINIMUM predicted height over the local day -- not
    every low -- against Point Loma reconstructed as 0.92 * 9410170 with the -2 min
    low-tide time offset. Recomputing it here is what makes the two halves of this
    finding comparable: #102 measured a DERIVED station at low water, and the
    regression above measures a RAW one at high water.
    """

    def minima(events, scale: float, shift_min: int) -> dict:
        out: dict[datetime.date, float] = {}
        for stamp, height, _ in events:
            day = (stamp + datetime.timedelta(minutes=shift_min)).astimezone(PACIFIC).date()
            value = height * scale
            if day not in out or value < out[day]:
                out[day] = value
        return out

    open_coast = minima(fetch_hilo(OPEN_COAST, year), 1.0, 0)
    derived = minima(fetch_hilo(BAY, year), TWC0405_RATIO, -2)
    unscaled = minima(fetch_hilo(BAY, year), 1.0, 0)

    days = sorted(set(open_coast) & set(derived))
    scaled_diffs = [open_coast[d] - derived[d] for d in days]
    raw_diffs = [open_coast[d] - unscaled[d] for d in sorted(set(open_coast) & set(unscaled))]

    return {
        "year": year,
        "n_days": len(days),
        "la_jolla_minus_derived_point_loma_ft": spread(scaled_diffs),
        "la_jolla_minus_raw_9410170_ft": spread(raw_diffs),
    }


def band_membership() -> dict:
    """How the band's OCCUPANCY changes with the station, not just its heights."""
    open_coast = fetch_series(OPEN_COAST, BAND_BEGIN, BAND_HOURS)
    bay = fetch_series(BAY, BAND_BEGIN, BAND_HOURS)
    common = sorted(set(open_coast) & set(bay))
    if not common:
        raise SystemExit("band check: the two series share no timestamps")

    def inside(reading) -> set[str]:
        return {t for t in common if BAND_MIN_FT < reading(t) < BAND_MAX_FT}

    at_open = inside(lambda t: open_coast[t])
    at_bay = inside(lambda t: bay[t])
    at_derived = inside(lambda t: TWC0405_RATIO * bay[t])

    return {
        "window": {"begin": BAND_BEGIN, "hours": BAND_HOURS, "samples": len(common)},
        "band_ft": [BAND_MIN_FT, BAND_MAX_FT],
        "band_source": "activities/surf/thresholds.json tide_band, read not restated",
        "in_band_minutes": {
            "9410230": len(at_open) * 6,
            "raw_9410170": len(at_bay) * 6,
            "derived_point_loma": len(at_derived) * 6,
        },
        "misclassified_samples_pct": {
            "raw_9410170": round(100 * len(at_open ^ at_bay) / len(at_open), 2),
            "derived_point_loma": round(100 * len(at_open ^ at_derived) / len(at_open), 2),
        },
        "in_band_sample_diff_ft": spread(
            [bay[t] - open_coast[t] for t in common if BAND_MIN_FT < open_coast[t] < BAND_MAX_FT]
        ),
        "_note": "A timestamp-aligned comparison of two SERIES confounds the range "
        "difference with the bay's phase lag (TWC0405 publishes -9 min at high "
        "water). That is deliberate here: a predicate walking a series inherits "
        "both. The regression above matches turning points and isolates range.",
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def verify_twc0405() -> dict:
    """Fetch the published subordinate-station ratio rather than trusting the constant."""
    url = (
        "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/"
        "TWC0405/tidepredoffsets.json"
    )
    payload = _get(url)
    for key, expected in (("refStationId", BAY), ("heightOffsetHighTide", TWC0405_RATIO)):
        if payload.get(key) != expected:
            raise SystemExit(
                f"TWC0405 drift: {key} is {payload.get(key)!r}, pinned as {expected!r}. "
                "The published route from 9410170 to the open coast has changed, and "
                "every conclusion in findings/ that leans on it needs re-reading."
            )
    return {
        "station": "TWC0405 Point Loma",
        "source": url,
        "refStationId": payload["refStationId"],
        "heightOffsetHighTide": payload["heightOffsetHighTide"],
        "heightOffsetLowTide": payload["heightOffsetLowTide"],
        "timeOffsetHighTide": payload["timeOffsetHighTide"],
        "timeOffsetLowTide": payload["timeOffsetLowTide"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", default="2000:2040", help="'2016' or '2000:2040'")
    parser.add_argument("--write", action="store_true", help="rewrite findings/")
    parser.add_argument("--check", action="store_true", help="exit 1 if findings/ drifted")
    args = parser.parse_args()

    if ":" in args.years:
        first, last = (int(part) for part in args.years.split(":"))
        years = list(range(first, last + 1))
    else:
        years = [int(args.years)]

    result = {
        "measured": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
        "issue": 153,
        "question": "What does a predicate inherit from binding 9410230 rather than 9410170?",
        "product": (
            "NOAA CO-OPS predictions, interval=hilo, datum=MLLW, units=english, time_zone=gmt"
        ),
        "twc0405": verify_twc0405(),
        "regression": regress(years, quiet=args.check),
        "issue_102_finding_3_reproduction": daily_minimum_check(2026),
        "band_membership": band_membership(),
    }

    pooled = result["regression"]["pooled"]
    if not args.check:
        print(
            f"\nPOOLED {years[0]}-{years[-1]}  n={result['regression']['n_pairs']}  "
            f"slope={pooled['slope']:.4f}  intercept={pooled['intercept']:+.4f}  "
            f"r2={pooled['r2']:.5f}  1/slope={pooled['inverse_slope']:.4f}"
        )
        raw = result["regression"]["raw_9410170_minus_9410230_ft"]
        derived = result["regression"]["derived_point_loma_minus_9410230_ft"]
        print(
            f"  raw 9410170 - 9410230:  lows median {raw['lows']['median']:+.3f} ft, "
            f"highs median {raw['highs']['median']:+.3f} ft"
        )
        print(
            f"  0.92*9410170 - 9410230: lows median {derived['lows']['median']:+.3f} ft, "
            f"highs median {derived['highs']['median']:+.3f} ft"
        )

    if args.write:
        os.makedirs(os.path.dirname(FINDINGS), exist_ok=True)
        with open(FINDINGS, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(result, handle, indent=1)
            handle.write("\n")
        print(f"\nwrote {os.path.relpath(FINDINGS)}")

    if args.check:
        if not os.path.exists(FINDINGS):
            print(f"no committed findings at {FINDINGS}", file=sys.stderr)
            return 2
        committed = json.load(open(FINDINGS, encoding="utf-8"))
        drift = []
        for key in ("slope", "intercept", "r2"):
            was = committed["regression"]["pooled"][key]
            now = pooled[key]
            if abs(was - now) > 5e-4:
                drift.append(f"pooled {key}: committed {was}, now {now}")
        if committed["regression"]["n_pairs"] != result["regression"]["n_pairs"]:
            drift.append(
                f"n_pairs: committed {committed['regression']['n_pairs']}, "
                f"now {result['regression']['n_pairs']}"
            )
        if drift:
            print("CO-OPS predictions have moved under this finding:", file=sys.stderr)
            for line in drift:
                print(f"  {line}", file=sys.stderr)
            print(
                "\nThat is a real signal, not a flake: NOAA reissuing predictions or "
                "republishing the datum epoch would both land here. See "
                "https://github.com/cweber12/socal-coastal-data/issues/148 F7.",
                file=sys.stderr,
            )
            return 1
        print(f"findings reproduce: {len(years)} years, n={result['regression']['n_pairs']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
