"""Things standing on the hearth that the cat must pass behind (the fire-tool stand): cut them out
of the room layers as small images to draw over the cat. They are cut from the finished room and
lit layers, so they match the picture exactly.

usage: front.py <master-x4.png> <layerdir>   (bbox below is in picture px of the wide master)"""
import json, os, sys
import numpy as np, cv2
from scipy import ndimage as ndi
from PIL import Image

src, D = sys.argv[1], sys.argv[2]
X0, X1, Y0, Y1 = 1100, 1262, 265, 540
M = cv2.imread(src); K = M.shape[0] / 572.0
c = M[int(Y0 * K):int(Y1 * K), int(X0 * K):int(X1 * K)].astype(np.float32) / 255
lum, sat = c.mean(2), c.max(2) - c.min(2)
dark = ndi.binary_opening(ndi.binary_closing((lum < 0.13) & (sat < 0.10), iterations=3), iterations=2)
lab, n = ndi.label(dark)
sz = ndi.sum(dark, lab, range(1, n + 1))
mask = ndi.binary_fill_holes(lab == 1 + int(np.argmax(sz)))
mask = cv2.GaussianBlur(ndi.binary_dilation(mask, iterations=2).astype(np.float32), (0, 0), 1.2)
info = json.load(open(os.path.join(D, 'fireside.json')))
KD, MAR = 1080 / 572.0, info['margin'] / (1080 / 572.0)
out = {}
for tag, hpx in (('4k', 2160), ('2k', 1080)):
    s = hpx / 572.0
    box = [int(X0 * s), int(Y0 * s), int(X1 * s), int(Y1 * s)]
    m = cv2.resize(mask, (box[2] - box[0], box[3] - box[1]), interpolation=cv2.INTER_AREA)
    for layer in ('room', 'lit'):
        im = np.asarray(Image.open(os.path.join(D, f'{layer}-{tag}.webp')).convert('RGBA')).astype(np.float32)
        cr = im[box[1]:box[3], box[0]:box[2]].copy()
        cr[..., 3] *= m
        Image.fromarray(np.clip(cr + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(D, f'front-{layer}-{tag}.webp'), 'WEBP', quality=90, alpha_quality=95)
out = {'x': round(X0 * KD - info['margin'], 1), 'y': round(Y0 * KD, 1), 'w': round((X1 - X0) * KD, 1), 'h': round((Y1 - Y0) * KD, 1)}
info['front'] = [out]
json.dump(info, open(os.path.join(D, 'fireside.json'), 'w'), indent=1)
print(out)
