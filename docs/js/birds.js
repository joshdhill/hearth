// Birds heard today (from the bird board's live feed) fly to the window branch and perch for a while.
// Each painted plate keeps its own twig; the base of that twig is tucked behind the window's branch.
import { W, H, canvas, clamp, lerp, rand, pick, hex, rgb, shade, mix, easeOut, ago, loadImage, store } from './util.js';

const BOARD = '/bird-board/';
const FEED = BOARD + 'api/today.json';
const PX_PER_CM = 9.5;
const REGULARS = ['chickadee', 'cardinal', 'titmouse', 'bluejay', 'nuthatch', 'downy', 'goldfinch', 'housefinch', 'wren', 'mockingbird', 'dove', 'robin'];
const WINTER_REGULARS = ['junco', 'whitethroated'];

let META = null;
async function meta() {
  if (!META) META = await fetch('data/plates.json').then(r => r.json()).catch(() => ({}));
  return META;
}

export class Birds {
  constructor(app, scene) {
    this.app = app;
    this.scene = scene;
    this.perched = [];
    this.flying = [];
    this.distant = [];
    this.queue = [];
    this.feed = [];
    this.seen = {};
    this.imgs = {};
    this.next = 4;       // first visit soon after the scene opens
    this.clock = 0;
    this.lastCall = 0;
  }

  get o() { return this.scene.o; }

  async start() {
    this.meta = await meta();
    await this.poll(true);
    this.timer = setInterval(() => this.poll(false), 60000);
  }

  stop() { clearInterval(this.timer); this.stopped = true; }

  async poll(first) {
    try {
      const url = (this.o.feed || FEED) + '?t=' + Math.floor(Date.now() / 30000);
      const j = await fetch(url, { cache: 'no-store' }).then(r => r.json());
      this.feed = (j.birds || []).filter(b => b.key);
      for (const b of this.feed) {
        const prev = this.seen[b.key];
        if (first) {
          // anything heard in the last 10 minutes gets an early visit
          if (Date.now() / 1000 - b.ts < 600) this.queue.push({ key: b.key, fresh: false });
        } else if (prev === undefined || b.ts > prev) {
          this.queue.push({ key: b.key, fresh: true });
        }
        this.seen[b.key] = b.ts;
      }
    } catch (e) {
      console.warn('Bird feed unavailable:', e.message);
    }
  }

  info(key) {
    const m = this.meta[key];
    const f = this.feed.find(b => b.key === key);
    if (!m && !f) return null;
    return {
      key,
      name: (f && f.name) || (m && m.name) || key,
      cm: (f && f.cm) || (m && m.cm) || 18,
      len: (f && f.len) || (m && m.len) || 600,
      img: BOARD + ((f && f.img) || `cutouts/${key}.png`),
      snd: f && f.snd ? BOARD + f.snd : null,
      ts: f ? f.ts : 0,
      m: m || { kind: 'flyby', back: '#6b6158', belly: '#a89f90' }
    };
  }

