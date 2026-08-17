"""Re-derive the eight `cdip` ids in spots.json's `buoys` block from CDIP's own
active-station list, check the live/dead claims against it, and re-derive each
dead buoy's `dead_since` from the deployment file that value names.

The `buoys` block maps every NDBC id to a CDIP id by hand. Eight values, no join
behind them, no recorded retrieval, no re-run path -- the state
`tools/county-station/rejoin.py` and `tools/mpa/rejoin.py` took their bindings
out of, still standing in the same file.

    python tools/cdip-station/rejoin.py            # diff, exit 1 on any change
    python tools/cdip-station/rejoin.py --verbose  # every buoy, moved or not

Exit codes: 0 the committed record reproduces, 1 CDIP and the file disagree --
a live buoy has gone quiet or a DEAD one is answering, 2 the upstream is not the
shape this was written against.

---------------------------------------------------------------------------
NDBC is downstream of CDIP, which is why this asks CDIP
---------------------------------------------------------------------------

CDIP's data-access page states the direction of flow: "Every thirty minutes the
latest measurements from CDIP's buoys are transmitted to the NDBC in FM-13
format." So `ndbc.noaa.gov/data/realtime2/<id>.txt` is a relay, and its 404 is a
fact about the relay before it is a fact about the buoy.

That distinction is not academic here. NDBC 46235 404s and CDIP station 155 was
recovered on 2026-05-03 -- see the archive, and
https://github.com/cweber12/socal-coastal-data/issues/179. A recovered hull does
not resume answering; it gets redeployed, and the redeployment appears at CDIP
first.

WHAT THIS SCRIPT DOES NOT DO is watch for that redeployment. Watching CDIP for a
`155p1` deployment beyond 14 is
https://github.com/cweber12/socal-coastal-data/issues/180 and belongs beside the
other tripwires in `verify_coastal_apis.py`, not here. This script answers
"does the committed record still hold", once, on demand.

---------------------------------------------------------------------------
Why `dead_since` is re-derived here, and `status` is not
---------------------------------------------------------------------------

`status: dead` is INFERRED, and inferred from absence -- a 404, an empty payload,
a row missing from the active list. That is a judgement, and a tool does not
commit one: this script reports the disagreement and exits 1 so a human moves the
field. `dead_since` is PUBLISHED. CDIP states `time_coverage_end` as a global
attribute of the deployment file, so the value is transcribed rather than
decided, which makes it the same kind of thing as `mpa` and `county_station` --
and hand-typing one of those is the violation, not the safeguard. The axis is
docs/adr/0017-published-is-a-join-inferred-is-a-judgement.md.

THE NAMED FILE IS PINNED, NEVER "THE LATEST". The committed value says which
deployment it was read from, and this reads exactly that one. So a future
`155p1_d15` leaves this check green -- "d14 ended 2026-05-03" stays true forever
-- and noticing the d15 remains issue 180's job. The corollary, stated because it
is a real gap and not a design flourish: the committed value's "the fourteenth
and LAST" is NOT verified here. Only the date, its two quoted attributes, and
that the file belongs to this buoy.

A `dead_since` that does not parse as a re-derivable claim is REPORTED, never
fatal. "unknown; realtime2 404 as of 2026-07-27" was an honest answer while
nobody had asked CDIP, and an unstated date cannot be a wrong one. Only a value
claiming to be resolved can fail.

---------------------------------------------------------------------------
What is pinned, and what is only reported
---------------------------------------------------------------------------

PINNED, and a mismatch is a hard stop: the URL, the `<pre>` wrapper, the ten
fields, the three-digit station id, and that no station id appears twice. A
scrape that guesses at a shifted column produces a plausible-looking wrong
mapping, and the whole point of the mapping is that a human never typed it.

PINNED, and this is the check that earns the script: THE PUBLISHED NAME, not
merely the presence of the id. `045` appearing somewhere in the list is not
evidence that `045` is Oceanside Offshore -- every id in the file is a real CDIP
station, so a transposed pair would pass a presence check and bind a spot to the
wrong water. The name is compared after normalisation, stated below.

REPORTED, never fatal: row counts, each buoy's published position, and its
distance to the nearest spot that binds it. Positions are not in spots.json, so
there is nothing to diff them against -- they are printed so the 8-to-40 km
spread `core/zones/surf.ts` discloses can be read off a run rather than
recalled. When the registry in
https://github.com/cweber12/socal-coastal-data/issues/105 has somewhere to put
them, they become a diff.

EXIT 1, because a human decides: a live buoy absent from the list, or a DEAD one
present in it. The second is the REVIVED signal in its weakest form -- it means
the station is answering again, which either happened or means the reason it was
written off no longer holds. Both need a human.

---------------------------------------------------------------------------
Field 6 has no unit, and this script refuses to give it one
---------------------------------------------------------------------------

The feed is ten tab-separated fields and labels none of them. Eight are legible
from their values. Field 6 is not, and the temptation is to read it as
centimetres -- which makes Point Loma South 1049.8 m and Del Mar Nearshore
17.0 m, and both of those are right for those buoys.

That inference is strong enough to be dangerous. It is the IBWC
cubic-metres-per-second problem in its exact shape: not a wrong unit, a correct
unit with an unrecorded conversion behind it. So the raw integer is carried
verbatim, no conversion is written, and CLAUDE.md's rule holds -- convert only
on an exact unit-string match, and there is no unit string.

Asked upstream as open question 1 of
https://github.com/cweber12/socal-coastal-data/issues/177.

---------------------------------------------------------------------------
The timestamp carries no offset either
---------------------------------------------------------------------------

`08.16.2026-01:30:00` states no zone. Read at 18:30 Pacific it is consistent
with UTC, and CDIP publishes UTC in its netCDF, but this feed asserts nothing.
`core/feeds/coops-predictions.ts` refuses a default for exactly this -- and it
had a request parameter to declare, where this feed has none.

So the newest timestamp is REPORTED VERBATIM and nothing is derived from it. No
freshness assertion is made, because the only one available would encode the
guess. Open question 2 of the PRD.

Standard library only.
"""
import argparse
import json
import math
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SPOTS = os.path.join(ROOT, "shared", "spots.json")

