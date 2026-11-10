"""Recompose the fireplace picture: lower mantel (more wall above it), wider and lower firebox,
deeper hearth across the whole width, extra width for wide phone screens.

Stage 1 (this script, exact pixel work): cut brick courses out, move the firebox jambs and the
fire tools, empty the firebox, extend the hearth, lay it all out on the wider master canvas, and
write a mask of the areas that have no picture yet. Stage 2 (a fill model) paints the masked areas.

usage: compose_scene.py <fireplace.jpg> <outdir> [scale]
Coordinates below are in pixels of the original 1024x572 picture (x may run past its edges)."""
import json, sys
import numpy as np, cv2

src_path, OUT = sys.argv[1], sys.argv[2]
K = int(sys.argv[3]) if len(sys.argv) > 3 else 1
S = cv2.imread(src_path).astype(np.float32) / 255
if K != 1 and S.shape[1] == 1024:
    S = cv2.resize(S, None, fx=K, fy=K, interpolation=cv2.INTER_LANCZOS4)
W0, H0 = 1024, 572
MAR, TOP = 124, 65                      # extra width each side, extra wall above
P = lambda v: int(round(v * K))
X = lambda v: int(round((v + MAR) * K))    # x on the padded canvas

img = np.zeros((P(H0), P(W0 + 2 * MAR), 3), np.float32)
img[:, X(0):X(W0)] = S
unknown = np.ones(img.shape[:2], np.float32)            # 1 = needs painting
unknown[:, X(0):X(W0)] = 0


def lum(a):
    return a @ np.array([0.114, 0.587, 0.299], np.float32)


def soften(x, y0, y1, r=2):
    a, b = X(x) - r * K, X(x) + r * K
    img[P(y0):P(y1), a:b] = cv2.GaussianBlur(img[P(y0):P(y1), a - 4 * K:b + 4 * K], (0, 0), 0.8 * K)[:, 4 * K:-4 * K]


# ---- 1. lift the fire tools off the wall (they move right when the firebox widens) ----------------
TX0, TX1, TY0, TY1 = 748, 888, 232, 546
tool = img[P(TY0):P(TY1), X(TX0):X(TX1)].copy()
tm = (lum(tool) < 0.20).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(tm, 8)
keep = np.zeros_like(tm)
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] > 60 * K * K:
        keep[lab == i] = 1
keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, np.ones((3 * K, 3 * K), np.uint8))
tool_a = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 0.6 * K)
grow = cv2.dilate(keep, np.ones((9 * K, 9 * K), np.uint8)).astype(np.float32)
u = unknown[P(TY0):P(TY1), X(TX0):X(TX1)]
u[:] = np.maximum(u, grow)              # the wall behind the old tools needs repainting

# ---- 2. the log holder goes; the wall there gets repainted --------------------------------------------
unknown[P(456):P(505), X(0):X(206)] = 1

# ---- 3. hearth across the full width (its bricks repeat every ~52 px, so tile it) ---------------------
HY, HY2 = 503, 515          # HY..HY2 is where wall (or firebox floor) meets the hearth; below HY2 is hearth
HP = 52
n4 = 4 * HP
hsrc = img.copy()


def tile_rows(y0, y1, dst_x0, dst_x1, src_x0, src_x1, mirror=False, anchor='right'):
    """fill img[y0:y1, dst_x0:dst_x1] by repeating hsrc[y0:y1, src_x0:src_x1] (ping-pong if mirror);
    the repeat starts flush at the anchored end, so it carries on from the picture beside it"""
    piece = hsrc[P(y0):P(y1), X(src_x0):X(src_x1)]
    pw = piece.shape[1]
    flip = False
    if anchor == 'right':
        x = X(dst_x1)
        while x > X(dst_x0):
            w = min(pw, x - X(dst_x0))
            blk = piece[:, ::-1] if (mirror and flip) else piece
            img[P(y0):P(y1), x - w:x] = blk[:, pw - w:]
            x -= w; flip = not flip
    else:
        x = X(dst_x0)
        while x < X(dst_x1):
            w = min(pw, X(dst_x1) - x)
            blk = piece[:, ::-1] if (mirror and flip) else piece
            img[P(y0):P(y1), x:x + w] = blk[:, :w]
            x += w; flip = not flip


