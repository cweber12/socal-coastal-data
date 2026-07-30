"""Is there a mapped bench outline already, and does the published pin sit on it?

Issue #80 asks for one coarse Cabrillo polygon -- "a bench outline good to tens
of metres, provenance and uncertainty stated". This probe looks for one that
already exists rather than inventing one, because a traced outline whose
provenance is "I drew it" cannot be perturbed by a stated uncertainty.

OpenStreetMap carries `natural=reef` areas along this corridor. They are traced
from satellite imagery, which is exactly the tens-of-metres class the issue
asks for, and unlike a hand trace they carry a version, a changeset, a mapper
and -- via the changeset's `imagery_used` tag -- the georeferencing they
inherit.

Two outputs:

1. Per spot, the nearest mapped reef area and whether the pin is inside it.
   That is the coarse-locator question in #80 section 1, asked cheaply: if OSM
   already knows where 8 benches are, the locator job is a join and not a
   survey.
2. Full geometry and provenance for the one way selected as the Cabrillo bench,
   which `hypsometry.py` consumes.

**Not an MPA boundary.** #80 puts that out of scope and it is a different
query: `natural=reef` areas are tagged as physical features by mappers, not
legal lines. The Cabrillo State Marine Reserve relation is deliberately not
read here.

Standard library only. Overpass for the sweep, the OSM API for authoritative
per-way geometry and changeset tags.
"""
import json, math, os, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FINDINGS = os.path.join(os.path.dirname(HERE), "findings")

UA = {"User-Agent": "socal-coastal-data-recon/1.0 "
                    "(+https://github.com/cweber12/socal-coastal-data)"}
OVERPASS = "https://overpass-api.de/api/interpreter"
OSM_API = "https://api.openstreetmap.org/api/0.6"

# The 8 spots carrying a tidepool_floor_ft, read from spots.json rather than
# listed, so a spot gaining or losing a floor changes this probe's scope.
SEARCH_RADIUS_M = 1200

# Overpass 504s under load often enough that a single attempt is not a
# measurement. Failure after the retries is reported per spot, never silently
# turned into "no reef here" -- that would read as a measured absence.
ATTEMPTS = 3
BACKOFF_S = 20


def spots():
    d = json.load(open(os.path.join(ROOT, "shared", "spots.json")))
    return [s for s in d["spots"] if s.get("tidepool_floor_ft") is not None]


def post(url, body, attempts=ATTEMPTS):
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, data=body.encode(), headers=UA)
            return urllib.request.urlopen(req, timeout=180).read()
        except Exception as e:                       # noqa: BLE001 - reported
            last = e
            if i + 1 < attempts:
                time.sleep(BACKOFF_S * (i + 1))
    raise last


def get_xml(url):
    req = urllib.request.Request(url, headers=UA)
    return ET.fromstring(urllib.request.urlopen(req, timeout=180).read())


def m_per_deg(lat):
    """Local metres per degree. Good to <0.1% over one spot's neighbourhood."""
    return 111320.0 * math.cos(math.radians(lat)), 110540.0


def dist_m(lat0, lon0, lat1, lon1):
    mx, my = m_per_deg(lat0)
    return math.hypot((lon1 - lon0) * mx, (lat1 - lat0) * my)


def point_in_ring(lat, lon, ring):
    """Ray casting in degree space. The ring closes itself if it does not."""
    inside = False
    n = len(ring)
    for i in range(n):
        y0, x0 = ring[i]
        y1, x1 = ring[(i + 1) % n]
        if (x0 > lon) != (x1 > lon):
            t = (lon - x0) / (x1 - x0)
            if y0 + t * (y1 - y0) > lat:
                inside = not inside
    return inside


def dist_to_ring_m(lat, lon, ring):
    """Distance to the ring's boundary, 0 if inside. Segment-exact."""
    if point_in_ring(lat, lon, ring):
        return 0.0
    mx, my = m_per_deg(lat)
    px, py = 0.0, 0.0
    best = float("inf")
    n = len(ring)
    for i in range(n):
        ay = (ring[i][0] - lat) * my
        ax = (ring[i][1] - lon) * mx
        by = (ring[(i + 1) % n][0] - lat) * my
        bx = (ring[(i + 1) % n][1] - lon) * mx
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
        best = min(best, math.hypot(ax + t * dx - px, ay + t * dy - py))
    return best


