"""Stage for the Firebox picture: the straightened fire footage set into an opening in the middle of
the screen, everything around it left for FLUX Fill to paint as a tidy brick fireplace.

Footage: the clip as filmed is warped so the fireplace is square on (corners.json: where the output
corners come from in the clip). Its opening (the firebox, from the top of the frame down to the front
of the firebox floor) is placed at OPEN in scene px (1920x1080); the rest is masked for painting.

usage: firebox_stage.py <frame-as-filmed.png> <outdir>"""
import json, os, sys
import numpy as np, cv2

src, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
c = json.load(open(os.path.join(HERE, 'firebox', 'corners.json')))['corners']
M = cv2.getPerspectiveTransform(np.float32(c), np.float32([[0, 0], [1920, 0], [0, 1080], [1920, 1080]]))
# the opening in the straightened footage (px of the 1920x1080 straightened frame)
FX0, FX1, FY0, FY1 = 200, 1707, 0, 1000
K = 0.74                                          # footage scale in the scene
OX0 = 960 - (FX1 - FX0) * K / 2; OY0 = 170
OPEN = [OX0, OY0, OX0 + (FX1 - FX0) * K, OY0 + (FY1 - FY0) * K]
BOX = {'x': round(OX0 - FX0 * K, 1), 'y': round(OY0 - FY0 * K, 1), 'w': round(1920 * K, 1), 'h': round(1080 * K, 1)}
f = cv2.imread(src)
s = cv2.warpPerspective(f, M, (1920, 1080), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
v = np.power(s.astype(np.float32) / 255, 1 / 1.5) * 1.08 * np.array([0.88, 1.0, 1.10], np.float32)   # the loop's grade
s = (np.clip(v, 0, 1) * 255).astype(np.uint8)
SC = 572 / 1080                                   # the stage is painted at 1018x572 (two 716-px tiles), then enlarged 4x
Wst, Hst = 1018, 572
scene = np.full((1080, 1920, 3), 127, np.uint8)
x, y, w, h = BOX['x'], BOX['y'], BOX['w'], BOX['h']
fit = cv2.resize(s, (int(round(w)), int(round(h))), interpolation=cv2.INTER_AREA)
xi, yi = int(round(x)), int(round(y))
y1 = min(1080, yi + fit.shape[0]); x1 = min(1920, xi + fit.shape[1])
scene[yi:y1, xi:x1] = fit[:y1 - yi, :x1 - xi]
mask = np.full((1080, 1920), 255, np.uint8)
o = [int(round(v)) for v in OPEN]
mask[o[1]:o[3], o[0]:o[2]] = 0
stage = cv2.resize(scene, (Wst, Hst), interpolation=cv2.INTER_AREA)
m = (cv2.resize(mask, (Wst, Hst), interpolation=cv2.INTER_NEAREST) > 127).astype(np.uint8) * 255
stage[m > 0] = 127
cv2.imwrite(os.path.join(OUT, 'stage1.png'), stage)
cv2.imwrite(os.path.join(OUT, 'stage1-mask.png'), m)
json.dump({'open': [round(v, 1) for v in OPEN], 'video': BOX, 'footage_open': [FX0, FY0, FX1, FY1], 'k': K}, open(os.path.join(OUT, 'geom.json'), 'w'), indent=1)
print('opening (scene px)', [round(v) for v in OPEN], 'video box', BOX)