UA = {"User-Agent": "socal-coastal-data/0.1 "
                    "(+https://github.com/cweber12/socal-coastal-data) "
                    "cdip station re-join"}

# CDIP's active-station summary. Named on their data-access page as the script
# "To get a summary of our active stations including location, wave parameters
# and depth". Pinned by full path: the bare /sccoos.cdip 404s and
# /data_access/ 403s, so neither is a fallback worth trying.
SCCOOS = "https://cdip.ucsd.edu/data_access/sccoos.cdip"
DOCS = "https://cdip.ucsd.edu/m/documents/data_access.html"

# The payload is HTML-wrapped plain text. Both markers are pinned: a feed that
# stops wrapping has changed, and noticing is cheaper than discovering it
# through a row that parses to nine fields.
OPEN_MARKER = "<pre>"
CLOSE_MARKER = "</pre>"

FIELDS = 10
F_TIME, F_STATION, F_NAME, F_LAT, F_LON, F_UNKNOWN6, F_HS, F_PERIOD, F_DIR, F_TEMP = range(FIELDS)

# One archived deployment, on the dodsC path. `.das` is the Dataset Attribute
# Structure: the file's attributes as plain text, which is why no netCDF reader
# and no dependency is needed to read a global attribute out of it.
#
# The archive CATALOG at
# thredds.cdip.ucsd.edu/thredds/catalog/cdip/archive/<station>p1/catalog.xml
# lists the deployments and is deliberately not fetched -- see the docstring.
# Reading it would make this the d15 tripwire, which lives elsewhere.
ARCHIVE_DAS = ("https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/"
               "{station}p1/{station}p1_d{deployment}.nc.das")

# The attribute block the values are read from. SCOPED, not grepped: the three
# keys below are unique in the file today, but a variable-level `date_created` is
# a legitimate thing for CDIP to add, and it would silently shift the read.
GLOBAL_BLOCK = re.compile(r"^\s*NC_GLOBAL\s*\{", re.M)
DAS_STRING_ATTR = re.compile(r'^\s*String\s+(\w+)\s+"(.*)";\s*$', re.M)

# What makes a `dead_since` re-derivable. BOTH are required before anything is
# fetched: the date it claims, and the deployment file it claims to have read it
# from. A value carrying one and not the other is a claim with no provenance, and
# is reported rather than verified against a guess.
DEAD_SINCE_DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})\b")
DEAD_SINCE_FILE = re.compile(r"\b(\d{3})p1_d(\d{2})\.nc\b")

# Attribute values the committed string quotes verbatim, checked against the
# publisher whenever they appear. This is what stops the prose drifting away from
# the date while the date itself still matches.
DEAD_SINCE_QUOTED = re.compile(
    r"\b(time_coverage_end|date_created)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\b")

