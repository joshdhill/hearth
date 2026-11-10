"""Clear the stray fire tools the fill left lying on the hearth, by re-laying clean bricks.

The hearth is a row of bricks seen in perspective: every joint across its top points at one
vanishing point. So a clean brick-and-joint from elsewhere along the hearth can be laid over a
spoiled one exactly, by sliding it sideways a little less on each row further back. The wall
above the left stretch and the dark firebox above the middle come along with the clean bricks.

usage: clear_hearth.py <in.png> <out.png> [preview-dir]"""
import sys
import numpy as np, cv2

src, dst = sys.argv[1], sys.argv[2]
PRE = sys.argv[3] if len(sys.argv) > 3 else None
I = cv2.imread(src).astype(np.float32)
H, W = I.shape[:2]

VPX, VPY, YF = 400.0, 163.0, 519.0          # where the joints point; the row of the hearth's front edge
WALL_X = 372                                 # left of this the wall stands on the hearth; right of it is the firebox opening
BASE_WALL, BASE_OPEN = 506, 500              # first row of the hearth's top face under the wall / in front of the opening
JOINTS = np.array([21.5, 66, 112, 157.5, 203, 247, 293, 338.5, 385, 431.5, 479, 526, 572.5, 618.5, 664, 710, 754])

# what to remove (the tools and their shadows), as shapes in picture pixels
LEFT = [('c', 101, 502, 13), ('p', [(104, 495), (135, 497), (240, 502), (240, 516), (104, 516)]), ('c', 246, 497, 19),
        ('p', [(252, 488), (308, 496), (308, 516), (252, 516)]), ('c', 312, 504, 13), ('p', [(318, 501), (350, 503), (350, 516), (318, 516)])]
MID = [('p', [(522, 490), (560, 487), (600, 488), (604, 506), (522, 506)]), ('p', [(533, 505), (616, 505), (616, 517), (533, 517)]),
       ('p', [(588, 492), (640, 493), (668, 500), (668, 517), (588, 517)]), ('p', [(640, 501), (692, 502), (698, 517), (640, 517)])]
mask = np.zeros((H, W), np.uint8)
for s in LEFT + MID:
    if s[0] == 'c':
        cv2.circle(mask, (s[1], s[2]), s[3], 255, -1)
    else:
        cv2.fillPoly(mask, [np.array(s[1], np.int32)], 255)
mask[517:] = 0                               # never touch the front edge or the front face

# which clean joint each spoiled joint is re-laid from on the top face: (source joint, mirrored?)
TOP = {247: (431.5, False), 293: (479, False), 338.5: (431.5, True),                               # mortared joints under the wall
       526: (479, False), 572.5: (431.5, True), 618.5: (479, False), 664: (431.5, False), 710: (479, False)}
DARK = (66.0, 21.5)                          # under the wall: a joint and the brick to its left come from the first, the brick to its right from the second


def jx(j, y):
    """where joint j (its x at the front edge) is on row y"""
    return j + (VPX - j) * (YF - y) / (YF - VPY)


def sample(sx, y):
    x0 = np.clip(np.floor(sx).astype(int), 0, W - 2)
    f = (sx - x0)[:, None]
    return I[y, x0] * (1 - f) + I[y, x0 + 1] * f


# work out the re-laid colour for every spoiled pixel, and for a ring of good pixels around them (to match the tone)
wide = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
wide[521:] = 0
ys, xs = np.nonzero(wide)
left = xs < WALL_X
yy = np.minimum(np.maximum(ys, np.where(left, BASE_WALL, BASE_OPEN)), YF).astype(np.float32)   # the wall and the firebox slide as one piece with the row they stand on
lines = jx(JOINTS[None, :], yy[:, None])
i = np.argmin(np.abs(lines - xs[:, None]), axis=1)
d = JOINTS[i]
u = xs - lines[np.arange(len(xs)), i]
wall = left & (ys < BASE_WALL)

t = np.clip((u - 6) / 4.0, 0, 1)[:, None]
dark = sample(jx(DARK[0], yy) + u, ys) * (1 - t) + sample(jx(DARK[1], yy) + u, ys) * t
s_j = np.array([TOP.get(float(v), (v, False))[0] for v in d])
mir = np.array([TOP.get(float(v), (v, False))[1] for v in d])
top = sample(jx(s_j, yy) + np.where(mir, -u, u), ys)

# under the wall the hearth is in the wall's shade; the mortared joints are copied from in front of the firebox, where it is not
shade = np.clip(I[BASE_WALL:520, 44:60].mean(axis=(1, 2)) / I[BASE_WALL:520, 440:470].mean(axis=(1, 2)), 0.5, 1.0)
strip = np.clip((8.5 - np.abs(u)) / 2.0, 0, 1)[:, None]                 # just the joint itself
mortared = left & ~wall & (d > 225)
px = dark.copy()
sh = shade[np.clip(ys - BASE_WALL, 0, len(shade) - 1)][:, None]
px[mortared] = (dark * (1 - strip) + top * sh * strip)[mortared]

# in front of the firebox: whole bricks from further along, brought to the brightness of the bricks they sit among
front = ~left
px[front] = top[front]
out = I.copy()
ring = (cv2.dilate(mask, np.ones((3, 3), np.uint8)) == 0)[ys, xs] & front & (ys >= BASE_OPEN + 2)
orig = I[ys, xs]
brick = lambda c: (c[:, 2] > c[:, 0] * 1.35) & (c[:, 2] > 90)             # brick-coloured, not mortar or shadow (BGR)
ok = ring & brick(orig) & brick(top)
gains, centres = [], []
for j in sorted(set(d[front].tolist())):
    sel = ok & (d == j)
    if sel.sum() >= 12:
        gains.append(np.median(orig[sel] / np.maximum(top[sel], 1), axis=0)); centres.append(j)
gains = np.clip(np.array(gains), 0.85, 1.2)
print('brightness match in front of the firebox, by joint:', {c: np.round(g, 2).tolist() for c, g in zip(centres, gains)})
g = np.stack([np.interp(xs, centres, gains[:, c]) for c in range(3)], axis=1)
lit = front & (ys >= BASE_OPEN)
px[lit] *= g[lit]
# the firebox above them is plain darkness: take it from the darkness either side on the same row
good = (wide == 0).astype(np.float32)
num = cv2.GaussianBlur(I * good[..., None], (301, 1), 50); den = cv2.GaussianBlur(good, (301, 1), 50)[..., None]
dark_row = num / np.maximum(den, 1e-6)
cav = front & (ys < BASE_OPEN)
px[cav] = dark_row[ys[cav], xs[cav]]
out[ys, xs] = px

# the upright joint in the wall course that one tool lay across: carry it down to the hearth
jm = mask[492:504, 274:289] > 0
out[492:504, 274:289][jm] = I[480:492, 274:289][::-1][jm]

soft = cv2.GaussianBlur((mask > 0).astype(np.float32), (0, 0), 1.0)[..., None]
res = out * soft + I * (1 - soft)
cv2.imwrite(dst, np.clip(res + 0.5, 0, 255).astype(np.uint8))
print('re-laid', int((mask > 0).sum()), 'pixels')
if PRE:
    for name, (a, b) in {'L1': (40, 220), 'L2': (200, 380), 'M1': (490, 670), 'M2': (600, 780)}.items():
        v = np.vstack([I[474:552, a:b], res[474:552, a:b]])
        cv2.imwrite(f'{PRE}/cl-{name}.png', cv2.resize(np.clip(v, 0, 255).astype(np.uint8), None, fx=8, fy=8, interpolation=cv2.INTER_CUBIC))
