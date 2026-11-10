// The house cat: a jointed side-view cat that walks, sits, stretches, naps and jumps.
// It follows a list of steps (a "trick"); between tricks it is out of the room.
import { rand, pick, clamp, lerp, easeInOut } from '../util.js';

// Joint positions for each pose, cat facing right, origin on the ground under the body.
// sh/hip: shoulder and hip, ff/hf: front and hind feet, tail: -1 wrapped .. 0 level .. 1 up
const POSES = {
  stand:  { sh: [60, -92],  hip: [-64, -90],  ff: [62, 0],     hf: [-72, 0],    head: [124, -138], tail: 0.55, arch: 0 },
  sit:    { sh: [30, -116], hip: [-38, -46],  ff: [46, 0],     hf: [-4, 0],     head: [54, -176],  tail: -0.9, arch: 14 },
  bow:    { sh: [62, -42],  hip: [-62, -108], ff: [150, 0],    hf: [-70, 0],    head: [130, -50],  tail: 1,    arch: -14 },
  lie:    { sh: [52, -46],  hip: [-62, -40],  ff: [114, -4],   hf: [-20, -2],   head: [102, -88],  tail: -0.8, arch: 6 },
  sleep:  { sh: [52, -42],  hip: [-62, -40],  ff: [112, -4],   hf: [-20, -2],   head: [116, -36],  tail: -1,   arch: 9 },
  crouch: { sh: [50, -62],  hip: [-58, -54],  ff: [64, 0],     hf: [-48, 0],    head: [104, -100], tail: 0.15, arch: 10 },
  leap:   { sh: [66, -92],  hip: [-66, -88],  ff: [150, -98],  hf: [-150, -70], head: [130, -126], tail: 0.05, arch: -5 }
};
const KEYS = ['sh', 'hip', 'ff', 'hf', 'head'];
const blendPose = (a, b, t) => {
  const o = { tail: lerp(a.tail, b.tail, t), arch: lerp(a.arch, b.arch, t) };
  for (const k of KEYS) o[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)];
  return o;
};

export const COATS = {
  black:  { body: '#191411', far: '#0e0b09', eye: '#f0c24a' },
  gray:   { body: '#6a6c72', far: '#4c4e54', eye: '#e9c75a' },
  orange: { body: '#c9772e', far: '#9a5720', eye: '#6f9a52', stripes: '#a35c1e' },
  white:  { body: '#ebe4d8', far: '#c3bbac', eye: '#5c93b8' },
  tuxedo: { body: '#191411', far: '#0e0b09', eye: '#f0c24a', white: '#efe9de' }
};
const WAIT = { off: 0, sometimes: [150, 360], often: [35, 90], loop: [1.5, 4] };

export class HouseCat {
  // spots: { floor, floorScale, shelf, shelfScale, shelfX: [x0, x1], jumpL, jumpR, fireL, fireR, x0, x1 }
  constructor(spots, opt) {
    this.S = spots; this.opt = opt;
    this.away = true;
    this.wait = /catnow/.test(location.search) ? 1 : rand(8, 20);
    this.steps = [];
    this.pose = POSES.stand; this.from = POSES.stand; this.to = POSES.stand; this.pt = 1; this.pd = 0.5;
    this.x = 0; this.y = spots.floor; this.s = spots.floorScale; this.dir = 1;
    this.ph = 0; this.walk = 0; this.clock = 0; this.rot = 0; this.air = false; this.up = false;
  }

  // ---- tricks ---------------------------------------------------------------
  list() { return [['walk', 'Walk by'], ['mantel', 'Jump on the mantel'], ['stretch', 'Big stretch'], ['sit', 'Sit by the fire'], ['nap', 'Nap on the rug'], ['zoom', 'Zoomies'], ['bye', 'Off you go']]; }

