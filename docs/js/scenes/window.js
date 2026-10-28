// The window scenes: Bird Window, Weather Window, Thanksgiving and Winter Night.
// One painter with options; the outside reflects the real time of day, season and weather.
import { W, H, canvas, rgb, hex, mix, shade, clamp, lerp, rand, seeded, sunFor, seasonFor, fbm1, noise1 } from '../util.js';
import { skyState, moonPhase, atmos } from '../sky.js';
import { conditionFor, weather } from '../weather.js';
import { makeBranch, paintBranch, paintTwig, paintTreeline, cloudSprite, grain, mixMul, pumpkin, candleBody, flame, drawLeaf, bareTree } from '../paint.js';
import { Birds } from '../birds.js';
import { Cat } from '../overlays/cat.js';

// Glass opening and trim, in design space
const G = { x: 150, y: 96, w: 1620, h: 700 };
const JAMB = 22, CASING = 54;
const SILL_Y = G.y + G.h + JAMB;           // back edge of the sill's top face (818)
const SILL_FRONT = SILL_Y + 30;             // front edge (848)

const SEASON_TREES = {
  spring: ['#56683f', '#8fae5a', '#a9c46c', '#e7c3cf', '#7c9b4b'],
  summer: ['#334a2c', '#4f6e3a', '#5d7d42', '#41603a', '#6d8a49'],
  autumn: ['#5a4632', '#b8642e', '#cf8f2f', '#9a3f24', '#7d7a3a', '#d9a441'],
  lateautumn: ['#4e4237', '#9c5a2e', '#b07a3a', '#7d4a2e', '#6c5d45'],
  winter: ['#4a4441', '#5e5654', '#6a625e']
};
const GROUND = { spring: '#6f8f45', summer: '#5c7a3c', autumn: '#7d7444', lateautumn: '#6f6243', winter: '#7a7468' };

export class WindowScene {
  constructor(app, preset) {
    this.app = app;
    this.p = preset;               // id, options
    this.parts = [];               // precipitation particles
    this.leaves = [];
    this.trickles = [];
    this.layers = {};
    this.stamp = '';
    this.t = 0;
  }

  get o() { return this.p.opts; }

  async enter() {
    this.cat = new Cat({ ground: SILL_Y + 16, x0: 40, x1: W - 40, scale: 1, mode: () => this.o.cat, lit: () => this.sky });
    if (this.o.birds !== false && this.p.branch) {
      this.birds = new Birds(this.app, this);
      this.birds.start();
    }
    this.rebuild(true);
  }

  exit() {
    this.birds && this.birds.stop();
    this.birds = null;
  }

  update() {
    // options changed
    if (this.o.birds !== false && this.p.branch && !this.birds) { this.birds = new Birds(this.app, this); this.birds.start(); }
    if (this.o.birds === false && this.birds) { this.birds.stop(); this.birds = null; }
    this.rebuild(true);
  }

  // ---- state ------------------------------------------------------------
  conditions() {
    const cond = conditionFor(this.o.weather || 'live');
    const sun = sunFor(this.o.time || 'live');
    const season = this.o.season && this.o.season !== 'auto' ? this.o.season : seasonFor();
    const sky = skyState(sun.el, cond);
    // winter scene: snow on the ground unless it's warm out
    const snowGround = season === 'winter' && (this.p.decor === 'winter' || cond.kind.includes('snow') || (cond.temp ?? 50) < 34);
    return { cond, sun, season, sky, snowGround };
  }

  rebuild(force) {
    const c = this.conditions();
    // repaint static layers when light changes enough
    const key = [c.season, c.cond.kind, Math.round(c.sky.day * 40), Math.round(c.sky.cloud * 10), c.snowGround, this.o.weather, this.o.time, this.p.decor].join('|');
    this.c = c; this.sky = c.sky;
    if (!force && key === this.stamp) return;
    this.stamp = key;
    this.paintOutside();
    this.paintBranches();
    this.paintGlass();
    this.paintFrame();
    this.makeClouds();
    this.makeParticles();
  }

