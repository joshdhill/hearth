"""Download Pexels clips at their best size, with stills to judge them by.

usage: pexels_get.py <outdir> <id> [<id> ...]
Saves <outdir>/pexels-<id>.mp4, <outdir>/stills/<id>-<k>.jpg and <outdir>/clips.json.
"""
import json, os, re, subprocess, sys, urllib.request
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
IDS = sys.argv[2:]
os.makedirs(f'{OUT}/stills', exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'


def size_of(u):
    m = re.search(r'(\d{3,4})_(\d{3,4})', u)
    return int(m.group(1)) * int(m.group(2)) if m else 0


info = {}
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
    ctx = b.new_context(user_agent=UA, viewport={'width': 1440, 'height': 900}, locale='en-US')
    pg = ctx.new_page()
    for vid in IDS:
        dst = f'{OUT}/pexels-{vid}.mp4'
        try:
            pg.goto(f'https://www.pexels.com/video/{vid}/', wait_until='domcontentloaded', timeout=60000)
            for attempt in range(3):
                pg.wait_for_timeout(5000 + attempt * 8000)
                if 'Just a moment' not in pg.title():
                    break
            html = pg.content()
            title = pg.title()
            files = sorted(set(re.findall(r'https://videos\.pexels\.com/video-files/[^"\'\s\\]+?\.mp4', html)), key=size_of)
            ok = False
            r = ctx.request.get(f'https://www.pexels.com/download/video/{vid}/', timeout=180000)
            if r.ok and len(r.body()) > 1e6:
                open(dst, 'wb').write(r.body()); ok = True; how = r.url
            if not ok and files:
                how = files[-1]
                req = urllib.request.Request(how, headers={'User-Agent': UA, 'Referer': 'https://www.pexels.com/'})
                open(dst, 'wb').write(urllib.request.urlopen(req, timeout=180).read()); ok = True
            if not ok:
                # the page was blocked: try the usual file names straight from the file server
                for size in ('uhd_3840_2160', 'uhd_2560_1440', 'hd_1920_1080', 'hd_1280_720'):
                    for fps in (24, 25, 30, 50, 60):
                        u = f'https://videos.pexels.com/video-files/{vid}/{vid}-{size}_{fps}fps.mp4'
                        try:
                            req = urllib.request.Request(u, headers={'User-Agent': UA, 'Referer': 'https://www.pexels.com/'})
                            data = urllib.request.urlopen(req, timeout=180).read()
                            if len(data) > 1e6:
                                open(dst, 'wb').write(data); ok = True; how = u
                                break
                        except Exception:
                            pass
                    if ok:
                        break
            if not ok:
                print(vid, 'no file', title, files[-3:], flush=True); continue
            pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                            'stream=width,height,r_frame_rate,codec_name:format=duration', '-of', 'json', dst],
                                           capture_output=True, text=True).stdout)
            st, dur = pr['streams'][0], float(pr['format']['duration'])
            info[vid] = dict(title=title, file=how, w=st['width'], h=st['height'], fps=st['r_frame_rate'], codec=st['codec_name'],
                             seconds=round(dur, 1), mb=round(os.path.getsize(dst) / 1e6, 1))
            print(vid, info[vid], flush=True)
            for k, f in enumerate((0.15, 0.5, 0.85)):
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(dur * f), '-i', dst, '-frames:v', '1',
                                '-vf', 'scale=1920:-2', '-q:v', '3', f'{OUT}/stills/{vid}-{k}.jpg'])
        except Exception as e:
            print(vid, 'failed', e, flush=True)
    b.close()
json.dump(info, open(f'{OUT}/clips.json', 'w'), indent=1)