  // start a trick now, from wherever the cat is
  do(trick) {
    if (this.air) { this.pending = trick; return; }      // finish the jump first
    const S = this.S, st = [];
    if (S.noShelf && trick === 'mantel') trick = 'stretch';      // this picture has no room above the mantel
    const side = this.away ? pick([-1, 1]) : (this.x < (S.x0 + S.x1) / 2 ? -1 : 1);   // the side it is on / comes in from
    const off = d => (d < 0 ? S.x0 - 330 : S.x1 + 330);
    if (this.away) {
      if (trick === 'bye') return;
      st.push({ tp: 'enter', x: off(side) });
    }
    const down = () => {
      const left = this.x < (S.shelfX[0] + S.shelfX[1]) / 2;
      const ex = left ? S.shelfX[0] + 40 : S.shelfX[1] - 40;
      st.push({ tp: 'go', x: ex }, { tp: 'face', dir: left ? -1 : 1 }, { tp: 'pose', pose: 'crouch', hold: 0.5 },
        { tp: 'jump', x: left ? S.jumpL : S.jumpR, y: S.floor, s: S.floorScale }, { tp: 'pose', pose: 'stand', hold: 0.3 });
      return left ? -1 : 1;
    };
    let at = side;                      // which side of the room the cat ends up on
    const onShelf = this.up && !this.away;
    if (onShelf && trick !== 'mantel') at = down();
    const mid = (S.x0 + S.x1) / 2;
    switch (trick) {
      case 'walk': at = -at; break;
      case 'zoom':
        st.push({ tp: 'go', x: at < 0 ? S.x1 - 200 : S.x0 + 200, fast: 2.6 }, { tp: 'pose', pose: 'crouch', hold: 0.5, wiggle: true },
          { tp: 'go', x: at < 0 ? S.x0 + 260 : S.x1 - 260, fast: 2.8 }, { tp: 'pose', pose: 'crouch', hold: 0.4, wiggle: true });
        st.push({ tp: 'go', x: mid + rand(-200, 200), fast: 2.4 }, { tp: 'pose', pose: 'sit', hold: rand(3, 6) }, { tp: 'pose', pose: 'stand', hold: 0.2 });
        at = pick([-1, 1]);
        break;
      case 'stretch':
        st.push({ tp: 'go', x: mid + rand(-380, 380) }, { tp: 'pose', pose: 'bow', hold: 2.8, dur: 0.9 }, { tp: 'pose', pose: 'stand', hold: 0.4, dur: 0.7 });
        at = pick([-1, 1]);
        break;
      case 'sit': {
        const left = Math.random() < 0.5;
        st.push({ tp: 'go', x: left ? S.fireL : S.fireR }, { tp: 'face', dir: left ? 1 : -1 },
          { tp: 'pose', pose: 'sit', hold: rand(22, 45), dur: 0.8 }, { tp: 'pose', pose: 'stand', hold: 0.3, dur: 0.6 });
        at = pick([-1, 1]);
        break;
      }
      case 'nap':
        st.push({ tp: 'go', x: mid + rand(-260, 260) }, { tp: 'pose', pose: 'sit', hold: 2.5, dur: 0.8 }, { tp: 'pose', pose: 'lie', hold: 5, dur: 1 },
          { tp: 'pose', pose: 'sleep', hold: rand(50, 100), dur: 1.6 }, { tp: 'pose', pose: 'lie', hold: 2.5, dur: 1.2 },
          { tp: 'pose', pose: 'stand', hold: 0.3, dur: 0.8 }, { tp: 'pose', pose: 'bow', hold: 2.4, dur: 0.9 }, { tp: 'pose', pose: 'stand', hold: 0.3, dur: 0.7 });
        at = pick([-1, 1]);
        break;
      case 'mantel': {
        if (!onShelf) {
          const left = at < 0;
          st.push({ tp: 'go', x: left ? S.jumpL : S.jumpR }, { tp: 'face', dir: left ? 1 : -1 },
            { tp: 'pose', pose: 'sit', hold: 1.4, dur: 0.6, look: -0.5 }, { tp: 'pose', pose: 'crouch', hold: 0.9, dur: 0.4, wiggle: true },
            { tp: 'jump', x: left ? S.shelfX[0] + 60 : S.shelfX[1] - 60, y: S.shelf, s: S.shelfScale }, { tp: 'pose', pose: 'stand', hold: 0.4 });
        }
        const a = S.shelfX[0] + 120, b = S.shelfX[1] - 120;
        st.push({ tp: 'go', x: rand(lerp(a, b, 0.3), lerp(a, b, 0.7)) }, { tp: 'pose', pose: 'sit', hold: rand(10, 22), dur: 0.8 });
        if (Math.random() < 0.6) st.push({ tp: 'pose', pose: 'lie', hold: 4, dur: 1 }, { tp: 'pose', pose: 'sleep', hold: rand(25, 50), dur: 1.5 }, { tp: 'pose', pose: 'lie', hold: 2, dur: 1.2 });
        st.push({ tp: 'pose', pose: 'stand', hold: 0.3, dur: 0.7 }, { tp: 'pose', pose: 'bow', hold: 2.2, dur: 0.9 }, { tp: 'pose', pose: 'stand', hold: 0.3, dur: 0.7 });
        const left = Math.random() < 0.5;
        st.push({ tp: 'go', x: left ? S.shelfX[0] + 40 : S.shelfX[1] - 40 }, { tp: 'face', dir: left ? -1 : 1 }, { tp: 'pose', pose: 'crouch', hold: 0.6, dur: 0.4 },
          { tp: 'jump', x: left ? S.jumpL : S.jumpR, y: S.floor, s: S.floorScale }, { tp: 'pose', pose: 'stand', hold: 0.3 });
        at = left ? -1 : 1;
        break;
      }
      case 'bye': break;
    }
    st.push({ tp: 'go', x: off(at), fast: trick === 'bye' ? 1.5 : 1 }, { tp: 'leave' });
    this.steps = st; this.step = null;
    if (this.away) { this.away = false; this.up = false; this.y = S.floor; this.s = S.floorScale; }
    this.setPose('stand', 0.4);
  }

