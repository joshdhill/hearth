"""Collect thumbnails of fireplace clips from free video libraries into labelled contact sheets.

Opens each listing page in a real browser, scrolls it, and keeps every thumbnail that links
to a clip's own page. Saves sheets (sheet-N.jpg) with a number on each tile, plus
index.json mapping the numbers to the clip pages, so a clip can be picked by eye.

usage: look.py <outdir>     (pages in env PAGES, one per line)
"""
import io, json, os, re, sys, time, urllib.request
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
PAGES = [p.strip() for p in os.environ['PAGES'].splitlines() if p.strip()]
TW, TH = 480, 270

JS = r"""() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    let src = '', vid = '';
    const im = a.querySelector('img');
    if (im) src = im.currentSrc || im.src || im.getAttribute('data-src') || '';
    const v = a.querySelector('video') || (a.parentElement && a.parentElement.querySelector('video'));
    if (v) { vid = v.currentSrc || v.src || (v.querySelector('source') || {}).src || ''; if (!src) src = v.poster || ''; }
    const r = a.getBoundingClientRect();
    if ((src || vid) && r.width > 120 && r.height > 60)
      out.push({ href, src, vid, title: (a.getAttribute('title') || a.getAttribute('aria-label') || (im && im.alt) || a.innerText || '').trim().slice(0, 120) });
  }
  return out;
}"""


def get(url, ref):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': ref})
    return urllib.request.urlopen(req, timeout=40).read()


items, seen = [], set()
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
    ctx = b.new_context(user_agent=UA, viewport={'width': 1440, 'height': 900}, locale='en-US')
    pg = ctx.new_page()
    for page in PAGES:
        try:
            pg.goto(page, wait_until='domcontentloaded', timeout=60000)
            for attempt in range(3):
                pg.wait_for_timeout(5000 + attempt * 8000)
                if 'Just a moment' not in pg.title():
                    break
            found = []
            for k in range(14):
                found += pg.evaluate(JS)
                pg.mouse.wheel(0, 1400)
                pg.wait_for_timeout(1300)
            n0 = len(items)
            for f in found:
                key = f['href'].split('?')[0]
                if key in seen or key.rstrip('/') == page.split('?')[0].rstrip('/'):
                    continue
                if not re.search(r'\d{3,}|/video/|/videos/|/stock-video/', key):
                    continue
                seen.add(key)
                f['page'] = page
                items.append(f)
            print(page, pg.title(), len(items) - n0, 'clips', flush=True)
            pg.screenshot(path=f'{OUT}/page-{PAGES.index(page)}.jpg', type='jpeg', quality=60)
        except Exception as e:
            print(page, 'failed', e, flush=True)
    b.close()

tiles = []
for i, it in enumerate(items):
    img = None
    for u in (it['src'],):
        if not u or u.startswith('data:'):
            continue
        try:
            img = Image.open(io.BytesIO(get(u, it['page']))).convert('RGB')
            break
        except Exception as e:
            print('thumb failed', u[:100], e)
    if img is None and it['vid']:
        try:
            open('/tmp/v.mp4', 'wb').write(get(it['vid'], it['page']))
            os.system('ffmpeg -v error -y -ss 3 -i /tmp/v.mp4 -frames:v 1 /tmp/v.jpg')
            img = Image.open('/tmp/v.jpg').convert('RGB')
        except Exception as e:
            print('preview failed', it['vid'][:100], e)
    if img is None:
        continue
    img.thumbnail((TW, TH))
    t = Image.new('RGB', (TW, TH), (20, 20, 20))
    t.paste(img, ((TW - img.width) // 2, (TH - img.height) // 2))
    it['n'] = len(tiles)
    tiles.append(t)

try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
except Exception:
    font = ImageFont.load_default()
cols, rows = 4, 4
for s in range(0, len(tiles), cols * rows):
    sheet = Image.new('RGB', (cols * TW, rows * TH), (0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for j, t in enumerate(tiles[s:s + cols * rows]):
        x, y = (j % cols) * TW, (j // cols) * TH
        sheet.paste(t, (x, y))
        d.rectangle([x, y, x + 62, y + 40], fill=(0, 0, 0))
        d.text((x + 6, y + 4), str(s + j), fill=(255, 255, 0), font=font)
    sheet.save(f'{OUT}/sheet-{s // (cols * rows)}.jpg', quality=80)
json.dump([it for it in items if 'n' in it], open(f'{OUT}/index.json', 'w'), indent=1)
print(len(tiles), 'tiles')