def match(dst_x0, dst_x1, ref_x0, ref_x1, y0, y1, side):
    """pull the tiled stretch toward the colour of the real hearth beside it, fading with distance"""
    ref = img[P(y0):P(y1), X(ref_x0):X(ref_x1)].reshape(-1, 3).mean(0)
    near = (img[P(y0):P(y1), X(dst_x1 - 30):X(dst_x1)] if side == 'left' else img[P(y0):P(y1), X(dst_x0):X(dst_x0 + 30)]).reshape(-1, 3).mean(0)
    g = np.clip(ref / np.maximum(near, 1e-3), 0.6, 1.6)
    w = X(dst_x1) - X(dst_x0)
    t = np.linspace(0, 1, w, dtype=np.float32) if side == 'left' else np.linspace(1, 0, w, dtype=np.float32)
    t = (0.35 + 0.65 * t)[None, :, None]                 # full correction at the join, about a third far away
    img[P(y0):P(y1), X(dst_x0):X(dst_x1)] *= 1 + (g - 1) * t


# hearth surface and front edge: repeat four-brick stretches taken from in front of the firebox.
# Seams sit on the mortar joints of the front bricks (measured: 225, 278, 331, 377, 432 ... 850, 904).
tile_rows(HY2, 572, -MAR, 225, 432, 640, anchor='right')
tile_rows(HY2, 572, 904, W0 + MAR, 484, 691, anchor='left')
tile_rows(HY2, 538, 752, 888, 432, 568, anchor='left')          # where the tool stand stood (surface only)
for (a, b, ra, rb, side) in ((-MAR, 225, 227, 262, 'left'), (904, W0 + MAR, 868, 902, 'right')):
    match(a, b, ra, rb, HY2, 538, side)        # the ashy top surface
    match(a, b, ra, rb, 538, 572, side)        # the red front bricks
# the strip where wall meets hearth: repeat the bit of it that lies in front of plain wall
tile_rows(HY, HY2, -MAR, 225, 228, 294, mirror=True, anchor='right')
tile_rows(HY, HY2, 904, W0 + MAR, 892, 942, mirror=True, anchor='left')
tile_rows(HY, HY2, 752, 888, 892, 942, mirror=True, anchor='left')
for x in (225, 904):
    soften(x, HY, 572, 2)
for x in (752, 888):
    soften(x, HY, 538, 3)
unknown[P(HY):, :] = 0

# ---- 4. widen the firebox: both jambs move outwards by DX, and the inside is emptied ------------------
DX = 58
FY0, FY1 = 221, 514
rows = slice(P(FY0), P(FY1))
left_strip = img[rows, X(302):X(346)].copy()          # wall edge and inner left wall
right_strip = img[rows, X(646):X(730)].copy()         # inner right wall and its outer edge
img[rows, X(302 - DX):X(346 - DX)] = left_strip
img[rows, X(646 + DX):X(730 + DX)] = right_strip
strips = [(302 - DX, left_strip.copy()), (646 + DX, right_strip.copy())]       # set in again later, see step 7
# the cavity between the side walls: logs and grate go (the fire footage brings its own)
cx0, cx1 = 346 - DX, 646 + DX
cav = img[P(FY0 + 4):P(FY1), X(cx0):X(cx1)]
hh, ww = cav.shape[:2]
yy = np.linspace(0, 1, hh, dtype=np.float32)[:, None, None]
dark = np.array([0.018, 0.020, 0.026], np.float32) * (0.7 + 0.9 * yy ** 2)                  # a touch lighter toward the floor
noise = cv2.GaussianBlur(np.random.default_rng(3).normal(0, 1, (hh, ww)).astype(np.float32), (0, 0), 1.2 * K)[..., None] * 0.005
cav[:] = np.clip(dark + noise, 0, 1)
# the firebox floor meets the hearth: fade the dark out over the first hearth bricks
fy = P(FY1)
ramp = np.linspace(1, 0, P(14), dtype=np.float32)[:, None, None]
band = img[fy:fy + P(14), X(cx0):X(cx1)]
band[:] = band * (1 - 0.85 * ramp) + np.array([0.02, 0.022, 0.03], np.float32) * 0.85 * ramp
unknown[rows, X(300 - DX):X(732 + DX)] = 0
for x in (302 - DX, 730 + DX, cx0, cx1):
    soften(x, FY0, FY1, 1)

