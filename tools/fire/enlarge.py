"""Enlarge a short fireplace clip to 4K, with real detail in the parts that stay still.

The bricks, floor, grate and logs don't move, so one still picture of them (the clip's median
frame) is enlarged 4x with Real-ESRGAN and its fine detail is laid over every frame, scaled to
that frame's own brightness (so the firelight flicker is kept). The moving parts (flames, embers,
smoke) are enlarged smoothly with no added detail, which keeps them free of shimmer.

usage: enlarge.py plate <src.mp4> <plate.png>                    the still picture to enlarge
       enlarge.py build <src.mp4> <plate.png> <plate_x4.png> <out.mp4>
"""
import json, subprocess, sys
import cv2
import numpy as np

OW, OH = 3840, 2160


def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate',
                        '-of', 'json', path], capture_output=True, text=True, check=True)
    s = json.loads(r.stdout)['streams'][0]
    a, b = s['r_frame_rate'].split('/')
    return s['width'], s['height'], float(a) / float(b)


def frames(path, w, h):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    while True:
        b = p.stdout.read(w * h * 3)
        if len(b) < w * h * 3:
            break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)


mode, src = sys.argv[1], sys.argv[2]
w, h, fps = probe(src)

if mode == 'plate':
    allf = np.stack(list(frames(src, w, h)))
    cv2.imwrite(sys.argv[3], np.median(allf, 0).astype(np.uint8))
    raise SystemExit(0)

plate_lo = cv2.imread(sys.argv[3]).astype(np.float32) / 255
x4 = cv2.imread(sys.argv[4]).astype(np.float32) / 255
out = sys.argv[5]

# how much each spot moves: the detail is only laid where things stay still
allf = np.stack([f.astype(np.float32).mean(2) / 255 for f in frames(src, w, h)])
move = allf.std(0)
still = np.clip(1 - (move - 0.012) / 0.03, 0, 1)
still = cv2.GaussianBlur(still, (0, 0), 3)
still = cv2.resize(still, (OW, OH), interpolation=cv2.INTER_LINEAR)[..., None]

plate_hr = cv2.resize(x4, (OW, OH), interpolation=cv2.INTER_AREA)
plate_up = cv2.resize(plate_lo, (OW, OH), interpolation=cv2.INTER_LANCZOS4)
detail = plate_hr - plate_up
# keep it to fine detail, and not too strong (the enlarger can over-sharpen)
detail = (detail - cv2.GaussianBlur(detail, (0, 0), 6)) * 0.85
blur_plate = cv2.GaussianBlur(plate_lo.mean(2), (0, 0), 4) + 0.02

enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{OW}x{OH}', '-r', f'{fps:.6f}',
                        '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', out], stdin=subprocess.PIPE)
for i, f in enumerate(frames(src, w, h)):
    lo = f.astype(np.float32) / 255
    up = cv2.resize(lo, (OW, OH), interpolation=cv2.INTER_LANCZOS4)
    ratio = (cv2.GaussianBlur(lo.mean(2), (0, 0), 4) + 0.02) / blur_plate
    ratio = cv2.resize(np.clip(ratio, 0.5, 2.0), (OW, OH), interpolation=cv2.INTER_LINEAR)[..., None]
    o = up + detail * ratio * still
    enc.stdin.write((np.clip(o, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
    if i == 48:
        cv2.imwrite(out.replace('.mp4', '-still.png'), (np.clip(o, 0, 1) * 255 + 0.5).astype(np.uint8))
        cv2.imwrite(out.replace('.mp4', '-plain.png'), (np.clip(up, 0, 1) * 255 + 0.5).astype(np.uint8))
enc.stdin.close()
if enc.wait():
    raise SystemExit('encoder failed')
print('wrote', out)
