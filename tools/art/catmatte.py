"""Cut the black cat out of its plain cream background (stills and video frames)."""
import numpy as np, cv2
from scipy import ndimage as ndi

FUR = np.array([0.07, 0.06, 0.07], np.float32)        # BGR of the darkest fur
CREAM = np.array([223, 236, 244], np.float32) / 255     # BGR of the paper in the original illustration


def matte(bgr, bg=None, solid_thr=0.5):
    """bgr float image in 0..1 -> (alpha, clean foreground colour, background colour).
    The cat is dark on a light, even background, so alpha is how far a pixel has moved from the
    background towards dark fur; the inside of the cat (eyes, nose, sheen) is then filled solid."""
    h, w, _ = bgr.shape
    if bg is None:
        b = max(4, h // 40)
        border = np.concatenate([bgr[:b].reshape(-1, 3), bgr[-b:].reshape(-1, 3), bgr[:, :b].reshape(-1, 3), bgr[:, -b:].reshape(-1, 3)])
        bg = np.median(border, 0)
    d = bg - FUR
    a = np.clip(((bg - bgr) @ d) / (d @ d), 0, 1)
    a = np.clip((a - 0.06) / 0.80, 0, 1)                       # ignore paper grain, firm up the fur
    solid = a > solid_thr
    lab, n = ndi.label(solid)
    if n == 0:
        return np.zeros((h, w), np.float32), bgr, bg
    sizes = ndi.sum(solid, lab, range(1, n + 1))
    keep = np.isin(lab, 1 + np.nonzero(sizes > sizes.max() * 0.02)[0])   # the cat, and big bits of it (a lifted paw)
    body = ndi.binary_fill_holes(keep)
    # ...but a hole that is plain paper (the gap between tail and legs) stays a hole
    holes, hn = ndi.label(body & ~keep)
    if hn:
        med = ndi.median(a, holes, range(1, hn + 1))
        area = ndi.sum(np.ones_like(a), holes, range(1, hn + 1))
        paper = 1 + np.nonzero((np.asarray(med) < 0.12) & (np.asarray(area) > (h * w) * 2e-5))[0]
        body &= ~np.isin(holes, paper)
    near = ndi.binary_dilation(body, iterations=max(2, h // 120))        # soft fur edge only close to the body
    alpha = np.where(body, 1.0, a * near).astype(np.float32)
    alpha = np.maximum(alpha, cv2.GaussianBlur(body.astype(np.float32), (0, 0), 0.8) * body)
    # remove the paper colour from half-transparent edge pixels
    aa = np.clip(alpha, 0.08, 1)[..., None]
    fg = np.clip((bgr - (1 - aa) * bg) / aa, 0, 1)
    fg = np.where(alpha[..., None] > 0.97, bgr, fg)
    return alpha, fg.astype(np.float32), bg


def cutout(path):
    im = cv2.imread(path).astype(np.float32) / 255
    a, fg, bg = matte(im)
    ys, xs = np.nonzero(a > 0.5)
    return a, fg, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
