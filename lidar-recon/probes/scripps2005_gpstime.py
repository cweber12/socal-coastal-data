"""When was each tile actually flown, read from the point records?

`scripps2005_header.py` establishes that this product carries GPS time (point
format 1) but on GPS WEEK time (global encoding bit 0 clear) -- seconds since
Sunday 00:00 of a week the file does not name. So the point records give
day-of-week and time-of-day ABSOLUTELY, and the calendar week comes from the
FGDC metadata, which declares acquisition `begdate 20050404` to
`enddate 20050408`.

That range contains exactly one Monday and one Friday, which is what makes this
determinate.

HOW THIS IS READ WITHOUT A DECOMPRESSOR. In a LAZ file the point data begins
with an 8-byte chunk-table offset, and the first point of each chunk is stored
UNCOMPRESSED before the arithmetic-coded residuals begin. So point 0 costs a
28-byte range request and no laszip.

  Point format 1, 28 bytes:
    0  X i32     4  Y i32     8  Z i32    12 Intensity u16
    14 flags u8  15 class u8  16 scan i8  17 user u8
    18 src u16   20 GPS time f64

GPS-UTC was 13 s throughout 2005 (TAI-UTC 32, GPS = TAI - 19). April 2005 is
PDT, UTC-7.

WHY NOT THE FILE CREATION DATE: it reads year 1970, day 1 on every tile. That
is an unset field, not a date, and `scripps2005_header.py` records it as such.

A METHOD NOTE WORTH KEEPING. Before the metadata was fetched, an attempt was
made to pin the week by asking which Monday/Friday pair had BOTH sorties on
their day's low. That favoured the week of 18 April and was wrong. Tide-timing
inference looked convincing; the metadata contradicted it. The elimination that
is trustworthy is in `scripps2005_acquisition_tide.py`, and it runs AFTER the
week is known rather than trying to determine it.

Standard library only.
"""
import json
import os
import struct
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BASE = ("https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/"
        "LPC/Projects/legacy/CA_SCRIPPS_APR_2005/")
LINKS = BASE + "0_file_download_links.txt"
META = BASE + "metadata/USGS_LPC_CA_SCRIPPS_APR_2005_%s.xml"
UA = {"User-Agent": "socal-coastal-data lidar-recon (stdlib probe)"}

GPS_MINUS_UTC_2005 = 13          # seconds, constant across 2005
PDT_OFFSET_HOURS = -7            # April 2005
DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

CORRIDOR_X = (458000.0, 492500.0)
CORRIDOR_Y = (3600900.0, 3675700.0)


def get(url, rng=None, timeout=90):
    h = dict(UA)
    if rng:
        h["Range"] = "bytes=%d-%d" % rng
    with urllib.request.urlopen(urllib.request.Request(url, headers=h),
                                timeout=timeout) as r:
        return r.read()


