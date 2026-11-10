"""Recompose the fireplace picture: lower mantel (more wall above it), wider and lower firebox,
deeper hearth across the whole width, extra width for wide phone screens.

Stage 1 (this script, exact pixel work): cut brick courses out, move the firebox jambs and the
fire tools, extend the hearth, lay everything out on the wider master canvas, and write a mask
of the areas that have no picture yet. Stage 2 (a fill model) paints the masked areas.

usage: compose_scene.py <fireplace.jpg> <outdir> [scale]
All coordinates below are in pixels of the original 1024x572 picture."""
import sys
import numpy as np, cv2

src_path, OUT = sys.argv[1], sys.argv[2]
K = int(sys.argv[3]) if len(sys.argv) > 3 else 1
S = cv2.imread(src_path).astype(np.float32) / 255
if K != 1 and S.shape[1] == 1024:
    S = cv2.resize(S, None, fx=K, fy=K, interpolation=cv2.INTER_LANCZOS4)
H0, W0 = 572, 1024
P = lambda v: int(round(v * K))
PITCH, BRICK = 32.3, 86.0

img = S.copy()
unknown = np.zeros(img.shape[:2], np.float32)          # 1 = needs painting


def lum(a):
    return a @ np.array([0.114, 0.587, 0.299], np.float32)


# ---- 1. lift the fire tools off the wall (they move right when the firebox widens) ----------------
TX0, TX1, TY0, TY1 = 748, 888, 232, 546
tool = img[P(TY0):P(TY1), P(TX0):P(TX1)].copy()
tl = lum(tool)
tm = (tl < 0.20).astype(np.uint8)
tm = cv2.morphologyEx(tm, cv2.MORPH_OPEN, np.ones((max(1, K), max(1, K)), np.uint8))
n, lab, stats, _ = cv2.connectedComponentsWithStats(tm, 8)
keep = np.zeros_like(tm)
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] > 60 * K * K:
        keep[lab == i] = 1
keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, np.ones((3 * K, 3 * K), np.uint8))
tool_a = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 0.6 * K)
# the wall behind the old tools needs repainting (a little wider than the tools themselves)
grow = cv2.dilate(keep, np.ones((7 * K, 7 * K), np.uint8))
unknown[P(TY0):P(TY1), P(TX0):P(TX1)] = np.maximum(unknown[P(TY0):P(TY1), P(TX0):P(TX1)], grow)

# ---- 2. the log holder goes; wall and hearth there get repainted ---------------------------------------
unknown[P(458):P(505), 0:P(204)] = 1

# ---- 3. hearth across the full width (its bricks repeat every ~50 px, so tile it) ---------------------
HY = 503
hearth = img[P(HY):, :].copy()


def tile_hearth(dst_x0, dst_x1, src_x0):
    w = dst_x1 - dst_x0
    hearth[:, P(dst_x0):P(dst_x1)] = img[P(HY):, P(src_x0):P(src_x0) + P(dst_x1) - P(dst_x0)]


# measured pitch of the front (bullnose) bricks
prof = lum(img[P(552):P(568), P(215):P(940)]).mean(0)
prof = prof - cv2.GaussianBlur(prof.reshape(1, -1), (0, 0), 30 * K).ravel()
ac = np.correlate(prof, prof, 'full')[len(prof) - 1:]
lo, hi = P(38), P(64)
HP = (lo + int(np.argmax(ac[lo:hi]))) / K
print('hearth brick pitch', round(HP, 2))
n4 = round(4 * HP)
tile_hearth(210 - n4, 210, 210)                 # left of the old hearth end
tile_hearth(0, 210 - n4, 210 + n4 - (210 - n4)) if 210 - n4 > 0 else None
tile_hearth(946, 1024, 946 - n4)                # past the old right end
tile_hearth(756, 884, 756 - round(3 * HP))      # where the tool stand stood (top surface only matters)
img[P(HY):, :] = hearth
# soften the tile seams a touch
for x in (210, 210 - n4, 946, 756, 884):
    if 2 < x < W0 - 2:
        a, b = P(x) - 2 * K, P(x) + 2 * K
        img[P(HY):, a:b] = cv2.GaussianBlur(img[P(HY):, a - 4 * K:b + 4 * K], (0, 0), 0.8 * K)[:, 4 * K:-4 * K]
unknown[P(HY):, :] = 0