# ---- 5. set the tools back down, further right --------------------------------------------------------
TSHIFT = 62
dst = img[P(TY0):P(TY1), X(TX0 + TSHIFT):X(TX1 + TSHIFT)]
sh = cv2.GaussianBlur(np.roll(tool_a, (P(1.5), P(3)), (0, 1)), (0, 0), 3 * K)[..., None]      # a soft shadow on the wall
dst *= 1 - 0.28 * sh
dst[:] = dst * (1 - tool_a[..., None]) + tool * tool_a[..., None]
u = unknown[P(TY0):P(TY1), X(TX0 + TSHIFT):X(TX1 + TSHIFT)]
u[:] = np.minimum(u, 1 - (tool_a > 0.3))

# ---- 6. take courses out: one under the mantel, two through the firebox ---------------------------------
# relight first: what ends up right under the beam should carry the beam's shadow
cols = np.r_[X(0):X(240), X(800):X(1024)]
prof = lum(img[:, cols]).mean(1)
sm = cv2.GaussianBlur(prof.reshape(-1, 1), (0, 0), 9 * K).ravel()
r = np.clip(sm / sm[P(250):P(300)].mean(), 0.05, 1.2)
gain = np.ones(img.shape[0], np.float32)
for y in range(P(161), P(262)):
    gain[y] = np.clip(r[y - P(33)] / r[y], 0.35, 1.0)
img *= gain[:, None, None]
segs = [(0, 128), (161, 320), (384, 508)]
parts = [img[P(a):P(b)] for a, b in segs]
uparts = [unknown[P(a):P(b)] for a, b in segs]
# the hearth: stretch its top surface so it reads deeper (the cat walks here)
top = cv2.resize(img[P(508):P(537)], (img.shape[1], P(61)), interpolation=cv2.INTER_CUBIC)
parts += [top, img[P(537):P(572)]]
uparts += [np.zeros(top.shape[:2], np.float32), unknown[P(537):P(572)]]
body = np.vstack(parts)
ubody = np.vstack(uparts)

# ---- 7. the master canvas: room above the mantel -------------------------------------------------------
Hm, Wm = body.shape[0] + P(TOP), body.shape[1]
master = np.zeros((Hm, Wm, 3), np.float32)
mask = np.ones((Hm, Wm), np.float32)
master[P(TOP):] = body
mask[P(TOP):] = ubody
mask = (mask > 0.5).astype(np.uint8)


def ymap(y):          # original y -> master y
    out = TOP
    for a, b in segs:
        if y < b:
            return out + max(0, y - a)
        out += b - a
    if y < 537:
        return out + (y - 508) * 61 / 29
    return out + 61 + (y - 537)


# the firebox side walls were cut along with the courses, which leaves a step in their shading:
# set them in again whole, squeezed to the new height
oy0, oy1 = P(ymap(FY0)), P(ymap(508))
for x0, st in strips:
    st = st[:P(508 - FY0)]
    sq = cv2.resize(st, (st.shape[1], oy1 - oy0), interpolation=cv2.INTER_AREA)
    master[oy0:oy1, X(x0):X(x0) + st.shape[1]] = sq
for x in (cx0, cx1):
    a, b = X(x) - K, X(x) + K
    master[oy0:oy1, a:b] = cv2.GaussianBlur(master[oy0:oy1, a - 3 * K:b + 3 * K], (0, 0), 0.8 * K)[:, 3 * K:-3 * K]

geom = {
    'scale': K, 'size': [Wm / K, Hm / K], 'margin': MAR,
    'mantel_top': ymap(45), 'mantel_bottom': ymap(127), 'mantel_x': [35 + MAR, 990 + MAR],
    'firebox': [cx0 + MAR, ymap(FY0 + 4), cx1 + MAR, ymap(FY1 - 1)],          # the empty cavity: x0, y0, x1, y1
    'opening': [306 - DX + MAR, ymap(FY0), 722 + DX + MAR, ymap(FY1 - 1)],
    'hearth_top': ymap(HY2), 'hearth_front': ymap(552),
}
json.dump(geom, open(f'{OUT}/geom.json', 'w'), indent=1)
cv2.imwrite(f'{OUT}/stage1.png', np.clip(master * 255 + 0.5, 0, 255).astype(np.uint8))
cv2.imwrite(f'{OUT}/stage1-mask.png', mask * 255)
prev = master.copy(); prev[mask > 0] = prev[mask > 0] * 0.3 + np.array([0.6, 0.1, 0.6], np.float32) * 0.7
cv2.imwrite(f'{OUT}/stage1-preview.jpg', np.clip(prev * 255, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
print('master', Wm / K, 'x', Hm / K, 'unknown', round(float(mask.mean()), 3))
print(json.dumps(geom))
