"""Turn generated cat clips (dark cat on plain cream) into sprite sheets with transparency.

Every clip was generated on the same stage (see cat_canvases.py), so in every frame the floor is
at the same height and the cat's hips start at the same spot. Each sheet records that anchor, and
the player puts it at the cat's position in the room.

usage: cat_sprites.py <clips.json> <clipdir> <outdir>
clips.json: {name: {"src": "file.mp4" | "still:pose", "reverse": bool, "loop": "walk"|"whole"|false,
                    "trim": [first, last], ...}}"""
import json, os, subprocess, sys
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from catmatte import matte, CREAM

cfg = json.load(open(sys.argv[1]))
CLIPS, OUT = sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
stage = json.load(open(os.path.join(HERE, 'canvas', 'stage.json')))
FW, FH = 854, 480                         # every frame is brought to this size (16:9, like the stage)
SX, SY = FW / stage['canvas'][0], FH / stage['canvas'][1]
GROUND, HIPX = stage['ground'] * SY, stage['hip_x'] * SX
SETS = {'hd': 1.0, 'sd': 0.5}             # sprite sizes: big screens, phones
MAXPAGE = 4096


def read_frames(path):
    pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
                        capture_output=True, text=True).stdout.strip().split(',')
    w, h = int(pr[0]), int(pr[1])
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)
    return [cv2.resize(f, (FW, FH), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255 for f in fr]


def still(pose):
    im = cv2.imread(os.path.join(HERE, 'canvas', pose + '.png')).astype(np.float32) / 255
    return [cv2.resize(im, (FW, FH), interpolation=cv2.INTER_AREA)]


def small(a):
    return cv2.resize(a, (96, 54), interpolation=cv2.INTER_AREA).ravel()


def find_walk_loop(alphas):
    """first and last frame of the longest stretch that comes back to where it started (whole strides)"""
    S = np.array([small(a) for a in alphas])
    n = len(S)
    D = np.sqrt(((S[:, None, :] - S[None, :, :]) ** 2).mean(-1))
    best = None
    for i in range(0, min(6, n - 12)):
        for j in range(i + 10, n - 1):
            c = (D[i, j] + D[i + 1, j + 1] + (D[i + 2, j + 2] if j + 2 < n else D[i + 1, j + 1])) / 3
            score = c - 0.00035 * (j - i)                       # longer is better, a little
            if best is None or score < best[0]:
                best = (score, i, j, c)
    _, i, j, c = best
    step = float(np.mean(np.diagonal(D, 1)))
    print(f'   walk loop: frames {i}..{j - 1} ({j - i} frames), seam {c / step:.2f}x a normal frame change')
    return i, j


def walk_speed(alphas):
    """how far the planted paws slide back per frame (sprite px): the speed the cat must move forward"""
    y0, y1 = int(GROUND) - 14, int(GROUND) + 3
    prof = [a[y0:y1].max(0) for a in alphas]
    shifts = []
    for p, q in zip(prof, prof[1:] + prof[:1]):
        best = min(range(-16, 5), key=lambda s: float(np.abs(np.roll(p, s) - q).sum()))
        shifts.append(best)
    v = -float(np.median(shifts))
    print('   paw shifts per frame:', shifts, '-> speed', v)
    return v


manifest = {'fps': 16, 'ground_note': 'anchor = hips on the floor', 'sets': {k: {} for k in SETS}}
for name, c in cfg.items():
    print(name, c)
    frames = still(c['src'][6:]) if c['src'].startswith('still:') else read_frames(os.path.join(CLIPS, c['src']))
    if 'trim' in c:
        frames = frames[c['trim'][0]:c['trim'][1]]
    if c.get('reverse'):
        frames = frames[::-1]
    mats = [matte(f) for f in frames]
    alphas = [m[0] for m in mats]
    info = {}
    if c.get('loop') == 'walk':
        i, j = find_walk_loop(alphas)
        mats, alphas = mats[i:j], alphas[i:j]
        info['speed'] = walk_speed(alphas)
    n = len(mats)
    # the box that holds the cat in every frame
    union = np.max(np.array([a > 0.04 for a in alphas]), 0)
    ys, xs = np.nonzero(union)
    x0, x1 = max(0, xs.min() - 6), min(FW, xs.max() + 7)
    y0, y1 = max(0, ys.min() - 6), min(FH, int(GROUND) + 8)
    for sname, sc in SETS.items():
        cw, ch = int(np.ceil((x1 - x0) * sc)), int(np.ceil((y1 - y0) * sc))
        per_row = max(1, MAXPAGE // cw)
        cols = min(per_row, int(np.ceil(np.sqrt(n * ch / cw))) or 1)
        cols = max(1, min(cols, n))
        rows_per_page = max(1, MAXPAGE // ch)
        per_page = cols * rows_per_page
        pages = []
        for p0 in range(0, n, per_page):
            chunk = mats[p0:p0 + per_page]
            rows = int(np.ceil(len(chunk) / cols))
            sheet = np.zeros((rows * ch, cols * cw, 4), np.uint8)
            for k, (a, fg, _bg) in enumerate(chunk):
                rgba = np.dstack([fg[y0:y1, x0:x1, ::-1], a[y0:y1, x0:x1, None]])
                if sc != 1:
                    prem = rgba.copy(); prem[..., :3] *= prem[..., 3:]
                    prem = cv2.resize(prem, (cw, ch), interpolation=cv2.INTER_AREA)
                    al = np.clip(prem[..., 3:], 1e-4, 1)
                    rgba = np.dstack([np.clip(prem[..., :3] / al, 0, 1), prem[..., 3:]])
                else:
                    rgba = cv2.resize(rgba, (cw, ch), interpolation=cv2.INTER_AREA) if rgba.shape[:2] != (ch, cw) else rgba
                r, cc = divmod(k, cols)
                sheet[r * ch:(r + 1) * ch, cc * cw:(cc + 1) * cw] = np.clip(rgba * 255 + 0.5, 0, 255).astype(np.uint8)
            fn = f'{name}-{sname}{"-" + str(len(pages)) if p0 else ""}.webp'
            Image.fromarray(sheet, 'RGBA').save(os.path.join(OUT, fn), 'WEBP', quality=84, method=5, alpha_quality=92)
            pages.append(fn)
        manifest['sets'][sname][name] = {'frames': n, 'cell': [cw, ch], 'cols': cols, 'per_page': per_page, 'pages': pages,
                                         'anchor': [round((HIPX - x0) * sc, 2), round((GROUND - y0) * sc, 2)],
                                         'unit': round(sc * SX, 5),               # sprite px per stage px
                                         **({'speed': round(info['speed'] * sc, 3)} if 'speed' in info else {})}
        print('  ', sname, n, 'frames', cw, 'x', ch, pages, round(sum(os.path.getsize(os.path.join(OUT, p)) for p in pages) / 1e6, 2), 'MB')
manifest['stage'] = {'cat_height_sitting': round((stage['ground'] - stage['poses']['sit']['bbox'][1]), 1), 'px': stage['canvas']}
json.dump(manifest, open(os.path.join(OUT, 'cat.json'), 'w'), indent=1)
print('wrote', os.path.join(OUT, 'cat.json'))
