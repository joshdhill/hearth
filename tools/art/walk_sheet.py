"""A walk cycle filmed on a green screen -> one looping sprite sheet with transparency, for the demo.

The clip is a tracking shot (the cat walks on the spot). The background is green but not perfectly
even, so it is estimated smoothly around the cat in every frame, and each pixel's transparency is
how far it has moved from that background towards the cat's darkest fur. Green spill on the edges
is taken out. Then the longest seamless run of whole strides is found, and how fast the planted
paws slide back (the speed the cat must travel across the room).

usage: walk_sheet.py <clip.mp4> <outdir> <name>"""
import json, os, subprocess, sys
import numpy as np, cv2
from scipy import ndimage as ndi
from PIL import Image

src, OUT, NAME = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)
pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src], capture_output=True, text=True).stdout.strip().split(',')
w, h = int(pr[0]), int(pr[1])
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True, check=True).stdout
frames = [f.astype(np.float32) / 255 for f in np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)]


def key(bgr):
    b = max(4, h // 30)
    border = np.concatenate([bgr[:b].reshape(-1, 3), bgr[:, :b].reshape(-1, 3), bgr[:, -b:].reshape(-1, 3)])
    med = np.median(border, 0)
    gdom = bgr[..., 1] - np.maximum(bgr[..., 0], bgr[..., 2])          # how green: the screen is, the cat is not
    gb = float(np.median(gdom[:b].ravel().tolist() + gdom[:, :b].ravel().tolist() + gdom[:, -b:].ravel().tolist()))
    rough = gdom < 0.4 * gb
    rough = ndi.binary_opening(rough, iterations=2)
    lab, n = ndi.label(rough)
    if n:
        sz = ndi.sum(rough, lab, range(1, n + 1)); rough = np.isin(lab, 1 + np.nonzero(sz > sz.max() * 0.05)[0])
    m = (~ndi.binary_dilation(rough, iterations=12)).astype(np.float32)
    s = 24
    bg = cv2.GaussianBlur(bgr * m[..., None], (0, 0), s) / np.clip(cv2.GaussianBlur(m, (0, 0), s), 1e-3, None)[..., None]
    lum = bgr.mean(2)
    fur = np.median(bgr[rough & (lum <= np.percentile(lum[rough], 20))], 0) if rough.any() else np.zeros(3, np.float32)
    d = bg - fur
    a = np.clip((((bg - bgr) * d).sum(2)) / np.clip((d * d).sum(2), 1e-4, None), 0, 1)
    a = np.clip((a - 0.10) / 0.72, 0, 1)
    solid = a > 0.5
    lab, n = ndi.label(solid)
    if n == 0:
        return np.zeros((h, w), np.float32), bgr
    sz = ndi.sum(solid, lab, range(1, n + 1))
    body = ndi.binary_fill_holes(np.isin(lab, 1 + np.nonzero(sz > sz.max() * 0.02)[0]))
    near = ndi.binary_dilation(body, iterations=3)
    alpha = np.where(body, 1.0, a * near).astype(np.float32)
    alpha = np.maximum(alpha, cv2.GaussianBlur(body.astype(np.float32), (0, 0), 0.7) * body)
    aa = np.clip(alpha, 0.1, 1)[..., None]
    fg = np.clip((bgr - (1 - aa) * bg) / aa, 0, 1)
    fg = np.where(alpha[..., None] > 0.97, bgr, fg)
    g = fg[..., 1]; cap = np.maximum(fg[..., 0], fg[..., 2]) + 0.03            # no green spill on the fur
    edge = ndi.binary_dilation(alpha < 0.99, iterations=3)[..., None] & (alpha[..., None] > 0)
    fg[..., 1] = np.where(edge[..., 0] | (bgr.mean(2) < 0.3), np.minimum(g, cap), g)
    # what is still green and only partly there is left-over screen (its shadow, a reflection between the legs): drop it
    green = np.clip(((bgr[..., 1] - np.maximum(bgr[..., 0], bgr[..., 2])) - 0.02) * 10, 0, 1)
    alpha = np.where(alpha < 0.99, alpha * (1 - green), alpha).astype(np.float32)
    return alpha, fg


mats = [key(f) for f in frames]
if len(sys.argv) > 4:                                                   # debug: save one frame's cut-out
    a, fg = mats[int(sys.argv[4])]
    cv2.imwrite(os.path.join(OUT, NAME + '-dbg.png'), np.hstack([frames[int(sys.argv[4])], np.dstack([a] * 3), fg * a[..., None] + 0.5 * (1 - a[..., None])]) * 255)
    print('alpha>0.5 px', int((a > 0.5).sum()), [int((m[0] > 0.5).sum()) for m in mats][:70])
al = [m[0] for m in mats]
S = np.array([cv2.resize(a, (96, int(96 * h / w)), interpolation=cv2.INTER_AREA).ravel() for a in al])
sq = (S ** 2).sum(1)
D = np.sqrt(np.maximum(sq[:, None] + sq[None, :] - 2 * S @ S.T, 0) / S.shape[1])
step = float(np.mean(np.diagonal(D, 1)))
best = None
n = len(al)
for i in range(3, max(4, n // 3)):
    for j in range(i + 10, n - 2):
        c = (D[i, j] + D[i + 1, j + 1] + D[i - 1, j - 1]) / 3
        sc = c / step - 0.01 * (j - i)
        if best is None or sc < best[0]:
            best = (sc, i, j, c / step)
_, i, j, seam = best
print(f'{n} frames; loop {i}..{j - 1} ({j - i} frames), seam {seam:.2f}x a normal frame change')
# ease the join: the last few frames of the loop lean towards the frames just before it starts
for k in range(3):
    t = (k + 1) / 4
    a1, f1 = mats[j - 3 + k]; a0, f0 = mats[i - 3 + k]
    am = a1 * (1 - t) + a0 * t
    fm = (f1 * (a1 * (1 - t))[..., None] + f0 * (a0 * t)[..., None]) / np.clip(am, 1e-4, 1)[..., None]
    mats[j - 3 + k] = (am, np.clip(fm, 0, 1))
loop = mats[i:j]
# the floor: where the lowest paws are most of the time
lows = [np.nonzero(a.max(1) > 0.5)[0].max() for a, _ in loop]
ground = float(np.percentile(lows, 80))
tops = [np.nonzero(a.max(1) > 0.5)[0].min() for a, _ in loop]
height = ground - float(np.median(tops))
# paw slide per frame along the floor
y0, y1 = int(ground) - 8, int(ground) + 2
prof = [a[y0:y1].max(0) for a, _ in loop] + [loop[0][0][y0:y1].max(0)]
shifts = []
for p, q in zip(prof[:-1], prof[1:]):
    if p.sum() < 4 or q.sum() < 4:
        continue
    cand = list(range(-40, 41))
    shifts.append(cand[int(np.argmax([float(np.minimum(np.roll(p, s), q).sum()) for s in cand]))])
neg = [x for x in shifts if x < 0]
v = -float(np.median(neg if len(neg) > len(shifts) / 2 else shifts))
faces = 'right' if v >= 0 else 'left'
print('paw slide per frame', shifts[:20], '-> speed', v, 'faces', faces)
union = np.max(np.array([a > 0.03 for a, _ in loop]), 0)
ys, xs = np.nonzero(union)
x0, x1, yy0, yy1 = max(0, xs.min() - 4), min(w, xs.max() + 5), max(0, ys.min() - 4), min(h, max(int(ground) + 6, ys.max() + 3))
cw, ch = x1 - x0, yy1 - yy0
cols = max(1, min(len(loop), 4096 // cw))
rows = -(-len(loop) // cols)
sheet = np.zeros((rows * ch, cols * cw, 4), np.uint8)
for k, (a, fg) in enumerate(loop):
    r, c = divmod(k, cols)
    rgba = np.dstack([fg[yy0:yy1, x0:x1, ::-1], a[yy0:yy1, x0:x1, None]])
    sheet[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] = np.clip(rgba * 255 + 0.5, 0, 255).astype(np.uint8)
Image.fromarray(sheet, 'RGBA').save(os.path.join(OUT, NAME + '.webp'), 'WEBP', quality=88, method=5, alpha_quality=95)
cx = float(np.average(np.arange(w), weights=union.sum(0) + 1e-6))
info = {'fps': 16, 'frames': len(loop), 'cell': [int(cw), int(ch)], 'cols': int(cols), 'sheet': NAME + '.webp', 'anchor': [round(cx - x0, 1), round(ground - yy0, 1)],
        'height': round(height, 1), 'speed': round(abs(v), 2), 'faces': faces, 'seam': round(seam, 2)}
json.dump(info, open(os.path.join(OUT, NAME + '.json'), 'w'), default=float)
print(info, round(os.path.getsize(os.path.join(OUT, NAME + '.webp')) / 1e6, 2), 'MB')
