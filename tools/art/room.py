"""Final grade of the fireplace picture for the Fireside scene.

From the finished 4x master it writes, at 4K and at 1080p:
  room-*.webp  the room in the evening (dim), with a soft-edged opening where the fire footage shows
  lit-*.webp   the same room lit warm by the fire; its transparency is how much firelight each spot gets.
               The page lays it over the dim room and fades it up and down as the fire flickers.
plus thumb.jpg and fireside.json (where things are, in the scene's 1920x1080 coordinates).

usage: room.py <master-x4.jpg> <geom.json> <outdir>"""
import json, os, sys
import numpy as np, cv2
from PIL import Image

src, geomp, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
g = json.load(open(geomp))
M = cv2.imread(src).astype(np.float32) / 255          # BGR
H4, W4 = M.shape[:2]
K = H4 / 572.0                                          # master px per original px
KD = 1080 / 572.0                                       # scene px per original px
MAR = g['margin']
Wo, Ho = W4 / K, 572.0
yy, xx = np.mgrid[0:H4, 0:W4].astype(np.float32)
xo, yo = xx / K, yy / K                                 # original-picture coordinates of every pixel

ox0, oy0, ox1, oy1 = g['opening']                       # the firebox opening (with its side walls)
cx0, cy0, cx1, cy1 = g['firebox']                       # the empty cavity
mant_top, mant_bot = g['mantel_top'], g['mantel_bottom']
CANDLES = [(218, 55), (366, 35), (398, 70), (950, 66), (978, 62), (1006, 76), (1058, 76), (45, 371), (85, 402)]

# ---- where the firelight falls --------------------------------------------------------------------------
dx = np.maximum(np.maximum(ox0 - xo, xo - ox1), 0)
dy_up = np.maximum(oy0 - yo, 0)
d = np.hypot(dx, dy_up)
wall = 0.46 * np.exp(-d / 105.0)                                        # the wall around the opening
wall = np.where(yo < mant_top, wall * 0.55, wall)                         # the mantel shades what is above it
below = yo > oy1 - 2
hearth = 0.98 * np.exp(-(dx / 300.0) ** 2) * np.exp(-np.maximum(yo - oy1, 0) / 190.0)
A = np.where(below, hearth, wall)
inside = (xo > ox0) & (xo < ox1) & (yo > oy0) & (yo <= oy1)
A = np.where(inside, 0.92, A)                                             # the firebox's own side walls
for (cx, cy) in CANDLES:                                                  # each candle lights a little of the wall behind it
    r2 = (xo - cx) ** 2 + ((yo - cy + 6) * 1.15) ** 2
    A = np.maximum(A, 0.62 * np.exp(-r2 / (2 * 24.0 ** 2)))
A = cv2.GaussianBlur(A.astype(np.float32), (0, 0), 5 * K / 4)

# ---- the opening for the footage -------------------------------------------------------------------------
V = {'x': 440.2, 'y': 319.4, 'w': 1083.6, 'h': 609.6}                    # where the footage sits (scene px): the fire centred in the firebox, its logs just above the hearth
to_o = lambda xs: xs / KD + MAR
hx = np.clip((xo - to_o(640)) / (to_o(729) - to_o(640)), 0, 1) * np.clip((to_o(1235) - xo) / (to_o(1235) - to_o(1144)), 0, 1)
hy = np.clip((yo - (cy0 + 5)) / 34.0, 0, 1) * np.clip((cy1 + 1.0 - yo) / 3.0, 0, 1)
smooth = lambda t: t * t * (3 - 2 * t)
hole = smooth(hx) * smooth(hy)

# ---- grade ------------------------------------------------------------------------------------------------
fx, fy = (ox0 + ox1) / 2, oy1 - 40
vig = 1 - 0.34 * np.clip(np.hypot((xo - fx) / 760.0, (yo - fy) / 520.0), 0, 1.25) ** 2
dim = M * np.array([1.0, 0.95, 0.90], np.float32) * 0.50 * vig[..., None]            # BGR: a cool, dark evening
lit = np.clip(M * np.array([0.60, 1.02, 1.62], np.float32) * 1.08, 0, 1)             # BGR: firelight
dim_a = 1 - hole
lit_a = np.clip(A, 0, 1) * (1 - hole)


def save(rgb_bgr, alpha, name, size):
    rgba = np.dstack([rgb_bgr[..., ::-1], alpha[..., None]])
    prem = rgba.copy(); prem[..., :3] *= prem[..., 3:]
    prem = cv2.resize(prem, size, interpolation=cv2.INTER_AREA)
    al = np.clip(prem[..., 3:], 1e-4, 1)
    out = np.dstack([np.clip(prem[..., :3] / al, 0, 1), prem[..., 3:]])
    # where alpha is ~0 keep the colour sensible so the edge doesn't fringe
    Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, name), 'WEBP', quality=88, method=5, alpha_quality=95)
    print(name, size, round(os.path.getsize(os.path.join(OUT, name)) / 1e6, 2), 'MB')


for tag, hpx in (('4k', 2160), ('2k', 1080)):
    size = (int(round(W4 * hpx / H4 / 2)) * 2, hpx)
    save(dim, dim_a, f'room-{tag}.webp', size)
    save(lit, lit_a, f'lit-{tag}.webp', size)

# thumbnail: the 16:9 middle, with a suggestion of fire
c0, c1 = int(MAR * K), int((Wo - MAR) * K)
th = (dim * (1 - 0.8 * A[..., None]) + lit * 0.8 * A[..., None])[:, c0:c1]
th = cv2.resize(th, (640, 360), interpolation=cv2.INTER_AREA)
fxp, fyp = (fx - MAR) / (Wo - 2 * MAR) * 640, (oy1 - 70) / Ho * 360
ty, tx = np.mgrid[0:360, 0:640].astype(np.float32)
fire = np.exp(-(((tx - fxp) / 60) ** 2 + ((ty - fyp) / 48) ** 2))
th = np.clip(th + fire[..., None] * np.array([0.15, 0.55, 1.0], np.float32), 0, 1)
cv2.imwrite(os.path.join(OUT, 'thumb.jpg'), (th * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 86])

D = lambda x: round((x - MAR) * KD, 1)
Y = lambda y: round(y * KD, 1)
info = {
    'wide': round(Wo * KD, 1), 'margin': round(MAR * KD, 1),
    'video': V, 'cavity': [D(cx0), Y(cy0), D(cx1), Y(cy1)],
    'mantel': {'y': Y(mant_top), 'x': [D(g['mantel_x'][0]), D(g['mantel_x'][1])], 'clear': [D(425), D(925)]},
    'hearth': {'y': Y(514), 'back': Y(500)},                               # where paws go (the front of the bricks' top face), and the back edge
    'candles': [[D(x), Y(y)] for x, y in CANDLES],
}
json.dump(info, open(os.path.join(OUT, 'fireside.json'), 'w'), indent=1)
print(json.dumps(info))