# ---- 4. widen the firebox: both jambs move outwards by DX ------------------------------------------------
DX = 58
FY0, FY1 = 221, 512
rows = slice(P(FY0), P(FY1))
left_strip = img[rows, P(302):P(350)].copy()          # wall edge, inner left wall, start of the dark
right_strip = img[rows, P(640):P(730)].copy()         # inner right wall and its outer edge
dark_l = img[rows, P(350):P(350 + DX)].copy()
dark_r = img[rows, P(640 - DX):P(640)].copy()
img[rows, P(302 - DX):P(350 - DX)] = left_strip
img[rows, P(350 - DX):P(350)] = dark_l
img[rows, P(640 + DX):P(730 + DX)] = right_strip
img[rows, P(640):P(640 + DX)] = dark_r
unknown[rows, P(300 - DX):P(732 + DX)] = 0
# blend the new wall edges into the bricks beside them
for x in (302 - DX, 730 + DX):
    a, b = P(x) - K, P(x) + K
    img[rows, a:b] = cv2.GaussianBlur(img[rows, a - 3 * K:b + 3 * K], (0, 0), 0.7 * K)[:, 3 * K:-3 * K]

# ---- 5. set the tools back down, further right --------------------------------------------------------
TSHIFT = 62
dst = img[P(TY0):P(TY1), P(TX0 + TSHIFT):P(TX1 + TSHIFT)]
sh = cv2.GaussianBlur(np.roll(tool_a, (P(1.5), P(3)), (0, 1)), (0, 0), 3 * K)[..., None]      # a soft shadow on the wall
dst *= 1 - 0.28 * sh
dst[:] = dst * (1 - tool_a[..., None]) + tool * tool_a[..., None]
u = unknown[P(TY0):P(TY1), P(TX0 + TSHIFT):P(TX1 + TSHIFT)]
u[:] = np.minimum(u, 1 - (tool_a > 0.3))

# ---- 6. take courses out: one under the mantel, two through the firebox ---------------------------------
# relight first: what ends up right under the beam should carry the beam's shadow
wall = np.r_[0:P(290), P(790):P(1024)]
prof = lum(img[:, wall]).mean(1)
sm = cv2.GaussianBlur(prof.reshape(-1, 1), (0, 0), 9 * K).ravel()
ref = sm[P(250):P(300)].mean()
r = np.clip(sm / ref, 0.05, 1.2)
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
print('body rows', body.shape[0] / K)

# ---- 7. the master canvas: room above the mantel, extra width at the sides ---------------------------
TOP, MAR = 65, 124
Hm, Wm = body.shape[0] + P(TOP), body.shape[1] + 2 * P(MAR)
master = np.zeros((Hm, Wm, 3), np.float32)
mask = np.ones((Hm, Wm), np.float32)
master[P(TOP):, P(MAR):P(MAR) + body.shape[1]] = body
mask[P(TOP):, P(MAR):P(MAR) + body.shape[1]] = ubody
# hearth rows in the margins: tile on
hy = P(TOP) + P(128 + 159 + 124)
hb = master[hy:, P(MAR):P(MAR) + body.shape[1]]
w4 = P(n4)
for x in range(P(MAR), -1, -w4):
    a = max(0, x - w4)
    master[hy:, a:x] = hb[:, P(210) + w4 - (x - a):P(210) + w4]
    mask[hy:, a:x] = 0
x = P(MAR) + body.shape[1]
while x < Wm:
    b = min(Wm, x + w4)
    master[hy:, x:b] = hb[:, P(600):P(600) + (b - x)]
    mask[hy:, x:b] = 0
    x = b
mask = (mask > 0.5).astype(np.uint8)
np.save(f'{OUT}/geom.npy', np.array([K, TOP, MAR, DX, TSHIFT, Hm, Wm]))
cv2.imwrite(f'{OUT}/stage1.png', np.clip(master * 255 + 0.5, 0, 255).astype(np.uint8))
cv2.imwrite(f'{OUT}/stage1-mask.png', mask * 255)
prev = master.copy(); prev[mask > 0] = prev[mask > 0] * 0.3 + np.array([0.6, 0.1, 0.6], np.float32) * 0.7
cv2.imwrite(f'{OUT}/stage1-preview.jpg', np.clip(prev * 255, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
print('master', Wm / K, 'x', Hm / K, 'unknown', round(float(mask.mean()), 3))