def first_point_gps(url):
    """GPS time of point 0, from the raw seed point of the first LAZ chunk."""
    b = get(url, (0, 374))
    if b[:4] != b"LASF":
        raise ValueError("not LAS")
    pt_offset, = struct.unpack_from("<I", b, 96)
    fmt_byte = b[104]
    if (fmt_byte & 0x3F) != 1:
        raise ValueError("point format %d, expected 1" % (fmt_byte & 0x3F))
    maxx, minx, maxy, miny, _, _ = struct.unpack_from("<dddddd", b, 179)
    # LAZ: skip the 8-byte chunk table offset; the chunk's first point is raw.
    start = pt_offset + (8 if fmt_byte & 0x80 else 0)
    p = get(url, (start, start + 27))
    if len(p) < 28:
        raise ValueError("short point read (%d B)" % len(p))
    gps, = struct.unpack_from("<d", p, 20)
    return gps, {"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy}


def decode_week_time(sow):
    """Seconds-of-week -> day-of-week plus UTC and local time-of-day."""
    if not 0 <= sow < 604800:
        return None
    day = int(sow // 86400)
    rem = sow - day * 86400 - GPS_MINUS_UTC_2005      # GPS -> UTC
    if rem < 0:
        rem += 86400
        day = (day - 1) % 7
    local = (rem + PDT_OFFSET_HOURS * 3600) % 86400
    return {
        "seconds_of_week": sow,
        "day_of_week": DOW[day],
        "utc_time": "%02d:%02d:%05.2f" % (rem // 3600, (rem % 3600) // 60,
                                          rem % 60),
        "local_pdt": "%02d:%02d" % (local // 3600, (local % 3600) // 60),
        "utc_minutes": rem / 60.0,
    }


def acquisition_range(tile_id):
    """begdate/enddate from the per-tile FGDC metadata."""
    try:
        x = get(META % tile_id).decode("utf-8", "replace")
    except Exception as e:
        return {"error": "%s" % e}
    out = {}
    for tag in ("begdate", "enddate"):
        i = x.find("<%s>" % tag)
        if i >= 0:
            out[tag] = x[i + len(tag) + 2:x.find("</%s>" % tag, i)].strip()
    return out


def main():
    urls = sorted(u.strip() for u in get(LINKS).decode().splitlines()
                  if u.strip().lower().endswith(".laz"))
    tiles, failed = {}, []
    for u in urls:
        name = u.rsplit("/", 1)[-1]
        tid = name.rsplit("_", 1)[-1].replace(".laz", "")
        try:
            gps, bb = first_point_gps(u)
        except Exception as e:
            failed.append({"tile": tid, "error": "%s" % e})
            print("  ! %s: %s" % (tid, e))
            continue
        t = decode_week_time(gps)
        in_corr = not (bb["maxx"] < CORRIDOR_X[0] or bb["minx"] > CORRIDOR_X[1] or
                       bb["maxy"] < CORRIDOR_Y[0] or bb["miny"] > CORRIDOR_Y[1])
        tiles[tid] = {"gps_week_seconds": gps, "in_corridor": in_corr,
                      "decoded": t}
        print("  %s  %s  %s  %s UTC  %s PDT  %s"
              % (tid, "corridor" if in_corr else "-       ",
                 t["day_of_week"], t["utc_time"], t["local_pdt"],
                 "%.1f" % gps))

    corridor = {k: v for k, v in tiles.items() if v["in_corridor"]}
    others = {k: v for k, v in tiles.items() if not v["in_corridor"]}

    def sortie(group):
        if not group:
            return None
        mins = [v["decoded"]["utc_minutes"] for v in group.values()]
        days = sorted({v["decoded"]["day_of_week"] for v in group.values()})
        return {"tiles": len(group), "days_of_week": days,
                "utc_start": "%02d:%02d" % (min(mins) // 60, min(mins) % 60),
                "utc_end": "%02d:%02d" % (max(mins) // 60, max(mins) % 60),
                "duration_minutes": round(max(mins) - min(mins), 1)}

    meta = acquisition_range(sorted(corridor)[0]) if corridor else {}
    out = {
        "probe": os.path.basename(__file__),
        "product": "USGS LPC CA_SCRIPPS_APR_2005 (legacy)",
        "gps_time_type": "GPS week time (global encoding bit 0 clear)",
        "gps_minus_utc_seconds_2005": GPS_MINUS_UTC_2005,
        "read_method": ("First point of the first LAZ chunk is stored "
                        "uncompressed after the 8-byte chunk table offset, so "
                        "point 0 costs a 28-byte range read and no laszip."),
        "acquisition_range_from_fgdc": meta,
        "corridor_sortie": sortie(corridor),
        "other_sortie": sortie(others),
        "resolution": ("The FGDC range 20050404-20050408 contains exactly one "
                       "Monday and one Friday, so the corridor sortie is "
                       "Monday 4 April 2005 and the other is Friday 8 April, "
                       "which lands on the metadata's own enddate."),
        "tiles_failed": failed,
        "tiles": tiles,
    }
    dst = os.path.join(ROOT, "findings", "scripps2005-gpstime.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print("\ncorridor sortie: %s" % out["corridor_sortie"])
    print("other sortie   : %s" % out["other_sortie"])
    print("fgdc range     : %s" % meta)
    print("wrote %s" % dst)
    return 0 if tiles else 1


if __name__ == "__main__":
    sys.exit(main())
