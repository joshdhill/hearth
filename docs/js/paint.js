// Painting primitives shared by the window scenes.
import { canvas, rgb, hex, mix, shade, seeded, lerp, clamp, fbm1 } from './util.js';

// Catmull-Rom through points -> dense polyline
export function spline(pts, step = 6) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

// A path with per-point width, used for perches and painting.
export function makeBranch(points, w0, w1) {
  const pts = spline(points);
  let total = 0;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); acc.push(total); }
  const at = t => {
    const d = clamp(t, 0, 1) * total;
    let i = 1;
    while (i < acc.length - 1 && acc[i] < d) i++;
    const a = pts[i - 1], b = pts[i], f = (d - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]);
    const x = lerp(a[0], b[0], f), y = lerp(a[1], b[1], f);
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
    return { x, y, tx: dx / n, ty: dy / n, w: lerp(w0, w1, Math.pow(t, 0.85)) };
  };
  return { pts, total, at, w0, w1 };
}

// Tapered bark-textured limb. light: 0..1, tint: rgb of daylight
export function paintBranch(ctx, br, opt) {
  const { base = '#5b4b3f', light = 1, tint = [255, 250, 240], seed = 3, snow = 0, moss = 0 } = opt;
  const rnd = seeded(seed);
  const N = 160;
  const L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const p = br.at(i / N);
    const wob = 1 + (fbm1(i * 0.11 + seed) - 0.5) * 0.18;
    const w = p.w * wob / 2;
    L.push([p.x - p.ty * w, p.y + p.tx * w]);
    R.push([p.x + p.ty * w, p.y - p.tx * w]);
  }
  const lit = mix([40, 34, 30], tint, 0.25 + 0.75 * light);
  const col = mixMul(hex(base), lit);
  ctx.save();
  ctx.beginPath();
  L.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fillStyle = rgb(col);
  ctx.fill();
  ctx.clip();
  // shadow underside / highlight on top: draw offset copies of the centreline
  const strokeAlong = (off, width, style, alpha) => {
    ctx.globalAlpha = alpha; ctx.strokeStyle = style; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = br.at(i / N);
      const x = p.x - p.ty * p.w * off, y = p.y + p.tx * p.w * off;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.lineWidth = width; ctx.stroke();
  };
  // the side facing up gets light; tangent normal (−ty, tx) points to the "left"; choose the upward one
  const mid = br.at(0.5); const up = (mid.tx >= 0 ? 1 : -1);  // when moving right, left-normal points down in screen space
  strokeAlong(0.42 * up, br.w0 * 0.5, rgb(shade(col, -0.55)), 0.55);
  strokeAlong(-0.3 * up, br.w0 * 0.18, rgb(shade(col, 0.28)), 0.45);
  // bark furrows
  ctx.lineWidth = 1.6;
  for (let k = 0; k < br.total / 3; k++) {
    const t = rnd(), p = br.at(t), off = (rnd() - 0.5) * 0.85, len = 6 + rnd() * 22;
    const x = p.x - p.ty * p.w * off, y = p.y + p.tx * p.w * off;
    ctx.globalAlpha = 0.18 + rnd() * 0.2;
    ctx.strokeStyle = rnd() < 0.7 ? rgb(shade(col, -0.45)) : rgb(shade(col, 0.22));
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + p.tx * len, y + p.ty * len); ctx.stroke();
  }
  if (moss > 0) {
    for (let k = 0; k < br.total / 18 * moss; k++) {
      const p = br.at(rnd()), off = -0.35 * up + (rnd() - 0.5) * 0.2;
      ctx.globalAlpha = 0.25; ctx.fillStyle = rgb(mixMul(hex('#6f7a3c'), lit));
      ctx.beginPath(); ctx.ellipse(p.x - p.ty * p.w * off, p.y + p.tx * p.w * off, 6 + rnd() * 10, 2 + rnd() * 3, Math.atan2(p.ty, p.tx), 0, 7); ctx.fill();
    }
  }
  ctx.restore();
  if (snow > 0) {
    // snow sits on the top edge
    ctx.save();
    ctx.fillStyle = rgb(mix([150, 160, 185], [250, 250, 252], 0.35 + 0.65 * light));
    ctx.beginPath();
    const top = up > 0 ? R : L;
    for (let i = 0; i <= N; i++) {
      const p = br.at(i / N), h = (2 + fbm1(i * 0.3 + seed) * 9) * snow * Math.min(1, p.w / 18);
      const q = top[i];
      const x = q[0] + p.ty * h * up * -1, y = q[1] - Math.abs(h);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    for (let i = N; i >= 0; i--) { const q = top[i], p = br.at(i / N); ctx.lineTo(q[0] + p.ty * 2 * up, q[1] + 3); }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  return L.concat(R.reverse());
}

function mixMul(c, light) { return [c[0] * light[0] / 255, c[1] * light[1] / 255, c[2] * light[2] / 255]; }
export { mixMul };

// Thin twig with optional leaves. Returns nothing; paints directly.
export function paintTwig(ctx, x, y, ang, len, w, col, rnd, leaf) {
  const steps = 6;
  let px = x, py = y, a = ang;
  ctx.strokeStyle = rgb(col); ctx.lineCap = 'round';
  for (let i = 0; i < steps; i++) {
    const seg = len / steps, nw = w * (1 - (i + 1) / (steps + 1));
    a += (rnd() - 0.5) * 0.25;
    const nx = px + Math.cos(a) * seg, ny = py + Math.sin(a) * seg;
    ctx.lineWidth = Math.max(0.8, nw);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
    if (i > 1 && rnd() < 0.35 && len > 60) paintTwig(ctx, nx, ny, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.4), len * 0.4, nw, col, rnd, leaf);
    if (leaf && rnd() < leaf.p) drawLeaf(ctx, nx, ny, a + (rnd() - 0.5) * 2, leaf.size * (0.7 + rnd() * 0.5), leaf.colors[Math.floor(rnd() * leaf.colors.length)]);
    if (leaf && leaf.bud && rnd() < 0.3) { ctx.fillStyle = rgb(leaf.bud); ctx.beginPath(); ctx.arc(nx, ny, 2.4, 0, 7); ctx.fill(); }
    px = nx; py = ny;
  }
}