  async image(b) {
    if (this.imgs[b.key]) return this.imgs[b.key];
    const im = await loadImage(b.img);
    let use = im;
    if (b.m.kind === 'trunk') {
      // fade the plate's own trunk at the top and bottom so it melts into the window's trunk
      const c = canvas(im.width, im.height), x = c.getContext('2d');
      x.drawImage(im, 0, 0);
      x.globalCompositeOperation = 'destination-in';
      const g = x.createLinearGradient(0, 0, 0, im.height);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.22, 'rgba(0,0,0,1)'); g.addColorStop(0.78, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, im.width, im.height);
      use = c;
    }
    this.imgs[b.key] = use;
    return use;
  }

  // ---- scheduling ---------------------------------------------------------
  tick(dt) {
    this.clock += dt;
    const now = this.clock;
    // departures
    for (const p of this.perched) if (!p.leaving && now > p.until) this.depart(p);
    this.next -= dt;
    if (this.next > 0 || this.busy) return;
    const night = (this.scene.sky?.day ?? 1) < 0.15;
    const max = this.o.maxBirds || 3;
    if (this.perched.filter(p => !p.leaving).length >= max) {
      const oldest = this.perched.filter(p => !p.leaving).sort((a, b) => a.since - b.since)[0];
      if (this.queue.length && oldest) this.depart(oldest);
      this.next = this.queue.length ? 2 : rand(10, 20);
      return;
    }
    this.next = rand(18, 50) * (night ? 2.5 : 1) * (this.feed.length > 6 ? 0.8 : 1.2);
    let job = this.queue.shift();
    if (job && this.perched.some(p => p.b.key === job.key)) job = null;
    const key = job ? job.key : this.choose();
    if (!key) return;
    this.visit(key, job && job.fresh);
  }

  choose() {
    const busy = new Set(this.perched.map(p => p.b.key).concat(this.flying.map(f => f.b.key)));
    const nowS = Date.now() / 1000;
    const pool = [];
    for (const b of this.feed) {
      if (busy.has(b.key)) continue;
      const age = nowS - b.ts;
      pool.push([b.key, Math.sqrt(b.n || 1) * (1 + 4 * Math.exp(-age / 1800))]);
    }
    if (pool.length < 3 && this.o.regulars !== false) {
      const m = new Date().getMonth();
      const regs = REGULARS.concat(m >= 9 || m <= 3 ? WINTER_REGULARS : []);
      for (const k of regs) if (!busy.has(k) && this.meta[k] && !pool.some(p => p[0] === k)) pool.push([k, 0.6]);
    }
    if (!pool.length) return null;
    let sum = pool.reduce((s, p) => s + p[1], 0), r = Math.random() * sum;
    for (const [k, w] of pool) { if ((r -= w) <= 0) return k; }
    return pool[0][0];
  }

  async visit(key, fresh) {
    const b = this.info(key);
    if (!b) return;
    if (b.m.kind === 'flyby' || !this.scene.geometry.limb) { this.flyby(b, fresh); return; }
    this.busy = true;
    try {
      const img = await this.image(b);
      if (this.stopped) return;
      const spot = b.m.kind === 'trunk' ? this.trunkSpot(b, img) : this.twigSpot(b, img);
      if (!spot) { this.flyby(b, fresh); return; }
      const target = spot.bodyAt;
      const fromLeft = target[0] < W / 2 ? Math.random() < 0.75 : Math.random() < 0.25;
      const start = [fromLeft ? -120 : W + 120, rand(80, 420)];
      const size = spot.lenPx;
      this.flying.push({
        b, spot, img, size, kind: 'arrive', fresh,
        p0: start, p2: target, p1: [(start[0] + target[0]) / 2, Math.min(start[1], target[1]) - rand(60, 200)],
        t: 0, dur: Math.hypot(target[0] - start[0], target[1] - start[1]) / rand(560, 760),
        flap: rand(0, 6), col: [hex(b.m.back || '#6b6158'), hex(b.m.belly || '#a89f90')]
      });
    } catch (e) {
      console.warn('Plate failed', key, e.message);
    } finally { this.busy = false; }
  }

  flyby(b, fresh) {
    // a distant pass across the sky; geese come in a V
    const flock = /goose/.test(b.key) ? 7 : /mallard/.test(b.key) ? 3 : 1;
    const ltr = Math.random() < 0.5, y = rand(140, 330), size = clamp(b.cm * 1.6, 34, 110);
    for (let i = 0; i < flock; i++) {
      const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      this.distant.push({
        b, x: (ltr ? -150 : W + 150) - (ltr ? 1 : -1) * row * size * 1.1, y: y + side * row * size * 0.55,
        vx: (ltr ? 1 : -1) * rand(130, 170), size: size * (0.85 + Math.random() * 0.2), flap: rand(0, 6),
        col: [hex(b.m.back || '#4d4741'), hex(b.m.belly || '#7d756c')]
      });
    }
    if (fresh) this.announce(b, true);
  }

  depart(p) {
    p.leaving = true;
    p.fade = 0;
    const away = [p.spot.bodyAt[0] + (p.spot.bodyAt[0] < W / 2 ? -1 : 1) * rand(700, 1100), rand(-200, 120)];
    this.flying.push({
      b: p.b, spot: p.spot, img: p.img, size: p.spot.lenPx, kind: 'leave',
      p0: p.spot.bodyAt.slice(), p2: away, p1: [lerp(p.spot.bodyAt[0], away[0], 0.3), p.spot.bodyAt[1] - rand(60, 140)],
      t: 0, dur: rand(1.2, 1.8), flap: rand(0, 6), col: [hex(p.b.m.back || '#6b6158'), hex(p.b.m.belly || '#a89f90')]
    });
  }

  land(f) {
    const p = { b: f.b, spot: f.spot, img: f.img, since: this.clock, until: this.clock + rand(45, 160), fade: 0, bob: rand(8, 20) };
    this.perched.push(p);
    this.announce(f.b, f.fresh);
  }

  announce(b, fresh) {
    if (this.o.names !== false) this.app.caption(b.name, b.ts ? `Heard ${ago(b.ts)}` : 'A regular here');
    if (fresh && b.snd && this.o.calls !== false && this.clock - this.lastCall > 40) {
      this.lastCall = this.clock;
      const vol = this.o.callVolume ?? 0.45;
      // on the TV the call goes through the app's own player so Spotify isn't paused
      if (window.HearthNative && window.HearthNative.playSound) window.HearthNative.playSound(new URL(b.snd, location.href).href, vol);
      else { try { const a = new Audio(b.snd); a.volume = vol; a.play().catch(() => {}); } catch (e) { /* no audio */ } }
    }
  }

  // ---- placement -----------------------------------------------------------
  twigSpot(b, img) {
    const g = this.scene.geometry;
    const lenPx = clamp(b.cm * PX_PER_CM, 95, 330);
    const s = lenPx / b.len;
    const sw = img.width * s, sh = img.height * s;
    const others = this.perched.filter(p => !p.leaving).map(p => p.spot);
    let best = null;
    for (const flip of [false, true]) {
      const jx = (flip ? 1 - b.m.joint[0] : b.m.joint[0]) * sw, jy = b.m.joint[1] * sh;
      let dx = (flip ? -b.m.dir[0] : b.m.dir[0]) * sw, dy = b.m.dir[1] * sh;
      const dn = Math.hypot(dx, dy) || 1; dx /= dn; dy /= dn;
      const bxN = flip ? 1 - b.m.body[0] : b.m.body[0], byN = b.m.body[1];
      for (const [br, name] of [[g.limb, 'limb'], [g.sub, 'sub']]) {
        for (let t = 0.1; t <= 0.9; t += 0.03) {
          const P = br.at(t);
          const cross = Math.abs(dx * P.ty - dy * P.tx);
          if (cross < 0.5) continue;
          const ox = P.x - jx, oy = P.y - jy;
          const body = [ox + bxN * sw, oy + byN * sh];
          const r = lenPx * 0.36;
          // whole bird must sit inside the glass, clear of the trunk
          if (body[0] - r < g.glass.x + 30 || body[0] + r > Math.min(g.glass.x + g.glass.w - 30, 1520)) continue;
          if (body[1] - r < g.glass.y + 24 || body[1] + r * 0.6 > g.glass.y + g.glass.h - 10) continue;
          // the branch is painted over the plate, so keep the body off every branch
          if (nearBranch(body, r * 0.75, [g.limb, g.sub, g.arm])) continue;
          if (others.some(o => Math.hypot(o.bodyAt[0] - body[0], o.bodyAt[1] - body[1]) < (o.lenPx + lenPx) * 0.42)) continue;
          // the plate's twig should point away from the branch toward the bird
          const toBody = (body[0] - P.x) * dx + (body[1] - P.y) * dy;
          if (toBody < 0) continue;
          let score = Math.random() * 0.6 + cross * 0.4;
          if (Math.abs(body[1] - (g.glass.y + g.glass.h / 2)) < r * 0.6) score -= 0.5;     // head behind the meeting rail
          if (Math.abs(body[0] - W / 2) < r * 0.5) score -= 0.35;                          // behind the centre bar
          if (!best || score > best.score) best = { score, ox, oy, sw, sh, flip, lenPx, bodyAt: body, kind: 'twig', on: name };
        }
      }
    }
    return best;
  }

  trunkSpot(b, img) {
    const g = this.scene.geometry;
    const [t0, t1] = b.m.trunk;
    const lenPx = clamp(b.cm * PX_PER_CM, 95, 330);
    let s = lenPx / b.len;
    const want = 104 / ((t1 - t0) * img.width);       // plate trunk to match the window trunk
    s = clamp(want, s * 0.65, s * 1.5);
    const sw = img.width * s, sh = img.height * s;
    const flip = (t0 + t1) / 2 < 0.5;                   // keep the bird on the side facing the room's view
    const tc = (flip ? 1 - (t0 + t1) / 2 : (t0 + t1) / 2) * sw;
    const others = this.perched.filter(p => !p.leaving && p.spot.kind === 'trunk');
    for (let tries = 0; tries < 30; tries++) {
      const y = rand(g.glass.y + sh * 0.35, g.glass.y + g.glass.h - sh * 0.35);
      if (Math.abs(y - 640) < 110 + sh * 0.2 || Math.abs(y - 470) < 60 + sh * 0.2) continue;
      if (others.some(o => Math.abs(o.bodyAt[1] - y) < sh * 0.7)) continue;
      const P = g.trunk.at(tAtY(g.trunk, y));
      const ox = P.x - tc, oy = y - sh / 2;
      const body = [ox + (flip ? 1 - b.m.body[0] : b.m.body[0]) * sw, oy + b.m.body[1] * sh];
      return { ox, oy, sw, sh, flip, lenPx, bodyAt: body, kind: 'trunk' };
    }
    return null;
  }

  // plates are painted in daylight; dim and tint them to the scene's light
  lightFor() {
    const sky = this.scene.sky;
    if (!sky) return [255, 255, 255];
    return mix([58, 62, 82], sky.tint, 0.22 + 0.78 * sky.light).map(v => Math.min(255, v * 1.04));
  }
  lit(p) {
    const L = this.lightFor();
    const key = L.map(v => Math.round(v / 6)).join(',');
    if (p.litKey === key) return p.litImg;
    p.litKey = key;
    if (L.every(v => v > 238)) { p.litImg = p.img; return p.img; }
    const c = canvas(p.img.width, p.img.height), x = c.getContext('2d');
    x.drawImage(p.img, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = rgb(L); x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(p.img, 0, 0);
    p.litImg = c;
    return c;
  }

  // ---- drawing ------------------------------------------------------------
  drawPerched(ctx, t, dt, kind) {
    if (kind === 'twig') this.tick(dt);
    for (const p of this.perched) {
      if (p.spot.kind !== kind) continue;
      p.fade = Math.min(1, p.fade + dt / 0.35);
      const a = p.leaving ? 1 - p.fade : easeOut(p.fade);
      if (p.leaving && p.fade >= 1) p.gone = true;
      const s = p.spot;
      // small life: breathing and the occasional settle
      const since = this.clock - p.since;
      const hop = since % p.bob < 0.35 ? Math.sin((since % p.bob) / 0.35 * Math.PI) * 4 : 0;
      const sc = (p.leaving ? 1 : 1.05 - 0.05 * easeOut(Math.min(1, p.fade))) * (1 + Math.sin(t * 1.9 + p.bob) * 0.004);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.translate(s.bodyAt[0], s.bodyAt[1] - hop); ctx.scale(sc, sc); ctx.translate(-s.bodyAt[0], -s.bodyAt[1]);
      const im = this.lit(p);
      if (s.flip) { ctx.translate(s.ox + s.sw, s.oy); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, s.sw, s.sh); }
      else ctx.drawImage(im, s.ox, s.oy, s.sw, s.sh);
      ctx.restore();
    }
    this.perched = this.perched.filter(p => !p.gone);
  }

  drawFlying(ctx, t, dt) {
    for (const f of this.flying) {
      f.t += dt / f.dur;
      const k = f.kind === 'arrive' ? easeOut(Math.min(1, f.t)) : Math.min(1, f.t) * Math.min(1, f.t);
      const x = bez(f.p0[0], f.p1[0], f.p2[0], k), y = bez(f.p0[1], f.p1[1], f.p2[1], k);
      const nx = bez(f.p0[0], f.p1[0], f.p2[0], Math.min(1, k + 0.02)), ny = bez(f.p0[1], f.p1[1], f.p2[1], Math.min(1, k + 0.02));
      const heading = Math.atan2(ny - y, nx - x);
      const small = f.b.cm < 20;
      f.flap += dt * (small ? 15 : 7) * (f.kind === 'arrive' && f.t > 0.85 ? 1.4 : 1);
      let alpha = 1;
      if (f.kind === 'arrive' && f.t >= 1) { alpha = 0; f.done = true; this.land(f); }
      if (f.kind === 'leave') alpha = Math.min(1, f.t * 5);
      const bounce = small && f.kind !== 'arrive' ? Math.sin(f.flap * 0.25) * 10 : 0;
      ctx.globalAlpha = alpha;
      const L = this.lightFor();
      flyer(ctx, x, y + bounce, f.size * 0.92, heading, f.flap, f.col.map(c => c.map((v, i) => v * L[i] / 255)), f.kind === 'arrive' && f.t > 0.8);
      ctx.globalAlpha = 1;
      if (f.t >= 1) f.done = true;
    }
    this.flying = this.flying.filter(f => !f.done);
  }

  drawDistant(ctx, t, dt) {
    for (const d of this.distant) {
      d.x += d.vx * dt; d.flap += dt * 6;
      ctx.globalAlpha = 0.8;
      flyer(ctx, d.x, d.y + Math.sin(d.flap * 0.3) * 3, d.size, d.vx > 0 ? 0 : Math.PI, d.flap, d.col.map(c => mix(c, this.scene.sky?.hor || [180, 190, 200], 0.35)), false);
      if (d.x < -300 || d.x > W + 300) d.done = true;
    }
    ctx.globalAlpha = 1;
    this.distant = this.distant.filter(d => !d.done);
  }
}

