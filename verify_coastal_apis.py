#!/usr/bin/env python3
"""
Endpoint verification for the Oceanside -> Mexican border coastal data stack.

Standard library only. Run:  python3 verify_coastal_apis.py
Optional:                    EBIRD_API_KEY=xxxx python3 verify_coastal_apis.py

Reports per endpoint: HTTP status, latency, payload size, and where possible
the age of the newest observation in the payload. Freshness matters more than
status here -- several of these return 200 with data that stopped updating
months ago.
"""

import concurrent.futures
import datetime as dt
import gzip
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zoneinfo

# NWS requires a descriptive User-Agent with contact info or it rejects you.
UA = "coastal-conditions-verifier/0.1 (you@example.com)"
TIMEOUT = 25
NOW = dt.datetime.now(dt.timezone.utc)

# Some feeds (eBird) stamp observations in the local time of the observation
# with no offset attached. Tagging those UTC makes everything read 7-8h stale.
try:
    PACIFIC = zoneinfo.ZoneInfo("America/Los_Angeles")
except zoneinfo.ZoneInfoNotFoundError:  # no system tzdata (bare Windows/containers)
    PACIFIC = dt.timezone(dt.timedelta(hours=-8))

# Bounding box for the corridor: Oceanside pier down to the border.
NORTH, SOUTH = 33.22, 32.53
WEST, EAST = -117.45, -117.09

# CDIP station / NDBC WMO pairs, north to south.
BUOYS = [
    ("Oceanside Offshore", "045", "46224"),
    ("Leucadia Nearshore", "262", "46274"),
    ("Del Mar Nearshore", "153", "46266"),
    ("Torrey Pines Outer", "100", "46225"),
    ("Scripps Nearshore", "201", "46254"),
    ("Mission Bay West", "220", "46258"),
    ("Point Loma South", "191", "46232"),
    ("Imperial Beach Nearshore", "155", "46235"),
]

# Endpoints confirmed dead at the source, not regressions to chase. They stay
# in the run so we notice if they ever come back, but they do not count as
# failures. Keyed by NDBC WMO id.
DEAD_BUOYS = {
    "46235": "decommissioned; station page is up but serves no realtime2 file",
}

results = []


def fetch(url, headers=None):
    """Return (status, seconds, bytes, body_text_or_None, error_or_None)."""
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    req.add_header("Accept-Encoding", "gzip")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    ctx = ssl.create_default_context()
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            secs = time.perf_counter() - t0
            try:
                text = raw.decode("utf-8", errors="replace")
            except Exception:
                text = None
            return r.status, secs, len(raw), text, None
    except urllib.error.HTTPError as e:
        # Keep the error body: ERDDAP answers "no rows matched" with a 404 whose
        # payload is the only way to tell a data gap from a missing dataset.
        secs = time.perf_counter() - t0
        raw = b""
        text = None
        try:
            raw = e.read()
            if e.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            text = raw.decode("utf-8", errors="replace")
        except Exception:
            pass
        return e.code, secs, len(raw), text, f"HTTP {e.code} {e.reason}"
    except Exception as e:
        return None, time.perf_counter() - t0, 0, None, f"{type(e).__name__}: {e}"


def age_str(when):
    """Humanize how old an observation is."""
    if when is None:
        return "-"
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt.timezone.utc)
    delta = NOW - when
    hours = delta.total_seconds() / 3600
    if hours < 0:
        return f"+{abs(hours):.0f}h (forecast)"
    if hours < 48:
        return f"{hours:.1f}h old"
    return f"{hours / 24:.0f}d old"


def record(name, url, status, secs, size, note="", newest=None, err=None, dead=None):
    """dead: reason this endpoint is known-dead, so a failure here is expected."""
    results.append(
        {
            "name": name,
            "url": url,
            "status": status,
            "secs": secs,
            "size": size,
            "note": note,
            "age": age_str(newest),
            "err": err,
            "dead": dead,
        }
    )


# ---------------------------------------------------------------- checks


def check_nws_points():
    url = "https://api.weather.gov/points/33.1959,-117.3795"
    s, t, n, body, e = fetch(url)
    note = ""
    if body:
        try:
            p = json.loads(body)["properties"]
            note = f"grid {p['gridId']} {p['gridX']},{p['gridY']}"
        except Exception as ex:
            note = f"parse failed: {ex}"
    record("NWS /points (Oceanside)", url, s, t, n, note, err=e)