export function drawLeaf(ctx, x, y, a, s, col) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = rgb(col);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(s * 0.5, -s * 0.42, s, 0);
  ctx.quadraticCurveTo(s * 0.5, s * 0.42, 0, 0);
  ctx.fill();
  ctx.globalAlpha = 0.35; ctx.strokeStyle = rgb(shade(col, -0.4)); ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 0.9, 0); ctx.stroke();
  ctx.restore();
}

// Rows of rounded foliage blobs along a ridge; depth 0 near .. 1 far
export function paintTreeline(ctx, opt) {
  const { y0, amp, x0 = -40, x1 = 1960, colors, seed = 1, blob = 30, haze, bare = 0, snow = 0, everg = 0.15, light = 1, base = true } = opt;
  const rnd = seeded(seed);
  const ridge = x => y0 - amp * fbm1(x * 0.004 + seed * 3.1, 4);
  // base mass
  if (base) {
    ctx.fillStyle = rgb(haze(colors[0]));
    ctx.beginPath(); ctx.moveTo(x0, 1080);
    for (let x = x0; x <= x1; x += 8) ctx.lineTo(x, ridge(x) + blob * 0.6);
    ctx.lineTo(x1, 1080); ctx.closePath(); ctx.fill();
  }
  for (let x = x0; x <= x1; x += blob * 0.55) {
    const top = ridge(x);
    const ev = rnd() < everg;
    if (ev) {
      // conifer: stacked triangles
      const h = blob * (2.2 + rnd() * 1.6), w = blob * (0.9 + rnd() * 0.4);
      const c = haze(mix(hex('#2f3f2c'), hex('#4b5a44'), rnd()));
      ctx.fillStyle = rgb(c);
      for (let k = 0; k < 4; k++) {
        const ty = top - h + k * h * 0.22, tw = w * (0.35 + k * 0.22);
        ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x - tw, ty + h * 0.34); ctx.lineTo(x + tw, ty + h * 0.34); ctx.closePath(); ctx.fill();
      }
      if (snow) { ctx.fillStyle = rgb(haze([235, 238, 245])); for (let k = 0; k < 4; k++) { const ty = top - h + k * h * 0.22, tw = w * (0.35 + k * 0.22); ctx.beginPath(); ctx.moveTo(x, ty + 2); ctx.lineTo(x - tw * 0.8, ty + h * 0.26); ctx.lineTo(x + tw * 0.6, ty + h * 0.22); ctx.closePath(); ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1; } }
      continue;
    }
    if (rnd() < bare) {
      // bare deciduous crown: fine branching lines
      const h = blob * (2.2 + rnd() * 1.5);
      ctx.strokeStyle = rgb(haze(mix(hex('#5d5352'), hex('#776a66'), rnd())));
      bareTree(ctx, x, top + blob * 0.5, h, rnd, Math.max(0.6, blob / 22));
      continue;
    }
    // leafy crown: a shadowed mass covered in small top-lit dabs
    const c = colors[1 + Math.floor(rnd() * (colors.length - 1))];
    const r = blob * (0.8 + rnd() * 0.7);
    const cx = x + (rnd() - 0.5) * blob * 0.4, cy = top + r * 0.25;
    ctx.fillStyle = rgb(haze(shade(c, -0.32)));
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.15, r * 1.05, r * 0.82, 0, 0, 7); ctx.fill();
    const dabs = 20 + Math.round(r / 3);
    for (let k = 0; k < dabs; k++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
      const px = cx + Math.cos(a) * d * 1.05, py = cy + Math.sin(a) * d * 0.8;
      const lt = clamp(-(py - cy) / r * 0.55 + (px - cx) / r * 0.12, -0.55, 0.55) * (0.5 + 0.5 * light);
      ctx.fillStyle = rgb(haze(shade(c, lt * 0.4 + (rnd() - 0.5) * 0.14)));
      ctx.beginPath(); ctx.ellipse(px, py, r * (0.14 + rnd() * 0.16), r * (0.11 + rnd() * 0.12), rnd() * 3, 0, 7); ctx.fill();
    }
  }
}

