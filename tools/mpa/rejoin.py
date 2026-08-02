"""Re-run the `mpa` point-in-polygon join and diff it against spots.json.

`mpa` is an upstream join, and this repo's rule for one is that a wrong value is
fixed by fixing the join and re-running it, never by hand. That rule was
unsatisfiable until this script: the join had been run once, and no record of HOW
survived it. `grep -r ds582` returned four sentences of prose and not one URL, so
nobody who had not run it could re-run it.

    python tools/mpa/rejoin.py            # diff, exit 1 on any change
    python tools/mpa/rejoin.py --verbose  # every spot, inside a polygon or not

Exit codes: 0 the committed record reproduces, 1 the upstream and the file
disagree -- either the join answers differently or the layer has been re-issued,
2 the upstream is not the shape this was written against.

---------------------------------------------------------------------------
What is pinned, and what is only reported
---------------------------------------------------------------------------

PINNED, and a mismatch is a hard stop: the service URL, the four attributes the
join reads, the corridor envelope, and the set of `Type` values the layer
publishes for this corridor. A join that guesses at a renamed attribute produces
a plausible-looking wrong designation for a legally load-bearing field.

REPORTED, never fatal: the corridor feature count and the per-area table. CDFW
may add or retire an area, and that is the upstream doing its job.

EXIT 1, because a human has to decide: any spot whose join result moved, and any
drift in the layer's own vintage. The second is not cosmetic -- `lastEditDate`
moving means the polygons this repo resolved against are not the polygons the
service now serves, whether or not any of these 26 coordinates noticed.

---------------------------------------------------------------------------
Two dates, and neither one is "the pull date"
---------------------------------------------------------------------------

The layer description states the data are California's MPAs "as January 1,
2019", while `editingInfo.lastEditDate` is 2024-01-09. Content date and service
edit date are five years apart. Recording one and calling it the layer's age
misrepresents it in whichever direction you picked, so both are committed and
both are checked.

---------------------------------------------------------------------------
The type is an attribute, and it is deliberately not parsed from the name
---------------------------------------------------------------------------

Every corridor area's NAME happens to end in its type -- "Cabrillo SMR",
"Swami's SMCA". Reading the type off the name would work today and is the rule
this repo forbids: `Type` is what the authority publishes, and deriving it by
string-matching a display name is hand-populating it in a different costume.

`CCR` and `CCR_Int` carry the same subsection in two forms, and this asserts they
agree rather than assuming it -- the same check `tools/county-station/rejoin.py`
runs on Station_Name against AgencyStationIdentifier.

Standard library only.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SPOTS = os.path.join(ROOT, "shared", "spots.json")

UA = {"User-Agent": "socal-coastal-data/0.1 "
                    "(+https://github.com/cweber12/socal-coastal-data) "
                    "mpa re-join"}

# CDFW California Marine Protected Areas [ds582], the authoritative polygons.
# Pinned by full service path: the ArcGIS Hub item id resolves to this, but Hub
# search results are ranked and picking "the MPA one" would eventually read a
# different state's layer.
LAYER = ("https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/"
         "biosds582_fpu/FeatureServer/0")

# Attributes read. Every one is asserted present before anything is queried.
ATTR_NAME = "NAME"
ATTR_TYPE = "Type"
ATTR_CCR = "CCR"
ATTR_CCR_INT = "CCR_Int"
REQUIRED_ATTRS = (ATTR_NAME, ATTR_TYPE, ATTR_CCR, ATTR_CCR_INT)

# The whole corridor: Oceanside Harbor down to Border Field, with margin. The
# inventory spans 32.539-33.208 N and -117.394 to -117.124 W, and this contains
# it, which is asserted below -- a spot added outside it fails loudly rather than
# silently dropping out of the corridor area list.
#
# It reaches well north of the northernmost MPA on purpose. Batiquitos (137) is
# at 33.09 and this runs to 33.30, so the query covers the Oceanside stretch as
# well; it still returns exactly 11 areas, which is what "there is no MPA between
# the Oceanside city line and Batiquitos Lagoon" looks like when it is measured
# rather than quoted.
ENVELOPE = (-117.50, 32.45, -117.05, 33.30)


def die(message):
    print(f"mpa: {message}", file=sys.stderr)
    sys.exit(2)


def get(url, params=None):
    """One request. A 200 carrying an ArcGIS error body is a failed read."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=UA)
    payload = json.load(urllib.request.urlopen(req, timeout=120))
    if "error" in payload:
        die(f"service returned 200 with an error body: "
            f"{json.dumps(payload['error'])[:300]}")
    return payload


