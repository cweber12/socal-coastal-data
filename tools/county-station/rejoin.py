"""Re-run the county_station join and diff it against what spots.json holds.

`county_station` is an upstream join, and this repo's rule for one is that a
wrong value is fixed by fixing the join and re-running it, never by hand. That
rule was unsatisfiable until now: the join had been run once, by hand, and the
only record of WHICH SPOTS it covered was the sentence "ONLY for spots tagged
swim, surf, dive or tidepool" in spots.json's own `_schema` -- prose, pointing
at an `audiences` field that #125 deletes.

The scope is `county_station_scope` on each spot now, and this reads it. That
is the whole demonstration: if this script can re-run the join from what the
repo holds, the record is sufficient; if it could not, the record would be
prose.

    python tools/county-station/rejoin.py            # diff, exit 1 on any change
    python tools/county-station/rejoin.py --verbose  # every spot, matched or not

Exit codes: 0 nothing moved, 1 the join now answers differently, 2 the upstream
is not the shape this was written against.

---------------------------------------------------------------------------
What is pinned, and what is only reported
---------------------------------------------------------------------------

PINNED, and a mismatch is a hard stop: the resource id, the column names the
join reads, the county and status strings it filters on, and the two county-wide
aggregate rows that must be dropped. A scrape that guesses at a renamed column
produces a plausible-looking wrong station, which is worse than no answer.

REPORTED, never fatal: the record counts. Stations open and close, so 287 San
Diego rows becoming 289 is the upstream doing its job, not drift. What IS fatal
is the join answering differently for a spot, because that is the committed
value being wrong -- and it is reported per spot with both sides shown, so a
human decides whether the upstream moved or this did.

---------------------------------------------------------------------------
The code column is Station_Name, and this is not obvious
---------------------------------------------------------------------------

`AgencyStationIdentifier` looks like the station code and holds it for 98 of the
123 Active San Diego rows. On the other 25 it is null and the code is in
`Station_Name` -- including FM-090 and IB-069, which spots.json binds to
blacks-beach and silver-strand. Reading the obvious column would have dropped
both from the pool and silently matched those spots to a station further away.

Where both are present they agree on every row, and this asserts that rather
than assuming it.

Standard library only.
"""
import argparse
import json
import math
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SPOTS = os.path.join(ROOT, "shared", "spots.json")

UA = {"User-Agent": "socal-coastal-data/0.1 "
                    "(+https://github.com/cweber12/socal-coastal-data) "
                    "county_station re-join"}

# data.ca.gov CKAN, package beach-water-quality-postings-and-closures, resource
# "Beach Water Quality Monitoring Stations". Pinned by id: the package's
# resource ORDER is not stable and picking "the CSV one" would eventually read
# the bacteria results instead.
CKAN = "https://data.ca.gov/api/3/action/datastore_search"
RESOURCE_ID = "98e628ff-d012-4982-ad32-b9f9ad8ab524"
PAGE = 1000

COUNTY = "San Diego"
ACTIVE = "Active"

# Columns read. Every one is asserted present before anything is filtered.
COL_COUNTY = "CountyName"
COL_STATUS = "Status"
COL_NAME = "Station_Name"
COL_AGENCY_ID = "AgencyStationIdentifier"
COL_LAT = "Station_UpperLat"
COL_LON = "Station_UpperLon"
REQUIRED_COLUMNS = (COL_COUNTY, COL_STATUS, COL_NAME, COL_AGENCY_ID, COL_LAT, COL_LON)

# County-wide rollups carrying one coordinate near San Onofre. They are Active
# and they are not places, so a nearest-neighbour that keeps them can bind a
# spot to the whole county.
AGGREGATES = frozenset({"All_SanDiego_County_Beaches", "Northern_SanDiego_County_Beaches"})

# Past this, spots.json flags the match county_station_suspect: the station may
# sit on a different beach cell carrying different water.
SUSPECT_M = 1000

# Distances are compared to the nearest metre with this slack, because the
# committed values were rounded by whatever computed them and a metre of
# disagreement on a 1400 m match is not a finding.
TOLERANCE_M = 5

EARTH_R_M = 6371008.8


def fetch_all():
    """Every row of the resource, following the datastore's own paging."""
    rows, offset, total = [], 0, None
    while True:
        q = urllib.parse.urlencode({"resource_id": RESOURCE_ID, "limit": PAGE, "offset": offset})
        req = urllib.request.Request(f"{CKAN}?{q}", headers=UA)
        payload = json.load(urllib.request.urlopen(req, timeout=120))
        if not payload.get("success"):
            die(f"CKAN returned success=false for resource {RESOURCE_ID}")
        result = payload["result"]
        total = result["total"] if total is None else total
        batch = result["records"]
        rows.extend(batch)
        offset += len(batch)
        # A 200 carrying an empty page is a dead read, not the end of the data.
        if not batch and offset < total:
            die(f"empty page at offset {offset} with {total} rows promised")
        if offset >= total or not batch:
            break
    if len(rows) != total:
        die(f"read {len(rows)} rows against {total} promised")
    return rows


def die(message):
    print(f"county-station: {message}", file=sys.stderr)
    sys.exit(2)


