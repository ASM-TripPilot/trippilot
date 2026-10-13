import sys
from fontTools.ttLib import TTFont
src, dst, name = sys.argv[1:4]
f = TTFont(src)
n = f['name']
for rec in list(n.names):
    if rec.nameID in (16, 17, 21, 22, 25): n.removeNames(nameID=rec.nameID)
for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0)):
    for nid, val in ((1, name), (2, 'Regular'), (4, name), (6, name)):
        n.setName(val, nid, pid, eid, lid)
f.save(dst)