def layer_metadata():
    meta = get(LAYER, {"f": "json"})
    present = {f["name"] for f in meta.get("fields", [])}
    missing = [a for a in REQUIRED_ATTRS if a not in present]
    if missing:
        die(f"the layer no longer carries {', '.join(missing)}. The join reads those "
            "attributes by name and will not guess at replacements.")
    editing = meta.get("editingInfo") or {}
    if "lastEditDate" not in editing:
        die("the layer no longer publishes editingInfo.lastEditDate, which is the "
            "only in-band signal that the polygons have been re-issued.")
    return meta, editing


def epoch_ms_to_date(ms):
    """UTC calendar date. The layer publishes milliseconds since the epoch."""
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def query(params):
    base = {"returnGeometry": "false", "f": "json", "inSR": "4326"}
    base.update(params)
    return get(LAYER + "/query", base).get("features", [])


def corridor_areas():
    """Every MPA in the corridor envelope, by CCR subsection."""
    west, south, east, north = ENVELOPE
    feats = query({
        "where": "1=1",
        "geometry": f"{west},{south},{east},{north}",
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": ",".join(REQUIRED_ATTRS),
    })
    areas = []
    for f in feats:
        a = f["attributes"]
        ccr, ccr_int = str(a.get(ATTR_CCR) or ""), a.get(ATTR_CCR_INT)
        # The two forms of the subsection must agree, or which one identifies the
        # area is no longer decidable from the data.
        if ccr_int is None or str(ccr_int) not in ccr:
            die(f"{a.get(ATTR_NAME)}: {ATTR_CCR} {ccr!r} does not contain "
                f"{ATTR_CCR_INT} {ccr_int!r}. The subsection is no longer decidable.")
        areas.append({
            "name": a[ATTR_NAME],
            "type": a[ATTR_TYPE],
            "ccr": ccr,
            "ccr_int": int(ccr_int),
        })
    areas.sort(key=lambda x: x["ccr_int"])
    return areas


