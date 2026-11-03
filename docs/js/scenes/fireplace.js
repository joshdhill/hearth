// Fireplace scenes: a real 4K loop, procedural crackle, optional garland lights and the cat.
import { W, H, canvas, seeded, rgb, hex, lerp } from '../util.js';
import { FireSound } from '../audio/fire.js';
import { Cat } from '../overlays/cat.js';

const REL = 'https://github.com/joshdhill/hearth/releases/download/media-v2/';
// The TV plays the 4K, 10-bit files from the release. Browsers and iPhones stream a 1080p
// copy from the site itself as HLS, in small pieces (release files aren't served as video).
const SITE = new URL('../../media/', import.meta.url).href;
const fire = (key, name) => ({
  name, tv: REL + key + '-4k.mp4', hls: SITE + 'fire/' + key + '/index.m3u8', poster: SITE + 'fire/' + key + '/poster.jpg'
});
// Each is a 5-6 minute seamless loop re-cut from one free 4K clip (Pixabay).
export const FIRES = {
  brick: fire('brick', 'Brick fireplace'),
  logs: fire('logs', 'Roaring logs'),
  roaring: fire('roaring', 'Hearth with grate'),
  stove: fire('stove', 'Wood stove')
};
const LEVEL = { off: 0, low: 0.25, medium: 0.5, high: 0.85 };
// a real fireplace recording (CC0, "Fireplace sound loop" by PagDev) under the generated crackles
export const AMBIENCE = SITE + 'fire-ambience.m4a';

export class FireplaceScene {
  constructor(app, preset) {
    this.app = app; this.p = preset;
    this.sound = new FireSound();
    this.transparent = true;    // the page shows the video behind the canvas
  }
  get o() { return this.p.opts; }

  async enter() {
    this.cat = new Cat({ ground: H - 26, x0: 0, x1: W, scale: 1.25, mode: () => this.o.cat, rim: 'rgba(255,150,60,0.55)' });
    this.play();
    this.applySound();
  }

  play() {
    const f = FIRES[this.o.fire] || FIRES.brick;
    if (this.playing === f) return;
    this.playing = f;
    this.app.video(f);
  }

  applySound() {
    const lv = LEVEL[this.o.sound || 'medium'] ?? 0.5;
    this.app.ambient(lv > 0 ? AMBIENCE : null, lv);              // recorded fire, looping
    if (this.o.crackle !== false && lv > 0) this.sound.start(lv * 0.4); else this.sound.stop();
  }

  update() { this.play(); this.applySound(); this.garland = null; }

  exit() { this.sound.stop(); this.app.video(null); this.app.ambient(null); }

  draw(ctx, t, dt) {
    ctx.clearRect(0, 0, W, H);
    // soft vignette so overlays sit well on any frame
    if (!this.vig) {
      this.vig = canvas(W, H);
      const v = this.vig.getContext('2d'), g = v.createRadialGradient(W / 2, H * 0.55, H * 0.4, W / 2, H * 0.5, H * 1.05);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
      v.fillStyle = g; v.fillRect(0, 0, W, H);
    }
    ctx.drawImage(this.vig, 0, 0);
    const lights = this.o.lights === true || (this.o.lights !== false && this.p.decor === 'christmas');
    if (lights) this.drawGarland(ctx, t);
    this.cat.draw(ctx, t, dt);
  }

  // an evergreen swag with warm lights across the top of the screen
  drawGarland(ctx, t) {
    if (!this.garland) {
      const c = canvas(W, 260), x = c.getContext('2d'), r = seeded(19);
      this.bulbs = [];
      const swags = 4, sw = W / swags;
      for (let s = 0; s < swags; s++) {
        const x0 = s * sw, x1 = x0 + sw;
        for (let i = 0; i <= 120; i++) {
          const u = i / 120, px = lerp(x0, x1, u), py = 34 + Math.sin(u * Math.PI) * 110;
          for (let k = 0; k < 7; k++) {
            const a = r() * Math.PI * 2, len = 18 + r() * 26;
            x.strokeStyle = rgb(hex(r() < 0.5 ? '#1f3a26' : '#2d4d33')); x.lineWidth = 2.2;
            x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len * 0.7); x.stroke();
          }
          if (i % 12 === 6) this.bulbs.push({ x: px, y: py + 14, ph: r() * 7, sp: 0.4 + r() * 0.8, c: ['#ffd9a0', '#ffcf8a', '#ffe6c2'][i % 3] });
        }
        // a bow where the swags meet
        if (s > 0) { x.fillStyle = '#7a1f1f'; x.beginPath(); x.ellipse(x0 - 16, 38, 18, 12, -0.5, 0, 7); x.ellipse(x0 + 16, 38, 18, 12, 0.5, 0, 7); x.fill(); }
      }
      this.garland = c;
      this.glow = canvas(90, 90);
      const g = this.glow.getContext('2d'), rg = g.createRadialGradient(45, 45, 2, 45, 45, 45);
      rg.addColorStop(0, 'rgba(255,214,150,0.9)'); rg.addColorStop(0.3, 'rgba(255,190,110,0.4)'); rg.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 90, 90);
    }
    ctx.drawImage(this.garland, 0, -6);
    for (const b of this.bulbs) {
      const k = 0.7 + 0.3 * Math.sin(t * b.sp + b.ph);
      ctx.globalAlpha = k; ctx.drawImage(this.glow, b.x - 45, b.y - 45);
      ctx.fillStyle = b.c; ctx.beginPath(); ctx.ellipse(b.x, b.y, 5, 7.5, 0, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  thumb(ctx, w, h, img) {
    if (img) ctx.drawImage(img, 0, 0, w, h);
    else { ctx.fillStyle = '#2a1408'; ctx.fillRect(0, 0, w, h); }
  }
}
