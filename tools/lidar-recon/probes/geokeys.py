"""Read GeoTIFF GeoKeys over HTTP range requests. Stdlib only.
Pins the vertical datum from the raster itself rather than from a sidecar."""
import struct, urllib.request, sys, json

GK={1024:"GTModelType",1025:"GTRasterType",1026:"GTCitation",2048:"GeographicType",
 2049:"GeogCitation",2052:"GeogLinearUnits",2054:"GeogAngularUnits",
 3072:"ProjectedCSType",3073:"PCSCitation",3076:"ProjLinearUnits",
 4096:"VerticalCSType",4097:"VerticalCitation",4098:"VerticalDatum",4099:"VerticalUnits"}
UNITS={9001:"metre",9002:"foot",9003:"US survey foot",9014:"fathom"}
TYPESZ={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,16:8,17:8,18:8}

def rng(url,a,b):
    r=urllib.request.Request(url,headers={"Range":f"bytes={a}-{b}"})
    with urllib.request.urlopen(r,timeout=120) as f: return f.read()

def read_tiff_tags(url):
    head=rng(url,0,16)
    en="<" if head[:2]==b"II" else ">"
    ver=struct.unpack(en+"H",head[2:4])[0]
    big = ver==43
    if big:
        offsz=struct.unpack(en+"H",head[4:6])[0]
        ifd=struct.unpack(en+"Q",head[8:16])[0]
    else:
        ifd=struct.unpack(en+"I",head[4:8])[0]
    # read IFD
    if big:
        nb=rng(url,ifd,ifd+7); n=struct.unpack(en+"Q",nb)[0]
        entsz=20; base=ifd+8
    else:
        nb=rng(url,ifd,ifd+1); n=struct.unpack(en+"H",nb)[0]
        entsz=12; base=ifd+2
    raw=rng(url,base,base+n*entsz-1)
    tags={}
    for i in range(n):
        e=raw[i*entsz:(i+1)*entsz]
        if big:
            tag,typ=struct.unpack(en+"HH",e[:4]); cnt=struct.unpack(en+"Q",e[4:12])[0]; voff=e[12:20]
            inline = TYPESZ.get(typ,1)*cnt <= 8
            val = voff if inline else struct.unpack(en+"Q",voff)[0]
        else:
            tag,typ=struct.unpack(en+"HH",e[:4]); cnt=struct.unpack(en+"I",e[4:8])[0]; voff=e[8:12]
            inline = TYPESZ.get(typ,1)*cnt <= 4
            val = voff if inline else struct.unpack(en+"I",voff)[0]
        tags[tag]=(typ,cnt,val,inline)
    return en,big,tags

def fetch_val(url,en,typ,cnt,val,inline):
    sz=TYPESZ.get(typ,1)*cnt
    data = val[:sz] if inline else rng(url,val,val+sz-1)
    if typ==3: return list(struct.unpack(en+"%dH"%cnt,data))
    if typ==12: return list(struct.unpack(en+"%dd"%cnt,data))
    if typ==2: return data.decode("ascii","replace")
    if typ==4: return list(struct.unpack(en+"%dI"%cnt,data))
    return data

def geokeys(url):
    en,big,tags=read_tiff_tags(url)
    out={"bigtiff":big,"endian":en,"width":None,"height":None,"geokeys":{},"ascii":None}
    for t,k in ((256,"width"),(257,"height")):
        if t in tags:
            typ,cnt,val,inl=tags[t]; out[k]=fetch_val(url,en,typ,cnt,val,inl)[0]
    if 34737 in tags:
        typ,cnt,val,inl=tags[34737]; out["ascii"]=fetch_val(url,en,typ,cnt,val,inl)
    doubles=None
    if 34736 in tags:
        typ,cnt,val,inl=tags[34736]; doubles=fetch_val(url,en,typ,cnt,val,inl)
    if 34735 not in tags: return out
    typ,cnt,val,inl=tags[34735]
    d=fetch_val(url,en,typ,cnt,val,inl)
    nk=d[3]
    for i in range(nk):
        kid,loc,c,off=d[4+i*4:8+i*4]
        name=GK.get(kid,f"key{kid}")
        if loc==0: v=off
        elif loc==34737 and out["ascii"] is not None: v=out["ascii"][off:off+c].rstrip("|\x00")
        elif loc==34736 and doubles: v=doubles[off:off+c]
        else: v=f"<loc {loc}>"
        if name.endswith("Units") and isinstance(v,int): v=f"{v} ({UNITS.get(v,'?')})"
        out["geokeys"][name]=v
    if 33550 in tags:
        typ,cnt,val,inl=tags[33550]; out["pixel_scale"]=fetch_val(url,en,typ,cnt,val,inl)
    return out

if __name__=="__main__":
    targets=json.load(open(sys.argv[1]))
    res={}
    for label,url in targets.items():
        try:
            g=geokeys(url); res[label]=g
            print(f"\n### {label}")
            print(f"    {url.split('/')[-1]}  {g['width']}x{g['height']}  bigtiff={g['bigtiff']}")
            for k,v in g["geokeys"].items(): print(f"    {k:20s} = {v}")
            if "pixel_scale" in g: print(f"    pixel_scale          = {g['pixel_scale']}")
        except Exception as e:
            print(f"\n### {label}\n    ERROR {type(e).__name__}: {e}")
            res[label]={"error":str(e)}
    json.dump(res,open("geokeys_out.json","w"),indent=1)