ISO_Z = "%Y-%m-%dT%H:%M:%SZ"

# Feed names carry a state suffix the committed names do not. Stripped, both
# sides upper-cased, and compared exactly -- never fuzzily. A near-match is how
# a transposed pair survives the check the name comparison exists to be.
NAME_SUFFIX = ", CA"

EARTH_R_M = 6371008.8


def die(message):
    print(f"cdip-station: {message}", file=sys.stderr)
    sys.exit(2)


def great_circle_m(lat0, lon0, lat1, lon1):
    p0, p1 = math.radians(lat0), math.radians(lat1)
    dp, dl = math.radians(lat1 - lat0), math.radians(lon1 - lon0)
    h = math.sin(dp / 2) ** 2 + math.cos(p0) * math.cos(p1) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_M * math.asin(math.sqrt(h))


def fetch_active():
    """Every active station CDIP publishes, keyed by its three-digit id."""
    req = urllib.request.Request(SCCOOS, headers=UA)
    body = urllib.request.urlopen(req, timeout=120).read().decode("utf-8", "replace")

    lines = [ln for ln in body.splitlines() if ln.strip()]
    if not lines or lines[0].strip() != OPEN_MARKER:
        die(f"expected the payload to open with {OPEN_MARKER!r}; got "
            f"{lines[0][:60]!r} if anything. The feed's shape has changed.")
    if lines[-1].strip() != CLOSE_MARKER:
        die(f"expected the payload to close with {CLOSE_MARKER!r}; got "
            f"{lines[-1][:60]!r}. A truncated read is not a shorter station list.")

    rows = lines[1:-1]
    if not rows:
        die("the station list is empty. A 200 carrying no stations is a dead "
            "response, not a network with nothing deployed.")

    stations = {}
    for i, raw in enumerate(rows):
        parts = raw.split("\t")
        if len(parts) != FIELDS:
            die(f"row {i} has {len(parts)} fields, not {FIELDS}. The columns are read by "
                f"position because the feed publishes no header, so a shifted column would "
                f"be read as a different quantity. Row: {raw[:90]!r}")

        sid = parts[F_STATION].strip()
        if len(sid) != 3 or not sid.isdigit():
            die(f"row {i} station id {sid!r} is not the three-digit zero-padded form "
                "spots.json binds. Matching would become a guess about padding.")
        if sid in stations:
            die(f"station {sid} appears twice. 'Present in the active list' stops being "
                "a single fact, and this script's whole answer rests on it.")

        stations[sid] = {
            "id": sid,
            "name": parts[F_NAME].strip(),
            "lat": float(parts[F_LAT]),
            "lon": float(parts[F_LON]),
            # Verbatim. See the module docstring: field 6 has no published unit
            # and this script does not invent one.
            "field6_raw": parts[F_UNKNOWN6].strip(),
            "hs": parts[F_HS].strip(),
            "period": parts[F_PERIOD].strip(),
            "direction": parts[F_DIR].strip(),
            "temp": parts[F_TEMP].strip(),
            "stamp_raw": parts[F_TIME].strip(),
        }

    return stations


def das_global_attrs(text, url):
    """The String attributes of the .das's NC_GLOBAL block, and only that block."""
    opener = GLOBAL_BLOCK.search(text)
    if opener is None:
        die(f"{url} has no NC_GLOBAL block. The .das is not the shape this reads, and "
            "guessing at an unscoped attribute would verify a date against whatever "
            "else happens to carry the name.")

    # Walk to the matching close brace rather than trusting the indentation. The
    # block holds nested DODS {...} groups, so a first-} scan reads short.
    depth, i = 0, opener.end() - 1
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    else:
        die(f"{url}'s NC_GLOBAL block is unterminated. A truncated read is not a file "
            "with fewer attributes.")

    return dict(DAS_STRING_ATTR.findall(text[opener.end():i]))


def fetch_deployment_globals(station, deployment):
    """(url, attrs, error) for one archived deployment. Never raises on a 404."""
    url = ARCHIVE_DAS.format(station=station, deployment=deployment)
    req = urllib.request.Request(url, headers=UA)
    try:
        body = urllib.request.urlopen(req, timeout=120).read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return url, None, f"HTTP {exc.code}"
    except urllib.error.URLError as exc:
        return url, None, f"unreachable ({exc.reason})"
    return url, das_global_attrs(body, url), None


