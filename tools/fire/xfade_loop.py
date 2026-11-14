"""A plain seamless loop of a whole clip, for footage the splice planner can't join up.

The last few seconds dissolve into the first ones, so the loop is the clip's full length less the
dissolve, and nothing repeats sooner than that. A gentle crop and grade can be given per fire
(grades.json). Writes the same outputs as build_long.py: <name>-4k.mp4 for the TV (HEVC),
<name>-web/ (1080p HLS) and <name>-poster.jpg.

usage: xfade_loop.py <src.mp4> <name> <outdir>"""
import json, os, subprocess, sys

src, name, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)
g = json.load(open(os.path.join(os.path.dirname(__file__), 'grades.json'))).get(name, {})
D = float(g.get('dissolve', 2.0))
L = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], capture_output=True, text=True).stdout.strip())
L -= 0.2                                                     # stay clear of a short last frame
z, yb = float(g.get('zoom', 1.0)), float(g.get('crop_y', 0.5))
look = f"crop=iw/{z}:ih/{z}:(iw-ow)/2:(ih-oh)*{yb},scale=1920:1080:flags=lanczos"
if 'gamma' in g:
    gm, gain = g['gamma'], g.get('gain', 1.0)
    r, gg, b = [gain * c for c in g.get('rgb', [1, 1, 1])]
    look += (f",lutrgb=r='clip(255*pow(val/255\\,1/{gm})*{r}\\,0\\,255)'"
             f":g='clip(255*pow(val/255\\,1/{gm})*{gg}\\,0\\,255)':b='clip(255*pow(val/255\\,1/{gm})*{b}\\,0\\,255)'")
# the clip is read three times (tail, head, middle) so nothing waits in memory for a later part
ins = ['-ss', f'{L - D}', '-t', f'{D}', '-i', src, '-t', f'{D}', '-i', src, '-ss', f'{D}', '-t', f'{L - 2 * D}', '-i', src]
fc = (f"[0:v]{look},setpts=PTS-STARTPTS[tail];[1:v]{look},setpts=PTS-STARTPTS[head];[2:v]{look},setpts=PTS-STARTPTS[mid];"
      f"[tail][head]xfade=transition=fade:duration={D}:offset=0[join];"
      f"[join][mid]concat=n=2:v=1:a=0,scale=3840:2160:flags=lanczos,format=yuv420p10le[v]")
master = os.path.join(OUT, f'{name}-4k.mp4')
subprocess.run(['ffmpeg', '-v', 'error', '-y', *ins, '-filter_complex', fc, '-map', '[v]', '-an',
                '-c:v', 'libx265', '-preset', 'medium', '-crf', '22', '-tag:v', 'hvc1', '-x265-params', 'log-level=error', master], check=True)
web = os.path.join(OUT, f'{name}-web'); os.makedirs(web, exist_ok=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', master, '-an', '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p',
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-maxrate', '6M', '-bufsize', '12M', '-g', '150', '-keyint_min', '150', '-sc_threshold', '0',
                '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_segment_filename', f'{web}/seg%03d.ts', f'{web}/index.m3u8'], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '12', '-i', master, '-frames:v', '1', '-vf', 'scale=1920:1080', '-q:v', '3', os.path.join(OUT, f'{name}-poster.jpg')], check=True)
json.dump({'name': name, 'seconds': round(L - D, 2), 'method': 'whole clip, dissolve at the join', 'grade': g}, open(os.path.join(OUT, f'{name}.json'), 'w'))
print('wrote', master, round(L - D, 1), 's')
