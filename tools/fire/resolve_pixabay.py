"""Find the 4K file behind each Pixabay video page (run on the build machine)."""
import json, re, sys
from playwright.sync_api import sync_playwright

import os, time
dl = sys.argv[1]
pages = sys.argv[2:]
os.makedirs(dl, exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
    ctx = b.new_context(user_agent=UA, viewport={'width': 1440, 'height': 900}, locale='en-US')
    pg = ctx.new_page()
    seen = set()
    pg.on('request', lambda r: seen.add(r.url) if 'cdn.pixabay.com/video' in r.url else None)
    for u in pages:
        seen.clear()
        try:
            for attempt in range(3):
                pg.goto(u, wait_until='domcontentloaded', timeout=60000)
                pg.wait_for_timeout(6000 + attempt * 8000)
                if 'Just a moment' not in pg.title():
                    break
            html = pg.content()
        except Exception as e:
            print(json.dumps({'page': u, 'error': str(e)[:200]}), flush=True)
            continue
        found = set(re.findall(r'https://cdn\.pixabay\.com/video/[0-9/]+/[A-Za-z0-9_-]+\.mp4', html))
        found |= {x.split('?')[0] for x in seen if '.mp4' in x}
        large = sorted({re.sub(r'_(tiny|small|medium|large)\.mp4$', '_large.mp4', x) for x in found})
        vid = re.search(r'-(\d+)/?$', u.rstrip('/')).group(1)
        mine = [x for x in large if re.search(rf'/{vid}[-_]', x)]
        saved, note = None, ''
        if mine:
            # fetch inside the same browser session, so the CDN sees the page's cookies
            for attempt in range(3):
                r = ctx.request.get(mine[0], headers={'Referer': u}, timeout=600000)
                body = r.body()
                if r.ok and len(body) > 100000:
                    saved = f'{dl}/pixabay-{vid}.mp4'
                    open(saved, 'wb').write(body)
                    break
                note = f'{r.status} {body[:60]!r}'
                time.sleep(10 + attempt * 15)
        print(json.dumps({'page': u, 'title': pg.title()[:80], 'url': mine[:1], 'saved': saved, 'note': note}), flush=True)
        time.sleep(4)
    b.close()