def check_dead_since(ndbc_id, buoy, problems):
    """Re-derive one committed dead_since from the deployment file it names.

    Appends to `problems` (exit 1: a human decides) only when a value that CLAIMS
    to be resolved disagrees with the publisher. An unstated or non-parsing date
    is printed and passed over.
    """
    claim = buoy.get("dead_since")
    if not claim:
        print(f"   {ndbc_id} is marked {buoy['status']} with no dead_since. Nothing to "
              "re-derive -- an unstated date cannot be a wrong one.")
        return

    m_date, m_file = DEAD_SINCE_DATE.match(claim), DEAD_SINCE_FILE.search(claim)
    if not (m_date and m_file):
        print(f"   {ndbc_id} dead_since is not a re-derivable claim, so it is REPORTED "
              f"and not failed: {claim[:64]!r}...")
        print("     A leading ISO date AND a <station>p1_dNN.nc filename are what make "
              "one checkable. This value states no provenance to re-run.")
        return

    claimed_date = m_date.group(1)
    station, deployment = m_file.group(1), m_file.group(2)

    if station != buoy.get("cdip"):
        problems.append((
            ndbc_id,
            f"dead_since names deployment {station}p1_d{deployment}.nc, but the buoy binds "
            f"CDIP {buoy.get('cdip')!r}. The date would be verified against another "
            "station's file, which is worse than not verifying it."))
        return

    url, attrs, error = fetch_deployment_globals(station, deployment)
    if error:
        problems.append((
            ndbc_id,
            f"dead_since names {station}p1_d{deployment}.nc and the archive answers "
            f"{error}. The file the committed date was read from is no longer being "
            f"served: {url}"))
        return

    # The file must be THIS buoy's. Every station's deployments are named the same
    # way, so a transposed station id would otherwise verify a plausible date
    # against the wrong water -- the same failure the name check exists to catch.
    wmo = attrs.get("wmo_id")
    if wmo != ndbc_id:
        problems.append((
            ndbc_id,
            f"{station}p1_d{deployment}.nc publishes wmo_id {wmo!r}, not {ndbc_id}. "
            "Refusing to confirm a death date from another buoy's deployment."))
        return

    end = attrs.get("time_coverage_end")
    if not end:
        die(f"{url} carries no time_coverage_end in NC_GLOBAL. The attribute this "
            "re-derivation rests on is gone, so the check cannot be made -- which is "
            "reported rather than passed.")

    if end[:10] != claimed_date:
        problems.append((
            ndbc_id,
            f"dead_since claims {claimed_date}; {station}p1_d{deployment}.nc publishes "
            f"time_coverage_end {end}, i.e. {end[:10]}. One side moved."))
        return

    for name, quoted in DEAD_SINCE_QUOTED.findall(claim):
        published = attrs.get(name)
        if published != quoted:
            problems.append((
                ndbc_id,
                f"dead_since quotes {name} {quoted}; {station}p1_d{deployment}.nc "
                f"publishes {published!r}. The date still matches, so this is the prose "
                "drifting off the file it cites."))
            return

    print(f"   {ndbc_id} / cdip {station}  dead_since {claimed_date} reproduces from "
          f"{station}p1_d{deployment}.nc")
    print(f"     time_coverage_end {end}   wmo_id {wmo} confirms the file is this buoy")

    created = attrs.get("date_created")
    if created:
        try:
            hours = (datetime.strptime(created, ISO_Z).replace(tzinfo=timezone.utc)
                     - datetime.strptime(end, ISO_Z).replace(tzinfo=timezone.utc)
                     ).total_seconds() / 3600
            gap = f"archived {hours:.1f} h after it stopped"
        except ValueError:
            gap = f"archived {created}, gap not computable from these two stamps"
        print(f"     {gap} -- REPORTED, never asserted. CDIP publishes no recovery event, "
              "so a short gap is what 'recovered rather than left silent' rests on.")

    print("     NOT CHECKED HERE: that this is still the LAST deployment. A "
          f"{station}p1_d15 is the REVIVED signal, it belongs to "
          "https://github.com/cweber12/socal-coastal-data/issues/180, and this check "
          "stays green when one appears.")


def normalised(name):
    """Upper-cased, state suffix removed. Applied to both sides identically."""
    out = name.strip().upper()
    if out.endswith(NAME_SUFFIX):
        out = out[: -len(NAME_SUFFIX)]
    return out.strip()


