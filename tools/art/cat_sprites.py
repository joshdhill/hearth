"""Turn generated cat clips (dark cat on plain cream) into sprite sheets with transparency.

Every clip was generated on a known stage (see cat_canvases.py), so the floor and the spot where
the cat's hips start are known in every frame. Each sheet records that anchor, and the player puts
it at the cat's position in the room.

usage: cat_sprites.py <clips.json> <clipdir> <outdir>
clips.json: {name: {"src": "file.mp4" | "still:pose", "reverse": bool, "gait": bool, "jump": bool, "trim": [a, b]}}
  gait  - a walk/trot/run "on the spot": keeps the run-up, finds a seamless loop of whole strides,
          and measures how fast the planted paws slide back (the speed the cat must travel)
  jump  - filmed on the tall jump stage; records where the cat lands and how far along it is in each frame"""
import json, os, subprocess, sys
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from catmatte import matte

cfg = json.load(open(sys.argv[1]))
CLIPS, OUT = sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
stage = json.load(open(os.path.join(HERE, 'canvas', 'stage.json')))
jstage = json.load(open(os.path.join(HERE, 'canvas', 'jump-stage.json')))
SETS = {'hd': 1.0, 'sd': 0.5}             # sprite sizes: big screens, phones
MAXPAGE = 4096
FPS = 16


class Stage:
    def __init__(self, jump):
        if jump:
            self.fw, self.fh = 480, 854
            k = self.fh / jstage['canvas'][1]
            self.ground, self.hipx = jstage['floor'] * k, jstage['start_x'] * self.fw / jstage['canvas'][0]
            self.sit_h = jstage['sit_h'] * k
        else:
            self.fw, self.fh = 854, 480
            k = self.fh / stage['canvas'][1]
            self.ground, self.hipx = stage['ground'] * k, stage['hip_x'] * self.fw / stage['canvas'][0]
            self.sit_h = (stage['ground'] - stage['poses']['sit']['bbox'][1]) * k


