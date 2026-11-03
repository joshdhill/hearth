"""Measure a fire clip: steadiness of the camera, and how well it can loop or be re-spliced.
usage: analyze.py <video> <name> <outdir>"""
import json, sys
import cv2, numpy as np

path, name, out = sys.argv[1:4]
cap = cv2.VideoCapture(path)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
small = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    small.append(cv2.resize(f, (128, 72), interpolation=cv2.INTER_AREA).astype(np.float32) / 255)
F = np.stack(small)
N = len(F)
gray = F.mean(axis=3)
std = gray.std(axis=0)
static_frac = float((std < 0.025).mean())          # share of the picture that never changes
# camera drift: compare the steady parts of the first and last second
mask = (std < 0.03).astype(np.float32)
drift = float((np.abs(gray[:int(fps)].mean(0) - gray[-int(fps):].mean(0)) * mask).sum() / max(1, mask.sum()))

X = F.reshape(N, -1)
sq = (X ** 2).sum(1)
D = np.sqrt(np.maximum(sq[:, None] + sq[None, :] - 2 * X @ X.T, 0) / X.shape[1])
K = max(1, int(round(fps * 0.5)))
M = N - K
W = np.zeros((M, M), np.float32)
for k in range(K + 1):
    W += D[k:k + M, k:k + M]
W /= K + 1
med = float(np.median(D[np.triu_indices(N, int(fps * 2))]))
step = float(np.mean([D[i, i + 1] for i in range(N - 1)]))
# best whole-clip loop: jump from frame b back to frame a, as long as possible
minlen = int(N * 0.6)
bestc, besta, bestb = 9e9, 0, 0
for a in range(0, M - minlen):
    row = W[a + minlen:M, a]
    j = int(np.argmin(row)); c = float(row[j])
    if c < bestc:
        bestc, besta, bestb = c, a, a + minlen + j
# splice points for longer playback: jumps at least 3 s away that look like ordinary motion
gap = int(fps * 3)
iu = np.abs(np.arange(M)[:, None] - np.arange(M)[None, :]) > gap
good = int(((W < step * 3.0) & iu).sum())
ok = int(((W < med * 0.55) & iu).sum())
res = dict(name=name, frames=N, fps=round(fps, 3), seconds=round(N / fps, 1), static=round(static_frac, 3),
           drift=round(drift, 4), median=round(med, 4), step=round(step, 4),
           loop=dict(a=besta, b=bestb, seconds=round((bestb - besta) / fps, 1), cost=round(bestc, 4),
                     vs_step=round(bestc / step, 2), vs_median=round(bestc / med, 3)),
           splices_great=good, splices_ok=ok)
print(json.dumps(res))
json.dump(res, open(f'{out}/{name}.json', 'w'))
np.save(f'{out}/{name}-W.npy', W.astype(np.float16))
