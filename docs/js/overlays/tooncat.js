// The cartoon cat for the Fireside scene: a hand-drawn 2D black cat (generated from the family's cat)
// that walks along the hearth and does tricks. Every clip starts and ends in the same standing pose,
// so tricks are simply: walk in, stop, play the move (hold it, and play it back to stand up), walk on.
// It is put into the room the way a compositor would: darker away from the fire, a thin warm rim
// that flickers with the fire when it is behind the cat, and a contact shadow falling forwards.
const BASE = new URL('../../media/cat-demo/', import.meta.url).href;

export const TRICKS = [
  ['random', 'Random: loop through them all'], ['sit', 'Sit by the fire'], ['lie', 'Lie down'],
  ['stretch', 'Big stretch'], ['look', 'Look round'], ['walk', 'Walk by'], ['bye', 'Off you go']
];
const MOVES = { sit: { hold: [5, 9] }, lie: { hold: [8, 14] }, stretch: {}, look: {} };
const PAUSE = { sometimes: [40, 90], often: [12, 30], loop: [0.8, 2] };   // seconds between visits
const CHANCE = { sometimes: 0.5, often: 0.75, loop: 1 };                  // that a visit includes a trick
const BASE_H = 205;                                                      // standing, floor to ear tips (scene px)
const rnd = ([a, b]) => a + Math.random() * (b - a);

export class ToonCat {
  // spots: { floor, x0, x1, fire: [x0, x1] } in scene px; opt.mode(): 'off' | 'sometimes' | 'often' | 'loop'
  constructor(spots, opt) {
    this.sp = spots; this.opt = opt;
    this.sheets = {}; this.loading = {};
    this.away = true; this.wait = 4; this.x = spots.x0 - 300; this.dir = 1; this.f = 0;
    this.plan = null; this.planX = 0; this.move = null; this.fade = null; this.queue = []; this.bag = [];
    this.buf = document.createElement('canvas'); this.rim = document.createElement('canvas');
    this.ready = this.load('toon');
  }
  useSet() {}
  load(name) {
    if (!this.loading[name]) this.loading[name] = (async () => {
      const m = await (await fetch(BASE + name + '.json')).json();
      m.img = new Image(); m.img.src = BASE + m.sheet;
      await m.img.decode().catch(() => {});
      return (this.sheets[name] = m);
    })().catch(() => null);
    return this.loading[name];
  }
  get mode() { return (this.opt.mode && this.opt.mode()) || 'often'; }
  next() {                                       // every trick once, in shuffled order, then again
    if (!this.bag.length) this.bag = Object.keys(MOVES).sort(() => Math.random() - 0.5);
    return this.bag.pop();
  }
  aim(trick, soon, gap = 160) {
    // tricks happen on the middle of the hearth (by the fire, clear of the tool stand); with no room
    // left ahead, the cat walks off and does it on its next visit, coming in from the other side
    this.plan = trick;
    if (trick) this.load('toon-' + trick);
    const px = soon && !this.away ? this.x + this.dir * gap : 560 + Math.random() * 800;
    if (!this.away && (this.dir > 0 ? px > 1450 : px < 450)) { this.plan = null; if (trick) this.queue.unshift(trick); return; }
    this.planX = Math.max(450, Math.min(1450, px));
  }
  do(trick) {
    if (trick === 'bye') { this.queue = []; this.plan = null; if (this.move && this.move.phase !== 'out') { this.move.phase = 'out'; } return; }
    if (trick === 'random') { this.bag = []; trick = this.next(); }
    if (trick === 'walk') trick = null;
    if (this.move) { if (trick) this.queue.push(trick); return; }
    if (this.away) { this.queue = trick ? [trick] : []; this.wait = 0; if (trick) this.load('toon-' + trick); return; }
    this.aim(trick, true);
  }

  update(dt) {
    const m = this.sheets.toon;
    if (!m) return;
    if (this.fade) { this.fade.t += dt; if (this.fade.t > 0.3) this.fade = null; }
    if (this.away) {
      this.wait -= dt;
      if (this.wait > 0 || (this.mode === 'off' && !this.queue.length)) return;
      this.away = false; this.dir = Math.random() < 0.5 ? 1 : -1; this.f = 0;
      this.dir = this.x > 960 ? -1 : 1;                                // come back in from the side it left by
      this.x = this.dir > 0 ? this.sp.x0 - 250 : this.sp.x1 + 250;
      const mode = this.mode;
      this.aim(this.queue.length ? this.queue.shift() : Math.random() < (CHANCE[mode] || 0) ? (mode === 'loop' ? this.next() : this.next()) : null);
      return;
    }
    if (this.move) {
      const mv = this.move, mm = mv.m, how = MOVES[mv.name];
      if (mv.phase === 'in') { mv.f += dt * mm.fps; if (mv.f >= mm.frames - 1) { mv.f = mm.frames - 1; if (how.hold) { mv.phase = 'hold'; mv.t = 0; mv.len = rnd(how.hold); } else this.endMove(); } }
      else if (mv.phase === 'hold') { mv.t += dt; if (mv.t > mv.len) mv.phase = 'out'; }
      else { mv.f -= dt * mm.fps; if (mv.f <= 0) this.endMove(); }
      return;
    }
    const s = BASE_H / m.height, fr = dt * m.fps;
    this.f = (this.f + fr) % m.frames;
    this.x += this.dir * m.speed * s * fr;
    if (this.plan && (this.dir > 0 ? this.x >= this.planX : this.x <= this.planX)) {
      if (this.sheets['toon-' + this.plan]) this.startMove(this.plan);
      else if (this.x > 300 && this.x < 1620) this.planX = this.x + this.dir * 40;    // still loading: try a little further on
      else this.plan = null;
    }
    if ((this.dir > 0 && this.x > this.sp.x1 + 260) || (this.dir < 0 && this.x < this.sp.x0 - 260)) {
      this.away = true;
      const p = PAUSE[this.mode];
      this.wait = this.queue.length ? 0.5 : p ? rnd(p) : 1e9;
    }
  }
  startMove(name) {
    this.fade = { m: this.sheets.toon, f: this.f, t: 0 };
    this.move = { name, m: this.sheets['toon-' + name], f: 0, phase: 'in', t: 0 };
    this.plan = null;
  }
  endMove() {
    const mv = this.move; this.move = null;
    this.fade = { m: mv.m, f: 0, t: 0 };
    this.f = 0;
    // more to do: a queued trick, or (non-stop) the next one, a little further along if there is room
    const more = this.queue.length ? this.queue.shift() : this.mode === 'loop' ? this.next() : null;
    if (more) this.aim(more, true, 220 + Math.random() * 200);
  }

