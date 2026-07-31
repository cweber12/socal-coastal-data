"""Sample a DEM window around a spot straight out of the published GeoTIFF,
over HTTP range requests. Standard library only.

Purpose: answer "is there DATA on the reef", not "does a tile exist".
Window half-width defaults to 100 m, which is the spots.json coordinate error
bar -- the disc the published coordinate actually admits.
"""
import struct, zlib, math, json, urllib.request, statistics
import http.client, urllib.parse

_CONN={}
def rng(url,a,b):
    """Ranged GET on a kept-alive connection. CoNED needs one read per raster
    row, so a fresh TCP+TLS handshake per row is the difference between
    seconds and minutes."""
    p=urllib.parse.urlsplit(url); key=p.netloc
    for attempt in (0,1):
        c=_CONN.get(key)
        if c is None:
            c=http.client.HTTPSConnection(p.netloc,timeout=180); _CONN[key]=c
        try:
            c.request("GET",p.path+(("?"+p.query) if p.query else ""),
                      headers={"Range":f"bytes={a}-{b}","Host":p.netloc})
            r=c.getresponse(); d=r.read()
            if r.status not in (200,206): raise OSError(f"HTTP {r.status}")
            return d
        except Exception:
            try: c.close()
            except Exception: pass
            _CONN.pop(key,None)
            if attempt: raise

TYPESZ={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,16:8,17:8,18:8}

def tiff_tags(url):
    head=rng(url,0,15)
    en="<" if head[:2]==b"II" else ">"
    big=struct.unpack(en+"H",head[2:4])[0]==43
    ifd=struct.unpack(en+"Q",head[8:16])[0] if big else struct.unpack(en+"I",head[4:8])[0]
    if big: n=struct.unpack(en+"Q",rng(url,ifd,ifd+7))[0]; entsz=20; base=ifd+8
    else:   n=struct.unpack(en+"H",rng(url,ifd,ifd+1))[0]; entsz=12; base=ifd+2
    raw=rng(url,base,base+n*entsz-1); tags={}
    for i in range(n):
        e=raw[i*entsz:(i+1)*entsz]
        tag,typ=struct.unpack(en+"HH",e[:4])
        if big: cnt=struct.unpack(en+"Q",e[4:12])[0]; vb=e[12:20]; lim=8
        else:   cnt=struct.unpack(en+"I",e[4:8])[0];  vb=e[8:12];  lim=4
        inline=TYPESZ.get(typ,1)*cnt<=lim
        val=vb if inline else struct.unpack(en+("Q" if big else "I"),vb)[0]
        tags[tag]=(typ,cnt,val,inline)
    return en,big,tags

def tval(url,en,typ,cnt,val,inline,first=None):
    n = cnt if first is None else min(first,cnt)
    sz=TYPESZ.get(typ,1)*n
    data = val[:sz] if inline else rng(url,val,val+sz-1)
    fmt={3:"H",4:"I",12:"d",16:"Q",11:"f"}.get(typ)
    if typ==2: return data.decode("ascii","replace").rstrip("\x00")
    return list(struct.unpack(en+f"{n}{fmt}",data))

def arr_at(url,en,typ,val,inline,idx):
    """One element of a (possibly huge) offset array without reading it all."""
    sz=TYPESZ[typ]
    if inline: data=val[idx*sz:(idx+1)*sz]
    else: data=rng(url,val+idx*sz,val+(idx+1)*sz-1)
    fmt={3:"H",4:"I",16:"Q"}[typ]
    return struct.unpack(en+fmt,data)[0]

def unpredict_row(buf,off,rowbytes,bps=4):
    b=bytearray(buf[off:off+rowbytes])
    for i in range(1,len(b)): b[i]=(b[i]+b[i-1])&0xFF
    wc=len(b)//bps; out=bytearray(len(b))
    for c in range(wc):
        for k in range(bps): out[bps*c+k]=b[(bps-k-1)*wc+c]
    return struct.unpack(f"<{wc}f",bytes(out))

# --- UTM forward (NAD83/GRS80), sub-metre over one zone ---
def ll2utm(lat,lon,zone=11):
    a=6378137.0; f=1/298.257222101; e2=f*(2-f); k0=0.9996
    lon0=math.radians(-183+6*zone); p=math.radians(lat); l=math.radians(lon)
    N=a/math.sqrt(1-e2*math.sin(p)**2); T=math.tan(p)**2
    ep2=e2/(1-e2); C=ep2*math.cos(p)**2; A=(l-lon0)*math.cos(p)
    e4,e6=e2*e2,e2**3
    M=a*((1-e2/4-3*e4/64-5*e6/256)*p-(3*e2/8+3*e4/32+45*e6/1024)*math.sin(2*p)
        +(15*e4/256+45*e6/1024)*math.sin(4*p)-(35*e6/3072)*math.sin(6*p))
    E=k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120)+500000.0
    Nn=k0*(M+N*math.tan(p)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24
        +(61-58*T+T*T+600*C-330*ep2)*A**6/720))
    return E,Nn