def check_nws_alerts(zone):
    url = f"https://api.weather.gov/alerts/active?zone={zone}"
    s, t, n, body, e = fetch(url)
    note = ""
    if body:
        try:
            feats = json.loads(body).get("features", [])
            if feats:
                events = {f["properties"]["event"] for f in feats}
                note = f"{len(feats)} active: {', '.join(sorted(events))[:60]}"
            else:
                note = "0 active (valid empty response)"
        except Exception as ex:
            note = f"parse failed: {ex}"
    record(f"NWS alerts {zone}", url, s, t, n, note, err=e)


def check_nws_product(ptype, site="SGX"):
    url = f"https://api.weather.gov/products/types/{ptype}/locations/{site}"
    s, t, n, body, e = fetch(url)
    note, newest = "", None
    if body:
        try:
            items = json.loads(body).get("@graph", [])
            note = f"{len(items)} products"
            if items:
                newest = dt.datetime.fromisoformat(
                    items[0]["issuanceTime"].replace("Z", "+00:00")
                )
        except Exception as ex:
            note = f"parse failed: {ex}"
    record(f"NWS product {ptype}/{site}", url, s, t, n, note, newest, e)


def check_ndbc(label, wmo):
    url = f"https://www.ndbc.noaa.gov/data/realtime2/{wmo}.txt"
    s, t, n, body, e = fetch(url)
    note, newest = "", None
    if body:
        lines = [l for l in body.splitlines() if l and not l.startswith("#")]
        if not lines:
            note = "200 but no data rows -- buoy likely offline"
        else:
            f = lines[0].split()
            try:
                newest = dt.datetime(
                    int(f[0]), int(f[1]), int(f[2]), int(f[3]), int(f[4]),
                    tzinfo=dt.timezone.utc,
                )
                note = f"{len(lines)} rows"
            except Exception as ex:
                note = f"parse failed: {ex}"
    record(f"NDBC {wmo} ({label})", url, s, t, n, note, newest, e, DEAD_BUOYS.get(wmo))


def check_cdip_catalog():
    """Discover real realtime filenames rather than assuming the _rt.nc suffix."""
    url = "https://thredds.cdip.ucsd.edu/thredds/catalog/cdip/realtime/catalog.xml"
    s, t, n, body, e = fetch(url)
    note = ""
    if body:
        names = []
        for chunk in body.split('urlPath="')[1:]:
            names.append(chunk.split('"')[0])
        hits = [x for x in names if any(f"/{c}p1" in x or x.startswith(f"{c}p1")
                                        for _, c, _ in BUOYS)]
        note = f"{len(names)} datasets; {len(hits)} match our stations"
        if hits:
            note += f"; e.g. {hits[0].split('/')[-1]}"
    record("CDIP THREDDS realtime catalog", url, s, t, n, note, err=e)


def check_coops(product, station="9410230", extra=""):
    base = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
    # time_zone=gmt, not lst_ldt: the returned "t" strings carry no offset, so
    # asking for local time and then tagging it UTC made every row read 7h stale.
    q = (
        f"?product={product}&application=verifier&station={station}"
        f"&time_zone=gmt&units=english&format=json{extra}"
    )
    url = base + q
    s, t, n, body, e = fetch(url)
    note, newest = "", None
    if body:
        try:
            d = json.loads(body)
            if "error" in d:
                note = f"API error: {d['error'].get('message', '')[:70]}"
            else:
                rows = d.get("data") or d.get("predictions") or []
                note = f"{len(rows)} rows"
                if rows:
                    ts = rows[-1].get("t")
                    if ts:
                        newest = dt.datetime.strptime(ts, "%Y-%m-%d %H:%M").replace(
                            tzinfo=dt.timezone.utc
                        )
        except Exception as ex:
            note = f"parse failed: {ex}"
    record(f"CO-OPS {product} @{station}", url, s, t, n, note, newest, e)


