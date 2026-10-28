// Small shared helpers: math, noise, colour, storage, sun position.

export const W = 1920, H = 1080;           // every scene paints in this design space
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const easeOut = t => 1 - Math.pow(1 - t, 3);
export const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Deterministic PRNG so painted layers come out the same every repaint.
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// 1D value noise, smooth, period 256.
const P = new Float32Array(512);
{ const r = seeded(7); for (let i = 0; i < 256; i++) P[i] = P[i + 256] = r(); }
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  return lerp(P[i & 255], P[(i + 1) & 255], smooth(f));
}
export function fbm1(x, oct = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * noise1(x * f + i * 31.7); f *= 2; a *= 0.5; }
  return v;
}

// Colour
export function hex(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
export const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const shade = (c, k) => (k >= 0 ? mix(c, [255, 255, 255], k) : mix(c, [0, 0, 0], -k));
export const mul = (c, m) => [c[0] * m[0] / 255, c[1] * m[1] / 255, c[2] * m[2] / 255];

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Safe localStorage
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem('hearth:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem('hearth:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('hearth:' + k); } catch (e) { /* ignore */ } }
};

// Germantown, MD
export const HOME = { lat: 39.1732, lon: -77.2717, name: 'Germantown' };

// Solar elevation in degrees (NOAA approximation, good to ~0.5°).
export function sunElevation(date = new Date(), lat = HOME.lat, lon = HOME.lon) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * rad;
  const ha = lst - ra;
  const el = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha));
  return el / rad;
}

// Sun elevation and whether it is rising, for a time-of-day override.
export function sunFor(mode) {
  const now = new Date();
  if (mode === 'day') return { el: 38, rising: false };
  if (mode === 'golden') return { el: 6, rising: false };
  if (mode === 'dusk') return { el: -3.5, rising: false };
  if (mode === 'night') return { el: -25, rising: false };
  const el = sunElevation(now);
  const later = sunElevation(new Date(now.getTime() + 600000));
  return { el, rising: later > el };
}

export function seasonFor(date = new Date()) {
  const m = date.getMonth(), d = date.getDate();
  if (m === 11 || m <= 1) return 'winter';
  if (m >= 2 && m <= 4) return m === 2 && d < 20 ? 'winter' : 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m === 10 && d > 20) return 'lateautumn';
  return m === 8 && d < 22 ? 'summer' : 'autumn';
}

export function ago(tsSec) {
  const m = Math.round((Date.now() / 1000 - tsSec) / 60);
  if (m < 1) return 'just now';
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h === 1 ? 'an hour ago' : `${h} hours ago`;
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}