def area_at(lat, lon):
    """Point-in-polygon. None where the point falls outside every MPA."""
    feats = query({
        "where": "1=1",
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": ",".join(REQUIRED_ATTRS),
    })
    if not feats:
        return None
    if len(feats) > 1:
        # MPAs in this corridor do not overlap. If two ever do, the join has to
        # say which one it wrote and why, and that is a decision not a default.
        names = ", ".join(sorted(f["attributes"][ATTR_NAME] for f in feats))
        die(f"point {lat},{lon} falls inside {len(feats)} polygons ({names}). "
            "The join writes one name and cannot choose between them.")
    a = feats[0]["attributes"]
    return {"name": a[ATTR_NAME], "type": a[ATTR_TYPE], "ccr_int": int(a[ATTR_CCR_INT])}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--verbose", action="store_true",
                    help="print every spot, not only the ones that moved")
    args = ap.parse_args()

    spots_file = json.load(open(SPOTS, encoding="utf-8"))
    spots = spots_file["spots"]
    recorded = spots_file["joins"]["mpa"]

    meta, editing = layer_metadata()
    live_edit = epoch_ms_to_date(editing["lastEditDate"])
    live_version = meta.get("currentVersion")

    print(f"shared/spots.json {spots_file['version']} | {recorded['layer']}")
    print(f"  service      {recorded['service_url']}")
    print(f"  content date {recorded['content_date']} (stated in the layer description)")
    print(f"  last edited  {live_edit} live, {recorded['layer_last_edit_date']} recorded")
    print(f"  version      {live_version} live, {recorded['service_version']} recorded")
    print(f"  pulled       {recorded['retrieved']}")

    vintage_moved = []
    if live_edit != recorded["layer_last_edit_date"]:
        vintage_moved.append(f"lastEditDate {recorded['layer_last_edit_date']} -> {live_edit}")
    if live_version != recorded["service_version"]:
        vintage_moved.append(f"currentVersion {recorded['service_version']} -> {live_version}")

    areas = corridor_areas()
    types_live = sorted({a["type"] for a in areas})
    types_recorded = sorted(recorded["types_published"])

    print(f"\n  {len(areas)} MPAs in the corridor envelope, "
          f"CCR {areas[0]['ccr_int']}-{areas[-1]['ccr_int']}")
    if args.verbose:
        for a in areas:
            print(f"    {a['ccr_int']:>4}  {a['name']:<34} {a['type']}")
    print(f"  types published: {', '.join(types_live)}")

    if types_live != types_recorded:
        die(f"the corridor's Type domain is {types_live}, and this repo records "
            f"{types_recorded}. shared/spots.generated.ts emits that set as a union and "
            "core/components/spot-protection.tsx branches on it, so a new designation is "
            "a rendering this repo has not been told how to write.")

    # Every spot must sit inside the envelope, or the corridor summary above is
    # describing a different stretch of coast from the one being joined.
    west, south, east, north = ENVELOPE
    outside = [s["slug"] for s in spots
               if not (west <= s["lon"] <= east and south <= s["lat"] <= north)]
    if outside:
        die(f"{len(outside)} spots fall outside the pinned envelope ({', '.join(outside)}). "
            "Widen ENVELOPE deliberately, or the corridor area list is incomplete.")

    print()
    changed, inside = [], 0
    for spot in spots:
        live = area_at(spot["lat"], spot["lon"])
        if live:
            inside += 1
        same = (
            (live["name"] if live else None) == spot["mpa"]
            and (live["type"] if live else None) == spot["mpa_type"]
            and (live["ccr_int"] if live else None) == spot["ccr_section"]
        )
        if not same:
            changed.append((spot, live))
        if args.verbose or not same:
            mark = "  " if same else "->"
            committed = (f"{spot['mpa']} ({spot['mpa_type']}, {spot['ccr_section']})"
                         if spot["mpa"] else "outside every polygon")
            answer = (f"{live['name']} ({live['type']}, {live['ccr_int']})"
                      if live else "outside every polygon")
            print(f"{mark} {spot['slug']:<22} committed {committed:<42} re-run {answer}")

    print(f"\n  {inside} of {len(spots)} spots inside a polygon; "
          f"{sum(1 for s in spots if not s['mpa_resolved'])} carry mpa_resolved false")

    # Every area a spot resolves into has to be one the envelope enumerated, or
    # the corridor list above describes a different stretch of coast from the one
    # the spots were joined against -- and types_published would be measured over
    # the wrong set.
    corridor_sections = {a["ccr_int"] for a in areas}
    stray = sorted({s["ccr_section"] for s in spots
                    if s["ccr_section"] is not None and s["ccr_section"] not in corridor_sections})
    if stray:
        die(f"spots resolve into § 632(b) {stray}, which the corridor envelope did not return. "
            "The area list and the join disagree about where the corridor is.")

    if changed or vintage_moved:
        print()
        for line in vintage_moved:
            print(f"mpa: the layer's own vintage moved -- {line}")
        if vintage_moved:
            print("  The polygons served today are not the ones this file resolved against. "
                  "Re-read the layer description for a new content date and update joins.mpa, "
                  "even if every binding below still reproduces.")
        if changed:
            print(f"mpa: {len(changed)} of {len(spots)} bindings have MOVED.")
            print("  A boundary may have been re-issued, or a coordinate corrected. Neither is "
                  "fixed by editing spots.json by hand: decide which, then re-run and write "
                  "the join's answer. A binding that moves is legally load-bearing.")
        return 1

    print(f"\nmpa: all {len(spots)} bindings reproduce, and the layer's vintage is unchanged "
          f"({live_edit}, v{live_version}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
