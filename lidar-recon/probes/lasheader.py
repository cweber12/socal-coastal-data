"""Read the LAS public header block out of a remote (COPC) LAZ via one range
request. Gives bbox, Z range, point count and file creation date -- enough to
confirm which swath covers a spot without downloading 120-370 MB."""
import struct, datetime, json
from probe_dem import rng

def las_header(url):
    b=rng(url,0,374)
    assert b[:4]==b"LASF", b[:4]
    h={}
    h["version"]=f"{b[24]}.{b[25]}"
    h["system_id"]=b[26:58].split(b"\0")[0].decode("ascii","replace").strip()
    h["software"]=b[58:90].split(b"\0")[0].decode("ascii","replace").strip()
    doy,yr=struct.unpack("<HH",b[90:94])
    h["creation_doy"],h["creation_year"]=doy,yr
    if yr and doy:
        h["creation_date"]=(datetime.date(yr,1,1)+datetime.timedelta(days=doy-1)).isoformat()
    h["point_format"]=b[104]
    h["legacy_point_count"]=struct.unpack("<I",b[107:111])[0]
    sx,sy,sz=struct.unpack("<3d",b[131:155])
    ox,oy,oz=struct.unpack("<3d",b[155:179])
    mxx,mnx,mxy,mny,mxz,mnz=struct.unpack("<6d",b[179:227])
    h.update({"scale":[sx,sy,sz],"offset":[ox,oy,oz],
              "minx":mnx,"maxx":mxx,"miny":mny,"maxy":mxy,"minz":mnz,"maxz":mxz})
    if h["version"]=="1.4":
        h["point_count_1_4"]=struct.unpack("<Q",rng(url,247,254))[0]
    return h

if __name__=="__main__":
    SPOTS={"swamis":(33.035,-117.293),"cardiff-reef":(33.017,-117.283),
     "torrey-pines-beach":(32.933,-117.256),"la-jolla-shores":(32.857,-117.257),
     "la-jolla-cove":(32.850,-117.272),"windansea":(32.832,-117.280),
     "sunset-cliffs":(32.723,-117.256),"cabrillo-tidepools":(32.669,-117.245)}
    SW={"swamis":("20140830",13),"cardiff-reef":("20140830",13),
        "torrey-pines-beach":("20140828",11),"la-jolla-shores":("20140828",9),
        "la-jolla-cove":("20140828",9),"windansea":("20140828",9),
        "sunset-cliffs":("20140828",6),"cabrillo-tidepools":("20140828",5)}
    B="https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/laz/geoid18/4912/"
    out={}
    for slug,(dt,n) in SW.items():
        url=f"{B}{dt}_ncmp_ca_{n:02d}.copc.laz"
        h=las_header(url); lat,lon=SPOTS[slug]
        inside = h["minx"]<=lon<=h["maxx"] and h["miny"]<=lat<=h["maxy"]
        out[slug]={"url":url,**h,"spot_inside_swath_bbox":inside}
        print(f"{slug:20s} swath {n:02d} {dt}  created={h.get('creation_date')} "
              f"LAS{h['version']} pts={h.get('point_count_1_4') or h['legacy_point_count']:,}")
        print(f"{'':20s}   bbox lon[{h['minx']:.4f},{h['maxx']:.4f}] lat[{h['miny']:.4f},{h['maxy']:.4f}] "
              f"z[{h['minz']:.2f},{h['maxz']:.2f}]  spot inside: {inside}")
    json.dump(out,open("las_headers.json","w"),indent=1)
