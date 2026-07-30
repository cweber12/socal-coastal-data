import sys, json, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
NS='{http://s3.amazonaws.com/doc/2006-03-01/}'
BUCKET="https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/"
def listall(prefix):
    keys=[]; tok=None
    while True:
        p={"list-type":"2","prefix":prefix,"max-keys":"1000"}
        if tok: p["continuation-token"]=tok
        with urllib.request.urlopen(BUCKET+"?"+urllib.parse.urlencode(p),timeout=90) as r:
            root=ET.parse(r).getroot()
        for c in root.findall(NS+'Contents'):
            keys.append((c.findtext(NS+'Key'), int(c.findtext(NS+'Size'))))
        if root.findtext(NS+'IsTruncated')=='true':
            tok=root.findtext(NS+'NextContinuationToken')
        else: break
    return keys
if __name__=="__main__":
    pre=sys.argv[1]
    ks=listall(pre)
    json.dump(ks,open(sys.argv[2],"w"))
    ext={}
    for k,s in ks:
        e=k.rsplit('.',1)[-1].lower() if '.' in k.split('/')[-1] else '(none)'
        if k.endswith('.tif.xml'): e='tif.xml'
        if k.endswith('.tif.aux.xml'): e='tif.aux.xml'
        ext.setdefault(e,[0,0]); ext[e][0]+=1; ext[e][1]+=s
    print("prefix",pre,"total keys",len(ks))
    for e,(n,s) in sorted(ext.items()): print("  %-14s n=%-5d %.2f GiB" % (e,n,s/1024**3))
    # non-tile files
    for k,s in ks:
        base=k.split('/')[-1]
        if not base.startswith('20') or 'index' in base.lower() or 'tileindex' in base.lower():
            print("   OTHER:",base,s)
