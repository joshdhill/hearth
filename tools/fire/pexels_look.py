"""Search Pexels for fireplace clips: contact sheets of thumbnails plus the clips' file addresses.

Each search runs in a fresh browser (Pexels challenges a browser after its first page). Thumbnails
are hovered so their preview videos load, which reveals how each clip's files are named, and the
page's own data is searched for file addresses too. Then any clip ids listed in GET are downloaded
at their largest size, with three stills each.

usage: pexels_look.py <outdir>     env QUERIES (comma separated), GET (space separated ids)
"""
import io, json, os, re, subprocess, sys, time, urllib.request
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
os.makedirs(f'{OUT}/stills', exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
QUERIES = [q.strip() for q in os.environ.get('QUERIES', '').split(',') if q.strip()]
GET = os.environ.get('GET', '').split()
TW, TH = 480, 270
FILE_RE = re.compile(r'https://videos\.pexels\.com/video-files/(\d+)/[^"\'\s\\<>]+?\.mp4')


def px(u):
    m = re.search(r'(\d{3,4})_(\d{3,4})', u)
    return int(m.group(1)) * int(m.group(2)) if m else 0


def fetch(u, ref='https://www.pexels.com/'):
    return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA, 'Referer': ref}), timeout=240).read()


files, items, seen = {}, [], set()
known = json.load(open(f'{OUT}/files.json')) if os.path.exists(f'{OUT}/files.json') else {}
for k, v in known.items():
    files.setdefault(k, set()).update(v)

with sync_playwright() as p:
    for qi, q in enumerate(QUERIES + [f'#get{v}' for v in GET]):
        b = p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
        ctx = b.new_context(user_agent=UA, viewport={'width': 1440, 'height': 900}, locale='en-US')
        pg = ctx.new_page()
        pg.on('request', lambda r: [files.setdefault(m.group(1), set()).add(m.group(0)) for m in FILE_RE.finditer(r.url)])
        try:
            url = (f'https://www.pexels.com/video/{q[4:]}/' if q.startswith('#get')
                   else f'https://www.pexels.com/search/videos/{urllib.request.quote(q)}/?orientation=landscape')
            pg.goto(url, wait_until='domcontentloaded', timeout=60000)
            for attempt in range(4):
                pg.wait_for_timeout(5000 + attempt * 7000)
                if 'Just a moment' not in pg.title():
                    break
            print(q, '->', pg.title(), flush=True)
            if q.startswith('#get'):
                for m in FILE_RE.finditer(pg.content()):
                    files.setdefault(m.group(1), set()).add(m.group(0))
                continue
            for k in range(10):
                for a in pg.query_selector_all('a[href*="/video/"]'):
                    href = (a.get_attribute('href') or '').split('?')[0]
                    m = re.search(r'-(\d+)/?$', href)
                    if not m or m.group(1) in seen:
                        continue
                    im = a.query_selector('img')
                    src = im and (im.get_attribute('src') or '')
                    if not src:
                        continue
                    seen.add(m.group(1))
                    items.append(dict(id=m.group(1), href='https://www.pexels.com' + href if href.startswith('/') else href, src=src, q=q))
                    try:
                        a.hover(timeout=1500); pg.wait_for_timeout(250)
                    except Exception:
                        pass
                pg.mouse.wheel(0, 1300)
                pg.wait_for_timeout(1500)
            for m in FILE_RE.finditer(pg.content()):
                files.setdefault(m.group(1), set()).add(m.group(0))
        except Exception as e:
            print(q, 'failed', e, flush=True)
        b.close()
        json.dump({k: sorted(v) for k, v in files.items()}, open(f'{OUT}/files.json', 'w'), indent=0)

# contact sheets
tiles = []
for it in items:
    try:
        img = Image.open(io.BytesIO(fetch(it['src']))).convert('RGB')
    except Exception as e:
        print('thumb failed', it['id'], e); continue
    img.thumbnail((TW, TH))
    t = Image.new('RGB', (TW, TH), (20, 20, 20)); t.paste(img, ((TW - img.width) // 2, (TH - img.height) // 2))
    it['n'] = len(tiles); it['files'] = sorted(files.get(it['id'], []), key=px)[-2:]
    tiles.append(t)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
except Exception:
    font = ImageFont.load_default()
for s in range(0, len(tiles), 16):
    sheet = Image.new('RGB', (4 * TW, 4 * TH)); d = ImageDraw.Draw(sheet)
    for j, t in enumerate(tiles[s:s + 16]):
        x, y = (j % 4) * TW, (j // 4) * TH
        sheet.paste(t, (x, y)); d.rectangle([x, y, x + 62, y + 40], fill=(0, 0, 0)); d.text((x + 6, y + 4), str(s + j), fill=(255, 255, 0), font=font)
    sheet.save(f'{OUT}/sheet-{s // 16}.jpg', quality=80)
json.dump([it for it in items if 'n' in it], open(f'{OUT}/index.json', 'w'), indent=1)
print(len(tiles), 'tiles')

# downloads: the largest named file, or the usual names built from a preview's name
info = {}
for vid in GET:
    names = sorted(files.get(vid, []), key=px)
    cands = list(reversed(names))
    for n in names:
        m = re.search(r'/(\d+)[-_](?:sd_|hd_|uhd_)?\d{3,4}_\d{3,4}_(\d+)fps\.mp4$', n)
        if m:
            fid, fps = m.group(1), m.group(2)
            for size in ('uhd_3840_2160', 'uhd_4096_2160', 'uhd_2560_1440', 'hd_1920_1080', '3840_2160', '2560_1440', '1920_1080'):
                cands.append(f'https://videos.pexels.com/video-files/{vid}/{fid}{"-" if size[0] in "uh" else "_"}{size}_{fps}fps.mp4')
    for size in ('uhd_3840_2160', 'uhd_2560_1440', 'hd_1920_1080'):
        for fps in (24, 25, 30, 50, 60):
            cands.append(f'https://videos.pexels.com/video-files/{vid}/{vid}-{size}_{fps}fps.mp4')
    cands = sorted(set(cands), key=lambda u: -px(u))
    dst = f'{OUT}/pexels-{vid}.mp4'
    for u in cands:
        try:
            data = fetch(u)
            if len(data) > 1e6:
                open(dst, 'wb').write(data); break
        except Exception:
            continue
    else:
        print(vid, 'no download; names seen:', names[-4:], flush=True); continue
    pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
                                    '-of', 'json', dst], capture_output=True, text=True).stdout)
    st, dur = pr['streams'][0], float(pr['format']['duration'])
    info[vid] = dict(file=u, w=st['width'], h=st['height'], fps=st['r_frame_rate'], seconds=round(dur, 1), mb=round(os.path.getsize(dst) / 1e6, 1))
    print(vid, info[vid], flush=True)
    for k, f in enumerate((0.15, 0.5, 0.85)):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(dur * f), '-i', dst, '-frames:v', '1', '-vf', 'scale=1920:-2', '-q:v', '3', f'{OUT}/stills/{vid}-{k}.jpg'])
json.dump(info, open(f'{OUT}/clips.json', 'w'), indent=1)
