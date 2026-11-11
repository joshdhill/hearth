// The house cat, from the family's own illustration, moving with generated animation.
// Every clip is a sheet of frames cut out on transparency; clips meet at three poses
// (standing, sitting, lying), so tricks are chains of clips that join up.
import { W, rand, pick, clamp, lerp } from '../util.js';

const BASE = new URL('../../media/cat/', import.meta.url).href;
const WAIT = { sometimes: [150, 360], often: [35, 90], loop: [1.5, 4] };
const GAIT_RATE = { walk: 2.0, trot: 1.5, run: 1.3 };   // the generated strides are slow motion; this plays them at a living pace
const FADE = 4;                       // frames of dissolve between clips
const AHEAD = 2;                      // clips kept loaded ahead of the one playing
const KEEP = 7;                       // sheets held in memory at most (three of them are the single still poses)
const BACKWARDS = { stand2sit: 'sit2stand' };            // clips that are another clip's frames played in reverse
const STILLS = ['sit', 'lie', 'stand'];

// what the pose is at each end of a clip
const ENDS = {
  walk: ['stand', 'stand'], trot: ['stand', 'stand'], run: ['stand', 'stand'], stretch: ['stand', 'stand'],
  sit2stand: ['sit', 'stand'], stand2sit: ['stand', 'sit'], sit2lie: ['sit', 'lie'], lie2sit: ['lie', 'sit'],
  'sit-look': ['sit', 'sit'], 'sit-tail': ['sit', 'sit'], 'sit-groom': ['sit', 'sit'], 'sit-groom2': ['sit', 'sit'], 'sit-yawn': ['sit', 'sit'], 'sit-paw': ['sit', 'sit'],
  'lie-doze': ['lie', 'lie'], 'lie-roll': ['lie', 'lie'], 'jump-up': ['sit', 'sit'], 'jump-down': ['sit', 'sit']
};

export const TRICKS = [
  ['random', 'Random: loop through them all'], ['mantel', 'Jump on the mantel'], ['stretch', 'Big stretch'], ['sit', 'Sit by the fire'],
  ['nap', 'Nap by the fire'], ['wash', 'Have a wash'], ['roll', 'Roll over'], ['zoom', 'Zoomies'], ['walk', 'Walk by'], ['bye', 'Off you go']
];
const AUTO = ['mantel', 'stretch', 'sit', 'nap', 'wash', 'roll', 'zoom', 'walk'];

export class SpriteCat {
  // spots: { floor, shelf, floorH, shelfH, shelfX: [x0, x1], x0, x1, fire: [x0, x1] }   (H = height of the sitting cat)
  constructor(spots, opt) {
    this.S = spots; this.opt = opt;
    this.away = true; this.wait = rand(6, 14);
    this.steps = []; this.step = null;
    this.x = 0; this.y = spots.floor; this.h = spots.floorH; this.dir = 1; this.up = false;
    this.cur = null; this.prev = null;          // what is on screen: { clip, f } and the frame being dissolved out
    this.imgs = new Map(); this.meta = null; this.set = 'sd'; this.need = new Set();
    this.fast = 1;                              // time multiplier (for trying things out)
    this.ready = fetch(BASE + 'cat.json').then(r => r.json()).then(m => { this.meta = m; this.prime(); }).catch(() => { this.meta = null; });
  }

  useSet(name) { if (name !== this.set) { this.set = name; this.imgs.clear(); if (this.meta) this.prime(); } }
  src(clip) { return BACKWARDS[clip] || clip; }
  m(clip) { return this.meta.sets[this.set][this.src(clip)]; }

