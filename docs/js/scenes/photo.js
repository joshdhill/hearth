// Fireside: a photoreal fireplace picture filling the screen, with real fire footage set into
// the firebox, firelight that flickers over the brick, and the house cat on the hearth.
import { W, H, canvas, fbm1, loadImage } from '../util.js';
import { FireSound } from '../audio/fire.js';
import { HouseCat } from '../overlays/housecat.js';
import { AMBIENCE } from './fireplace.js';

const REL = 'https://github.com/joshdhill/hearth/releases/download/media-v2/';
const SITE = new URL('../../media/', import.meta.url).href;
const FIRE = { tv: REL + 'ember-4k.mp4', hls: SITE + 'fire/ember/index.m3u8', poster: SITE + 'fire/ember/poster.jpg' };
const LEVEL = { off: 0, low: 0.25, medium: 0.5, high: 0.85 };
const M = 240;          // extra picture on each side, seen on screens wider than a TV

// Each picture: where the fire goes (design pixels), which part of the footage fills it, and where the cat can go.
const PHOTOS = {
  brick: {
    src: SITE + 'scenes/brick.jpg',
    box: { x: 560, y: 418, w: 670, h: 545 },          // the dark inside of the firebox
    crop: [0.15, 0.085, 0.64, 0.915],                       // x, y, w, h of the footage, as fractions
    cat: { floor: 1048, floorScale: 1.12, noShelf: true, shelf: 0, shelfScale: 1, shelfX: [0, W], jumpL: 300, jumpR: 1600, fireL: 430, fireR: 1400, x0: -M, x1: W + M }
  }
};

export class PhotoScene {
  constructor(app, preset) {
    this.app = app; this.p = preset;
    this.ph = PHOTOS[preset.photo] || PHOTOS.brick;
    this.sound = new FireSound();
    this.transparent = true;
    this.wide = W + 2 * M;
    this.cat = new HouseCat(this.ph.cat, { mode: () => this.o.cat, coat: () => this.o.catColor || 'black', rim: 'rgba(255,150,70,0.55)' });
  }
  get o() { return this.p.opts; }

  async enter() {
    const { box, crop } = this.ph;
    const vw = box.w / crop[2], vh = box.h / crop[3];
    this.app.video(FIRE, { x: box.x - crop[0] * vw, y: box.y - crop[1] * vh, w: vw, h: vh });
    this.applySound();
    if (!this.room) await this.build();
    const tr = new URLSearchParams(location.search).get('trick');     // for trying a trick from the address bar
    if (tr) this.cat.do(tr);
  }
  applySound() {
    const lv = LEVEL[this.o.sound || 'medium'] ?? 0.5;
    this.app.ambient(lv > 0 ? AMBIENCE : null, lv);
    if (this.o.crackle !== false && lv > 0) this.sound.start(lv * 0.4); else this.sound.stop();
  }
  update() { this.applySound(); }
  exit() { this.sound.stop(); this.app.video(null); this.app.ambient(null); }
  act(key, value) {
    if (key !== 'trick') return;
    if (value === 'random') { this.app.setOpt('cat', 'loop'); if (this.cat.away) this.cat.do(this.cat.next()); return; }
    this.cat.do(value);
  }

  async build() {
    const img = await loadImage(this.ph.src);
    const { box } = this.ph;
    const c = canvas(W + 2 * M, H), x = c.getContext('2d');
    x.translate(M, 0);
    x.drawImage(img, 0, 0, W, H);
    // the sides, for wide phones: the picture's own edges mirrored outwards
    const sw = img.width * M / W;
    x.save(); x.scale(-1, 1); x.drawImage(img, 0, 0, sw, img.height, 0, 0, M, H); x.restore();
    x.save(); x.translate(2 * W, 0); x.scale(-1, 1); x.drawImage(img, img.width - sw, 0, sw, img.height, W - M, 0, M, H); x.restore();
    // evening: the picture was taken in daylight, so dim it and let the fire do the lighting
    x.fillStyle = 'rgba(14,7,3,0.5)'; x.fillRect(-M, 0, W + 2 * M, H);
    const cx = box.x + box.w / 2, cy = box.y + box.h * 0.7;
    const vg = x.createRadialGradient(cx, cy, 200, cx, cy, 1250);
    vg.addColorStop(0, 'rgba(8,4,2,0)'); vg.addColorStop(1, 'rgba(8,4,2,0.6)');
    x.fillStyle = vg; x.fillRect(-M, 0, W + 2 * M, H);
    // open the firebox with a soft edge, so the footage fades into the photo's own brick
    x.globalCompositeOperation = 'destination-out';
    const F = 90, N = 30;
    for (let i = 0; i < N; i++) {
      const d = F * i / N;
      x.fillStyle = `rgba(0,0,0,${i === N - 1 ? 1 : 0.1})`;
      x.beginPath(); x.roundRect(box.x + d, box.y + d, box.w - 2 * d, box.h - 2 * d, 30); x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    this.room = c;
    // firelight: a warm pool that the draw loop brightens and dims
    const g = this.glow = canvas((W + 2 * M) / 2, 540), z = g.getContext('2d');
    z.translate(M / 2, 0);
    const gx = cx / 2, gy = cy / 2;
    const rg = z.createRadialGradient(gx, gy, 30, gx, gy, 620);
    rg.addColorStop(0, 'rgba(255,140,50,0.5)'); rg.addColorStop(0.45, 'rgba(255,115,38,0.34)'); rg.addColorStop(1, 'rgba(255,100,30,0)');
    z.fillStyle = rg; z.fillRect(-M / 2, 0, (W + 2 * M) / 2, 540);
    // keep the glow off the fire itself
    z.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 12; i++) { const d = i * 3 - 12; z.fillStyle = 'rgba(0,0,0,0.2)'; z.beginPath(); z.roundRect(box.x / 2 + d, box.y / 2 + d, box.w / 2 - 2 * d, box.h / 2 - 2 * d, 12); z.fill(); }
  }

  draw(ctx, t, dt) {
    if (!this.room) return;
    ctx.drawImage(this.room, -M, 0);
    const fl = 0.62 + 0.5 * fbm1(t * 2.3) + 0.1 * Math.sin(t * 13.7) * fbm1(t * 0.7 + 9);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, Math.min(1, fl * 0.8));
    ctx.drawImage(this.glow, -M, 0, W + 2 * M, H);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    this.cat.draw(ctx, t, dt);
  }

  async thumb(ctx, w, h) {
    const img = await loadImage(this.ph.src).catch(() => null);
    if (img) ctx.drawImage(img, 0, 0, w, h);
    const { box } = this.ph, k = w / W;
    const g = ctx.createRadialGradient((box.x + box.w / 2) * k, (box.y + box.h * 0.75) * k, 1, (box.x + box.w / 2) * k, (box.y + box.h * 0.7) * k, box.w * 0.4 * k);
    g.addColorStop(0, '#ffd27a'); g.addColorStop(0.5, 'rgba(232,112,42,0.9)'); g.addColorStop(1, 'rgba(26,11,5,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
}
