"""Stage 2 of the fireplace recomposition: paint the masked areas (wall above the mantel with the
tops of the candles and plant, the extra width at the sides, the wall where the log holder and
the fire tools used to be) with FLUX Fill, half the picture at a time so the model works at more
than the picture's own resolution; the second half carries on from the first.

usage: fill_scene.py <stage1.png> <mask.png> <outdir> [seed]"""
import os, sys, time
import numpy as np, cv2
from gradio_client import Client, handle_file

src, maskp, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 11
os.makedirs(OUT, exist_ok=True)
img = cv2.imread(src)
mask = (cv2.imread(maskp, 0) > 127).astype(np.uint8)
H, W = mask.shape
PROMPT = ("Photograph of a rustic red brick fireplace wall with a thick reclaimed wood mantel beam. Weathered red bricks in running bond "
          "with gray mortar fill the whole wall. On the mantel stand pillar candles, glass jar candles and a ceramic pot with a leafy trailing "
          "pothos plant. Plain brick wall with nothing else on it. Warm, moody interior light, shallow depth, highly detailed.")
TW = 716
tiles = [(0, TW), (W - TW, W)]
client = Client('black-forest-labs/FLUX.1-Fill-dev', verbose=False)
done = np.zeros_like(mask)
for n, (x0, x1) in enumerate(tiles):
    m = mask[:, x0:x1] * (1 - done[:, x0:x1])
    if m.sum() == 0:
        continue
    tile = img[:, x0:x1]
    # grey out the unknown pixels so no stale colour leaks in at the mask edge
    t = tile.copy(); t[m > 0] = 127
    cv2.imwrite(f'{OUT}/tile{n}.png', t)
    cv2.imwrite(f'{OUT}/tile{n}-mask.png', cv2.merge([m * 255] * 3))
    res = None
    for attempt in range(3):
        try:
            t0 = time.time()
            job = client.submit(edit_images={'background': handle_file(f'{OUT}/tile{n}.png'), 'layers': [handle_file(f'{OUT}/tile{n}-mask.png')],
                                             'composite': handle_file(f'{OUT}/tile{n}.png')},
                                prompt=PROMPT, seed=seed + n, randomize_seed=False, width=1024, height=816, guidance_scale=30,
                                num_inference_steps=28, api_name='/infer')
            res = job.result(timeout=400)
            print('tile', n, 'took', round(time.time() - t0), 's', str(res)[:200], flush=True)
            break
        except Exception as e:
            print('tile', n, 'failed:', repr(e)[:400], flush=True)
            time.sleep(15)
    if res is None:
        break
    path = res[0] if isinstance(res, (list, tuple)) else res
    if isinstance(path, dict):
        path = path.get('path')
    out = cv2.imread(path)
    print('  model output', out.shape, flush=True)
    out = cv2.resize(out, (x1 - x0, H), interpolation=cv2.INTER_AREA)
    cv2.imwrite(f'{OUT}/tile{n}-out.png', out)
    soft = cv2.GaussianBlur(cv2.dilate(m, np.ones((5, 5), np.uint8)).astype(np.float32), (0, 0), 1.6)[..., None]
    soft = np.maximum(soft, m[..., None].astype(np.float32))
    img[:, x0:x1] = (out * soft + tile * (1 - soft)).astype(np.uint8)
    done[:, x0:x1] = np.maximum(done[:, x0:x1], m)
cv2.imwrite(f'{OUT}/filled.png', img)
left = int((mask * (1 - done)).sum())
print('unfilled pixels left:', left)
open(f'{OUT}/status.txt', 'w').write(f'unfilled {left}\n')