  load(clip) {
    const name = this.src(clip), key = this.set + ':' + name;
    const had = this.imgs.get(key);
    if (had) { had.used = performance.now(); return had.p; }
    const m = this.meta.sets[this.set][name];
    const pages = m.pages.map(() => new Image());
    const p = Promise.all(pages.map((im, i) => new Promise(res => {
      im.onload = () => (im.decode ? im.decode().then(res, res) : res());     // decoded before it is first drawn, so no hitch
      im.onerror = () => res();
      im.src = BASE + m.pages[i];
    }))).then(() => pages.every(im => im.naturalWidth));
    const e = { p, pages, used: performance.now(), done: false };
    this.imgs.set(key, e);
    p.then(ok => { e.done = ok; });
    // keep memory in check: forget the sheets used longest ago that nothing coming up needs
    if (this.imgs.size > KEEP) {
      const old = [...this.imgs.entries()].filter(([k]) => k !== key && !this.need.has(k.slice(k.indexOf(':') + 1))).sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < old.length && this.imgs.size > KEEP; i++) this.imgs.delete(old[i][0]);
    }
    return p;
  }
  have(clip) { const e = this.imgs.get(this.set + ':' + this.src(clip)); return !!(e && e.done); }

  // have the clips that are on screen, and the next few, loaded
  prime() {
    const need = new Set(STILLS);
    if (this.cur) need.add(this.src(this.cur.clip));
    if (this.prev) need.add(this.src(this.prev.clip));
    let n = 0;
    for (const s of (this.step ? [this.step, ...this.steps] : this.steps)) {
      const c = s.clip || s.gait || s.pose;
      if (!c || need.has(this.src(c))) continue;
      need.add(this.src(c));
      if (++n >= AHEAD) break;
    }
    this.need = need;
    for (const c of need) this.load(c);
  }

  // ---- tricks: each is a list of steps, starting and ending on its feet ----------------------------
  // The cat never turns round in view. If what it has been asked to do is behind it, it trots out and comes back in.
  script(trick, from) {
    const S = this.S, st = [], d = from.dir;
    const out = d > 0 ? S.x1 + 420 : S.x0 - 420;
    const fwd = v => (d > 0 ? v : W - v);               // a spot measured along the way the cat is going (a mirror for right-to-left)
    const f0 = d > 0 ? S.fire[0] : W - S.fire[1], f1 = d > 0 ? S.fire[1] : W - S.fire[0], mid = (f0 + f1) / 2;
    const sh0 = d > 0 ? S.shelfX[0] : W - S.shelfX[1], sh1 = d > 0 ? S.shelfX[1] : W - S.shelfX[0];
    const here = fwd(from.x);
    let spot = here;                                    // where the trick will happen
    const goTo = (a, b, gait = 'walk') => {             // get to somewhere between a and b; false if already past it
      if (here > b) return false;
      if (here < a) { spot = rand(a, b); st.push({ t: 'go', x: fwd(spot), gait }); }
      return true;
    };
    const comeBack = () => [{ t: 'go', x: out, gait: 'trot' }, { t: 'flip' }, { t: 'pause', secs: rand(0.6, 1.6) }, { t: 'again', trick }];
    const play = (...clips) => clips.forEach(clip => st.push({ t: 'play', clip }));
    const hold = (pose, secs) => st.push({ t: 'hold', pose, secs });
    const sitIdle = n => { for (let i = 0; i < n; i++) { hold('sit', rand(2.5, 6)); play(pick(['sit-look', 'sit-tail', 'sit-look', 'sit-yawn', 'sit-paw'])); } };
    switch (trick) {
      case 'walk': break;
      case 'bye': return [{ t: 'go', x: out, gait: 'trot', last: true }];
      case 'zoom':
        st.push({ t: 'go', x: out, gait: 'run' }, { t: 'flip' }, { t: 'pause', secs: rand(0.8, 2) }, { t: 'go', x: d > 0 ? S.x0 - 420 : S.x1 + 420, gait: 'run' },
          { t: 'flip' }, { t: 'pause', secs: rand(0.8, 2) }, { t: 'go', x: fwd(mid + rand(-250, 100)), gait: 'trot' });
        play('stand2sit'); sitIdle(1); play('sit2stand'); break;
      case 'stretch': if (!goTo(f0 - 300, f1 - 280)) return comeBack(); play('stretch'); break;
      case 'sit': if (!goTo(f0 - 110, mid - 60)) return comeBack(); play('stand2sit'); sitIdle(3); hold('sit', rand(3, 8)); play('sit2stand'); break;
      case 'wash':
        if (!goTo(f0 - 200, mid + 100)) return comeBack();
        play('stand2sit'); hold('sit', 1.5); play('sit-groom'); hold('sit', 1); play('sit-groom2'); hold('sit', 1.5); play('sit-yawn'); hold('sit', 2); play('sit2stand'); break;
      case 'roll':
        if (!goTo(f0 - 150, mid)) return comeBack();
        play('stand2sit', 'sit2lie'); hold('lie', 1.5); play('lie-roll'); hold('lie', 2); play('lie-roll'); hold('lie', 2.5); play('lie2sit'); hold('sit', 1.5); play('sit2stand'); break;
      case 'nap':
        if (!goTo(f0 - 120, mid - 100)) return comeBack();
        play('stand2sit'); hold('sit', 2); play('sit-yawn', 'sit2lie');
        for (let i = 0, n = 4 + (Math.random() * 5 | 0); i < n; i++) { hold('lie', rand(4, 10)); play('lie-doze'); }
        hold('lie', 3); play('lie2sit'); hold('sit', 2); play('sit2stand', 'stretch'); break;
      case 'mantel': {
        // sit below a clear stretch of mantel, jump up, potter about, jump down further along
        const mj = this.m('jump-up'), carry = mj.land[0] / mj.sit_h * S.floorH;       // how far forward the jump carries
        if (!goTo(sh0 + 70 - carry, sh0 + 330 - carry) && here > sh1 - 160 - carry) return comeBack();
        const landing = spot + carry;
        play('stand2sit'); hold('sit', 1.2); st.push({ t: 'jump', clip: 'jump-up', to: 'shelf' });
        hold('sit', rand(2, 4)); play(pick(['sit-look', 'sit-tail'])); hold('sit', rand(2, 5));
        if (Math.random() < 0.7) { play(pick(['sit-groom', 'sit-yawn', 'sit-paw'])); hold('sit', rand(2, 4)); }
        const far = sh1 - rand(200, 330);               // a standing cat is long: stop well short of the candles
        if (far > landing + 160) {
          play('sit2stand'); st.push({ t: 'go', x: fwd(far), gait: 'walk' });
          if (Math.random() < 0.5) play('stretch');
          play('stand2sit'); hold('sit', rand(3, 7)); play('sit-look');
        }
        hold('sit', rand(1, 3)); st.push({ t: 'jump', clip: 'jump-down', to: 'floor' }); hold('sit', 1.2); play('sit2stand');
        break;
      }
    }
    st.push({ t: 'go', x: out, gait: trick === 'zoom' ? 'trot' : 'walk', last: true });
    return st;
  }

  // start a trick (now if the cat is away, else as soon as it is back on its feet)
  do(trick) {
    if (!this.meta) return;
    if (trick === 'random') { if (this.away) this.wait = 0; return; }
    if (!this.away) {
      this.queued = trick; this.hurry = true;
      if (this.step && this.step.t === 'hold') this.step.secs = Math.min(this.step.secs, this.step.time + 0.4);
      return;
    }
    if (trick === 'bye') return;
    const S = this.S, dir = pick([-1, 1]);
    const from = { x: dir > 0 ? S.x0 - 420 : S.x1 + 420, dir };
    this.away = false; this.up = false; this.x = from.x; this.y = S.floor; this.h = S.floorH; this.dir = dir;
    this.steps = this.script(trick, from); this.step = null; this.cur = { clip: 'stand', f: 0 }; this.prev = null;
    this.acc = 0; this.hurry = false; this.queued = null; this.trick = trick;
    this.prime();
  }

  // the next trick when the cat chooses for itself: every trick once, shuffled, then again
  next() {
    if (!this.bag || !this.bag.length) {
      this.bag = AUTO.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);
      if (this.bag[this.bag.length - 1] === this.last && this.bag.length > 1) this.bag.reverse();
    }
    return (this.last = this.bag.pop());
  }

  show(clip, f = 0) {
    if (this.cur && this.cur.clip !== clip) this.prev = { ...this.cur, n: FADE, x: this.x, y: this.y, h: this.h, dir: this.dir };
    this.cur = { clip, f };
  }
  leave() { this.away = true; this.cur = this.prev = this.step = null; this.steps = []; this.trick = null; this.hurry = false; this.wait = 1e9; }

  // ---- per frame ------------------------------------------------------------------------------------
  update(dt) {
    if (!this.meta) return;
    dt *= this.fast;
    const mode = this.opt.mode();
    if (this.away) {
      if (!mode || mode === 'off') return;
      const w = WAIT[mode] || WAIT.sometimes;
      if (this.wait > w[1]) this.wait = rand(w[0], w[1]);
      this.wait -= dt;
      if (this.wait <= 0) { this.wait = 1e9; this.do(this.next()); }
      return;
    }
    const fps = this.meta.fps, S = this.S;
    if (this.prev) { this.prev.n -= dt * fps; if (this.prev.n <= 0) this.prev = null; }
    for (let guard = 0; guard < 8; guard++) {
      if (!this.step) {
        const feet = this.poseNow() === 'stand' && !this.up;
        // on its feet between steps: something it has been asked for can take over here
        if (this.queued && feet) {
          const q = this.queued; this.queued = null; this.hurry = false;
          this.steps = this.script(q, { x: this.x, dir: this.dir }); this.trick = q;
        }
        let s = this.steps[0];
        if (!s) { this.leave(); return; }
        // non-stop tricks: instead of walking off, go straight on to the next one
        if (s.last && feet && mode === 'loop' && this.trick !== 'bye') {
          const nx = this.next();
          if (nx !== 'walk') { this.steps = this.script(nx, { x: this.x, dir: this.dir }); this.trick = nx; s = this.steps[0]; }
          else { s.last = false; this.trick = 'walk'; }
        }
        if (s.t === 'again') { this.steps = this.script(s.trick, { x: this.x, dir: this.dir }); continue; }
        const c = s.clip || s.gait || s.pose;
        if (c && !this.have(c)) { this.prime(); return; }                 // still arriving: hold the pose
        this.steps.shift(); this.step = s; s.time = 0;
        this.prime();
        if (s.t === 'flip') { this.dir = -this.dir; this.step = null; continue; }
        if (s.t === 'play' || s.t === 'jump') {
          if (this.hurry && s.t === 'play' && ENDS[s.clip][0] === ENDS[s.clip][1] && ENDS[s.clip][0] !== 'stand') { this.step = null; continue; }   // skip the idling when asked for something else
          this.show(s.clip, 0); this.acc = 0;
          if (s.t === 'jump') {
            const m = this.m(s.clip);
            s.x0 = this.x; s.y0 = this.y; s.h0 = this.h; s.p = 0;
            s.h1 = s.to === 'shelf' ? S.shelfH : S.floorH; s.y1 = s.to === 'shelf' ? S.shelf : S.floor;
            s.x1 = this.x + this.dir * m.land[0] / m.sit_h * S.floorH;
          }
        } else if (s.t === 'hold') { this.show(s.pose, 0); if (this.hurry) s.secs = Math.min(s.secs, 0.4); }
        else if (s.t === 'go') {
          this.show(s.gait, 0); s.stopping = false;
          const m = this.m(s.gait), hidden = this.x < S.x0 - 300 || this.x > S.x1 + 300;
          this.acc = hidden ? m.lead : 0;                                 // already in its stride when it comes into view
        }
      }
      const s = this.step;
      s.time += dt;
      if (s.t === 'pause') { this.cur = this.prev = null; if (s.time >= s.secs) { this.step = null; continue; } return; }
      if (s.t === 'hold') { if (s.time >= s.secs) { this.step = null; continue; } return; }
      const m = this.m(this.cur.clip);
      if (s.t === 'play') {
        this.acc += dt * fps;
        const f = Math.floor(this.acc);
        if (f >= m.frames) { this.cur.f = m.frames - 1; this.step = null; this.show(ENDS[s.clip][1], 0); continue; }
        this.cur.f = f; return;
      }
      if (s.t === 'jump') {
        this.acc += dt * fps;
        this.cur.f = Math.min(m.frames - 1, Math.floor(this.acc));
        s.p = m.path[this.cur.f];
        this.cur.lift = s;
        if (this.acc >= m.frames) {
          // landed: from here on the cat is simply at the new spot (the last frame is still drawn from where it took off)
          this.x = s.x1; this.y = s.y1; this.h = s.h1; this.up = s.to === 'shelf';
          this.step = null; this.show('sit', 0); continue;
        }
        return;
      }
      if (s.t === 'go') {
        const adv = dt * fps * GAIT_RATE[s.gait] * (this.hurry && s.gait === 'walk' ? 1.5 : 1);
        const before = this.acc;
        this.acc += adv;
        const loop = m.frames - m.lead;
        const idx = a => (a < m.lead ? Math.floor(a) : m.lead + (Math.floor(a - m.lead) % loop));
        const f = idx(this.acc);
        // the cat covers ground only as fast as its planted paws slide back in the clip
        const scale = this.h / m.sit_h;
        const ramp = this.acc < m.lead ? clamp(this.acc / m.lead, 0.15, 1) : 1;
        this.x += this.dir * m.speed * adv * scale * ramp;
        this.cur.f = f;
        if (this.dir > 0 ? this.x > S.x1 + 400 : this.x < S.x0 - 400) {
          if (this.dir > 0 ? this.x >= s.x : this.x <= s.x) { this.step = null; continue; }          // gone from view
        } else if (this.acc >= m.lead && Math.floor(before) !== Math.floor(this.acc) && f === m.lead + m.stand) {
          // the moment of the stride that looks like standing: stop here if this is as near the spot as a whole stride gets
          const left = this.dir * (s.x - this.x);
          if (left <= m.speed * scale * loop / 2) { this.step = null; this.show('stand', 0); continue; }
        }
        return;
      }
      return;
    }
  }

  poseNow() {
    if (!this.cur) return 'stand';
    const c = this.cur.clip;
    return ENDS[c] ? ENDS[c][1] : c;
  }

  // draw one frame of a clip with the cat's floor point at (x, y); h = how tall the sitting cat is
  frame(ctx, c, x, y, h, dir, alpha) {
    const e = this.imgs.get(this.set + ':' + this.src(c.clip));
    if (!e || !e.done) return;
    const m = this.m(c.clip);
    const f = BACKWARDS[c.clip] ? m.frames - 1 - c.f : c.f;
    const img = e.pages[Math.floor(f / m.per_page)];
    const k = f % m.per_page, [cw, ch] = m.cell;
    const sx = (k % m.cols) * cw, sy = Math.floor(k / m.cols) * ch;
    let ax = m.anchor[0], ay = m.anchor[1];
    if (m.org) { ax -= m.org[f][0]; ay -= m.org[f][1]; }                  // frames cut out one by one
    if (c.lift) {                                                         // in a jump the floor point travels with the cat
      const p = c.lift.p;
      ax += p * m.land[0]; ay += p * m.land[1];
      x = lerp(c.lift.x0, c.lift.x1, p); y = lerp(c.lift.y0, c.lift.y1, p); h = lerp(c.lift.h0, c.lift.h1, p);
    }
    const s = h / m.sit_h;
    ctx.save();
    ctx.translate(x, y); ctx.scale(dir * s, s);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, sy, cw, ch, -ax, -ay, cw, ch);
    ctx.restore();
  }

  // the frames on screen right now: one, or two while one clip dissolves into the next
  frames(ctx) {
    const a = this.prev ? clamp(1 - this.prev.n / FADE, 0, 1) : 1;
    if (this.prev) {
      const p = this.prev;
      // dissolve: the old frame stays solid while the new one comes in, then fades out under it
      this.frame(ctx, p, p.x, p.y, p.h, p.dir, a < 0.5 ? 1 : 2 - 2 * a);
      this.frame(ctx, this.cur, this.x, this.y, this.h, this.dir, a < 0.5 ? 2 * a : 1);
    } else this.frame(ctx, this.cur, this.x, this.y, this.h, this.dir, 1);
  }

  // firelight on the cat: warm light added over the side of it that faces the fire
  firelight(ctx, x, y, h, glow) {
    const S = this.S, cx = x + this.dir * 0.35 * h, dist = Math.max(S.fire[0] - cx, cx - S.fire[1], 0);
    if (this.up || this.cur.lift || dist === 0) return;                   // above the fire, or in front of it (a silhouette): no light to add
    const near = 0.26 * Math.exp(-dist / 650) * (0.6 + 0.4 * glow);
    if (near < 0.02) return;
    const T = ctx.getTransform(), k = T.a;
    const bx = x - 1.9 * h, by = y - 1.8 * h, bw = 3.8 * h, bh = 2.0 * h;
    const dx = Math.floor(T.e + bx * k), dy = Math.floor(T.f + by * k), pw = Math.ceil(bw * k) + 1, ph = Math.ceil(bh * k) + 1;
    const b = this.buf || (this.buf = document.createElement('canvas'));
    if (b.width !== pw || b.height !== ph) { b.width = pw; b.height = ph; }
    const g = b.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, pw, ph);
    g.setTransform(k, 0, 0, k, T.e - dx, T.f - dy);                      // the same picture of the cat, in the buffer...
    this.frames(g);
    g.globalCompositeOperation = 'source-in';                             // ...kept only as the shape the light falls on
    const side = cx < (S.fire[0] + S.fire[1]) / 2 ? 1 : -1;
    const gr = g.createLinearGradient(cx + side * 0.8 * h, 0, cx - side * 0.5 * h, 0);
    gr.addColorStop(0, `rgba(255,150,70,${near})`); gr.addColorStop(1, 'rgba(255,150,70,0)');
    g.fillStyle = gr;
    g.fillRect(bx, by, bw, bh);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(b, dx, dy); ctx.restore();
  }

  draw(ctx, t, dt, glow = 0.5) {
    this.update(dt);
    if (this.away || !this.cur || !this.meta) return;
    const lift = this.cur.lift, air = lift && lift.p > 0.04 && lift.p < 0.96;
    let x = this.x, y = this.y, h = this.h;
    if (lift) { x = lerp(lift.x0, lift.x1, lift.p); y = lerp(lift.y0, lift.y1, lift.p); h = lerp(lift.h0, lift.h1, lift.p); }
    // the cat, with a faint warm edge so black fur still reads against a dark room
    ctx.save();
    ctx.shadowColor = `rgba(255,150,70,${0.22 + 0.26 * glow})`; ctx.shadowBlur = Math.max(6, h * 0.06);
    this.frames(ctx);
    ctx.restore();
    this.firelight(ctx, x, y, h, glow);
    // a soft shadow where it stands (not in mid-air), slipped in underneath
    if (!air) {
      const pose = this.poseNow(), w = h * (pose === 'sit' ? 0.42 : 0.7), cx = x + this.dir * h * (pose === 'sit' ? 0.2 : 0.42);
      const g = ctx.createRadialGradient(cx, y, 1, cx, y, w);
      g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.globalCompositeOperation = 'destination-over';
      ctx.translate(0, y); ctx.scale(1, 0.14); ctx.translate(0, -y);
      ctx.fillStyle = g; ctx.fillRect(cx - w, y - w, 2 * w, 2 * w); ctx.restore();
    }
  }
}
