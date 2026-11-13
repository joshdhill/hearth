"""A wider fire for a wider fireplace: three time-shifted copies of one fire loop, side by side.

Fire is light on dark, so the copies are combined by keeping the brighter of them at each pixel:
overlapping flames merge into one long fire instead of ghosting. Before that, each copy keeps only
its fire (a soft mask round the logs and flames, and the dim surroundings of the original fireplace
pushed to black). A soft, blurred copy of the result lights the back wall of the firebox.
Each copy is the same loop started at a different point, so the result loops just as seamlessly.

usage: widefire.py <loop.m3u8|mp4> <seconds> <out.mp4> [height] [test-seconds]"""
import subprocess, sys, os
import numpy as np, cv2

src, L, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
OH = int(sys.argv[4]) if len(sys.argv) > 4 else 1080
T = float(sys.argv[5]) if len(sys.argv) > 5 else L
D = 330                                  # how far apart the copies sit (source px)
OW = 1920 + 2 * D
# the mask: a soft dome over the logs and flames of the source
yy, xx = np.mgrid[0:1080, 0:1920].astype(np.float32)
r = np.hypot((xx - 960) / 560, (yy - 1120) / 900)
m = np.clip((1.0 - r) / 0.22, 0, 1)
m = m * m * (3 - 2 * m)
mp = os.path.splitext(out)[0] + '-mask.png'
cv2.imwrite(mp, (m * 255).astype(np.uint8))
# the side copies lose the round fireback ring behind the logs (three rings in a row would give it away):
# in a band along the ring, everything but bright flame is pushed down
RC, RR = (825, 840), 270
band = np.clip(1 - np.abs(np.hypot(xx - RC[0], yy - RC[1]) - RR) / 34, 0, 1) * np.clip((930 - yy) / 60, 0, 1)
rp = os.path.splitext(out)[0] + '-ring.png'
cv2.imwrite(rp, (band * 130).astype(np.uint8))
offs = [L / 3, 0.0, 2 * L / 3]           # left, middle, right copy start points
args = ['ffmpeg', '-v', 'error', '-y']
for o in offs:
    args += ['-stream_loop', '2', '-ss', f'{o:.3f}', '-t', f'{T:.3f}', '-i', src]
args += ['-loop', '1', '-i', mp, '-loop', '1', '-i', rp]
f = ['[3:v]format=gbrp,split=3[m0][m1][m2]', '[4:v]format=gbrp,split=2[r0][r2]']
for k in range(3):
    ring = f"[q{k}];[q{k}][r{k}]blend=all_expr='A*(1-B/130*(1-clip((A-110)/90\\,0\\,1)))':shortest=1" if k != 1 else ''   # dim the ring, keep bright flame
    f.append(f'[{k}:v]format=gbrp{ring},lutrgb=r=\'max(val-14,0)*1.07\':g=\'max(val-14,0)*1.07\':b=\'max(val-14,0)*1.07\'[s{k}]')
    f.append(f'[s{k}][m{k}]blend=all_mode=multiply:shortest=1,pad={OW}:1080:{k * D}:0:black[c{k}]')
f.append('[c0][c1]blend=all_mode=lighten[ab]')
f.append('[ab][c2]blend=all_mode=lighten,split[fire][g]')
f.append('[g]scale=iw/8:ih/8,gblur=sigma=14,scale=' + str(OW) + ':1080,colorchannelmixer=rr=0.55:gg=0.42:bb=0.30[glow]')
f.append(f'[fire][glow]blend=all_mode=lighten,scale=-2:{OH},format=yuv420p[v]')
args += ['-filter_complex', ';'.join(f), '-map', '[v]', '-an', '-t', f'{T:.3f}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '50', out]
subprocess.run(args, check=True)
print('wrote', out, OW, 'x 1080 source px, scaled to height', OH)
