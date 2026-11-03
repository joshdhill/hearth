"""Find long, genuinely unique 4K fireplace clips on Pixabay (run on the build machine).

Collects video pages from a few searches, reads each clip's length, downloads the longer
4K ones and measures how much unique footage each has (many stock clips are already
looped, so a "40 second" clip may hold only 10 seconds of real fire).

usage: scout_pixabay.py <outdir>
"""
import json, os, re, subprocess, sys, time
import numpy as np
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from loopplan import Planner

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
DL = '/tmp/scout-dl'
os.makedirs(DL, exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
SEARCHES = ['fireplace', 'fireplace fire', 'fireplace logs', 'wood stove', 'hearth', 'cozy fireplace', 'burning logs', 'fire wood']
MIN_SECONDS = float(os.environ.get('MIN_SECONDS', 40))
MAX_DOWNLOADS = int(os.environ.get('MAX_DOWNLOADS', 40))
KNOWN = {'236567', '234515', '234516', '262228', '306771', '239514', '262032', '123069', '15178', '275774', '334256', '261768'}
log = open(f'{OUT}/scout.jsonl', 'a')


def emit(d):
    print(json.dumps(d), flush=True)
    log.write(json.dumps(d) + '\n'); log.flush()


def goto(pg, u):
    for attempt in range(3):
        pg.goto(u, wait_until='domcontentloaded', timeout=60000)
        pg.wait_for_timeout(5000 + attempt * 8000)
        if 'Just a moment' not in pg.title():
            return pg.content()
    return pg.content()


def unique_footage(path):
    """Seconds of footage that isn't a repeat of earlier footage, plus how well it splices."""
    pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                    'stream=width,height,r_frame_rate,bit_rate:format=duration', '-of', 'json', path],
                                   capture_output=True, text=True).stdout)
    st = pr['streams'][0]
    a, b = st['r_frame_rate'].split('/')
    fps = float(a) / float(b)
    sw, sh = 160, 90
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-an', '-vf', f'scale={sw}:{sh}:flags=area', '-f', 'rawvideo',
                          '-pix_fmt', 'bgr24', '-'], capture_output=True).stdout
    S = np.frombuffer(raw, np.uint8).reshape(-1, sh, sw, 3).astype(np.float32) / 255
    N = len(S)
    std = S.mean(3).std(0)
    wmap = np.clip(std / max(1e-6, np.percentile(std, 95)), 0.15, 1.0)[..., None]
    X = (S * np.sqrt(wmap)).reshape(N, -1)
    sq = (X ** 2).sum(1)
    D = np.sqrt(np.maximum(sq[:, None] + sq[None, :] - 2 * X @ X.T, 0) / X.shape[1])
    P = Planner(D, fps)
    try:
        s0, sg = P.plan(300, 1)
        chk = P.check(s0, sg)
    except SystemExit as e:
        chk = {'error': str(e)}
    return dict(w=st['width'], h=st['height'], fps=round(fps, 2), seconds=round(N / fps, 1),
                mbps=round(int(st.get('bit_rate') or 0) / 1e6, 1), unique_s=round(P.unique_s, 1),
                repeats=round(P.repeat_frac, 2), join_vs_step=round(P.THR / P.step, 2), usable=round(float(P.alive.mean()), 2),
                still=round(float((std < 0.02).mean()), 2), plan=chk)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
    ctx = b.new_context(user_agent=UA, viewport={'width': 1440, 'height': 900}, locale='en-US')
    pg = ctx.new_page()
    seen_cdn = set()
    pg.on('request', lambda r: seen_cdn.add(r.url) if 'cdn.pixabay.com/video' in r.url else None)

    pages = {}
    for q in SEARCHES:
        for n in (1, 2, 3):
            u = f'https://pixabay.com/videos/search/{q.replace(" ", "%20")}/?min_width=3840' + (f'&pagi={n}' if n > 1 else '')
            try:
                html = goto(pg, u)
            except Exception as e:
                emit({'search': q, 'page': n, 'error': str(e)[:160]}); continue
            links = set(re.findall(r'href="(/videos/[a-z0-9-]+-(\d+)/)"', html))
            # durations shown on the result cards, if any
            cards = pg.evaluate("""() => [...document.querySelectorAll('a[href*="/videos/"]')].map(a => {
                const c = a.closest('div[class*=container], div[class*=cell], div[class*=item]') || a;
                return [a.getAttribute('href'), (c.innerText || '').slice(0, 80)];
            })""")
            dur = {}
            for href, txt in cards:
                m = re.search(r'(\d+):(\d\d)', txt or '')
                if m and href:
                    dur[href] = int(m.group(1)) * 60 + int(m.group(2))
            for href, vid in links:
                pages.setdefault(vid, {'page': 'https://pixabay.com' + href, 'card_s': dur.get(href), 'q': q})
            emit({'search': q, 'page': n, 'links': len(links), 'total': len(pages)})
            if not links:
                break
            time.sleep(3)

    # read each page's clip length (cards don't always show it)
    for vid, info in pages.items():
        if vid in KNOWN:
            continue
        if info['card_s'] is not None and info['card_s'] < MIN_SECONDS:
            continue
        try:
            html = goto(pg, info['page'])
        except Exception as e:
            emit({'id': vid, 'error': str(e)[:160]}); continue
        m = re.search(r'"duration"\s*:\s*"?PT(?:(\d+)M)?(\d+)S', html) or re.search(r'"duration"\s*:\s*(\d+)', html)
        if m:
            info['page_s'] = (int(m.group(1) or 0) * 60 + int(m.group(2))) if m.lastindex == 2 else int(m.group(1))
        found = set(re.findall(r'https://cdn\.pixabay\.com/video/[0-9/]+/[A-Za-z0-9_-]+\.mp4', html))
        found |= {x.split('?')[0] for x in seen_cdn if '.mp4' in x}
        large = sorted({re.sub(r'_(tiny|small|medium|large)\.mp4$', '_large.mp4', x) for x in found})
        info['cdn'] = [x for x in large if re.search(rf'/{vid}[-_]', x)][:1]
        info['title'] = pg.title()[:90]
        seen_cdn.clear()
        emit({'id': vid, **info})
        time.sleep(2)

    # download and measure the longest ones
    todo = [(v, i) for v, i in pages.items() if i.get('cdn') and (i.get('page_s') or i.get('card_s') or 999) >= MIN_SECONDS]
    todo.sort(key=lambda t: -(t[1].get('page_s') or t[1].get('card_s') or 0))
    emit({'to_measure': len(todo)})
    for vid, info in todo[:MAX_DOWNLOADS]:
        cookie = '; '.join(f"{c['name']}={c['value']}" for c in ctx.cookies() if 'pixabay' in c['domain'])
        f = f'{DL}/{vid}.mp4'
        ok = False
        for attempt in range(3):
            r = subprocess.run(['curl', '-sL', '--max-time', '600', '-A', UA, '-e', info['page'], '-H', f'Cookie: {cookie}',
                                '-o', f, '-w', '%{http_code} %{size_download}', info['cdn'][0]], capture_output=True, text=True)
            if r.stdout.startswith('200') and int(r.stdout.split()[1]) > 100000:
                ok = True; break
            time.sleep(10 + attempt * 10)
        if not ok:
            emit({'id': vid, 'download_failed': r.stdout}); continue
        try:
            m = unique_footage(f)
            dur = m['seconds']
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', f, '-vf', f'fps=12/{dur},scale=480:-2,tile=4x3:padding=4',
                            '-frames:v', '1', f'{OUT}/{vid}-sheet.jpg'])
            emit({'id': vid, 'page': info['page'], 'title': info.get('title'), **m})
        except Exception as e:
            emit({'id': vid, 'measure_error': str(e)[:200]})
        os.remove(f)
    b.close()

# summary, best first
rows = [json.loads(l) for l in open(f'{OUT}/scout.jsonl') if '"unique_s"' in l]
rows.sort(key=lambda r: -r['unique_s'])
with open(f'{OUT}/summary.txt', 'w') as s:
    for r in rows:
        s.write(f"{r['id']:>8} unique {r['unique_s']:5.1f}s of {r['seconds']:5.1f}s  {r['w']}x{r['h']}@{r['fps']}  {r['mbps']}Mbps  "
                f"join {r['join_vs_step']}x  still {r['still']}  {r['page']}\n")
print(open(f'{OUT}/summary.txt').read())