function tAtY(br, y) {
  let lo = 0, hi = 1;
  const down = br.at(0).y > br.at(1).y;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2, py = br.at(m).y;
    if ((py > y) === down) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

function bez(a, b, c, t) { return (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c; }

function nearBranch(pt, r, brs) {
  for (const br of brs) {
    if (!br) continue;
    for (let i = 0; i <= 40; i++) {
      const p = br.at(i / 40);
      if (Math.hypot(p.x - pt[0], p.y - pt[1]) < r + p.w / 2) return true;
    }
  }
  return false;
}

// A bird in flight, side view, painted in the plate's colours.
function flyer(ctx, x, y, size, heading, flap, col, flare) {
  const dir = Math.cos(heading) >= 0 ? 1 : -1;
  const tilt = clamp(Math.sin(heading), -0.5, 0.5) * 0.6;
  const [back, belly] = col;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.rotate(dir * tilt);
  const L = size;
  const wingA = flare ? -0.9 + Math.sin(flap) * 0.25 : Math.sin(flap);   // -1 up .. 1 down
  const wing = (shadeK, behind) => {
    ctx.fillStyle = rgb(shade(back, shadeK));
    ctx.beginPath();
    const sx = L * 0.04, sy = -L * 0.03;
    const tipX = -L * (0.12 + 0.08 * Math.abs(wingA)), tipY = wingA * L * (behind ? 0.42 : 0.5);
    ctx.moveTo(sx + L * 0.08, sy);
    ctx.quadraticCurveTo(sx, sy + tipY * 0.6, tipX, sy + tipY);
    ctx.quadraticCurveTo(-L * 0.1, sy + tipY * 0.35, -L * 0.14, sy);
    ctx.closePath(); ctx.fill();
  };
  wing(-0.3, true);
  // tail
  ctx.fillStyle = rgb(shade(back, -0.12));
  ctx.beginPath(); ctx.moveTo(-L * 0.2, -L * 0.02); ctx.lineTo(-L * 0.48, -L * 0.06); ctx.lineTo(-L * 0.47, L * 0.05); ctx.closePath(); ctx.fill();
  // body
  const g = ctx.createLinearGradient(0, -L * 0.1, 0, L * 0.1);
  g.addColorStop(0, rgb(back)); g.addColorStop(0.55, rgb(mix(back, belly, 0.5))); g.addColorStop(1, rgb(belly));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, L * 0.27, L * 0.1, 0, 0, 7); ctx.fill();
  // head and beak
  ctx.fillStyle = rgb(back);
  ctx.beginPath(); ctx.arc(L * 0.25, -L * 0.04, L * 0.085, 0, 7); ctx.fill();
  ctx.fillStyle = rgb(shade(back, -0.5));
  ctx.beginPath(); ctx.moveTo(L * 0.32, -L * 0.055); ctx.lineTo(L * 0.4, -L * 0.03); ctx.lineTo(L * 0.32, -L * 0.015); ctx.closePath(); ctx.fill();
  wing(0.05, false);
  ctx.restore();
}
