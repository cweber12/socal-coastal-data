"""What was the water doing while the corridor was lased?

`scripps2005_gpstime.py` pins the corridor sortie to Monday 4 April 2005,
19:19-20:45 UTC. This asks what the sea was at that moment, because a near-IR
laser returns nothing through water: the water level during acquisition is the
hard floor of everything the product can ever say about the intertidal.

TWO DELIBERATE CHOICES.

1. OBSERVED, NOT PREDICTED. `tides.py` in this directory uses the CO-OPS
   predictions product, which is the right call for bounding what a campaign
   COULD have caught. This is a different question -- what the laser actually
   saw -- so it reads `product=water_level`, the verified observation. #104
   measures predictions drifting off the 1983-2001 datum epoch at +2.02 mm/yr
   at this station, which is exactly the error an astronomical prediction would
   inject here.

2. ALL FOUR CANDIDATE MONDAYS ARE QUERIED AND RECORDED, including the three
   that fail. The date is already determined by the FGDC metadata, so this is
   not how the answer is found -- it is how a reader checks the answer rather
   than the conclusion. A finding that shows only the surviving candidate asks
   to be trusted.

`time_zone=gmt` is passed explicitly. The flight window is already UTC, so
nothing is converted and no offset is assumed. lib/tide.ts carries the long
version of why that parameter is never left to a default.

Standard library only.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
STATION = "9410230"                      # La Jolla (Scripps Pier)
CANDIDATES = ["20050404", "20050411", "20050418", "20050425"]
DETERMINED = "20050404"                  # from the FGDC begdate/enddate range
FLIGHT_UTC_MINUTES = (19 * 60 + 19, 20 * 60 + 45)
UA = {"User-Agent": "socal-coastal-data lidar-recon (stdlib probe)"}

# The eight floors in force, ft above MLLW, for context only. NOTHING here sets
# or promotes any of them.
FLOORS_FT = {"swamis": 0.0, "sunset-cliffs": 0.25, "la-jolla-shores": 0.8,
             "torrey-pines-beach": 0.9, "cardiff-reef": 1.0, "windansea": 1.0,
             "cabrillo-tidepools": 1.0, "la-jolla-cove": 1.1}


def water_level(date):
    q = urllib.parse.urlencode({
        "product": "water_level", "application": "socal-coastal-data",
        "begin_date": date, "end_date": date, "datum": "MLLW",
        "station": STATION, "time_zone": "gmt", "units": "english",
        "format": "json",
    })
    with urllib.request.urlopen(
            urllib.request.Request(BASE + "?" + q, headers=UA),
            timeout=90) as r:
        return json.loads(r.read())


def main():
    out = {}
    for d in CANDIDATES:
        try:
            payload = water_level(d)
        except Exception as e:
            out[d] = {"error": "%s" % e}
            print("  %s  ! %s" % (d, e))
            continue
        if "error" in payload:
            out[d] = {"error": payload["error"].get("message", payload["error"])}
            print("  %s  ! %s" % (d, out[d]["error"]))
            continue
        rows = [r for r in payload.get("data", []) if r.get("v") not in (None, "")]
        if not rows:
            out[d] = {"error": "no observations returned"}
            print("  %s  ! no observations" % d)
            continue
        allv = [float(r["v"]) for r in rows]
        win = [float(r["v"]) for r in rows
               if FLIGHT_UTC_MINUTES[0]
               <= int(r["t"][11:13]) * 60 + int(r["t"][14:16])
               <= FLIGHT_UTC_MINUTES[1]]
        rec = {
            "observations": len(rows),
            "in_flight_window": len(win),
            "day_low_ft_mllw": min(allv),
            "day_high_ft_mllw": max(allv),
        }
        if win:
            rec.update({
                "window_min_ft_mllw": min(win),
                "window_max_ft_mllw": max(win),
                "above_day_low_ft": round(min(win) - min(allv), 3),
            })
        out[d] = rec
        print("  %s  window %+.2f..%+.2f ft  day low %+.2f  above low %+.2f%s"
              % (d, rec.get("window_min_ft_mllw", float("nan")),
                 rec.get("window_max_ft_mllw", float("nan")),
                 rec["day_low_ft_mllw"], rec.get("above_day_low_ft", float("nan")),
                 "   <-- DETERMINED BY METADATA" if d == DETERMINED else ""))

    d = out.get(DETERMINED, {})
    lo = d.get("window_min_ft_mllw")
    hi = d.get("window_max_ft_mllw")
    above = ([s for s, f in sorted(FLOORS_FT.items(), key=lambda kv: kv[1])
              if hi is not None and f > hi])
    result = {
        "probe": os.path.basename(__file__),
        "station": STATION,
        "station_name": "La Jolla (Scripps Pier)",
        "product": "water_level (OBSERVED, not predictions)",
        "datum": "MLLW",
        "time_zone_requested": "gmt",
        "corridor_sortie_utc": "19:19-20:45 on the acquisition Monday",
        "determined_date": DETERMINED,
        "determined_by": ("FGDC begdate 20050404 / enddate 20050408 contains "
                          "exactly one Monday. The other candidates are "
                          "recorded so the elimination can be checked."),
        "candidates": out,
        "still_water_during_sortie_ft_mllw": [lo, hi],
        "floors_above_still_water": above,
        "not_claimed": [
            "Still water is NOT the lowest reliably-lased elevation. Runup "
            "rides on top of it; see scripps2005-acquisition.json for the "
            "swell measured during the sortie and what it implies.",
            "No floor is set, promoted or moved by this probe. FLOORS_FT is "
            "context for reading the water level, nothing more.",
        ],
    }
    dst = os.path.join(ROOT, "findings", "scripps2005-acquisition-tide.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1, sort_keys=True)
    print("\nstill water during the sortie: %s ft MLLW" % result["still_water_during_sortie_ft_mllw"])
    print("floors above it: %s" % (above or "none"))
    print("wrote %s" % dst)
    return 0 if lo is not None else 1


if __name__ == "__main__":
    sys.exit(main())