export function bareTree(ctx, x, y, h, rnd, w) {
  ctx.lineCap = 'round';
  const grow = (px, py, a, len, lw, depth) => {
    const nx = px + Math.cos(a) * len, ny = py + Math.sin(a) * len;
    ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
    if (depth <= 0 || len < 4) return;
    const n = 2 + (rnd() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) grow(nx, ny, a + (rnd() - 0.5) * 1.1, len * (0.62 + rnd() * 0.15), lw * 0.62, depth - 1);
  };
  grow(x, y, -Math.PI / 2 + (rnd() - 0.5) * 0.15, h * 0.42, w * 2.2, 5);
}

// Soft cloud sprite
export function cloudSprite(w, h, col, seed) {
  const c = canvas(w, h), x = c.getContext('2d'), rnd = seeded(seed);
  x.filter = `blur(${Math.round(h * 0.08)}px)`;
  for (let i = 0; i < 26; i++) {
    const cx = w * (0.15 + rnd() * 0.7), cy = h * (0.45 + (rnd() - 0.5) * 0.35 * (1 - Math.abs(cx / w - 0.5)));
    const r = h * (0.16 + rnd() * 0.22);
    const g = x.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, rgb(shade(col, 0.12), 0.9)); g.addColorStop(1, rgb(col, 0));
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  // flatter, darker base
  x.globalCompositeOperation = 'source-atop';
  const gb = x.createLinearGradient(0, 0, 0, h);
  gb.addColorStop(0.45, rgb(col, 0)); gb.addColorStop(1, rgb(shade(col, -0.25), 0.7));
  x.fillStyle = gb; x.fillRect(0, 0, w, h);
  return c;
}

