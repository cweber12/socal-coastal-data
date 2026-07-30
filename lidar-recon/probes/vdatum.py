import json, urllib.request, urllib.parse, time
SPOTS=[("swamis",33.035,-117.293),("cardiff-reef",33.017,-117.283),
 ("torrey-pines-beach",32.933,-117.256),("la-jolla-shores",32.857,-117.257),
 ("la-jolla-cove",32.850,-117.272),("windansea",32.832,-117.280),
 ("sunset-cliffs",32.723,-117.256),("cabrillo-tidepools",32.669,-117.245)]
API="https://vdatum.noaa.gov/vdatumweb/api/convert"
def conv(**kw):
    u=API+"?"+urllib.parse.urlencode(kw)
    for a in (0,1,2):
        try:
            with urllib.request.urlopen(u,timeout=120) as r: return u,json.load(r)
        except Exception as e:
            if a==2: return u,{"error":f"{type(e).__name__}: {e}"}
            time.sleep(2)
out={}
print(f"{'spot':20s} {'MLLW us_ft':>11s} {'unc ft':>7s} {'MLLW m':>8s} {'g12b us_ft':>11s} {'delta':>7s}")
for slug,lat,lon in SPOTS:
    base=dict(region="westcoast",s_x=lon,s_y=lat,s_z=0,
              s_h_frame="NAD83_2011",s_coor="geo",
              s_v_frame="NAVD88",s_v_unit="m",s_v_geoid="geoid18",
              t_h_frame="IGS14",t_v_frame="MLLW",t_v_unit="us_ft")
    u1,r1=conv(**base)
    b2=dict(base); b2["t_v_unit"]="m";  u2,r2=conv(**b2)
    b3=dict(base); b3["s_v_geoid"]="geoid12b"; u3,r3=conv(**b3)
    b4=dict(base); b4["t_v_unit"]="ft"; u4,r4=conv(**b4)
    def f(r,k="t_z"):
        try: return float(r[k])
        except Exception: return None
    d = None
    if f(r1) is not None and f(r3) is not None: d=round(f(r1)-f(r3),4)
    out[slug]={"lat":lat,"lon":lon,
      "navd88_geoid18_to_mllw_usft":{"request":u1,"response":r1},
      "navd88_geoid18_to_mllw_m":{"request":u2,"response":r2},
      "navd88_geoid12b_to_mllw_usft":{"request":u3,"response":r3},
      "navd88_geoid18_to_mllw_intft":{"request":u4,"response":r4},
      "geoid18_minus_geoid12b_usft":d}
    print(f"{slug:20s} {str(f(r1)):>11s} {str(f(r1,'uncertainty')):>7s} "
          f"{str(f(r2)):>8s} {str(f(r3)):>11s} {str(d):>7s}")
    time.sleep(0.5)
json.dump(out,open("vdatum_out.json","w"),indent=1)