def main():
    ap = argparse.ArgumentParser(description="Re-run the CDIP station mapping against spots.json.")
    ap.add_argument("--verbose", action="store_true", help="print every buoy, not only changes")
    args = ap.parse_args()

    spots_file = json.load(open(SPOTS, encoding="utf-8"))
    buoys = spots_file["buoys"]
    spots = spots_file["spots"]

    active = fetch_active()

    print(f"shared/spots.json {spots_file['version']} | {SCCOOS}")
    print(f"  {len(active)} active stations published; {len(buoys)} buoys in the inventory")
    newest = max(s["stamp_raw"] for s in active.values())
    print(f"  newest row stamped {newest} -- VERBATIM: the feed states no offset, "
          "and nothing here derives from it")
    print()

    problems = []
    for ndbc_id in sorted(buoys):
        buoy = buoys[ndbc_id]
        cdip_id = buoy.get("cdip")
        status = buoy["status"]
        if cdip_id is None:
            problems.append((ndbc_id, "carries no cdip id, so there is nothing to re-derive"))
            continue

        row = active.get(cdip_id)
        alive_upstream = row is not None

        if status == "live" and not alive_upstream:
            problems.append((
                ndbc_id,
                f"CDIP {cdip_id} is marked live and is ABSENT from the active list. "
                "Either it has been recovered or the id is wrong."))
        elif status != "live" and alive_upstream:
            problems.append((
                ndbc_id,
                f"CDIP {cdip_id} is marked {status} and is PRESENT in the active list "
                f"as {row['name']!r}. REVIVED: either it came back or the reason it was "
                "written off no longer holds."))
        elif alive_upstream and normalised(row["name"]) != normalised(buoy["name"]):
            problems.append((
                ndbc_id,
                f"CDIP {cdip_id} publishes {row['name']!r}; the file calls it "
                f"{buoy['name']!r}. Presence alone would have passed this -- every id "
                "in the file is a real station, so a transposed pair looks live."))

        if not args.verbose and not any(p[0] == ndbc_id for p in problems):
            continue

        mark = "->" if any(p[0] == ndbc_id for p in problems) else "  "
        if alive_upstream:
            # Nearest spot that binds this buoy, so the distance means something.
            bound = [s for s in spots
                     if ndbc_id in (s["wave"].get("primary"), s["wave"].get("fallback"),
                                    s["wave"].get("intended_primary"))]
            if bound:
                nearest = min(bound, key=lambda s: great_circle_m(
                    s["lat"], s["lon"], row["lat"], row["lon"]))
                km = great_circle_m(nearest["lat"], nearest["lon"], row["lat"], row["lon"]) / 1000
                reach = f"{km:5.1f} km to {nearest['slug']}"
            else:
                reach = "bound to no spot"
            print(f"{mark} {ndbc_id} / cdip {cdip_id}  {row['name']:26} "
                  f"{row['lat']:9.5f} {row['lon']:11.5f}  {reach}")
            print(f"     Hs {row['hs']:>5}  period {row['period']:>6}  dir {row['direction']:>4}"
                  f"  temp {row['temp']:>5}  field6 {row['field6_raw']:>7} (unit unresolved)")
        else:
            print(f"{mark} {ndbc_id} / cdip {cdip_id}  {buoy['name']:26} "
                  f"not in the active list  (file says {status})")

    dead_ids = [i for i in sorted(buoys) if buoys[i]["status"] != "live"]
    if dead_ids:
        print()
        print(f"  dead_since, re-derived from the archive ({len(dead_ids)} dead):")
        for ndbc_id in dead_ids:
            check_dead_since(ndbc_id, buoys[ndbc_id], problems)

    print()
    if problems:
        for ndbc_id, message in problems:
            print(f"cdip-station: {ndbc_id}: {message}")
        print()
        print(f"cdip-station: {len(problems)} of {len(buoys)} buoys DISAGREE with CDIP.")
        print("  Not fixed by editing spots.json until you know which side moved. CDIP's "
              "archive publishes each station's deployment history, and the data-access "
              f"page states NDBC is a relay of it: {DOCS}")
        return 1

    live = sum(1 for b in buoys.values() if b["status"] == "live")
    dead = len(buoys) - live
    rederived = sum(1 for i in buoys if buoys[i]["status"] != "live"
                    and DEAD_SINCE_DATE.match(buoys[i].get("dead_since") or "")
                    and DEAD_SINCE_FILE.search(buoys[i].get("dead_since") or ""))
    print(f"cdip-station: all {len(buoys)} buoys reproduce -- {live} live and present under the "
          f"published name, {dead} marked dead and absent, "
          f"{rederived} of {dead} dead_since re-derived from the deployment file named.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