def great_circle_m(lat0, lon0, lat1, lon1):
    p0, p1 = math.radians(lat0), math.radians(lat1)
    dp, dl = math.radians(lat1 - lat0), math.radians(lon1 - lon0)
    h = math.sin(dp / 2) ** 2 + math.cos(p0) * math.cos(p1) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_M * math.asin(math.sqrt(h))


def station_pool(rows):
    """Active, located, individually-named San Diego stations."""
    if rows:
        missing = [c for c in REQUIRED_COLUMNS if c not in rows[0]]
        if missing:
            die(f"the resource no longer carries {', '.join(missing)}. "
                "The join reads those columns by name and will not guess at replacements.")

    san_diego = [r for r in rows if str(r.get(COL_COUNTY) or "").strip() == COUNTY]
    active = [r for r in san_diego if str(r.get(COL_STATUS) or "").strip() == ACTIVE]

    pool, no_coord, agencies_disagree = [], 0, 0
    for r in active:
        name = str(r.get(COL_NAME) or "").strip()
        agency = str(r.get(COL_AGENCY_ID) or "").strip()
        # Asserted rather than assumed: where both columns are populated they
        # must agree, or the code this reports is not the code anyone uses.
        if agency and name and agency != name:
            agencies_disagree += 1
        if not name or name in AGGREGATES:
            continue
        if r.get(COL_LAT) in (None, "") or r.get(COL_LON) in (None, ""):
            no_coord += 1
            continue
        pool.append((name, float(r[COL_LAT]), float(r[COL_LON])))

    if agencies_disagree:
        die(f"{agencies_disagree} rows disagree between {COL_NAME} and {COL_AGENCY_ID}. "
            "Which one is the station code is no longer decidable from the data.")
    if not pool:
        die("the filter produced an empty station pool, which is a dead read and not a county "
            "with no stations")

    return pool, {
        "all_rows": len(rows),
        "san_diego": len(san_diego),
        "active": len(active),
        "active_without_coordinates": no_coord,
        "aggregates_dropped": sum(1 for r in active
                                  if str(r.get(COL_NAME) or "").strip() in AGGREGATES),
        "pool": len(pool),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--verbose", action="store_true", help="print every spot, not only changes")
    args = ap.parse_args()

    spots_file = json.load(open(SPOTS, encoding="utf-8"))
    spots = spots_file["spots"]

    pool, counts = station_pool(fetch_all())

    print(f"shared/spots.json {spots_file['version']} | resource {RESOURCE_ID}")
    print(f"  {counts['all_rows']} rows, {counts['san_diego']} in {COUNTY}, "
          f"{counts['active']} {ACTIVE}, {counts['aggregates_dropped']} county-wide aggregates "
          f"dropped, {counts['active_without_coordinates']} active without a coordinate")
    print(f"  station pool: {counts['pool']}")

    in_scope = [s for s in spots if s["county_station_scope"] == "in"]
    out_scope = [s for s in spots if s["county_station_scope"] == "out"]
    print(f"  scope: {len(in_scope)} in, {len(out_scope)} out, of {len(spots)} spots\n")

    changed = []
    for spot in in_scope:
        code, lat, lon = min(
            pool, key=lambda r: great_circle_m(spot["lat"], spot["lon"], r[1], r[2])
        )
        metres = round(great_circle_m(spot["lat"], spot["lon"], lat, lon))
        suspect = metres > SUSPECT_M

        same = (
            code == spot["county_station"]
            and abs(metres - (spot["county_station_distance_m"] or -1)) <= TOLERANCE_M
            and suspect == spot["county_station_suspect"]
        )
        if not same:
            changed.append((spot, code, metres, suspect))
        if args.verbose or not same:
            mark = "  " if same else "->"
            print(f"{mark} {spot['slug']:22} "
                  f"committed {str(spot['county_station']):8} {spot['county_station_distance_m']:>5} m"
                  f"{' suspect' if spot['county_station_suspect'] else '        '}"
                  f"   re-run {code:8} {metres:>5} m{' suspect' if suspect else ''}")

    # The scope is load-bearing or it is decoration. Saying what the join WOULD
    # have produced for the out-of-scope spots is what shows which.
    print()
    for spot in out_scope:
        code, lat, lon = min(
            pool, key=lambda r: great_circle_m(spot["lat"], spot["lon"], r[1], r[2])
        )
        metres = round(great_circle_m(spot["lat"], spot["lon"], lat, lon))
        print(f"   {spot['slug']:22} OUT OF SCOPE, and not written: "
              f"the join would have bound it to {code} at {metres} m. "
              f"{spot['county_station_null_reason']}")

    print()
    if changed:
        print(f"county-station: {len(changed)} of {len(in_scope)} matches have MOVED.")
        print("  A closer station may have opened, or a coordinate may have been corrected "
              "upstream. Neither is fixed by editing spots.json by hand: decide which, then "
              "re-run and write the join's answer.")
        return 1

    print(f"county-station: all {len(in_scope)} in-scope matches reproduce "
          f"(station code and distance within {TOLERANCE_M} m), "
          f"{len(out_scope)} out of scope and unwritten.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
