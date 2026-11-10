"""Upscale a picture 4x with real super-resolution models (run on the build machine).

usage: upscale.py <in> <outdir>
Writes <name>-x4-<model>.png for each model that loads.
"""
import os, sys, time, urllib.request
import numpy as np, torch
from PIL import Image
from spandrel import ModelLoader

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
name = os.path.splitext(os.path.basename(src))[0]
MODELS = {
    'esrgan': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
    'general': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth',
    'swinir': 'https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/003_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR-L_x4_GAN.pth',
}
want = (os.environ.get('MODELS') or 'esrgan,general,swinir').split(',')
img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
H, W, _ = img.shape
torch.set_num_threads(os.cpu_count())


def run(model, tile=192, pad=24):
    s = model.scale
    res = np.zeros((H * s, W * s, 3), np.float32)
    wsum = np.zeros((H * s, W * s, 1), np.float32)
    ys = list(range(0, H, tile)); xs = list(range(0, W, tile))
    for y in ys:
        for x in xs:
            y0, y1, x0, x1 = max(0, y - pad), min(H, y + tile + pad), max(0, x - pad), min(W, x + tile + pad)
            t = torch.from_numpy(img[y0:y1, x0:x1].transpose(2, 0, 1))[None]
            # pad to a multiple of 8 (SwinIR windows)
            ph, pw = (-t.shape[2]) % 8, (-t.shape[3]) % 8
            t = torch.nn.functional.pad(t, (0, pw, 0, ph), mode='reflect')
            with torch.no_grad():
                o = model(t)[0].clamp(0, 1).numpy().transpose(1, 2, 0)
            o = o[:(y1 - y0) * s, :(x1 - x0) * s]
            # feathered blend between tiles
            wy = np.minimum(np.arange(o.shape[0]) + 1, np.arange(o.shape[0])[::-1] + 1).clip(max=pad * s) / (pad * s)
            wx = np.minimum(np.arange(o.shape[1]) + 1, np.arange(o.shape[1])[::-1] + 1).clip(max=pad * s) / (pad * s)
            w = (wy[:, None] * wx[None, :])[..., None].astype(np.float32) + 1e-4
            res[y0 * s:y1 * s, x0 * s:x1 * s] += o * w
            wsum[y0 * s:y1 * s, x0 * s:x1 * s] += w
        print('  row', y, flush=True)
    return res / wsum


for key in want:
    try:
        t0 = time.time()
        f = f'/tmp/{key}.pth'
        urllib.request.urlretrieve(MODELS[key], f)
        m = ModelLoader().load_from_file(f)
        m.eval()
        o = run(m)
        Image.fromarray((o * 255 + 0.5).astype(np.uint8)).save(f'{out}/{name}-x4-{key}.png')
        print(key, 'done in', round(time.time() - t0), 's', flush=True)
    except Exception as e:
        print(key, 'FAILED', repr(e)[:300], flush=True)
