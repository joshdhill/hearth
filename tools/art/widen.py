"""Make the fireplace wider by splicing in more of its middle, in perspective.

The face of the fireplace (wall, mantel, lintel) is a flat upright plane, so it gets a plain slice
two brick-repeats wide. The hearth is seen from above in perspective: every joint across its top
points at one vanishing point, so on each row of its top face the slice is narrower the further back
the row is, which keeps every joint pointing at the same spot. Its upright front gets the full slice.
The seams are cross-faded over a few pixels.

usage: widen.py <master-x4.png> <geom.json> <out.png> <out-geom.json>"""
import json, sys
import numpy as np, cv2

src, gp, dst, gout = sys.argv[1:5]
g = json.load(open(gp))
I = cv2.imread(src)
H, W = I.shape[:2]
K = H / 572.0                                   # master px per picture px
VPX, VPY = 400.0, 163.0                         # where the hearth's joints point (picture px)
BACK, FRONT = 500.0, 519.0                      # the hearth's back edge (foot of the wall) and its front edge
SW = 169.0                                      # two brick repeats on the wall
C = 640.0                                       # where the wall is cut: the middle of the firebox opening
B = 14.0                                        # cross-fade width

ys = (np.arange(H) + 0.5) / K
depth = np.clip(ys, BACK, FRONT)
s = SW * (depth - VPY) / (BACK - VPY)           # slice width on each row (picture px)
seam = np.where(ys < BACK, C, VPX + (C - VPX) * (depth - VPY) / (BACK - VPY))
Wo = int(round(W + SW * K))
xo = (np.arange(Wo) + 0.5) / K
X = np.broadcast_to(xo[None, :], (H, Wo))
cut = (seam + s)[:, None]
w = np.clip((X - (cut - B / 2)) / B, 0, 1)
w = w * w * (3 - 2 * w)
mx_a = (X * K - 0.5).astype(np.float32)
mx_b = ((X - s[:, None]) * K - 0.5).astype(np.float32)
my = np.broadcast_to((np.arange(H, dtype=np.float32))[:, None], (H, Wo)).copy()
A = cv2.remap(I, mx_a, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
Bm = cv2.remap(I, mx_b, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
out = A * (1 - w[..., None]) + Bm * w[..., None]
cv2.imwrite(dst, np.clip(out + 0.5, 0, 255).astype(np.uint8))

R = lambda x: x + SW if x > C else x            # where a point on the wall ends up
g2 = dict(g)
g2['size'] = [g['size'][0] + SW, g['size'][1]]
g2['margin'] = g['margin'] + SW / 2             # keep the fireplace in the middle of the screen
g2['mantel_x'] = [R(x) for x in g['mantel_x']]
for k in ('firebox', 'opening'):
    b = g[k]; g2[k] = [b[0], b[1], R(b[2]), b[3]]
KD, M0 = 1080 / 572.0, g['margin']
to_o = lambda xs: xs / KD + M0                  # scene px of the old layout -> picture px
g2['hole'] = [to_o(640), to_o(729), R(to_o(1144)), R(to_o(1235))]
g2['clear'] = [425, R(925)]
g2['candles'] = [[R(x), y] for x, y in [(218, 55), (366, 35), (398, 70), (950, 66), (978, 62), (1006, 76), (1058, 76), (45, 371), (85, 402)]]
json.dump(g2, open(gout, 'w'), indent=1)
print('wrote', dst, out.shape, json.dumps(g2))