  // the next trick when the cat picks for itself: every trick once, in a shuffled order, then again
  next() {
    if (!this.bag || !this.bag.length) {
      const all = this.S.noShelf ? ['walk', 'stretch', 'sit', 'nap', 'zoom'] : ['walk', 'mantel', 'stretch', 'sit', 'nap', 'zoom'];
      this.bag = all.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);
      if (this.bag[this.bag.length - 1] === this.lastTrick && this.bag.length > 1) this.bag.reverse();
    }
    return (this.lastTrick = this.bag.pop());
  }

  setPose(name, dur = 0.5) { this.from = this.pose; this.to = POSES[name]; this.pt = 0; this.pd = dur; this.poseName = name; }

  // ---- per frame --------------------------------------------------------------
  update(dt) {
    const mode = this.opt.mode();
    if (this.away) {
      if (!mode || mode === 'off') return;
      this.wait -= dt;
      if (mode === 'loop' && this.wait > 4) this.wait = 2;
      if (this.wait <= 0) this.do(this.next());
      return;
    }
    this.clock += dt;
    this.pt = Math.min(1, this.pt + dt / this.pd);
    this.pose = blendPose(this.from, this.to, easeInOut(this.pt));
    let moving = false;
    if (!this.step) {
      this.step = this.steps.shift();
      const s = this.step;
      if (!s) { this.away = true; return; }
      s.t = 0;
      if (s.tp === 'enter') { this.x = s.x; this.step = null; }
      else if (s.tp === 'face') { this.dir = s.dir; this.step = null; }
      else if (s.tp === 'pose') this.setPose(s.pose, s.dur || 0.5);
      else if (s.tp === 'go') { this.dir = s.x >= this.x ? 1 : -1; if (this.poseName !== 'stand') this.setPose('stand', 0.3); }
      else if (s.tp === 'jump') {
        s.x0 = this.x; s.y0 = this.y; s.s0 = this.s;
        s.dur = 0.62 + Math.abs(s.y - this.y) / 1500;
        this.dir = s.x >= this.x ? 1 : -1;
        this.setPose('leap', 0.16); this.air = true;
      } else if (s.tp === 'leave') {
        this.away = true; this.step = null; this.steps = [];
        const w = WAIT[mode] || WAIT.sometimes;
        this.wait = rand(w[0], w[1]);
        return;
      }
    }
    const s = this.step;
    if (s) {
      s.t += dt;
      if (s.tp === 'go') {
        const v = 96 * this.s * (s.fast || 1) * dt;
        moving = true;
        this.fast = s.fast || 1;
        if (Math.abs(s.x - this.x) <= v) { this.x = s.x; this.step = null; } else this.x += this.dir * v;
      } else if (s.tp === 'pose') {
        this.wiggle = s.wiggle ? Math.sin(s.t * 26) * 3.5 : 0;
        this.look = s.look || 0;
        if (s.t >= (s.dur || 0.5) + s.hold) { this.step = null; this.wiggle = 0; this.look = 0; }
      } else if (s.tp === 'jump') {
        const u = Math.min(1, s.t / s.dur);
        const lift = 120 + Math.abs(s.y - s.y0) * 0.16;
        this.x = lerp(s.x0, s.x, u);
        const base = lerp(s.y0, s.y, u), arc = Math.sin(u * Math.PI) * lift;
        this.y = base - arc;
        this.s = lerp(s.s0, s.s, u);
        // lean along the path
        const vy = (s.y - s.y0) / s.dur - Math.cos(u * Math.PI) * Math.PI * lift / s.dur, vx = Math.abs(s.x - s.x0) / s.dur + 1;
        this.rot = clamp(Math.atan2(vy, vx * 1.6), -0.9, 0.9) * (1 - u * u);
        if (u > 0.82 && this.poseName === 'leap') this.setPose('crouch', 0.14);
        if (u >= 1) { this.y = s.y; this.s = s.s; this.rot = 0; this.air = false; this.up = s.y === this.S.shelf; this.step = null; this.setPose('stand', 0.35); if (this.pending) { const p = this.pending; this.pending = null; this.do(p); } }
      }
    }
    this.walk = clamp(this.walk + (moving ? dt : -dt) / 0.25, 0, 1);
    if (moving) this.ph += dt * (0.9 + 0.5 * (this.fast || 1));
  }

  draw(ctx, t, dt) {
    this.update(dt);
    if (this.away) return;
    const coat = COATS[this.opt.coat()] || COATS.black;
    const P = this.pose, w = this.walk, ph = this.ph * Math.PI * 2;
    ctx.save();
    // shadow on whatever is below
    if (!this.air) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(this.x, this.y + 3 * this.s, 118 * this.s, 9 * this.s, 0, 0, 7); ctx.fill();
    }
    ctx.translate(this.x, this.y);
    ctx.scale(this.s * this.dir, this.s);
    if (this.rot) { ctx.translate(0, -80); ctx.rotate(this.rot); ctx.translate(0, 80); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const bob = Math.sin(ph * 2) * 2.5 * w;
    const breathe = this.poseName === 'sleep' ? Math.sin(this.clock * 1.5) * 2 : 0;
    const sh = [P.sh[0] + (this.wiggle || 0) * 0.3, P.sh[1] + bob], hip = [P.hip[0] + (this.wiggle || 0), P.hip[1] + bob - breathe];
    const head = [P.head[0], P.head[1] + bob + (this.look || 0) * 22 + Math.sin(this.clock * 0.5) * 1.5];

    const foot = (base, joint, off) => {
      const a = ph + off * Math.PI * 2;
      return [lerp(base[0], joint[0] + Math.sin(a) * 36, w), lerp(base[1], -Math.max(0, Math.cos(a)) * 17, w)];
    };
    const leg = (joint, ft, front, wd, col) => {
      const k = ik(joint[0], joint[1], ft[0], ft[1], 49, 49, front ? -1 : 1);
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(joint[0], joint[1]); ctx.lineTo(k[0], k[1]); ctx.stroke();
      ctx.lineWidth = wd * 0.62; ctx.beginPath(); ctx.moveTo(k[0], k[1]); ctx.lineTo(ft[0], ft[1] - 4); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(ft[0] + 5, ft[1] - 5, 10, 5.5, 0, 0, 7); ctx.fill();
    };
    const paw = ft => { ctx.fillStyle = coat.white; ctx.beginPath(); ctx.ellipse(ft[0] + 5, ft[1] - 5, 10.5, 6, 0, 0, 7); ctx.fill(); };

    const body = col => {
      // far legs
      const fff = foot([P.ff[0] - 14, P.ff[1]], sh, 0.25), fhf = foot([P.hf[0] + 14, P.hf[1]], hip, 0.75);
      leg([sh[0] + 4, sh[1] + 6], fff, true, 19, coat.far);
      leg([hip[0] - 4, hip[1] + 6], fhf, false, 27, coat.far);
      // tail
      const B = [hip[0] - 30, hip[1] - 14], sw = Math.sin(this.clock * 1.7) * (0.12 + 0.1 * w);
      const key = k => (k === 'up'
        ? [[B[0] - 46, B[1] - 26], [B[0] - 66 + sw * 60, B[1] - 108], [B[0] - 34 + sw * 110, B[1] - 172]]
        : k === 'level'
          ? [[B[0] - 60, B[1] + 2], [B[0] - 118, B[1] + 22 + sw * 40], [B[0] - 168, B[1] - 12 + sw * 90]]
          : [[B[0] - 52, Math.min(-10, B[1] + 34)], [B[0] + 4, -7], [B[0] + 112 + sw * 30, -11 - Math.max(0, sw) * 40]]);
      const a = key(P.tail >= 0 ? 'level' : 'wrap'), b = key(P.tail >= 0 ? 'up' : 'level'), tt = P.tail >= 0 ? P.tail : 1 + P.tail;
      const c = a.map((p, i) => [lerp(p[0], b[i][0], tt), lerp(p[1], b[i][1], tt)]);
      ctx.strokeStyle = col; ctx.lineWidth = 13;
      ctx.beginPath(); ctx.moveTo(B[0], B[1]); ctx.bezierCurveTo(c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1]); ctx.stroke();
      // torso
      const mx = (sh[0] + hip[0]) / 2, my = (sh[1] + hip[1]) / 2 - P.arch * 1.6;
      ctx.lineWidth = 74; ctx.beginPath(); ctx.moveTo(hip[0], hip[1]); ctx.quadraticCurveTo(mx, my, sh[0], sh[1]); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(hip[0] - 4, hip[1] + 2, 44, 41, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sh[0] + 6, sh[1] + 2, 40, 39, 0, 0, 7); ctx.fill();
      if (coat.stripes) {
        ctx.strokeStyle = coat.stripes; ctx.lineWidth = 7;
        for (let i = 0; i < 5; i++) {
          const u = 0.12 + i * 0.19, px = lerp(hip[0], sh[0], u), py = lerp(hip[1], sh[1], u) - P.arch * 1.6 * (1 - Math.abs(u - 0.5) * 2) * 0.5;
          const nx = -(sh[1] - hip[1]), ny = sh[0] - hip[0], nl = Math.hypot(nx, ny) || 1;
          ctx.beginPath(); ctx.moveTo(px - nx / nl * 34, py - ny / nl * 34); ctx.lineTo(px - nx / nl * 12, py - ny / nl * 12); ctx.stroke();
        }
      }
      if (coat.white) { ctx.fillStyle = coat.white; ctx.beginPath(); ctx.ellipse(sh[0] + 24, sh[1] + 16, 20, 26, -0.3, 0, 7); ctx.fill(); }
      // near legs
      const nff = foot(P.ff, sh, 0.75), nhf = foot(P.hf, hip, 0.25);
      leg(hip, nhf, false, 29, col); leg(sh, nff, true, 21, col);
      if (coat.white) { paw(nff); paw(nhf); paw(fff); }
      // neck, head, ears
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = 46; ctx.beginPath(); ctx.moveTo(sh[0] + 12, sh[1] - 10); ctx.lineTo(head[0] - 8, head[1] + 10); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(head[0], head[1], 33, 29, 0.06, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(head[0] + 25, head[1] + 10, 14, 11, 0.2, 0, 7); ctx.fill();
      const ear = Math.sin(this.clock * 0.9) > 0.96 ? 4 : 0;
      ctx.beginPath(); ctx.moveTo(head[0] - 24, head[1] - 16); ctx.lineTo(head[0] - 18, head[1] - 56 + ear); ctx.lineTo(head[0], head[1] - 26); ctx.fill();
      ctx.beginPath(); ctx.moveTo(head[0] - 2, head[1] - 26); ctx.lineTo(head[0] + 16, head[1] - 54 + ear); ctx.lineTo(head[0] + 24, head[1] - 14); ctx.fill();
      if (coat.white) { ctx.fillStyle = coat.white; ctx.beginPath(); ctx.ellipse(head[0] + 28, head[1] + 12, 11, 8, 0.2, 0, 7); ctx.fill(); }
    };
    // warm rim from the fire, then the coat
    if (this.opt.rim) { ctx.save(); ctx.translate(0, -3); body(this.opt.rim); ctx.restore(); }
    body(coat.body);
    // eye
    const asleep = this.poseName === 'sleep' && this.pt > 0.5, blink = (this.clock % 5.3) < 0.13;
    ctx.strokeStyle = coat.body === '#ebe4d8' ? '#4a4038' : 'rgba(0,0,0,0.55)';
    if (asleep || blink) { ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(head[0] + 13, head[1] - 5, 6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    else {
      ctx.fillStyle = coat.eye; ctx.beginPath(); ctx.ellipse(head[0] + 13, head[1] - 4, 6, 6.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#120d0a'; ctx.beginPath(); ctx.ellipse(head[0] + 14, head[1] - 4, 2.2, 5.4, 0, 0, 7); ctx.fill();
    }
    // nose and whiskers
    ctx.fillStyle = '#c98a84'; ctx.beginPath(); ctx.ellipse(head[0] + 38, head[1] + 6, 3.2, 2.6, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(235,225,210,0.5)'; ctx.lineWidth = 1.2;
    for (const a of [-0.25, 0.05, 0.35]) { ctx.beginPath(); ctx.moveTo(head[0] + 30, head[1] + 12); ctx.lineTo(head[0] + 30 + Math.cos(a) * 34, head[1] + 12 + Math.sin(a) * 34); ctx.stroke(); }
    ctx.restore();
  }
}

// two-bone IK: returns the knee position; bend picks which side the knee goes
function ik(hx, hy, fx, fy, a, b, bend) {
  const dx = fx - hx, dy = fy - hy;
  const d = clamp(Math.hypot(dx, dy), Math.abs(a - b) + 0.01, a + b - 0.01);
  const ang = Math.atan2(dy, dx);
  const k = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const ka = ang + bend * k;
  return [hx + Math.cos(ka) * a, hy + Math.sin(ka) * a];
}