def probe(url,lat,lon,half_m=100.0):
    en,big,tags=tiff_tags(url)
    G=lambda k,first=None: tval(url,en,*tags[k],first=first) if k in tags else None
    W=G(256)[0]; H=G(257)[0]
    comp=G(259)[0]; pred=(G(317) or [1])[0]; bps=G(258)[0]//8
    scale=G(33550); tie=G(33922)
    nd=G(42113)
    nodata=float(nd) if nd else None
    gk=dict(); 
    # model space -> is it geographic (degrees) or projected (metres)?
    geographic = scale[0] < 1e-3
    if geographic:
        dx=half_m/(111320.0*math.cos(math.radians(lat))); dy=half_m/110540.0
        cx,cy=lon,lat; hx,hy=dx,dy
    else:
        cx,cy=ll2utm(lat,lon); hx=hy=half_m
    ox,oy=tie[3],tie[4]; sx,sy=scale[0],scale[1]
    def to_px(x,y): return (x-ox)/sx, (oy-y)/sy
    px0,py0=to_px(cx-hx,cy+hy); px1,py1=to_px(cx+hx,cy-hy)
    x0,x1=int(math.floor(min(px0,px1))),int(math.ceil(max(px0,px1)))
    y0,y1=int(math.floor(min(py0,py1))),int(math.ceil(max(py0,py1)))
    x0,y0=max(0,x0),max(0,y0); x1,y1=min(W-1,x1),min(H-1,y1)
    if x0>x1 or y0>y1: return {"error":"window outside raster","W":W,"H":H}
    vals=[]; nnod=0
    if comp==1 and 322 not in tags:                     # uncompressed strips
        rps=(G(278) or [H])[0]
        assert rps==1, f"rows/strip={rps} unsupported"
        typ,cnt,val,inl=tags[273]
        for y in range(y0,y1+1):
            so=arr_at(url,en,typ,val,inl,y)
            a=so+x0*bps; b=so+(x1+1)*bps-1
            row=struct.unpack(f"{en}{x1-x0+1}f",rng(url,a,b))
            for v in row:
                if nodata is not None and (v==nodata or v<-1e30 or v<=-32767): nnod+=1
                else: vals.append(v)
    elif comp in (8,32946) and 322 in tags:             # tiled deflate
        tw,th=G(322)[0],G(323)[0]
        across=(W+tw-1)//tw
        toff=tags[324]; tcnt=tags[325]
        cache={}
        for ty in range(y0//th, y1//th+1):
            for tx in range(x0//tw, x1//tw+1):
                ti=ty*across+tx
                o=arr_at(url,en,toff[0],toff[2],toff[3],ti)
                c=arr_at(url,en,tcnt[0],tcnt[2],tcnt[3],ti)
                if c==0: continue
                raw=zlib.decompress(rng(url,o,o+c-1))
                rowbytes=tw*bps
                for y in range(max(y0,ty*th), min(y1,ty*th+th-1)+1):
                    ry=y-ty*th
                    if pred==3: row=unpredict_row(raw,ry*rowbytes,rowbytes,bps)
                    else: row=struct.unpack(f"{en}{tw}f",raw[ry*rowbytes:(ry+1)*rowbytes])
                    for x in range(max(x0,tx*tw), min(x1,tx*tw+tw-1)+1):
                        v=row[x-tx*tw]
                        if nodata is not None and (v==nodata or v<-1e30) or v!=v: nnod+=1
                        else: vals.append(v)
    else:
        return {"error":f"compression {comp} not decoded (tiled={322 in tags})"}
    tot=len(vals)+nnod
    r={"W":W,"H":H,"compression":comp,"predictor":pred,"geographic":geographic,
       "px_window":[x0,x1,y0,y1],"pixels":tot,"nodata":nnod,
       "coverage_pct":round(100.0*len(vals)/tot,2) if tot else None,
       "nodata_value":nodata}
    if vals:
        vs=sorted(vals)
        r.update({"min_m":round(vs[0],3),"max_m":round(vs[-1],3),
                  "median_m":round(statistics.median(vs),3),
                  "p05_m":round(vs[int(.05*len(vs))],3),
                  "p95_m":round(vs[int(.95*len(vs))],3),
                  "frac_below_0m":round(sum(1 for v in vs if v<0)/len(vs),3)})
    return r
