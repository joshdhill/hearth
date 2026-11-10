"""Put each key pose of the cat on the same cream stage: same scale (matched by head size), same
ground line, hips at the same spot. Video is generated between these, so every clip lines up.

usage: cat_canvases.py <outdir>"""
import json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from catmatte import cutout, CREAM

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(__file__)
CW, CH = 1280, 720
UNITS = 2500.0                      # stage width, in pixels of the original illustration
S = CW / UNITS
GROUND = (UNITS * 9 / 16 - 90) * S  # y of the floor on the stage
HIP_X = 800 * S                     # x of the cat's hips on the stage
# pose: file, scale to original-illustration pixels, hip x in its own pixels
POSES = {
    'sit':   ('src/cat.jpg', 1.0, 560),
    'stand': ('keys/stand-a.png', 1.52, 370),
    'lie':   ('keys/lie-a.png', 1.46, 300),
}
meta = {'canvas': [CW, CH], 'ground': GROUND, 'hip_x': HIP_X, 'units_per_px': 1 / S, 'poses': {}}
for name, (f, k, hip) in POSES.items():
    a, fg, (x0, y0, x1, y1) = cutout(os.path.join(HERE, f))
    sc = k * S
    h, w = a.shape
    M = np.float32([[sc, 0, HIP_X - hip * sc], [0, sc, GROUND - y1 * sc]])
    A = cv2.warpAffine(a, M, (CW, CH), flags=cv2.INTER_AREA if sc < 1 else cv2.INTER_CUBIC)
    F = cv2.warpAffine(fg, M, (CW, CH), flags=cv2.INTER_AREA if sc < 1 else cv2.INTER_CUBIC)
    canvas = np.ones((CH, CW, 3), np.float32) * CREAM
    canvas = canvas * (1 - A[..., None]) + F * A[..., None]
    cv2.imwrite(f'{OUT}/{name}.png', np.clip(canvas * 255 + 0.5, 0, 255).astype(np.uint8))
    rgba = np.dstack([np.clip(F * 255 + 0.5, 0, 255), np.clip(A * 255 + 0.5, 0, 255)]).astype(np.uint8)
    cv2.imwrite(f'{OUT}/{name}-cut.png', rgba)
    ys, xs = np.nonzero(A > 0.5)
    meta['poses'][name] = {'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]}
    print(name, 'bbox on stage', meta['poses'][name]['bbox'])
json.dump(meta, open(f'{OUT}/stage.json', 'w'), indent=1)
