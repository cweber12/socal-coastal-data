"""What does CA_SCRIPPS_APR_2005 declare about itself, and what does it not?

`lidar-recon/` read seven products for #80 and every one of them is a derived
DEM raster. This is the first POINT CLOUD the recon has looked at: 43 legacy LAZ
tiles staged under `Elevation/LPC/Projects/legacy/CA_SCRIPPS_APR_2005/`.

Two questions, both answered from a single 375-byte range read per tile:

1. WHAT IS THE VERTICAL DATUM? The answer is that the file does not say. The
   GeoKeyDirectory carries GTModelType, GTRasterType and ProjectedCSType and
   nothing else -- keys 4096-4099 (VerticalCSType, VerticalCitation,
   VerticalDatum, VerticalUnits) are ABSENT. The FGDC metadata is no better:
   `<spref>` holds `<horizsys>` only, with no `<vertdef>`, and the whole 11.6 kB
   file contains no occurrence of NAVD, NGVD, geoid, ellipsoid, meters or feet.

   This is `../README.md` hazard 1 repeating, one notch worse. For product 8684
   the datum was at least a sibling's claim. Here neither the container nor the
   sidecar asserts anything.

   **This probe reports the absence. It does not fill it in.** An undeclared
   datum is not an invitation to assume the common one. What it was eventually
   established as, and how, is in `scripps2005_cabrillo_tie.py`.

2. IS ACQUISITION TIME RECOVERABLE? Point format decides it. Formats 0 and 2
   carry no GPS time at all. This file is format 1, so the time is there --
   but global encoding bit 0 is 0, meaning GPS WEEK time, which fixes
   day-of-week and time-of-day absolutely and leaves the calendar week open.
   `scripps2005_gpstime.py` reads it; the week comes from the FGDC metadata.

The file creation date is deliberately NOT trusted: it reads year 1970, day 1
on every tile, which is an unset field rather than a date.

Related: `lasheader.py` does the same job for LAS 1.4 COPC and is not reused,
because this is LAS 1.1 with a different header size and a GeoKey VLR rather
than a WKT VLR. `geokeys.py` reads GeoTIFF tag 34735 out of a raster; this
reads the same key structure out of a LAS VLR.

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
UA = {"User-Agent": "socal-coastal-data lidar-recon (stdlib probe)"}

# GeoTIFF key ids that would declare a vertical reference. Their ABSENCE is the
# finding, so they are named here rather than looked up only when present.
VERTICAL_KEYS = {4096: "VerticalCSType", 4097: "VerticalCitation",
                 4098: "VerticalDatum", 4099: "VerticalUnits"}
KEY_NAMES = {1024: "GTModelType", 1025: "GTRasterType",
             2048: "GeographicType", 3072: "ProjectedCSType", **VERTICAL_KEYS}

# The corridor box in UTM 11N metres, Oceanside Harbor to Border Field. Matches
# the AOI the download used; tiles are reported in or out, never filtered away.
CORRIDOR_X = (458000.0, 492500.0)
CORRIDOR_Y = (3600900.0, 3675700.0)


def get(url, rng=None, timeout=90):
    h = dict(UA)
    if rng:
        h["Range"] = "bytes=%d-%d" % rng
    with urllib.request.urlopen(urllib.request.Request(url, headers=h),
                                timeout=timeout) as r:
        return r.read()


def public_header(b):
    """LAS public header block. Offsets are identical across LAS 1.0-1.4."""
    if b[:4] != b"LASF":
        raise ValueError("not a LAS/LAZ file")
    doy, year = struct.unpack_from("<HH", b, 90)
    hdr_size, = struct.unpack_from("<H", b, 94)
    pt_offset, = struct.unpack_from("<I", b, 96)
    n_vlr, = struct.unpack_from("<I", b, 100)
    fmt_byte = b[104]
    n, = struct.unpack_from("<I", b, 107)
    maxx, minx, maxy, miny, maxz, minz = struct.unpack_from("<dddddd", b, 179)
    global_enc, = struct.unpack_from("<H", b, 6)
    return {
        "las_version": "%d.%d" % (b[24], b[25]),
        "global_encoding": global_enc,
        # Bit 0 clear means GPS Week Time: absolute time-of-day and
        # day-of-week, ambiguous calendar week.
        "gps_time_type": ("adjusted_standard_absolute" if global_enc & 1
                          else "gps_week_time_ambiguous_week"),
        "point_format": fmt_byte & 0x3F,
        "laz_compressed": bool(fmt_byte & 0x80),
        # Formats 0 and 2 carry no GPS time field at all.
        "carries_gps_time": (fmt_byte & 0x3F) in (1, 3, 4, 5, 6, 7, 8, 9, 10),
        "point_record_length": struct.unpack_from("<H", b, 105)[0],
        "point_count": n,
        "header_size": hdr_size,
        "point_data_offset": pt_offset,
        "vlr_count": n_vlr,
        # Unset on every tile in this product: year 1970, day 1. Recorded so a
        # reader can see it was checked and rejected, not overlooked.
        "file_creation_year": year,
        "file_creation_doy": doy,
        "file_creation_is_unset": (year, doy) in ((0, 0), (1970, 1)),
        "bbox_utm11n": {"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy},
        "z_range": {"min": minz, "max": maxz},
    }


def geokeys(url, hdr_size, pt_offset, n_vlr):
    """Walk the VLRs and return every GeoTIFF key present, by name."""
    if pt_offset <= hdr_size:
        return {"vlrs": [], "keys": {}, "vertical_keys_present": []}
    blob = get(url, (hdr_size, pt_offset - 1))
    vlrs, keys, off = [], {}, 0
    for _ in range(n_vlr):
        if off + 54 > len(blob):
            break
        user = blob[off + 2:off + 18].split(b"\x00")[0].decode("latin1")
        rec_id, = struct.unpack_from("<H", blob, off + 18)
        length, = struct.unpack_from("<H", blob, off + 20)
        desc = blob[off + 22:off + 54].split(b"\x00")[0].decode("latin1")
        vlrs.append({"user_id": user, "record_id": rec_id,
                     "length": length, "description": desc})
        body = blob[off + 54:off + 54 + length]
        if rec_id == 34735 and len(body) >= 8:      # GeoKeyDirectoryTag
            n_keys, = struct.unpack_from("<H", body, 6)
            for k in range(n_keys):
                if 8 + k * 8 + 8 > len(body):
                    break
                kid, loc, cnt, val = struct.unpack_from("<HHHH", body, 8 + k * 8)
                keys[kid] = {"name": KEY_NAMES.get(kid, "unknown"),
                             "tiff_tag_location": loc, "count": cnt,
                             "value": val}
        off += 54 + length
    return {"vlrs": vlrs, "keys": {str(k): v for k, v in keys.items()},
            "vertical_keys_present": sorted(k for k in keys if k in VERTICAL_KEYS)}


def intersects_corridor(bb):
    return not (bb["maxx"] < CORRIDOR_X[0] or bb["minx"] > CORRIDOR_X[1] or
                bb["maxy"] < CORRIDOR_Y[0] or bb["miny"] > CORRIDOR_Y[1])


def main():
    urls = sorted(u.strip() for u in get(LINKS).decode().splitlines()
                  if u.strip().lower().endswith(".laz"))
    print("%d tiles listed in the project" % len(urls))

    tiles, unreachable = {}, []
    for u in urls:
        name = u.rsplit("/", 1)[-1]
        tid = name.rsplit("_", 1)[-1].replace(".laz", "")
        try:
            b = get(u, (0, 374))
            h = public_header(b)
        except Exception as e:
            # 000012 returns HTTP 404. Recorded, never skipped silently: a tile
            # that cannot be read is not a tile that holds nothing.
            unreachable.append({"tile": tid, "error": "%s" % e})
            print("  ! %s unreachable: %s" % (tid, e))
            continue
        h.update(geokeys(u, h["header_size"], h["point_data_offset"],
                         h["vlr_count"]))
        h["in_corridor"] = intersects_corridor(h["bbox_utm11n"])
        tiles[tid] = h
        print("  %s  LAS %s  fmt %d  n=%-12s vert-keys %s  %s"
              % (tid, h["las_version"], h["point_format"],
                 "{:,}".format(h["point_count"]),
                 h["vertical_keys_present"] or "NONE",
                 "corridor" if h["in_corridor"] else "-"))

    in_corr = [t for t, h in tiles.items() if h["in_corridor"]]
    any_vert = [t for t, h in tiles.items() if h["vertical_keys_present"]]
    out = {
        "probe": os.path.basename(__file__),
        "product": "USGS LPC CA_SCRIPPS_APR_2005 (legacy)",
        "base_url": BASE,
        "tiles_listed": len(urls),
        "tiles_read": len(tiles),
        "tiles_unreachable": unreachable,
        "tiles_in_corridor": sorted(in_corr),
        "vertical_datum": {
            "declared_in_any_tile": bool(any_vert),
            "tiles_declaring_vertical_keys": sorted(any_vert),
            "conclusion": ("No tile declares a vertical datum. GeoKeys 4096-4099 "
                           "are absent everywhere and the FGDC metadata carries "
                           "no <vertdef>. This probe reports the absence and "
                           "does not fill it in."),
        },
        "tiles": tiles,
    }
    dst = os.path.join(ROOT, "findings", "scripps2005-headers.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print("\n%d tiles intersect the corridor" % len(in_corr))
    print("vertical GeoKeys present in %d of %d tiles" % (len(any_vert), len(tiles)))
    print("wrote %s" % dst)
    return 0 if tiles else 1


if __name__ == "__main__":
    sys.exit(main())
