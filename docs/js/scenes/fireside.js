// Fireside: a photoreal brick fireplace filling the screen. The picture is two layers (the room in
// the evening, and the same room lit by the fire, faded up and down as the fire flickers), with
// real fire footage showing through the firebox, live candle flames, and the family cat.
import { W, H, fbm1, clamp, loadImage } from '../util.js';
import { flame } from '../paint.js';
import { FireSound } from '../audio/fire.js';
import { ToonCat } from '../overlays/tooncat.js';
import { AMBIENCE } from './fireplace.js';

const REL = 'https://github.com/joshdhill/hearth/releases/download/media-v2/';
const SITE = new URL('../../media/', import.meta.url).href;
const DIR = SITE + 'fireside/';
const FIRE = { tv: REL + 'ember-4k.mp4', hls: SITE + 'fire/ember/index.m3u8', poster: SITE + 'fire/ember/poster.jpg' };
const LEVEL = { off: 0, low: 0.25, medium: 0.5, high: 0.85 };
const ROOM = { evening: '', dark: 'brightness(0.5)', lamp: 'brightness(1.75) saturate(1.08)' };

// Where things are in the picture, in scene pixels (tools/art/room.py works these out and writes them to fireside.json).
const G = {
  wide: 2401.7, margin: 234.1,                                   // the picture is wider than 16:9; wide screens show the extra
  video: { x: 440.2, y: 319.4, w: 1083.6, h: 609.6 },                   // where the fire footage sits
  cavity: [543.8, 485.2, 1329.2, 918.6],
  mantel: { y: 207.7, clear: [568.3, 1512.4] },                  // top of the mantel, and the stretch with nothing standing on it
  hearth: { y: 970.5 },                                          // where paws go on the hearth
  candles: [[177.5, 103.8], [456.9, 66.1], [517.3, 132.2], [1559.6, 124.6], [1612.4, 117.1], [1665.3, 143.5], [1763.5, 143.5], [-149.2, 700.5], [-73.6, 759]]
};

export class FiresideScene {
  constructor(app, preset) {
    this.app = app; this.p = preset;
    this.sound = new FireSound();
    this.transparent = true;
    this.wide = G.wide;
    // paws in the middle of the hearth's top face (its back edge is at y 944)
    this.cat = new ToonCat({ floor: 958.6, x0: -G.margin, x1: W + G.margin, fire: [G.cavity[0], G.cavity[2]] }, { mode: () => this.o.cat });
  }
  get o() { return this.p.opts; }

  async enter() {
    const app = this.app;
    app.video(FIRE, G.video);
    this.applySound();
    // the picture layers sit between the fire footage and the drawing canvas
    const big = Math.max(app.canvas.height, innerHeight * (window.devicePixelRatio || 1)) >= 1500;
    const tag = big ? '4k' : '2k';
    const host = document.getElementById('backdrop');
    host.textContent = '';
    this.room = new Image(); this.lit = new Image();
    for (const im of [this.room, this.lit]) { im.alt = ''; im.decoding = 'async'; host.appendChild(im); }
    this.lit.style.willChange = 'opacity'; this.lit.style.opacity = '0.7';
    const loaded = im => new Promise(res => { im.onload = res; im.onerror = res; });
    const a = loaded(this.room), b = loaded(this.lit);
    this.room.src = DIR + `room-${tag}.webp`; this.lit.src = DIR + `lit-${tag}.webp`;
    this.layout(); this.update();
    // the fire-tool stand stands on the hearth: drawn again over the cat, so it walks behind it
    this.front = { b: { x: 1523.7, y: 500.3, w: 305.9, h: 519.2 }, r: new Image(), l: new Image() };
    this.front.r.src = DIR + `front-room-${tag}.webp`; this.front.l.src = DIR + `front-lit-${tag}.webp`;
    await Promise.race([Promise.all([a, b]), new Promise(r => setTimeout(r, 6000))]);
    const ch = app.canvas.height;                                // sprite size to suit the screen: a TV's 1080 rows get the middle one
    this.cat.useSet(ch >= 1300 ? 'hd' : ch >= 760 ? 'md' : 'sd');
    await this.cat.ready;
    const q = new URLSearchParams(location.search);              // for trying things out: ?trick=mantel&fast=4
    if (q.get('fast')) this.cat.fast = +q.get('fast') || 1;
    if (q.get('trick')) this.cat.do(q.get('trick'));
  }

  // put the picture exactly where the canvas draws scene coordinates
  layout() {
    if (!this.room) return;
    const { k, ox, oy } = this.app.view, cw = this.app.canvas.width, ch = this.app.canvas.height;
    const l = (ox - G.margin * k) / cw * 100, t = oy / ch * 100, w = G.wide * k / cw * 100, h = H * k / ch * 100;
    for (const im of [this.room, this.lit]) { const s = im.style; s.left = l + 'vw'; s.top = t + 'vh'; s.width = w + 'vw'; s.height = h + 'vh'; }
  }

  applySound() {
    const lv = LEVEL[this.o.sound || 'medium'] ?? 0.5;
    this.app.ambient(lv > 0 ? AMBIENCE : null, lv);
    if (this.o.crackle !== false && lv > 0) this.sound.start(lv * 0.4); else this.sound.stop();
  }
  update() {
    this.applySound();
    if (this.room) this.room.style.filter = ROOM[this.o.room] || '';
  }
  exit() {
    this.sound.stop(); this.app.video(null); this.app.ambient(null);
    document.getElementById('backdrop').textContent = '';
    this.room = this.lit = null;
  }
  act(key, value) {
    if (key !== 'trick') return;
    if (value === 'random' && this.o.cat !== 'loop') this.app.setOpt('cat', 'loop');      // "random" = non-stop tricks, every one in turn
    if (value === 'bye' && this.o.cat === 'loop') this.app.setOpt('cat', 'often');          // sent away: no more non-stop tricks
    else if (value !== 'random' && this.o.cat === 'off') this.app.setOpt('cat', 'sometimes');   // asking for a trick brings the cat back
    this.cat.do(value);
  }

  draw(ctx, t, dt) {
    // the fire's light: a slow breathing with quick small flutters
    const fl = clamp(0.5 + 0.9 * (fbm1(t * 1.7) - 0.5) + 0.12 * (fbm1(t * 7.3 + 40) - 0.5), 0, 1);
    if (this.lit) this.lit.style.opacity = (0.56 + 0.44 * fl).toFixed(3);
    this.cat.draw(ctx, t, dt, fl);
    const fr = this.front;
    if (fr && fr.r.complete && fr.l.complete && fr.r.naturalWidth) {
      const { x, y, w, h } = fr.b;
      ctx.drawImage(fr.r, x, y, w, h);
      ctx.save(); ctx.globalAlpha = 0.56 + 0.44 * fl; ctx.drawImage(fr.l, x, y, w, h); ctx.restore();
    }
    if (this.o.candles !== false) G.candles.forEach(([x, y], i) => flame(ctx, x, y + 1, 7.5, t, i * 2.3 + 0.7));
  }

  async thumb(ctx, w, h) {
    const img = await loadImage(DIR + 'thumb.jpg').catch(() => null);
    if (img) ctx.drawImage(img, 0, 0, w, h);
  }
}