def read_frames(path, st):
    pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
                        capture_output=True, text=True).stdout.strip().split(',')
    w, h = int(pr[0]), int(pr[1])
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)
    return [cv2.resize(f, (st.fw, st.fh), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255 for f in fr]


def still(pose, st):
    im = cv2.imread(os.path.join(HERE, 'canvas', pose + '.png')).astype(np.float32) / 255
    return [cv2.resize(im, (st.fw, st.fh), interpolation=cv2.INTER_AREA)]


def small(a):
    h, w = a.shape
    return cv2.resize(a, (96, int(96 * h / w)), interpolation=cv2.INTER_AREA).ravel()


def dist_matrix(alphas):
    S = np.array([small(a) for a in alphas])
    sq = (S ** 2).sum(1)
    return np.sqrt(np.maximum(sq[:, None] + sq[None, :] - 2 * S @ S.T, 0) / S.shape[1])


def find_loop(alphas):
    """(first, end) of the longest stretch of whole strides that comes back to where it started"""
    D = dist_matrix(alphas)
    n = len(alphas)
    step = float(np.mean(np.diagonal(D, 1)))
    best = None
    for i in range(3, max(4, n // 3)):
        for j in range(i + 8, n - 2):
            c = (D[i, j] + D[i + 1, j + 1] + D[i + 2, j + 2] + D[i - 1, j - 1]) / 4
            score = c / step - 0.012 * (j - i)                     # longer is better, a little
            if best is None or score < best[0]:
                best = (score, i, j, c / step)
    _, i, j, c = best
    # the frame of the loop that looks most like the standing pose the clip started from
    k = int(np.argmin(D[0, i:j]))
    print(f'   loop: frames {i}..{j - 1} ({j - i} frames), seam {c:.2f}x a normal frame change; most like the start pose: loop frame {k} ({D[0, i + k] / step:.1f}x)')
    return i, j, k


def gait_speed(alphas, st):
    """how far the planted paws slide back per frame (sprite px): the speed the cat must move forward"""
    y0, y1 = int(st.ground) - 6, int(st.ground) + 3
    prof = [a[y0:y1].max(0) for a in alphas]
    shifts = []
    for p, q in zip(prof[:-1], prof[1:]):
        if p.sum() < 4 or q.sum() < 4:
            continue                                               # all paws in the air (a gallop)
        cand = range(-48, 6)
        errs = [float(np.minimum(np.roll(p, s), q).sum()) for s in cand]          # overlap of planted paws
        shifts.append(list(cand)[int(np.argmax(errs))])
    v = -float(np.median(shifts)) if shifts else 0.0
    print('   paw slide per frame:', shifts[:24], '... -> speed', v)
    return v


def trim_still_ends(mats, lead=2):
    """drop the frames at each end where nothing moves yet / any more (keeping a couple)"""
    al = [m[0] for m in mats]
    D = dist_matrix(al)
    step = float(np.percentile(np.diagonal(D, 1), 75)) + 1e-6
    n = len(al)
    a = next((i for i in range(n) if D[0, i] > 0.5 * step), 0)
    b = next((i for i in range(n - 1, -1, -1) if D[n - 1, i] > 0.5 * step), n - 1)
    a, b = max(0, a - lead), min(n, b + 1 + lead)
    return (a, b) if b - a >= 6 else (0, n)


def pack(name, mats, st, extra):
    n = len(mats)
    alphas = [m[0] for m in mats]
    union = np.max(np.array([a > 0.04 for a in alphas]), 0)
    ys, xs = np.nonzero(union)
    x0, x1 = max(0, xs.min() - 6), min(st.fw, xs.max() + 7)
    y0, y1 = max(0, ys.min() - 6), min(st.fh, max(int(st.ground) + 8, ys.max() + 4))
    out = {}
    for sname, sc in SETS.items():
        cw, ch = int(np.ceil((x1 - x0) * sc)), int(np.ceil((y1 - y0) * sc))
        cols = max(1, min(MAXPAGE // cw, int(np.ceil(np.sqrt(n * ch / cw))) or 1, n))
        per_page = cols * max(1, MAXPAGE // ch)
        pages = []
        for p0 in range(0, n, per_page):
            chunk = mats[p0:p0 + per_page]
            rows = int(np.ceil(len(chunk) / cols))
            sheet = np.zeros((rows * ch, cols * cw, 4), np.uint8)
            for k, (a, fg, _bg) in enumerate(chunk):
                rgba = np.dstack([fg[y0:y1, x0:x1, ::-1], a[y0:y1, x0:x1, None]])
                if rgba.shape[:2] != (ch, cw):
                    prem = rgba.copy(); prem[..., :3] *= prem[..., 3:]
                    prem = cv2.resize(prem, (cw, ch), interpolation=cv2.INTER_AREA)
                    al = np.clip(prem[..., 3:], 1e-4, 1)
                    rgba = np.dstack([np.clip(prem[..., :3] / al, 0, 1), prem[..., 3:]])
                r, cc = divmod(k, cols)
                sheet[r * ch:(r + 1) * ch, cc * cw:(cc + 1) * cw] = np.clip(rgba * 255 + 0.5, 0, 255).astype(np.uint8)
            fn = f'{name}-{sname}{"-" + str(len(pages)) if p0 else ""}.webp'
            Image.fromarray(sheet, 'RGBA').save(os.path.join(OUT, fn), 'WEBP', quality=84, method=5, alpha_quality=92)
            pages.append(fn)
        e = dict(extra)
        for key in ('speed',):
            if key in e:
                e[key] = round(e[key] * sc, 3)
        if 'land' in e:
            e['land'] = [round(v * sc, 2) for v in e['land']]
        out[sname] = {'frames': n, 'cell': [cw, ch], 'cols': cols, 'per_page': per_page, 'pages': pages,
                      'anchor': [round((st.hipx - x0) * sc, 2), round((st.ground - y0) * sc, 2)], 'sit_h': round(st.sit_h * sc, 2), **e}
        print('  ', sname, n, 'frames', cw, 'x', ch, len(pages), 'page(s)', round(sum(os.path.getsize(os.path.join(OUT, p)) for p in pages) / 1e6, 2), 'MB')
    return out


manifest = {'fps': FPS, 'sets': {k: {} for k in SETS}}
for name, c in cfg.items():
    print(name, c)
    st = Stage(bool(c.get('jump')))
    frames = still(c['src'][6:], st) if c['src'].startswith('still:') else read_frames(os.path.join(CLIPS, c['src']), st)
    if 'trim' in c:
        frames = frames[c['trim'][0]:c['trim'][1]]
    if c.get('reverse'):
        frames = frames[::-1]
    mats = [matte(f) for f in frames]
    extra = {}
    if c.get('gait'):
        al = [m[0] for m in mats]
        i, j, k = find_loop(al)
        extra = {'lead': i, 'stand': k, 'speed': gait_speed(al[i:j] + al[i:i + 1], st)}
        # ease the seam: the last frames lean toward what came just before the loop began
        B = 3
        for b in range(B):
            t = (b + 1) / (B + 1)
            a1, f1, bg = mats[j - B + b]; a0, f0, _ = mats[i - B + b]
            al2 = a1 * (1 - t) + a0 * t
            fg = (f1 * (a1 * (1 - t))[..., None] + f0 * (a0 * t)[..., None]) / np.clip(al2, 1e-4, 1)[..., None]
            mats[j - B + b] = (al2, np.clip(fg, 0, 1), bg)
        mats = mats[:j]
    elif len(mats) > 1 and c.get('autotrim', True):
        a, b = trim_still_ends(mats)
        print(f'   moving part: frames {a}..{b - 1} of {len(mats)}')
        mats = mats[a:b]
    if c.get('jump'):
        al = [m[0] for m in mats]
        # where the cat's weight is in each frame, and where its feet end up
        cy = np.array([np.average(np.arange(a.shape[0]), weights=a.sum(1) + 1e-6) for a in al])
        cx = np.array([np.average(np.arange(a.shape[1]), weights=a.sum(0) + 1e-6) for a in al])
        p = (cy - cy[0]) / (cy[-1] - cy[0] + 1e-6)
        p = np.clip(cv2.GaussianBlur(p.reshape(-1, 1), (0, 0), 1.0).ravel(), 0, 1)
        p = np.maximum.accumulate(p); p[0] = 0; p[-1] = 1
        ys, xs = np.nonzero(al[-1] > 0.5); ys0, xs0 = np.nonzero(al[0] > 0.5)
        land = [float(cx[-1] - cx[0]), float(ys.max() - ys0.max())]
        extra = {'land': land, 'path': [round(float(v), 3) for v in p]}
        print('   lands at', [round(v, 1) for v in land], 'sprite px from where it started')
    packed = pack(name, mats, st, extra)
    for sname in SETS:
        manifest['sets'][sname][name] = packed[sname]
json.dump(manifest, open(os.path.join(OUT, 'cat.json'), 'w'))
print('wrote', os.path.join(OUT, 'cat.json'), 'total', round(sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) / 1e6, 1), 'MB')