def sweep(lat, lon):
    """Every `natural=reef` area within SEARCH_RADIUS_M, with geometry."""
    q = (f"[out:json][timeout:120];"
         f"way(around:{SEARCH_RADIUS_M},{lat},{lon})[natural=reef];"
         f"out geom meta;")
    d = json.loads(post(OVERPASS, q))
    out = []
    for e in d.get("elements", []):
        g = e.get("geometry") or []
        ring = [(p["lat"], p["lon"]) for p in g]
        if len(ring) < 4:
            continue
        out.append({
            "way_id": e["id"], "version": e.get("version"),
            "timestamp": e.get("timestamp"), "changeset": e.get("changeset"),
            "user": e.get("user"), "tags": e.get("tags", {}),
            "nodes": len(ring), "ring": ring,
        })
    return out


def way_full(way_id):
    """Authoritative geometry from the OSM API, not the Overpass snapshot."""
    root = get_xml(f"{OSM_API}/way/{way_id}/full")
    nodes = {n.get("id"): (float(n.get("lat")), float(n.get("lon")))
             for n in root.findall("node")}
    w = root.find("way")
    refs = [nd.get("ref") for nd in w.findall("nd")]
    return {
        "way_id": int(w.get("id")), "version": int(w.get("version")),
        "timestamp": w.get("timestamp"), "changeset": int(w.get("changeset")),
        "user": w.get("user"),
        "tags": {t.get("k"): t.get("v") for t in w.findall("tag")},
        "closed": refs[0] == refs[-1],
        "ring": [nodes[r] for r in refs],
    }


def changeset(cs_id):
    root = get_xml(f"{OSM_API}/changeset/{cs_id}")
    c = root.find("changeset")
    return {"id": int(c.get("id")), "created_at": c.get("created_at"),
            "user": c.get("user"),
            "tags": {t.get("k"): t.get("v") for t in c.findall("tag")}}


def main():
    out = {
        "read_date": "2026-07-29",
        "issue": 80,
        "source": "OpenStreetMap (ODbL). Overpass for the sweep, "
                  "api.openstreetmap.org/api/0.6 for per-way geometry.",
        "query": f"way(around:{SEARCH_RADIUS_M},<pin>)[natural=reef]; out geom meta;",
        "what_this_is_not": "Not an MPA boundary and not derived from one. "
                            "natural=reef is a mapper's physical trace; #80 "
                            "puts legal boundaries out of scope.",
        "spots": {},
    }

    for s in spots():
        slug, lat, lon = s["slug"], s["lat"], s["lon"]
        try:
            reefs = sweep(lat, lon)
        except Exception as e:                       # noqa: BLE001 - reported
            out["spots"][slug] = {"lat": lat, "lon": lon,
                                  "error": f"{type(e).__name__}: {e}"}
            print(slug, "ERROR", e, flush=True)
            continue
        rows = []
        for r in reefs:
            d = dist_to_ring_m(lat, lon, r["ring"])
            rows.append({k: r[k] for k in
                         ("way_id", "version", "timestamp", "changeset", "user",
                          "nodes", "tags")} |
                        {"pin_inside": d == 0.0, "pin_to_boundary_m": round(d, 1),
                         "lat_span_m": round((max(p[0] for p in r["ring"]) -
                                              min(p[0] for p in r["ring"])) * 110540.0),
                         "lon_span_m": round((max(p[1] for p in r["ring"]) -
                                              min(p[1] for p in r["ring"])) *
                                             m_per_deg(lat)[0])})
        rows.sort(key=lambda r: r["pin_to_boundary_m"])
        out["spots"][slug] = {"lat": lat, "lon": lon, "reef_areas": len(rows),
                              "nearest_m": rows[0]["pin_to_boundary_m"] if rows else None,
                              "pin_inside_any": any(r["pin_inside"] for r in rows),
                              "areas": rows}
        print(slug, len(rows), "reef areas, nearest",
              rows[0]["pin_to_boundary_m"] if rows else None, "m", flush=True)
        time.sleep(2)                                # Overpass courtesy

    # The Cabrillo way the gate runs on: whichever mapped reef the pin sits in
    # or nearest to. Recorded as a selection, with the alternatives above.
    cab = out["spots"].get("cabrillo-tidepools", {})
    if cab.get("areas"):
        wid = cab["areas"][0]["way_id"]
        w = way_full(wid)
        w["changeset_detail"] = changeset(w["changeset"])
        w["selected_because"] = (
            "Nearest mapped natural=reef area to the cabrillo-tidepools pin; "
            "see spots.cabrillo-tidepools.areas for the ones not chosen.")
        out["cabrillo_bench"] = w
        print("cabrillo bench way", wid, "v%s" % w["version"],
              len(w["ring"]), "nodes,", "imagery:",
              w["changeset_detail"]["tags"].get("imagery_used"), flush=True)

    dest = os.path.join(FINDINGS, "osm-reef-locator.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("wrote", dest)


if __name__ == "__main__":
    main()
