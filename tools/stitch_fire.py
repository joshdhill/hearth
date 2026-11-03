#!/usr/bin/env python3
"""Make a long fireplace loop that doesn't visibly repeat.

A static-camera fire clip is cut into short pieces taken from random points and joined with
soft crossfades. The logs never move, and flames are different every moment, so the joins
can't be seen; the order never repeats within the output. The end crossfades back into the
start, so the whole file loops seamlessly too.

usage: stitch_fire.py SRC OUT_PREFIX [--minutes 2] [--fade 1.2] [--seed 7] [--size 3840] [--fps 0] [--dry]
writes OUT_PREFIX-4k.mp4 (HEVC Main10) and OUT_PREFIX-1080.mp4 (H.264, for browsers)
"""
import argparse, json, random, subprocess, sys


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True).stdout.strip()
    return float(out)


def plan(L, minutes, fade, seed):
    rnd = random.Random(seed)
    margin = 0.15
    pieces, total, prev = [], 0.0, None
    target = minutes * 60
    while total < target:
        ln = rnd.uniform(3.5, 6.5)
        for _ in range(50):
            st = rnd.uniform(margin, L - ln - margin)
            if prev is None or abs(st - prev) > 2.5:
                break
        pieces.append((round(st, 3), round(ln, 3)))
        total += ln - (fade if pieces[1:] else 0)
        prev = st
    a, l1 = pieces[0]
    # the first piece starts `fade` late; a short closing piece at its true start ends the file,
    # so the last frame flows straight into the first
    pieces[0] = (round(a + fade, 3), round(l1 - fade, 3))
    pieces.append((a, fade))
    return pieces


def build(src, prefix, pieces, fade, size, fps, dry):
    args = ['ffmpeg', '-v', 'warning', '-y']
    for st, ln in pieces:
        args += ['-ss', str(st), '-t', str(ln), '-i', src]
    f = []
    norm = f',fps={fps}' if fps else ''
    for i in range(len(pieces)):
        f.append(f'[{i}:v]setpts=PTS-STARTPTS{norm},format=yuv420p10le[v{i}]')
    cur, length = 'v0', pieces[0][1]
    for i in range(1, len(pieces)):
        off = round(length - fade, 3)
        nxt = f'x{i}'
        f.append(f'[{cur}][v{i}]xfade=transition=fade:duration={fade}:offset={off}[{nxt}]')
        cur, length = nxt, length + pieces[i][1] - fade
    f.append(f'[{cur}]split=2[big][web0]')
    f.append(f'[big]scale={size}:-2:flags=lanczos[uhd]')
    f.append('[web0]scale=1920:-2:flags=lanczos,format=yuv420p[web]')
    args += ['-filter_complex', ';'.join(f)]
    args += ['-map', '[uhd]', '-an', '-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p10le',
             '-profile:v', 'main10', '-tag:v', 'hvc1',
             '-x265-params', 'vbv-maxrate=30000:vbv-bufsize=60000:keyint=120:log-level=error',
             '-movflags', '+faststart', f'{prefix}-4k.mp4']
    args += ['-map', '[web]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-maxrate', '5M', '-bufsize', '10M',
             '-pix_fmt', 'yuv420p', '-movflags', '+faststart', f'{prefix}-1080.mp4']
    print(json.dumps({'pieces': len(pieces), 'seconds': round(length, 2)}))
    if dry:
        print(' '.join(args))
        return
    subprocess.run(args, check=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('prefix')
    ap.add_argument('--minutes', type=float, default=2)
    ap.add_argument('--fade', type=float, default=1.2)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--size', type=int, default=3840)
    ap.add_argument('--fps', type=float, default=0)
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    L = duration(a.src)
    pieces = plan(L, a.minutes, a.fade, a.seed)
    build(a.src, a.prefix, pieces, a.fade, a.size, a.fps, a.dry)
