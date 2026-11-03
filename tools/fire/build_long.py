"""Build a long, seamless fireplace loop from one short clip.

The clip is cut into runs of 4-12 seconds and re-joined in a new order, but only where the
fire in both places looks alike (a "video texture"). Each join is a half-second blend done in
linear light, so flames fade the way real light does. The last join leads back into the first
frame, so the whole thing loops with no visible restart.

usage: build_long.py <src.mp4> <name> <tv_seconds> <web_seconds> <outdir>
"""
import json, os, random, subprocess, sys
import cv2
import numpy as np

src, name, TV_S, WEB_S, OUT = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
os.makedirs(OUT, exist_ok=True)


def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                        'stream=width,height,r_frame_rate', '-of', 'json', path], capture_output=True, text=True, check=True)
    s = json.loads(r.stdout)['streams'][0]
    a, b = s['r_frame_rate'].split('/')
    return s['width'], s['height'], float(a) / float(b)


Wd, Hd, FPS = probe(src)
print(f'{name}: {Wd}x{Hd} @ {FPS:.3f}', flush=True)

# ---- 1. every frame as a near-lossless JPEG, for exact random access --------------------------
FR = f'/tmp/frames-{name}'
os.makedirs(FR, exist_ok=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-an', '-fps_mode', 'passthrough',
                '-vf', 'scale=in_color_matrix=bt709:out_color_matrix=bt601:out_range=pc,format=yuvj444p',
                '-q:v', '1', '-qmin', '1', f'{FR}/%05d.jpg'], check=True)
FILES = sorted(os.listdir(FR))
N = len(FILES)

# ---- 2. small copies of every frame, and how alike every pair of moments is -------------------
sw, sh = 160, 90
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-an', '-fps_mode', 'passthrough', '-vf', f'scale={sw}:{sh}:flags=area',
                      '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True, check=True).stdout
S = np.frombuffer(raw, np.uint8).reshape(-1, sh, sw, 3).astype(np.float32)[:N] / 255
N = min(N, len(S))
# weight the moving part of the picture (the fire) and ignore the still bricks
std = S.mean(3).std(0)
wmap = np.clip(std / max(1e-6, np.percentile(std, 95)), 0.15, 1.0)[..., None]
X = (S * np.sqrt(wmap)).reshape(N, -1)
sq = (X ** 2).sum(1)
D = np.sqrt(np.maximum(sq[:, None] + sq[None, :] - 2 * X @ X.T, 0) / X.shape[1])
if os.environ.get('D_ONLY'):     # just the similarity data, for working on the planner elsewhere
    np.savez_compressed(f'{OUT}/{name}-D.npz', D=D.astype(np.float16), fps=FPS, lum=S.mean((1, 2, 3)).astype(np.float32),
                        wmap=wmap[..., 0].astype(np.float16))
    raise SystemExit(0)

from loopplan import Planner
P = Planner(D, FPS)
K, step = P.K, P.step
print(f'frames {N}, blend {K}, step {step:.4f}, threshold {P.THR / step:.2f}x a normal frame change, '
      f'joins {int(P.ok.sum())}, usable landing frames {P.alive.mean():.0%}, '
      f'unique footage {P.unique_s:.1f}s (clip repeats {P.repeat_frac:.0%} of itself), '
      f'joined-up footage {P.usable_s:.1f}s', flush=True)


def best_plan(target_s, seeds):
    """Several walks; keep the one where footage comes back latest, with no weak join."""
    best = None
    for sd in seeds:
        try:
            st, sg = P.plan(target_s, sd)
        except SystemExit as e:
            print('  seed', sd, e, flush=True)
            continue
        r = P.check(st, sg)
        score = r['repeat_p5'] + 0.5 * r['repeat_soonest'] - 4 * max(0, r['worst_join'] - P.THR / step)
        print('  seed', sd, r, flush=True)
        if best is None or score > best[0]:
            best = (score, st, sg, r)
    if best is None:
        raise SystemExit('could not plan a loop')
    return best[1], best[2], best[3]


if os.environ.get('PLAN_ONLY'):
    for tgt in (120, 300):
        best_plan(tgt, range(1, 9))
    raise SystemExit(0)


