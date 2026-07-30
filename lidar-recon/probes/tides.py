"""Lowest predicted tide inside each DEM acquisition window at 9410230.
A green-laser campaign can only see reef that was out of the water when the
aircraft passed. This bounds what each campaign could possibly have caught.
Predictions, MLLW ft, station 9410230 (San Diego) -- the station spots.json binds."""
import json, urllib.request, urllib.parse
WINDOWS={
 "9488 2009 NCMP Topobathy DEM":("20090930","20091028"),
 "5189 2014 NCMP Topobathy DEM":("20140908","20141005"),
 "2616/8684 2009-2011 merged":("20090101","20110101"),
 "6260 2016 USGS El Nino DEM":("20160428","20160528"),
 "13968 2014-2015 USGS QL2 San Diego":("20141027","20150217"),
}
API="https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
out={}
print(f"{'dataset':36s} {'n_lows':>6s} {'min_ft':>7s} {'#<=0.0':>7s} {'#<=0.7':>7s} {'#<=1.3':>7s}")
for lbl,(b,e) in WINDOWS.items():
    p=dict(product="predictions",datum="MLLW",station="9410230",begin_date=b,end_date=e,
           interval="hilo",units="english",time_zone="lst_ldt",format="json",
           application="socal-coastal-data-recon")
    u=API+"?"+urllib.parse.urlencode(p)
    with urllib.request.urlopen(u,timeout=120) as r: d=json.load(r)
    pr=d.get("predictions") or []
    lows=[float(x["v"]) for x in pr if x.get("type")=="L"]
    rec={"request":u,"n_predictions":len(pr),"n_lows":len(lows),
         "min_low_ft":min(lows) if lows else None,
         "lows_le_0_0":sum(1 for v in lows if v<=0.0),
         "lows_le_0_7":sum(1 for v in lows if v<=0.7),
         "lows_le_1_3":sum(1 for v in lows if v<=1.3)}
    out[lbl]=rec
    print(f"{lbl:36s} {rec['n_lows']:6d} {rec['min_low_ft']:7.2f} "
          f"{rec['lows_le_0_0']:7d} {rec['lows_le_0_7']:7d} {rec['lows_le_1_3']:7d}")
json.dump(out,open("tides_out.json","w"),indent=1)
