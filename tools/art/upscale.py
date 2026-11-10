"""Enlarge a picture 4x with Real-ESRGAN (runs on the build machine's CPU, in tiles).
usage: upscale.py <in> <out.png> [tile]"""
import sys
import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

src, dst = sys.argv[1], sys.argv[2]
T = int(sys.argv[3]) if len(sys.argv) > 3 else 200
PAD = 16
model = ModelLoader().load_from_file('RealESRGAN_x4plus.pth').model.eval()
torch.set_num_threads(4)
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
H, W, _ = im.shape
out = np.zeros((H * 4, W * 4, 3), np.float32)
padded = np.pad(im, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='reflect')
n = 0
with torch.no_grad():
    for y in range(0, H, T):
        for x in range(0, W, T):
            h, w = min(T, H - y), min(T, W - x)
            tile = padded[y:y + h + 2 * PAD, x:x + w + 2 * PAD]
            t = torch.from_numpy(tile.transpose(2, 0, 1))[None]
            r = model(t)[0].clamp(0, 1).numpy().transpose(1, 2, 0)
            out[y * 4:(y + h) * 4, x * 4:(x + w) * 4] = r[PAD * 4:(PAD + h) * 4, PAD * 4:(PAD + w) * 4]
            n += 1
            print('tile', n, flush=True)
Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(dst)
print('saved', dst, out.shape)