  // ---- outside ----------------------------------------------------------
  paintOutside() {
    const { sky, season, snowGround, sun } = this.c;
    const cv = this.layers.out || (this.layers.out = canvas(W, H));
    const x = cv.getContext('2d');
    x.clearRect(0, 0, W, H);
    const horizon = this.p.view === 'field' ? 610 : 600;
    const g = x.createLinearGradient(0, G.y, 0, horizon + 60);
    g.addColorStop(0, rgb(sky.zen)); g.addColorStop(1, rgb(sky.hor));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // stars
    if (sky.stars > 0.02) {
      const r = seeded(91);
      for (let i = 0; i < 260; i++) {
        const sx = r() * W, sy = G.y + r() * (horizon - G.y) * 0.9, b = r();
        x.globalAlpha = sky.stars * (0.25 + b * 0.75) * (1 - sy / horizon * 0.6);
        x.fillStyle = '#f4f1e8';
        x.fillRect(sx, sy, b > 0.92 ? 2.2 : 1.3, b > 0.92 ? 2.2 : 1.3);
      }
      x.globalAlpha = 1;
    }
    // moon or sun
    if (sun.el < -4 && sky.cloud < 0.85) this.paintMoon(x, 420, 230, 34, sky);
    if (sky.sunVisible) {
      const sx = sun.rising ? 1350 : 560, sy = lerp(horizon - 20, G.y + 60, clamp(sun.el / 30, 0, 1));
      const gl = x.createRadialGradient(sx, sy, 10, sx, sy, 420);
      const warm = sun.el < 10 ? [255, 190, 120] : [255, 240, 210];
      gl.addColorStop(0, rgb(warm, 0.55 * (1 - sky.cloud))); gl.addColorStop(1, rgb(warm, 0));
      x.fillStyle = gl; x.fillRect(0, 0, W, H);
      x.fillStyle = rgb(mix(warm, [255, 255, 245], 0.6), 0.9 * (1 - sky.cloud));
      x.beginPath(); x.arc(sx, sy, 30, 0, 7); x.fill();
    }
    const lit = mix([70, 75, 95], sky.tint, 0.15 + 0.85 * sky.light);
    const haze = d => c => atmos(mixMul(c, lit), sky, d);
    const cols = (SEASON_TREES[season] || SEASON_TREES.autumn).map(hex);
    const bare = season === 'winter' ? 0.85 : season === 'lateautumn' ? 0.45 : 0;
    if (this.p.view === 'field') {
      // Sugarloaf Mountain on the horizon, then rolling farm hills
      x.fillStyle = rgb(haze(0.86)(hex('#4c5c68')));
      x.beginPath(); x.moveTo(150, horizon - 10);
      const pts = [[300, horizon - 40], [470, horizon - 92], [600, horizon - 142], [665, horizon - 168], [735, horizon - 172], [790, horizon - 150], [900, horizon - 108], [1080, horizon - 62], [1300, horizon - 28], [1500, horizon - 14]];
      for (const [px, py] of pts) x.lineTo(px, py);
      x.lineTo(1500, horizon + 40); x.lineTo(150, horizon + 40); x.closePath(); x.fill();
      x.fillStyle = rgb(haze(0.7)(hex('#6b7a52')));
      x.beginPath(); x.moveTo(0, H);
      for (let px = 0; px <= W; px += 16) x.lineTo(px, horizon - 6 + Math.sin(px * 0.004 + 1) * 18 + fbm1(px * 0.01) * 14);
      x.lineTo(W, H); x.closePath(); x.fill();
    }
    // far ridge, middle treeline, near treeline
    paintTreeline(x, { y0: horizon - 40, amp: 70, colors: cols, seed: 4, blob: 13, haze: haze(0.72), bare, snow: snowGround, everg: 0.12, light: sky.light });
    paintTreeline(x, { y0: horizon + 10, amp: 90, colors: cols, seed: 9, blob: 21, haze: haze(0.42), bare, snow: snowGround, everg: 0.18, light: sky.light });
    // ground
    const gcol = snowGround ? [232, 236, 242] : hex(GROUND[season] || GROUND.autumn);
    const gg = x.createLinearGradient(0, horizon + 30, 0, G.y + G.h);
    gg.addColorStop(0, rgb(haze(0.35)(gcol))); gg.addColorStop(1, rgb(haze(0.05)(shade(gcol, -0.12))));
    x.fillStyle = gg;
    x.beginPath(); x.moveTo(0, H);
    for (let px = 0; px <= W; px += 20) x.lineTo(px, horizon + 46 + fbm1(px * 0.003 + 5) * 26);
    x.lineTo(W, H); x.closePath(); x.fill();
    // grass texture and, in autumn, fallen leaves
    {
      const r = seeded(17);
      for (let i = 0; i < 2600; i++) {
        const gx = r() * W, gy = horizon + 60 + Math.pow(r(), 0.7) * (G.y + G.h - horizon - 60);
        const near = (gy - horizon) / (G.y + G.h - horizon);
        const c = snowGround ? shade(gcol, (r() - 0.5) * 0.08) : shade(gcol, (r() - 0.55) * 0.35);
        x.strokeStyle = rgb(haze(0.3 - near * 0.25)(c)); x.lineWidth = 0.8 + near * 1.6;
        x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + (r() - 0.5) * 4, gy - (3 + near * 10) * (snowGround ? 0.3 : 1)); x.stroke();
        if (!snowGround && (season === 'autumn' || season === 'lateautumn') && r() < 0.18) {
          x.fillStyle = rgb(haze(0.25 - near * 0.2)(hex(['#b8642e', '#cf8f2f', '#9a3f24', '#8b6a2c'][i % 4])));
          x.beginPath(); x.ellipse(gx, gy, 2 + near * 5, 1 + near * 2.5, r() * 3, 0, 7); x.fill();
        }
      }
    }
    if (this.p.view === 'field') {
      // a lone tree in the field and a fence line
      const r = seeded(5);
      x.strokeStyle = rgb(haze(0.2)(hex('#4b3f36')));
      if (season === 'winter' || season === 'lateautumn') bareTree(x, 1180, horizon + 120, 330, r, 3.4);
      else {
        x.lineWidth = 9; x.beginPath(); x.moveTo(1180, horizon + 120); x.lineTo(1184, horizon - 40); x.stroke();
        paintTreeline(x, { y0: horizon - 70, amp: 0, x0: 1110, x1: 1260, colors: cols, seed: 12, blob: 52, haze: haze(0.22), everg: 0, light: sky.light, base: false });
      }
      x.strokeStyle = rgb(haze(0.1)(hex('#5a4a3c'))); x.lineWidth = 4;
      for (let i = 0; i < 14; i++) { const fx = 120 + i * 130, fy = horizon + 170 + i * 4; x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx, fy + 46); x.stroke(); }
      x.lineWidth = 2.5; x.beginPath(); x.moveTo(100, horizon + 184); x.lineTo(1960, horizon + 238); x.stroke();
      x.beginPath(); x.moveTo(100, horizon + 204); x.lineTo(1960, horizon + 258); x.stroke();
    } else {
      // near shrubs along the bottom of the view
      paintTreeline(x, { y0: G.y + G.h - 16, amp: 46, colors: cols.map(c => shade(c, -0.2)), seed: 21, blob: 30, haze: haze(0.04), bare: bare * 0.7, snow: snowGround, everg: 0.1, light: sky.light });
    }
    if (sky.foggy) { x.fillStyle = rgb(sky.hor, 0.35); x.fillRect(0, 0, W, H); }
  }

  paintMoon(x, mx, my, r, sky) {
    const ph = moonPhase();
    const glow = x.createRadialGradient(mx, my, r, mx, my, r * 5);
    glow.addColorStop(0, 'rgba(230,230,210,0.22)'); glow.addColorStop(1, 'rgba(230,230,210,0)');
    x.fillStyle = glow; x.fillRect(mx - r * 5, my - r * 5, r * 10, r * 10);
    const m = canvas(r * 2 + 4, r * 2 + 4), mc = m.getContext('2d');
    mc.translate(r + 2, r + 2);
    mc.fillStyle = '#efeadb'; mc.beginPath(); mc.arc(0, 0, r, 0, 7); mc.fill();
    // terminator: lit fraction from phase
    const k = Math.cos(ph * 2 * Math.PI);         // 1 new .. -1 full
    mc.globalCompositeOperation = 'destination-out';
    mc.beginPath();
    const waxing = ph < 0.5;
    mc.arc(0, 0, r + 1, -Math.PI / 2, Math.PI / 2, !waxing);
    mc.ellipse(0, 0, Math.abs(k) * r, r + 1, 0, Math.PI / 2, -Math.PI / 2, k > 0 ? !waxing : waxing);
    mc.fill();
    x.globalAlpha = 0.95 * (1 - sky.cloud * 0.8);
    x.drawImage(m, mx - r - 2, my - r - 2);
    x.globalAlpha = 1;
  }

  makeClouds() {
    const { sky } = this.c;
    const n = Math.round(2 + sky.cloud * 7);
    const col = mix(mix(sky.hor, [255, 255, 255], 0.35 * sky.day), sky.zen, 0.15 + sky.grey * 0.3);
    this.clouds = [];
    for (let i = 0; i < n; i++) {
      const w = rand(380, 820), h = w * rand(0.28, 0.4);
      this.clouds.push({ img: cloudSprite(w | 0, h | 0, mix(col, [255, 255, 255], rand(0, 0.15) * sky.day), i * 7 + 3), x: rand(-200, W), y: rand(G.y - 60, 460 - h * 0.3), v: rand(4, 10) * (0.5 + (this.c.cond.wind || 5) / 10), a: 0.55 + sky.cloud * 0.4 });
    }
  }

  makeParticles() {
    const k = this.c.cond.kind;
    this.parts = [];
    const rain = /rain|drizzle|storm/.test(k) ? (k === 'heavyrain' || k === 'storm' ? 1 : k === 'drizzle' ? 0.35 : 0.65) : 0;
    const snow = /snow/.test(k) ? (k === 'heavysnow' ? 1 : 0.6) : 0;
    this.rain = rain; this.snow = snow;
    const n = Math.round(rain * 420 + snow * 320);
    for (let i = 0; i < n; i++) this.parts.push({ x: rand(0, W), y: rand(0, H), z: Math.pow(Math.random(), 1.6), ph: rand(0, 7) });
    const wantLeaves = this.o.leaves === true || (this.o.leaves !== false && this.p.decor === 'autumn');
    this.leaves = [];
    if (wantLeaves) {
      const pal = ['#c4622d', '#d9932c', '#a8432a', '#b98a3a', '#8e5a2b'].map(hex);
      for (let i = 0; i < 16; i++) this.leaves.push({ x: rand(0, W), y: rand(-H, H), z: rand(0.3, 1), r: rand(0, 7), vr: rand(-2, 2), c: pal[i % pal.length], ph: rand(0, 7) });
    }
  }

  // ---- branch -------------------------------------------------------------
  paintBranches() {
    if (!this.p.branch) { this.limb = this.sub = null; return; }
    const { sky, season, snowGround } = this.c;
    // trunk on the right, main limb across the lower sash, a side branch rising up-left
    this.trunk = makeBranch([[1640, G.y + G.h + 60], [1628, 520], [1612, 260], [1606, G.y - 60]], 150, 118);
    this.limb = makeBranch([[1600, 640], [1330, 606], [1060, 628], [800, 650], [540, 610], [300, 570], [90, 590]], 66, 18);
    this.sub = makeBranch([[1010, 632], [880, 520], [760, 380], [650, 250], [585, 110]], 32, 9);
    this.twigArm = makeBranch([[1560, 470], [1420, 420], [1280, 360], [1170, 330]], 22, 7);
    const lightC = mix([60, 64, 80], sky.tint, 0.2 + 0.8 * sky.light);
    const snow = snowGround || this.c.cond.kind.includes('snow') ? 1 : 0;
    const back = this.layers.back || (this.layers.back = canvas(W, H));
    const front = this.layers.front || (this.layers.front = canvas(W, H));
    const bx = back.getContext('2d'), fx = front.getContext('2d');
    bx.clearRect(0, 0, W, H); fx.clearRect(0, 0, W, H);
    paintBranch(bx, this.trunk, { base: '#5d5048', light: sky.light, tint: sky.tint, seed: 11, snow: snow * 0.3, moss: 0.6 });
    paintBranch(bx, this.twigArm, { base: '#5f5047', light: sky.light, tint: sky.tint, seed: 5, snow });
    // small twigs (no birds use these)
    const r = seeded(33);
    const twigCol = mixMul(hex('#5c4d42'), lightC);
    const leaf = seasonLeaves(season, lightC);
    for (const [br, n] of [[this.limb, 9], [this.sub, 5], [this.twigArm, 3]]) {
      for (let i = 0; i < n; i++) {
        const p = br.at(0.15 + r() * 0.8);
        const side = r() < 0.6 ? -1 : 1;
        const ang = Math.atan2(p.ty, p.tx) + side * (0.6 + r() * 0.6);
        paintTwig(bx, p.x, p.y, ang, 60 + r() * 110, Math.max(2, p.w * 0.22), twigCol, r, leaf);
      }
    }
    paintBranch(fx, this.limb, { base: '#58493f', light: sky.light, tint: sky.tint, seed: 3, snow, moss: season === 'winter' ? 0.4 : 0.2 });
    paintBranch(fx, this.sub, { base: '#5a4b40', light: sky.light, tint: sky.tint, seed: 8, snow });
  }

  // ---- glass ----------------------------------------------------------------
  paintGlass() {
    const { sky, cond } = this.c;
    const cv = this.layers.glass || (this.layers.glass = canvas(W, H));
    const x = cv.getContext('2d');
    x.clearRect(0, 0, W, H);
    // faint reflection sheen
    const g = x.createLinearGradient(G.x, G.y, G.x + G.w, G.y + G.h);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.035)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(G.x, G.y, G.w, G.h);
    if (sky.lamp > 0.4) {
      // room reflected in the glass at night
      const rg = x.createRadialGradient(W / 2, G.y + G.h + 40, 40, W / 2, G.y + G.h, 700);
      rg.addColorStop(0, `rgba(255,190,120,${0.10 * sky.lamp})`); rg.addColorStop(1, 'rgba(255,190,120,0)');
      x.fillStyle = rg; x.fillRect(G.x, G.y, G.w, G.h);
    }
    // frost in pane corners
    const frost = this.o.frost === true || (this.o.frost !== false && (this.p.decor === 'winter' || (cond.temp ?? 50) < 30));
    if (frost) for (const pane of this.panes()) frostCorner(x, pane, sky);
    // raindrops resting on the glass
    if (this.rain > 0 || /rain|drizzle|storm/.test(cond.kind)) {
      const r = seeded(4);
      const n = /heavy|storm/.test(cond.kind) ? 900 : 520;
      for (let i = 0; i < n; i++) drop(x, G.x + r() * G.w, G.y + r() * G.h, 1.5 + Math.pow(r(), 3) * 7, sky);
      this.trickles = Array.from({ length: 9 }, () => ({ x: rand(G.x, G.x + G.w), y: rand(G.y, G.y + G.h), v: 0, wait: rand(0, 6), r: rand(3, 5.5) }));
    } else this.trickles = [];
  }

  panes() {
    if (this.p.view === 'field') return [{ x: G.x, y: G.y, w: G.w, h: G.h }];
    const midY = G.y + G.h / 2, midX = G.x + G.w / 2;
    return [
      { x: G.x, y: G.y, w: G.w / 2, h: G.h / 2 }, { x: midX, y: G.y, w: G.w / 2, h: G.h / 2 },
      { x: G.x, y: midY, w: G.w / 2, h: G.h / 2 }, { x: midX, y: midY, w: G.w / 2, h: G.h / 2 }
    ];
  }

  // ---- frame, wall, sill and decor ------------------------------------------------
  paintFrame() {
    const { sky } = this.c;
    const cv = this.layers.frame || (this.layers.frame = canvas(W, H));
    const x = cv.getContext('2d');
    x.clearRect(0, 0, W, H);
    // light falling on the room: daylight through the window, warm lamps at night
    const day = mix([90, 95, 110], sky.tint, 0.4 + 0.6 * sky.light);
    const lamp = [255, 196, 140];
    const L = mix(mix(day, [255, 255, 255], 0), lamp, sky.lamp * 0.75);
    const amb = lerp(0.42, 0.78, sky.light) * (1 - sky.lamp * 0.25) + sky.lamp * 0.42;
    const lit = c => mixMul(c, L).map(v => v * amb + 6);
    const wall = hex(this.p.wall || '#8e8b78');
    const paint = hex(this.p.trim || '#e6dfd0');
    // wall
    x.fillStyle = rgb(lit(wall)); x.fillRect(0, 0, W, H);
    // light spill from the window onto the wall by day, lamp pool by night
    const spill = x.createRadialGradient(W / 2, G.y + G.h / 2, 300, W / 2, G.y + G.h / 2, 1150);
    spill.addColorStop(0, rgb(shade(lit(wall), 0.12), sky.light * 0.8)); spill.addColorStop(1, rgb(lit(wall), 0));
    x.fillStyle = spill; x.fillRect(0, 0, W, H);
    if (sky.lamp > 0.2) {
      const pool = x.createRadialGradient(W * 0.08, H * 0.9, 50, W * 0.08, H * 0.9, 900);
      pool.addColorStop(0, `rgba(255,180,110,${0.22 * sky.lamp})`); pool.addColorStop(1, 'rgba(255,180,110,0)');
      x.fillStyle = pool; x.fillRect(0, 0, W, H);
    }
    // casing
    const cOut = { x: G.x - JAMB - CASING, y: G.y - JAMB - CASING, w: G.w + 2 * (JAMB + CASING), h: G.h + JAMB + CASING + JAMB };
    const pc = lit(paint);
    // shadow the casing throws on the wall
    x.fillStyle = 'rgba(0,0,0,0.22)';
    x.filter = 'blur(14px)'; x.fillRect(cOut.x + 8, cOut.y + 12, cOut.w, cOut.h + 20); x.filter = 'none';
    x.fillStyle = rgb(pc); x.fillRect(cOut.x, cOut.y, cOut.w, cOut.h);
    // moulding profile: outer bead, flat, inner step
    bevel(x, cOut.x, cOut.y, cOut.w, cOut.h, 10, pc, 0.18, -0.3);
    bevel(x, cOut.x + 16, cOut.y + 16, cOut.w - 32, cOut.h - 16, 6, pc, 0.1, -0.2);
    // jamb (the window's depth), shaded toward the glass
    const jx = G.x - JAMB, jy = G.y - JAMB, jw = G.w + 2 * JAMB, jh = G.h + 2 * JAMB;
    x.fillStyle = rgb(shade(pc, -0.18)); x.fillRect(jx, jy, jw, jh);
    const jg = x.createLinearGradient(0, jy, 0, jy + JAMB);
    jg.addColorStop(0, rgb(shade(pc, -0.35))); jg.addColorStop(1, rgb(shade(pc, -0.12)));
    x.fillStyle = jg; x.fillRect(jx, jy, jw, JAMB);
    // cut the glass hole
    x.clearRect(G.x, G.y, G.w, G.h);
    // sashes
    const bar = (bx, by, bw, bh) => { x.fillStyle = rgb(shade(pc, -0.04)); x.fillRect(bx, by, bw, bh); bevel(x, bx, by, bw, bh, 3, pc, 0.14, -0.25); };
    const S = 20;
    bar(G.x, G.y, G.w, S); bar(G.x, G.y + G.h - S, G.w, S); bar(G.x, G.y, S, G.h); bar(G.x + G.w - S, G.y, S, G.h);
    if (this.p.view !== 'field') {
      bar(G.x, G.y + G.h / 2 - 16, G.w, 32);            // meeting rail
      bar(G.x + G.w / 2 - 9, G.y, 18, G.h);             // centre muntin
      // sash lock on the meeting rail
      x.fillStyle = rgb(mixMul(hex('#b08d57'), L)); x.fillRect(W / 2 - 34, G.y + G.h / 2 - 22, 68, 10);
    }
    // sill (stool): top face, front edge, apron, shadow
    const sx0 = cOut.x - 30, sx1 = cOut.x + cOut.w + 30;
    const top = x.createLinearGradient(0, SILL_Y, 0, SILL_FRONT);
    top.addColorStop(0, rgb(shade(pc, 0.06 + 0.1 * sky.light))); top.addColorStop(1, rgb(shade(pc, -0.02)));
    x.fillStyle = top;
    x.beginPath(); x.moveTo(jx, SILL_Y); x.lineTo(jx + jw, SILL_Y); x.lineTo(sx1, SILL_FRONT); x.lineTo(sx0, SILL_FRONT); x.closePath(); x.fill();
    x.fillStyle = rgb(shade(pc, -0.2)); x.fillRect(sx0, SILL_FRONT, sx1 - sx0, 26);
    x.fillStyle = 'rgba(0,0,0,0.28)'; x.filter = 'blur(10px)'; x.fillRect(sx0 + 20, SILL_FRONT + 26, sx1 - sx0 - 40, 26); x.filter = 'none';
    x.fillStyle = rgb(shade(pc, -0.08)); x.fillRect(cOut.x + 20, SILL_FRONT + 26, cOut.w - 40, 34);
    bevel(x, cOut.x + 20, SILL_FRONT + 26, cOut.w - 40, 34, 4, pc, 0.1, -0.3);
    // painted texture over everything solid (masked so the glass stays clear)
    const gt = canvas(W, H), gx = gt.getContext('2d');
    gx.fillStyle = gx.createPattern(grain(), 'repeat'); gx.fillRect(0, 0, W, H);
    gx.globalCompositeOperation = 'destination-in'; gx.drawImage(cv, 0, 0);
    x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.16;
    x.drawImage(gt, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    // room vignette
    const v = x.createRadialGradient(W / 2, H * 0.45, H * 0.55, W / 2, H * 0.5, H * 1.05);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(10,6,4,${0.35 + sky.lamp * 0.2})`);
    x.save(); x.beginPath(); x.rect(0, 0, W, H); x.rect(G.x, G.y, G.w, G.h); x.clip('evenodd');
    x.fillStyle = v; x.fillRect(0, 0, W, H); x.restore();
    this.paintDecor(x, L);
  }

  paintDecor(x, L) {
    const d = this.p.decor;
    this.candles = [];
    this.bulbs = [];
    const y = SILL_Y + 18;
    if (d === 'autumn') {
      pumpkin(x, 300, y + 4, 62, '#c86a28', L);
      pumpkin(x, 395, y + 6, 40, '#d7a24a', L, '#4d5a2a', 0.8);
      pumpkin(x, 1580, y + 6, 46, '#e6dcc4', L, '#5b5a33', 0.7);
      pumpkin(x, 1660, y + 4, 34, '#b55a26', L);
      // a few fallen leaves on the sill
      const r = seeded(8);
      for (let i = 0; i < 7; i++) drawLeaf(x, 480 + r() * 1000, y - 2 + r() * 10, r() * 6, 22 + r() * 10, mixMul(hex(['#b8642e', '#cf8f2f', '#9a3f24'][i % 3]), L));
      candleBody(x, 520, y + 8, 46, 90, L, '#efe4cc'); this.candles.push([520, y + 8 - 90, 12]);
      candleBody(x, 1480, y + 8, 40, 62, L, '#e9dcc0'); this.candles.push([1480, y + 8 - 62, 11]);
    } else if (d === 'winter') {
      // evergreen sprigs, pine cones, candles in jars
      const r = seeded(14);
      for (let i = 0; i < 2; i++) {
        const cx = i ? 1560 : 360;
        for (let k = 0; k < 24; k++) {
          const a = Math.PI + (r() - 0.5) * 0.9 + (k % 2 ? 0.2 : -0.2), len = 60 + r() * 70;
          x.strokeStyle = rgb(mixMul(hex(r() < 0.5 ? '#2e4a33' : '#3d5c3e'), L)); x.lineWidth = 2;
          const ex = cx + Math.cos(a) * len * (k % 2 ? -1 : 1), ey = y - 4 + Math.sin(a) * 12;
          x.beginPath(); x.moveTo(cx, y); x.lineTo(ex, ey); x.stroke();
          for (let n = 0; n < 10; n++) { const t = n / 10, px = lerp(cx, ex, t), py = lerp(y, ey, t); x.beginPath(); x.moveTo(px, py); x.lineTo(px + 7, py - 6); x.moveTo(px, py); x.lineTo(px + 7, py + 4); x.stroke(); }
        }
        x.fillStyle = rgb(mixMul(hex('#6b4a2e'), L));
        x.beginPath(); x.ellipse(cx + 30, y - 6, 18, 12, 0.3, 0, 7); x.fill();
      }
      candleBody(x, 600, y + 8, 50, 70, L, '#f1e8d8', true); this.candles.push([600, y + 8 - 70, 9]);
      candleBody(x, 1330, y + 8, 44, 100, L, '#f1e8d8', true); this.candles.push([1330, y + 8 - 100, 9]);
      candleBody(x, 1400, y + 8, 36, 58, L, '#f1e8d8', true); this.candles.push([1400, y + 8 - 58, 7]);
    }
    const lights = this.o.lights === true || (this.o.lights !== false && d === 'winter');
    if (lights) {
      // string lights draped across the head casing and down the sides
      const hooks = [[G.x - 60, G.y - 50], [G.x + 330, G.y - 46], [G.x + 700, G.y - 50], [W / 2, G.y - 46], [G.x + G.w - 700, G.y - 50], [G.x + G.w - 330, G.y - 46], [G.x + G.w + 60, G.y - 50]];
      x.strokeStyle = 'rgba(30,34,26,0.85)'; x.lineWidth = 2.5;
      for (let i = 0; i < hooks.length - 1; i++) {
        const [ax, ay] = hooks[i], [bx, by] = hooks[i + 1];
        x.beginPath(); x.moveTo(ax, ay); x.quadraticCurveTo((ax + bx) / 2, ay + 60, bx, by); x.stroke();
        for (let k = 1; k < 7; k++) {
          const t = k / 7, qx = lerp(lerp(ax, (ax + bx) / 2, t), lerp((ax + bx) / 2, bx, t), t), qy = lerp(lerp(ay, ay + 60, t), lerp(ay + 60, by, t), t);
          this.bulbs.push({ x: qx, y: qy + 9, ph: rand(0, 7), sp: rand(0.3, 0.9) });
        }
      }
      for (const side of [G.x - 52, G.x + G.w + 52]) {
        x.beginPath(); x.moveTo(side, G.y - 50);
        for (let yy = G.y - 50; yy < SILL_Y - 20; yy += 60) x.quadraticCurveTo(side + (yy % 120 ? 10 : -10), yy + 30, side, yy + 60);
        x.stroke();
        for (let yy = G.y + 20; yy < SILL_Y - 30; yy += 68) this.bulbs.push({ x: side + 2, y: yy, ph: rand(0, 7), sp: rand(0.3, 0.9) });
      }
      // sockets
      x.fillStyle = 'rgba(25,30,22,0.9)';
      for (const b of this.bulbs) x.fillRect(b.x - 3, b.y - 10, 6, 7);
    }
  }

  // ---- per frame --------------------------------------------------------------------
  draw(ctx, t, dt) {
    this.t = t;
    if ((this._chk = (this._chk || 0) + dt) > 30) { this._chk = 0; this.rebuild(false); }
    const sky = this.sky;
    ctx.drawImage(this.layers.out, 0, 0);
    // clouds drift across
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > W + 50) c.x = -c.img.width - 50;
      ctx.globalAlpha = c.a; ctx.drawImage(c.img, c.x, c.y); ctx.globalAlpha = 1;
    }
    this.birds && this.birds.drawDistant(ctx, t, dt);
    // lightning
    if (this.c.cond.kind === 'storm') {
      if (!this.flash && Math.random() < dt / 14) this.flash = 0.35;
      if (this.flash) { ctx.fillStyle = `rgba(230,235,255,${this.flash})`; ctx.fillRect(G.x, G.y, G.w, G.h); this.flash = Math.max(0, this.flash - dt * 1.6); }
    }
    this.drawPrecip(ctx, dt, 0, 0.55);
    if (this.p.branch) {
      // gentle sway around the trunk, stronger in wind
      const wind = clamp((this.c.cond.wind || 4) / 25, 0.1, 1);
      const sw = (Math.sin(t * 0.55) * 0.6 + Math.sin(t * 1.37 + 1) * 0.3 + fbm1(t * 0.3) * 0.6 - 0.3) * 0.0045 * (0.4 + wind);
      this.sway = sw;
      ctx.save();
      ctx.translate(1600, 640); ctx.rotate(sw); ctx.translate(-1600, -640);
      ctx.drawImage(this.layers.back, 0, 0);
      this.birds && this.birds.drawPerched(ctx, t, dt, 'twig');
      ctx.drawImage(this.layers.front, 0, 0);
      this.birds && this.birds.drawPerched(ctx, t, dt, 'trunk');
      ctx.restore();
    }
    this.birds && this.birds.drawFlying(ctx, t, dt);
    this.drawLeaves(ctx, dt);
    this.drawPrecip(ctx, dt, 0.55, 1.01);
    ctx.drawImage(this.layers.glass, 0, 0);
    this.drawTrickles(ctx, dt);
    ctx.drawImage(this.layers.frame, 0, 0);
    for (const [cx, cy, s] of this.candles || []) flame(ctx, cx, cy, s, t, cx);
    this.drawBulbs(ctx, t);
    this.cat.draw(ctx, t, dt);
  }

  drawPrecip(ctx, dt, z0, z1) {
    if (!this.parts.length) return;
    const sky = this.sky, wind = (this.c.cond.wind || 5) / 10;
    if (this.rain) {
      ctx.strokeStyle = rgb(mix([150, 160, 180], [215, 222, 235], sky.light)); ctx.lineCap = 'round';
      for (const p of this.parts) {
        if (p.z < z0 || p.z >= z1) continue;
        const sp = 900 + 1300 * p.z, len = 14 + 34 * p.z;
        p.y += sp * dt; p.x += wind * 60 * dt * (0.5 + p.z);
        if (p.y > G.y + G.h) { p.y = rand(-200, G.y); p.x = rand(-100, W); }
        ctx.globalAlpha = (0.1 + 0.32 * p.z) * this.rain;
        ctx.lineWidth = 0.8 + p.z * 1.4;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - wind * 4, p.y - len); ctx.stroke();
      }
    } else if (this.snow) {
      ctx.fillStyle = rgb(mix([175, 182, 200], [250, 250, 252], sky.light * 0.8 + 0.2));
      for (const p of this.parts) {
        if (p.z < z0 || p.z >= z1) continue;
        const sp = 35 + 95 * p.z;
        p.y += sp * dt; p.ph += dt * (0.6 + p.z);
        p.x += (Math.sin(p.ph) * 18 + wind * 30) * dt * (0.4 + p.z);
        if (p.y > G.y + G.h + 10) { p.y = rand(-40, G.y); p.x = rand(-50, W + 50); }
        ctx.globalAlpha = (0.35 + 0.6 * p.z) * this.snow;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1 + p.z * 3.6, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawLeaves(ctx, dt) {
    const lit = mix([70, 70, 90], this.sky.tint, 0.2 + 0.8 * this.sky.light);
    const wind = (this.c.cond.wind || 5) / 10;
    for (const l of this.leaves) {
      l.ph += dt; l.r += l.vr * dt;
      l.y += (40 + 50 * l.z) * dt;
      l.x += (Math.sin(l.ph * 0.9) * 50 + 25 * wind) * dt;
      if (l.y > G.y + G.h + 30) { l.y = rand(G.y - 300, G.y - 40); l.x = rand(G.x - 100, G.x + G.w); }
      ctx.save(); ctx.translate(l.x, l.y); ctx.scale(Math.cos(l.ph * 1.7), 1);
      drawLeaf(ctx, 0, 0, l.r, 12 + l.z * 16, mixMul(l.c, lit));
      ctx.restore();
    }
  }

  drawTrickles(ctx, dt) {
    for (const d of this.trickles) {
      if (d.wait > 0) { d.wait -= dt; continue; }
      d.v = Math.min(140, d.v + dt * 60 * Math.random());
      d.y += d.v * dt * (Math.random() < 0.1 ? 0 : 1);
      drop(ctx, d.x, d.y, d.r, this.sky);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = d.r * 0.8;
      ctx.beginPath(); ctx.moveTo(d.x, d.y - 4); ctx.lineTo(d.x, d.y - 60); ctx.stroke();
      if (d.y > G.y + G.h) { d.y = rand(G.y, G.y + G.h * 0.6); d.x = rand(G.x, G.x + G.w); d.v = 0; d.wait = rand(2, 10); }
    }
  }

  drawBulbs(ctx, t) {
    if (!this.bulbs || !this.bulbs.length) return;
    if (!this.glow) {
      this.glow = canvas(80, 80);
      const g = this.glow.getContext('2d'), rg = g.createRadialGradient(40, 40, 2, 40, 40, 40);
      rg.addColorStop(0, 'rgba(255,214,150,0.95)'); rg.addColorStop(0.25, 'rgba(255,190,110,0.45)'); rg.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 80, 80);
    }
    for (const b of this.bulbs) {
      const k = 0.72 + 0.28 * Math.sin(t * b.sp + b.ph);
      ctx.globalAlpha = k;
      ctx.drawImage(this.glow, b.x - 40, b.y - 36);
      ctx.fillStyle = '#fff3d6';
      ctx.beginPath(); ctx.ellipse(b.x, b.y, 4.2, 6.5, 0, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Perch geometry for the birds module (design space, before sway)
  get geometry() {
    return { glass: G, limb: this.limb, sub: this.sub, arm: this.twigArm, trunk: this.trunk, sway: this.sway || 0, pivot: [1600, 640] };
  }

  thumb(ctx, w, h) {
    ctx.save(); ctx.scale(w / W, h / H);
    ctx.drawImage(this.layers.out, 0, 0);
    if (this.p.branch) { ctx.drawImage(this.layers.back, 0, 0); ctx.drawImage(this.layers.front, 0, 0); }
    ctx.drawImage(this.layers.frame, 0, 0);
    for (const [cx, cy, s] of this.candles || []) flame(ctx, cx, cy, s, 0, cx);
    this.drawBulbs(ctx, 0);
    ctx.restore();
  }
}

function seasonLeaves(season, lit) {
  const L = c => mixMul(hex(c), lit);
  if (season === 'autumn') return { p: 0.35, size: 16, colors: ['#c4622d', '#d9932c', '#a8432a', '#8b6a2c'].map(L) };
  if (season === 'lateautumn') return { p: 0.12, size: 14, colors: ['#9c5a2e', '#7d4a2e', '#b07a3a'].map(L) };
  if (season === 'summer') return { p: 0.55, size: 18, colors: ['#4f6e3a', '#5d7d42', '#3e5c33'].map(L) };
  if (season === 'spring') return { p: 0.3, size: 11, colors: ['#8fae5a', '#a9c46c'].map(L), bud: L('#c98a9a') };
  return null;
}

function bevel(x, bx, by, bw, bh, s, c, hi, lo) {
  x.fillStyle = rgb(shade(c, hi)); x.fillRect(bx, by, bw, s); x.fillRect(bx, by, s, bh);
  x.fillStyle = rgb(shade(c, lo)); x.fillRect(bx, by + bh - s, bw, s); x.fillRect(bx + bw - s, by, s, bh);
}

function drop(x, cx, cy, r, sky) {
  const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, `rgba(255,255,255,${0.35 + 0.2 * sky.light})`);
  g.addColorStop(0.55, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.85, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
}

function frostCorner(x, pane, sky) {
  const r = seeded(Math.round(pane.x + pane.y));
  const corners = [[pane.x, pane.y + pane.h, -1], [pane.x + pane.w, pane.y + pane.h, 1]];
  for (const [cx, cy] of corners) {
    const g = x.createRadialGradient(cx, cy, 6, cx, cy, 190);
    g.addColorStop(0, 'rgba(225,235,248,0.26)'); g.addColorStop(0.45, 'rgba(225,235,248,0.08)'); g.addColorStop(1, 'rgba(225,235,248,0)');
    x.fillStyle = g; x.fillRect(cx - 200, cy - 200, 400, 400);
    // fern-like crystals
    x.strokeStyle = `rgba(235,242,252,${0.16 + 0.1 * sky.lamp})`; x.lineWidth = 0.9;
    for (let i = 0; i < 16; i++) {
      let px = cx + (r() - 0.5) * 60, py = cy - r() * 30, a = -Math.PI / 2 + (cx > pane.x + 1 ? -0.7 : 0.7) * r();
      const len = 30 + r() * 100;
      x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 8; k++) {
        const nx = px + Math.cos(a) * len / 8, ny = py + Math.sin(a) * len / 8;
        x.lineTo(nx, ny);
        x.moveTo(nx, ny); x.lineTo(nx + Math.cos(a + 0.8) * 8, ny + Math.sin(a + 0.8) * 8);
        x.moveTo(nx, ny); x.lineTo(nx + Math.cos(a - 0.8) * 8, ny + Math.sin(a - 0.8) * 8);
        x.moveTo(nx, ny);
        px = nx; py = ny; a += (r() - 0.5) * 0.3;
      }
      x.stroke();
    }
  }
}

export { G as GLASS, SILL_Y };
