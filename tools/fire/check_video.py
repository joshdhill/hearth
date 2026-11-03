"""Check a finished fire loop: visible cuts (including the seam where it loops) and how soon
the same footage comes back.

usage: check_video.py <video or .m3u8> [more...]
"""
import subprocess, sys
import numpy as np

W, H = 96, 54


def frames(path):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-an', '-vf', f'scale={W}:{H}:flags=area,format=gray',
                        '-f', 'rawvideo', '-'], capture_output=True, check=True)
    fps = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate',
                          '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip().split('\n')[0]
    a, b = fps.split('/')
    return np.frombuffer(r.stdout, np.uint8).reshape(-1, H * W).astype(np.float32) / 255, float(a) / float(b)


for path in sys.argv[1:]:
    F, fps = frames(path)
    L = len(F)
    # cuts: frame-to-frame change, including last -> first
    d = np.abs(np.diff(np.vstack([F, F[:1]]), axis=0)).mean(1)
    med = float(np.median(d))
    top = np.argsort(-d)[:5]
    seam = d[-1] / med
    # repeats: for each frame, the nearest later time (around the loop) showing near-identical footage
    sq = (F ** 2).sum(1)
    Dm = np.sqrt(np.maximum(sq[:, None] + sq[None, :] - 2 * F @ F.T, 0) / F.shape[1])
    step = float(np.median(np.diagonal(Dm, 1)))
    same = Dm < 0.35 * step
    lag = (np.arange(L)[None, :] - np.arange(L)[:, None]) % L
    lag = np.where(same & (lag > fps * 1.0), lag, L)
    soon = lag.min(1) / fps
    # long repeats only: footage that comes back as a run of 2+ seconds
    print(f'{path}: {L / fps:.1f}s @ {fps:g}fps')
    print(f'  cuts: seam {seam:.2f}x a normal frame change, biggest '
          + ', '.join(f'{d[t] / med:.1f}x at {t / fps:.1f}s' for t in top))
    print(f'  same footage returns after: soonest {soon.min():.1f}s, 5% {np.percentile(soon, 5):.1f}s, '
          f'median {np.median(soon):.1f}s; shown once per loop {np.mean(soon >= L / fps - 0.01):.0%}')