// Fine grain that makes flat fills feel painted
let grainTile = null;
export function grain() {
  if (grainTile) return grainTile;
  const c = canvas(256, 256), x = c.getContext('2d'), d = x.createImageData(256, 256);
  const r = seeded(11);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 128 + (r() - 0.5) * 70;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  grainTile = c;
  return c;
}

// --- sill decor ---------------------------------------------------------

export function pumpkin(ctx, x, y, r, col, lit, stemCol = '#5f5a2e', squash = 0.72) {
  const c = mixMul(hex(col), lit);
  const h = r * squash;
  // contact shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(x, y + 2, r * 1.15, r * 0.12, 0, 0, 7); ctx.fill();
  // ribs from the outside in, so the front rib sits on top
  const ribs = [-1, 1, -0.6, 0.6, -0.2, 0.2].map(t => t * 0.5);
  for (const t of ribs) {
    const rx = r * (0.34 + 0.16 * (1 - Math.abs(t) * 2)), ox = t * r * 1.2;
    const cy = y - h;
    const g = ctx.createRadialGradient(x + ox - rx * 0.25, cy - h * 0.35, rx * 0.15, x + ox, cy, Math.max(rx, h) * 1.1);
    g.addColorStop(0, rgb(shade(c, 0.25))); g.addColorStop(0.6, rgb(c)); g.addColorStop(1, rgb(shade(c, -0.5)));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x + ox, cy, rx, h, 0, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = rgb(mixMul(hex(stemCol), lit)); ctx.lineWidth = r * 0.17; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y - h * 1.85); ctx.quadraticCurveTo(x + r * 0.05, y - h * 2.3, x + r * 0.24, y - h * 2.4); ctx.stroke();
}

export function candleBody(ctx, x, y, w, h, lit, col = '#efe6d2', jar = false) {
  const c = mixMul(hex(col), lit);
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, rgb(shade(c, -0.3))); g.addColorStop(0.45, rgb(shade(c, 0.1))); g.addColorStop(1, rgb(shade(c, -0.4)));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, w / 2, w * 0.12, 0, 0, 7); ctx.fill();
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = rgb(shade(c, 0.15));
  ctx.beginPath(); ctx.ellipse(x, y - h, w / 2, w * 0.12, 0, 0, 7); ctx.fill();
  if (jar) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
    ctx.strokeRect(x - w / 2 - 6, y - h * 1.15, w + 12, h * 1.15);
  }
}

export function flame(ctx, x, y, s, t, seed) {
  const fl = 0.85 + 0.15 * Math.sin(t * 9 + seed) + 0.08 * Math.sin(t * 23 + seed * 3);
  const sway = Math.sin(t * 2.3 + seed) * s * 0.08;
  // halo
  const g = ctx.createRadialGradient(x, y - s, 0, x, y - s, s * 9);
  g.addColorStop(0, `rgba(255,190,110,${0.30 * fl})`); g.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - s, s * 9, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.scale(1, fl);
  const f = ctx.createLinearGradient(0, -s * 2.4, 0, 0);
  f.addColorStop(0, 'rgba(255,240,200,0)'); f.addColorStop(0.35, 'rgba(255,214,140,0.95)'); f.addColorStop(0.85, 'rgba(255,150,60,0.95)'); f.addColorStop(1, 'rgba(120,140,255,0.7)');
  ctx.fillStyle = f;
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(s * 0.55, -s * 0.4, s * 0.25 + sway, -s * 1.6, sway * 1.6, -s * 2.4);
  ctx.bezierCurveTo(-s * 0.25 + sway, -s * 1.6, -s * 0.55, -s * 0.4, 0, 0);
  ctx.fill(); ctx.restore();
}