# ---- 3. rendering ------------------------------------------------------------------------------------
TO_LIN = ((np.arange(256) / 255.0) ** 2.2).astype(np.float32)          # close enough to sRGB for blending
TO_SRGB = (np.clip(np.linspace(0, 1, 4096) ** (1 / 2.2), 0, 1) * 255 + 0.5).astype(np.uint8)


def frame(i, size=None):
    im = cv2.imread(f'{FR}/{FILES[i]}', cv2.IMREAD_COLOR)
    if size and (im.shape[1], im.shape[0]) != size:
        im = cv2.resize(im, size, interpolation=cv2.INTER_AREA)
    return im


def blend(a, b, t):
    x = TO_LIN[a] * (1 - t) + TO_LIN[b] * t
    return TO_SRGB[np.clip((x * 4095).astype(np.int32), 0, 4095)]


def frames_of(segs, size=None):
    for (cur, i, j, _c) in segs:
        for f in range(cur, i):
            yield frame(f, size)
        for k in range(K):
            t = (k + 1) / (K + 1)
            yield blend(frame(i + k, size), frame(j + k, size), t)


def render(segs, cmd, size):
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = 0
    for im in frames_of(segs, size):
        p.stdin.write(im.tobytes()); n += 1
        if n % 900 == 0:
            print(f'  {n} frames', flush=True)
    p.stdin.close()
    if p.wait():
        raise SystemExit('encoder failed')
    return n


info = dict(name=name, src=f'{Wd}x{Hd}@{FPS:.2f}', clip_seconds=round(N / FPS, 1), unique_seconds=round(P.unique_s, 1),
            usable_seconds=round(P.usable_s, 1),
            threshold_vs_step=round(P.THR / step, 2))

# TV: 4K, 10-bit HEVC
s0, tv, info['tv'] = best_plan(TV_S, range(1, 13))
print(info['tv'], flush=True)
raw_in = ['-f', 'rawvideo', '-pix_fmt', 'bgr24', '-r', f'{FPS:.6f}']
color = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
render(tv, ['ffmpeg', '-v', 'error', '-y', *raw_in, '-s', f'{Wd}x{Hd}', '-i', '-',
            '-vf', 'scale=in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p10le',
            '-c:v', 'libx265', '-preset', 'fast', '-crf', '20', '-profile:v', 'main10', '-tag:v', 'hvc1',
            '-x265-params', f'keyint={int(FPS * 2)}:min-keyint={int(FPS * 2)}:vbv-maxrate=32000:vbv-bufsize=64000:log-level=error',
            *color, '-movflags', '+faststart', f'{OUT}/{name}-4k.mp4'], None)

# Web and phones: 1080p H.264 as HLS (iPhones play it natively)
_, web, info['web'] = best_plan(WEB_S, range(21, 33))
print(info['web'], flush=True)
os.makedirs(f'{OUT}/{name}-web', exist_ok=True)
g = int(round(FPS * 2))
render(web, ['ffmpeg', '-v', 'error', '-y', *raw_in, '-s', '1920x1080', '-i', '-',
             '-vf', 'scale=in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p',
             '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-maxrate', '7M', '-bufsize', '14M', '-profile:v', 'high',
             '-level', '4.2', '-g', str(g), '-keyint_min', str(g), '-sc_threshold', '0', *color,
             '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_segment_type', 'mpegts',
             '-hls_segment_filename', f'{OUT}/{name}-web/seg%03d.ts', f'{OUT}/{name}-web/index.m3u8'], (1920, 1080))

# poster and a sheet of join midpoints to check by eye
cv2.imwrite(f'{OUT}/{name}-poster.jpg', cv2.resize(frame(s0 + K), (1280, 720), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
tiles = []
for (cur, i, j, _c) in sorted(dict(((s[1], s[2]), s) for s in tv).values(), key=lambda s: -s[3])[:6]:      # six weakest joins
    m = K // 2
    row = [cv2.resize(frame(i + m - K), (480, 270)), cv2.resize(blend(frame(i + m), frame(j + m), 0.5), (480, 270)),
           cv2.resize(frame(j + K + m), (480, 270))]
    tiles.append(np.hstack(row))
cv2.imwrite(f'{OUT}/{name}-joins.jpg', np.vstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 80])
json.dump(info, open(f'{OUT}/{name}.json', 'w'), indent=1)
print(json.dumps(info), flush=True)