def check_open_meteo_marine(host, dead=None):
    url = (
        f"https://{host}/v1/marine?latitude=33.19&longitude=-117.40"
        "&hourly=wave_height,wave_period,wave_direction,"
        "swell_wave_height,swell_wave_period,swell_wave_direction"
        "&forecast_days=3&timezone=America%2FLos_Angeles"
    )
    s, t, n, body, e = fetch(url)
    note = ""
    if body:
        try:
            d = json.loads(body)
            if "error" in d or d.get("error"):
                note = f"API error: {str(d.get('reason'))[:70]}"
            else:
                h = d.get("hourly", {})
                vals = [v for v in h.get("wave_height", []) if v is not None]
                note = f"{len(h.get('time', []))} hours, {len(vals)} non-null wave_height"
        except Exception as ex:
            note = f"parse failed: {ex}"
    record(f"Open-Meteo marine ({host})", url, s, t, n, note, err=e, dead=dead)


# Real column names off .../info/HABs-ScrippsPier/index.json. Note the
# capitalised Temp -- the old query asked for "temperature", which does not
# exist on any SCCOOS dataset.
SCCOOS_HAB_COLS = "time,Temp,Salinity,Avg_Chloro,Pseudo_nitzschia_seriata_group"


def check_sccoos_habs(dataset="HABs-ScrippsPier", days=30):
    """Scripps Pier HAB grab samples. Weekly, so a 3-day window returns nothing.

    Station is keyed by Location_Code here, not the "station" column the old
    query filtered on -- and with one site per dataset it needs no filter.
    """
    since = (NOW - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = (
        f"https://erddap.sccoos.org/erddap/tabledap/{dataset}.json"
        f"?{SCCOOS_HAB_COLS}&time%3E={since}"
    )
    s, t, n, body, e = fetch(url)
    note, newest = "", None
    if s == 404 and body and "no matching results" in body:
        e = f"HTTP 404: query valid, no samples in last {days}d"
    elif body:
        try:
            rows = json.loads(body)["table"]["rows"]
            note = f"{len(rows)} samples/{days}d"
            if rows:
                newest = dt.datetime.fromisoformat(rows[-1][0].replace("Z", "+00:00"))
                if rows[-1][1] is not None:
                    note += f", {rows[-1][1]}C"
        except Exception as ex:
            note = f"parse failed: {ex}"
    record(f"SCCOOS ERDDAP {dataset}", url, s, t, n, note, newest, e)


def check_sccoos_live_datasets(days=30):
    """Replaces the old autoss probe -- that dataset is gone from this ERDDAP.

    Rather than hardcode another ID that may be retired next, ask the catalog
    which datasets are still updating and flag if none serve our corridor.
    """
    since = (NOW - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = (
        "https://erddap.sccoos.org/erddap/tabledap/allDatasets.json"
        f"?datasetID,maxTime&maxTime%3E={since}"
    )
    s, t, n, body, e = fetch(url)
    note, newest = "", None
    if body:
        try:
            rows = [r for r in json.loads(body)["table"]["rows"] if r[1]]
            note = f"{len(rows)} datasets updated <{days}d"
            ours = [r for r in rows if "Scripps" in r[0] or "delmar" in r[0]]
            if ours:
                note += "; corridor: " + ", ".join(r[0] for r in ours)
                newest = max(
                    dt.datetime.fromisoformat(r[1].replace("Z", "+00:00")) for r in ours
                )
            else:
                note += "; NONE in our corridor"
        except Exception as ex:
            note = f"parse failed: {ex}"
    record("SCCOOS ERDDAP live datasets", url, s, t, n, note, newest, e)


# Tijuana River valley, Nestor down to the border. 11013500 (TIJUANA R NR
# NESTOR CA) is the right site number and the right river -- but its series
# catalog has no unit-value series at all, and daily discharge stopped on
# 1982-09-29. Nothing else in this box publishes realtime discharge either;
# the live Tijuana gauge is run by the IBWC, not USGS. Probe the box rather
# than a dead site number, so this lights up if USGS ever restores one.
TIJUANA_BBOX = "-117.20,32.52,-116.90,32.62"


def check_usgs_discharge_bbox(label, bbox):
    url = (
        "https://waterservices.usgs.gov/nwis/iv/?format=json"
        f"&bBox={bbox}&parameterCd=00060"
    )
    s, t, n, body, e = fetch(url)
    note, newest = "", None
    if body:
        try:
            series = json.loads(body)["value"]["timeSeries"]
            if not series:
                note = "NO realtime discharge gauge in box (11013500 retired 1982)"
            else:
                sites, stamps = [], []
                for ser in series:
                    sites.append(ser["sourceInfo"]["siteCode"][0]["value"])
                    vals = ser["values"][0]["value"]
                    if vals:
                        stamps.append(dt.datetime.fromisoformat(vals[-1]["dateTime"]))
                note = f"{len(series)} gauges: " + ", ".join(sites[:4])
                if stamps:
                    newest = max(stamps)
        except Exception as ex:
            note = f"parse failed: {ex}"
    record(f"USGS discharge bbox ({label})", url, s, t, n, note, newest, e)


def check_usgs_iv(label, site):
    """Realtime discharge at one gauge."""
    url = (
        "https://waterservices.usgs.gov/nwis/iv/?format=json"
        f"&sites={site}&parameterCd=00060"
    )
    s, t, n, body, e = fetch(url)
    note, newest = "", None
    if body:
        try:
            series = json.loads(body)["value"]["timeSeries"]
            if not series:
                note = "no timeseries -- gauge discontinued or wrong parameter"
            else:
                name = series[0]["sourceInfo"]["siteName"]
                vals = series[0]["values"][0]["value"]
                note = f"{name[:34]} | {len(vals)} pts"
                if vals:
                    newest = dt.datetime.fromisoformat(vals[-1]["dateTime"])
                    note += f" | {vals[-1]['value']} cfs"
        except Exception as ex:
            note = f"parse failed: {ex}"
    record(f"USGS IV {site} ({label})", url, s, t, n, note, newest, e)


def check_usgs_new_api():
    url = "https://api.waterdata.usgs.gov/ogcapi/v0/collections?f=json"
    s, t, n, body, e = fetch(url)
    note = ""
    if body:
        try:
            cols = json.loads(body).get("collections", [])
            note = f"{len(cols)} collections available"
        except Exception as ex:
            note = f"parse failed: {ex}"
    record("USGS OGC API (new)", url, s, t, n, note, err=e)


def check_inaturalist():
    since = (NOW - dt.timedelta(days=14)).strftime("%Y-%m-%d")
    url = (
        "https://api.inaturalist.org/v1/observations?"
        f"nelat={NORTH}&nelng={EAST}&swlat={SOUTH}&swlng={WEST}"
        f"&d1={since}&per_page=5&order_by=observed_on&verifiable=true"
    )
    s, t, n, body, e = fetch(url)
    note, newest = "", None
    if body:
        try:
            d = json.loads(body)
            note = f"{d.get('total_results', 0)} obs in bbox/14d"
            # time_observed_at carries a real offset, so no tz guessing needed --
            # but results[0] is not the newest. order_by=observed_on sorts by date
            # only, and hand-entered times are routinely in the future. Take the
            # newest observation that isn't ahead of the clock.
            stamps = [
                dt.datetime.fromisoformat(r["time_observed_at"])
                for r in d.get("results", [])
                if r.get("time_observed_at")
            ]
            sane = [x for x in stamps if x <= NOW]
            if sane:
                newest = max(sane)
            if len(sane) < len(stamps):
                note += f" ({len(stamps) - len(sane)} future-dated)"
        except Exception as ex:
            note = f"parse failed: {ex}"
    record("iNaturalist observations", url, s, t, n, note, newest, e)


def check_ebird():
    key = os.environ.get("EBIRD_API_KEY")
    url = "https://api.ebird.org/v2/data/obs/US-CA-073/recent?back=3&maxResults=5"
    if not key:
        record("eBird US-CA-073", url, None, 0.0, 0, "skipped: set EBIRD_API_KEY")
        return
    s, t, n, body, e = fetch(url, {"X-eBirdApiToken": key})
    note, newest = "", None
    if body:
        try:
            obs = json.loads(body)
            note = f"{len(obs)} recent obs"
            if obs:
                # obsDt is local time at the observation, offset omitted.
                newest = dt.datetime.fromisoformat(obs[0]["obsDt"]).replace(
                    tzinfo=PACIFIC
                )
        except Exception as ex:
            note = f"parse failed: {ex}"
    record("eBird US-CA-073", url, s, t, n, note, newest, e)


def check_ca_beach_ckan():
    url = (
        "https://data.ca.gov/api/3/action/package_show"
        "?id=beach-water-quality-postings-and-closures"
    )
    s, t, n, body, e = fetch(url)
    note = ""
    if body:
        try:
            d = json.loads(body)
            res = d["result"]["resources"]
            note = f"{len(res)} resources | ids: " + ", ".join(
                r["id"][:8] for r in res[:3]
            )
        except Exception as ex:
            note = f"parse failed: {ex}"
    record("data.ca.gov CKAN package", url, s, t, n, note, err=e)


def check_sunrise():
    url = "https://api.sunrise-sunset.org/json?lat=32.87&lng=-117.26&formatted=0"
    s, t, n, body, e = fetch(url)
    note = ""
    if body:
        try:
            note = json.loads(body)["results"]["sunrise"][:19] + " UTC sunrise"
        except Exception as ex:
            note = f"parse failed: {ex}"
    record("sunrise-sunset.org", url, s, t, n, note, err=e)


# ---------------------------------------------------------------- runner

CHECKS = [
    check_nws_points,
    lambda: check_nws_alerts("PZZ740"),
    lambda: check_nws_alerts("PZZ745"),
    lambda: check_nws_alerts("CAZ043"),
    lambda: check_nws_product("SRF"),
    lambda: check_nws_product("CWF"),
    check_cdip_catalog,
    lambda: check_coops("water_temperature", "9410230", "&date=latest"),
    lambda: check_coops("water_level", "9410230", "&date=latest&datum=MLLW"),
    lambda: check_coops(
        "predictions", "9410230",
        "&datum=MLLW&interval=hilo&begin_date="
        + NOW.strftime("%Y%m%d") + "&range=168",
    ),
    lambda: check_coops("water_level", "9410170", "&date=latest&datum=MLLW"),
    lambda: check_open_meteo_marine("marine-api.open-meteo.com"),
    lambda: check_open_meteo_marine(
        "api.open-meteo.com",
        dead="/v1/marine is served only by the marine-api host",
    ),
    check_sccoos_live_datasets,
    check_sccoos_habs,
    lambda: check_usgs_discharge_bbox("Tijuana valley", TIJUANA_BBOX),
    lambda: check_usgs_iv("San Luis Rey @ Oceanside", "11042000"),
    check_usgs_new_api,
    check_inaturalist,
    check_ebird,
    check_ca_beach_ckan,
    check_sunrise,
]
CHECKS += [lambda l=l, w=w: check_ndbc(l, w) for l, _, w in BUOYS]


def main():
    print(f"Probing {len(CHECKS)} endpoints at {NOW.isoformat(timespec='seconds')}\n")
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda f: f(), CHECKS))

    w = max(len(r["name"]) for r in results) + 2
    print(f"{'ENDPOINT':<{w}} {'STAT':<7} {'MS':>6} {'AGE':>14}  NOTE")
    print("-" * (w + 80))
    ok = warn = bad = dead = 0
    for r in sorted(results, key=lambda x: x["name"]):
        failed = bool(r["err"]) or (r["status"] and r["status"] >= 400)
        detail = r["err"] or r["note"]
        if failed and r["dead"]:
            mark, dead = "DEAD", dead + 1
            detail = r["dead"]
        elif failed:
            mark, bad = "FAIL", bad + 1
        elif r["dead"]:
            # Marked dead but answering. Worth a look -- either it came back or
            # the reason we wrote it off no longer holds.
            mark, ok = "REVIVED", ok + 1
        elif r["status"] is None:
            mark, warn = "SKIP", warn + 1
        else:
            mark, ok = str(r["status"]), ok + 1
        print(
            f"{r['name']:<{w}} {mark:<7} {r['secs'] * 1000:>6.0f} "
            f"{r['age']:>14}  {detail[:70]}"
        )

    print(f"\n{ok} ok, {warn} skipped, {dead} known-dead, {bad} failed")
    print(
        "\nFreshness beats status. Anything reading days old on a realtime feed\n"
        "is a dead station, not a working endpoint.\n"
        "\nOne thing this script cannot verify for you:\n"
        "  San Diego County DEHQ beach advisories. Open sdbeachinfo.com with\n"
        "  devtools on the network tab, find the ArcGIS FeatureServer URL it\n"
        "  calls, then append /query?where=1%3D1&outFields=*&f=geojson.\n"
        "  Undocumented, so pin the layer id and add a schema-drift alarm.\n"
        "\nAnd one gap no endpoint closes: there is no realtime USGS discharge\n"
        "for the Tijuana River. 11013500 is the correct site and river, but it\n"
        "stopped publishing in 1982 and no other USGS gauge in the valley has\n"
        "replaced it. The live gauge there is IBWC's, on a separate feed.\n"
    )
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