  draw(ctx, t, dt, fl) {
    this.update(dt);
    const m = this.sheets.toon;
    if (!m || this.away) return;
    const a = this.fade ? this.fade.t / 0.3 : 1;
    if (this.fade) this.drawFrame(ctx, this.fade.m, this.fade.f, 1 - a, fl);
    if (this.move) this.drawFrame(ctx, this.move.m, this.move.f, a, fl);
    else this.drawFrame(ctx, m, this.f, a, fl);
  }

  drawFrame(ctx, m, f0, alpha, fl) {
    const k = Math.abs(ctx.getTransform().a) || 1;                 // scene px -> device px
    const s = BASE_H / m.height, fi = Math.min(m.frames - 1, Math.max(0, Math.floor(f0)));
    const [cw, ch] = m.cell, sx = (fi % m.cols) * cw, sy = Math.floor(fi / m.cols) * ch;
    const w = cw * s, h = ch * s, x = this.x, y = this.sp.floor;
    const [f0x, f1x] = this.sp.fire;
    const near = Math.max(0, Math.min(1, 1 - Math.max(f0x - x, x - f1x, 0) / 260));
    const flip = (m.faces === 'right') !== (this.dir > 0);
    const left = flip ? x - (cw - m.anchor[0]) * s : x - m.anchor[0] * s, top = y - m.anchor[1] * s;
    // contact shadow; with the fire behind the cat it falls forwards, towards us
    const len = m.height * s * 1.05;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y + 2 + 5 * near); ctx.scale(1, 0.11 + 0.05 * near);
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, len * 0.62);
    g.addColorStop(0, `rgba(10,5,2,${0.55 + 0.2 * near})`); g.addColorStop(0.6, `rgba(10,5,2,${0.22 + 0.1 * near})`); g.addColorStop(1, 'rgba(10,5,2,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, len * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // the cat, graded into the room in its own buffer (at screen resolution)
    const bw = Math.max(1, Math.ceil(w * k)), bh = Math.max(1, Math.ceil(h * k));
    const buf = this.buf, bx = buf.getContext('2d');
    if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; this.rim.width = bw; this.rim.height = bh; }
    bx.globalCompositeOperation = 'source-over'; bx.clearRect(0, 0, bw, bh);
    bx.save(); if (flip) { bx.translate(bw, 0); bx.scale(-1, 1); }
    bx.drawImage(m.img, sx, sy, cw, ch, 0, 0, bw, bh); bx.restore();
    bx.globalCompositeOperation = 'source-atop';
    bx.fillStyle = `rgba(14,8,5,${0.30 * (1 - near) + 0.10})`; bx.fillRect(0, 0, bw, bh);         // the dim room
    bx.fillStyle = `rgba(255,128,50,${(0.05 + 0.10 * fl) * near})`; bx.fillRect(0, 0, bw, bh);    // warm spill from the fire
    ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(buf, left, top, w, h); ctx.restore();
    // backlight: the fire is behind the cat, so its upper outline catches a thin warm rim that flickers
    if (near > 0.01) {
      const rx = this.rim.getContext('2d');
      rx.globalCompositeOperation = 'source-over'; rx.clearRect(0, 0, bw, bh);
      rx.drawImage(buf, 0, 0);
      rx.globalCompositeOperation = 'destination-out';
      const d = Math.max(1.5, 2.2 * k * s * (m.height / 200));
      rx.drawImage(buf, 0, d); rx.drawImage(buf, d * 0.6, d * 0.8); rx.drawImage(buf, -d * 0.6, d * 0.8);
      rx.globalCompositeOperation = 'source-in';
      rx.fillStyle = 'rgb(255,170,90)'; rx.fillRect(0, 0, bw, bh);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (0.35 + 0.45 * fl) * near * alpha;
      ctx.drawImage(this.rim, left, top, w, h); ctx.restore();
    }
  }
}
