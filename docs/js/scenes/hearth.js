// Fireside: a painted room with a mantel, real fire footage inside the firebox, and the house cat.
import { W, H, canvas, seeded, rgb, hex, mix, shade, lerp, fbm1 } from '../util.js';
import { pumpkin, candleBody, flame, grain } from '../paint.js';
import { FireSound } from '../audio/fire.js';
import { HouseCat } from '../overlays/housecat.js';
import { AMBIENCE } from './fireplace.js';

const REL = 'https://github.com/joshdhill/hearth/releases/download/media-v2/';
const SITE = new URL('../../media/', import.meta.url).href;
// crop: the part of the footage that fills the firebox, as fractions of the frame [x, y, w, h]
const FIRE = {
  tv: REL + 'ember-4k.mp4', hls: SITE + 'fire/ember/index.m3u8', poster: SITE + 'fire/ember/poster.jpg',
  crop: [0.19, 0.208, 0.56, 0.792]
};
const LEVEL = { off: 0, low: 0.25, medium: 0.5, high: 0.85 };

// layout, in the 1920x1080 design space
const BOX = { x: 740, y: 540, w: 440, h: 350 };           // firebox opening
const SHELF = { x0: 500, x1: 1420, y: 352, h: 50 };       // mantel shelf (top surface at y)
const SUR = { x0: 560, x1: 1360, y0: 402, y1: 890 };      // the surround
const FLOOR = 930;                                         // where the wall meets the floor
const CAT = { floor: 1030, floorScale: 1.28, shelf: SHELF.y + 2, shelfScale: 0.8, shelfX: [SHELF.x0 + 20, SHELF.x1 - 20],
  jumpL: 330, jumpR: 1590, fireL: 560, fireR: 1360, x0: 0, x1: W };

const STYLES = {
  brick: { wall: '#73604f', trim: '#d9cdb8', floor: '#4b301d', rug: '#6a2a25', rug2: '#c7a567' },
  stone: { wall: '#5f6258', trim: '#cfc8b6', floor: '#3f2c1c', rug: '#2f4a44', rug2: '#c9b27a' },
  white: { wall: '#6f7c78', trim: '#ece6d8', floor: '#5a3a22', rug: '#33405e', rug2: '#d1b98a' }
};

export function decorFor(v, d = new Date()) {
  if (v && v !== 'auto') return v;
  const m = d.getMonth(), day = d.getDate();
  if (m === 11 || (m === 10 && day > 26)) return 'christmas';
  if (m === 9 || m === 10 || (m === 8 && day > 20)) return 'autumn';
  return 'everyday';
}

function openingPath(x, style) {
  const { x: bx, y: by, w, h } = BOX;
  x.beginPath();
  if (style === 'white') { x.rect(bx, by, w, h); return; }
  x.moveTo(bx, by + h); x.lineTo(bx, by + 90);
  x.ellipse(bx + w / 2, by + 90, w / 2, 90, 0, Math.PI, 0);
  x.lineTo(bx + w, by + h); x.closePath();
}

export class HearthScene {
  constructor(app, preset) {
    this.app = app; this.p = preset;
    this.sound = new FireSound();
    this.transparent = true;
    this.cat = new HouseCat(CAT, { mode: () => this.o.cat, coat: () => this.o.catColor || 'black', rim: 'rgba(255,150,70,0.5)' });
  }
  get o() { return this.p.opts; }

  async enter() {
    this.build();
    const [cx, cy, cw, ch] = FIRE.crop;
    const vw = BOX.w / cw, vh = BOX.h / ch;
    this.app.video(FIRE, { x: BOX.x - cx * vw, y: BOX.y - cy * vh, w: vw, h: vh });
    this.applySound();
    const tr = new URLSearchParams(location.search).get('trick');     // for trying a trick from the address bar
    if (tr) this.cat.do(tr);
  }
  applySound() {
    const lv = LEVEL[this.o.sound || 'medium'] ?? 0.5;
    this.app.ambient(lv > 0 ? AMBIENCE : null, lv);
    if (this.o.crackle !== false && lv > 0) this.sound.start(lv * 0.4); else this.sound.stop();
  }
  update() { this.build(); this.applySound(); }
  exit() { this.sound.stop(); this.app.video(null); this.app.ambient(null); }
  act(key, value) { if (key === 'trick') this.cat.do(value); }

  // ---- the still parts of the room, painted once per setting -------------------------------------
  build() {
    const style = STYLES[this.o.style] ? this.o.style : 'brick', decor = decorFor(this.o.decor), lights = !!this.o.lights;
    const sig = [style, decor, lights].join();
    if (sig === this.sig) return;
    this.sig = sig; this.style = style; this.decor = decor;
    const st = STYLES[style];
    const c = this.room = canvas(W, H), x = c.getContext('2d'), r = seeded(41);
    this.flames = []; this.bulbs = [];

    // wall
    const wg = x.createLinearGradient(0, 0, 0, FLOOR);
    wg.addColorStop(0, rgb(shade(hex(st.wall), -0.3))); wg.addColorStop(0.55, st.wall); wg.addColorStop(1, rgb(shade(hex(st.wall), -0.12)));
    x.fillStyle = wg; x.fillRect(0, 0, W, FLOOR);
    if (style === 'white') {            // panelled lower wall
      x.fillStyle = rgb(shade(hex(st.trim), -0.22)); x.fillRect(0, 640, W, FLOOR - 640);
      x.fillStyle = rgb(shade(hex(st.trim), -0.08)); x.fillRect(0, 632, W, 14);
      x.strokeStyle = 'rgba(0,0,0,0.16)'; x.lineWidth = 3;
      for (let px = 40; px < W; px += 230) x.strokeRect(px, 676, 190, 196);
    }
    // floor boards, wider toward the viewer
    x.fillStyle = st.floor; x.fillRect(0, FLOOR, W, H - FLOOR);
    let fy = FLOOR;
    for (let i = 0; fy < H; i++) {
      const bh = 16 + i * 9;
      x.fillStyle = rgb(shade(hex(st.floor), (r() - 0.5) * 0.16)); x.fillRect(0, fy, W, bh);
      x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(0, fy, W, 2);
      for (let k = 0; k < 5; k++) { const jx = r() * W; x.fillRect(jx, fy, 2, bh); }
      fy += bh;
    }
    // skirting board
    x.fillStyle = rgb(shade(hex(st.trim), -0.18)); x.fillRect(0, FLOOR - 34, W, 34);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, FLOOR - 3, W, 5);
    // rug
    x.fillStyle = st.rug;
    x.beginPath(); x.moveTo(430, 978); x.lineTo(1490, 978); x.lineTo(1640, H); x.lineTo(280, H); x.closePath(); x.fill();
    x.strokeStyle = st.rug2; x.lineWidth = 5;
    x.beginPath(); x.moveTo(452, 990); x.lineTo(1468, 990); x.lineTo(1600, H + 10); x.moveTo(452, 990); x.lineTo(320, H + 10); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.moveTo(476, 1002); x.lineTo(1444, 1002); x.stroke();

    this.paintFireplace(x, style, st, r);
    this.paintDecor(x, decor, lights, st, r);

    // paint grain over everything, then cut the firebox out so the fire shows through
    x.globalAlpha = 0.07; x.globalCompositeOperation = 'overlay';
    x.fillStyle = x.createPattern(grain(), 'repeat'); x.fillRect(0, 0, W, H);
    x.globalAlpha = 1; x.globalCompositeOperation = 'destination-out';
    openingPath(x, style); x.fill();
    x.globalCompositeOperation = 'source-over';

    // the dark inside edges of the firebox, drawn over the footage
    const s = this.inner = canvas(BOX.w, BOX.h), y = s.getContext('2d');
    y.translate(-BOX.x, -BOX.y); openingPath(y, style); y.clip();
    const edge = (g, stops) => { stops.forEach(([o, a]) => g.addColorStop(o, `rgba(8,4,2,${a})`)); y.fillStyle = g; y.fillRect(BOX.x, BOX.y, BOX.w, BOX.h); };
    edge(y.createLinearGradient(BOX.x, 0, BOX.x + 110, 0), [[0, 0.95], [1, 0]]);
    edge(y.createLinearGradient(BOX.x + BOX.w, 0, BOX.x + BOX.w - 110, 0), [[0, 0.95], [1, 0]]);
    edge(y.createLinearGradient(0, BOX.y, 0, BOX.y + 150), [[0, 1], [1, 0]]);
    edge(y.createLinearGradient(0, BOX.y + BOX.h, 0, BOX.y + BOX.h - 26), [[0, 0.9], [1, 0]]);

    // firelight: a warm pool that the draw loop brightens and dims
    const g = this.glow = canvas(960, 540), z = g.getContext('2d');
    const rg = z.createRadialGradient(480, 400, 20, 480, 400, 470);
    rg.addColorStop(0, 'rgba(255,150,60,0.55)'); rg.addColorStop(0.35, 'rgba(255,120,40,0.22)'); rg.addColorStop(1, 'rgba(255,100,30,0)');
    z.fillStyle = rg; z.fillRect(0, 0, 960, 540);
    const d = this.dark = canvas(960, 540), q = d.getContext('2d');
    const dg = q.createRadialGradient(480, 380, 150, 480, 330, 640);
    dg.addColorStop(0, 'rgba(10,5,2,0)'); dg.addColorStop(1, 'rgba(10,5,2,0.74)');
    q.fillStyle = dg; q.fillRect(0, 0, 960, 540);
  }

  paintFireplace(x, style, st, r) {
    const { x0, x1, y0, y1 } = SUR;
    // shadow the fireplace casts on the wall
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(x0 - 16, y0, x1 - x0 + 32, FLOOR - y0);
    if (style === 'brick' || style === 'stone') {
      x.fillStyle = style === 'brick' ? '#3d2c25' : '#3b3a36'; x.fillRect(x0, y0, x1 - x0, y1 - y0 + 40);
      if (style === 'brick') {
        const bh = 31, bw = 86;
        for (let row = 0, y = y0; y < y1 + 40; row++, y += bh) {
          for (let bx = x0 - (row % 2 ? bw / 2 : 0); bx < x1; bx += bw) {
            const c = mix(hex('#8b4a35'), hex(r() < 0.3 ? '#6e3a2c' : '#a35a3e'), r());
            x.fillStyle = rgb(shade(c, (r() - 0.6) * 0.3));
            const ax = Math.max(bx + 2, x0), aw = Math.min(bx + bw - 2, x1) - ax;
            if (aw > 4) x.fillRect(ax, y + 2, aw, bh - 4);
          }
        }
      } else {
        for (let y = y0; y < y1 + 40;) {
          const sh = 46 + r() * 34;
          for (let bx = x0; bx < x1;) {
            const sw = 80 + r() * 110, c = mix(hex('#8d8779'), hex(r() < 0.4 ? '#6f6a60' : '#a39a86'), r());
            x.fillStyle = rgb(shade(c, (r() - 0.6) * 0.25));
            const aw = Math.min(sw, x1 - bx) - 5;
            x.beginPath(); x.roundRect(bx + 3, y + 3, Math.max(6, aw), Math.min(sh, y1 + 40 - y) - 5, 9); x.fill();
            bx += sw;
          }
          y += sh;
        }
      }
      // the arch ring
      x.save(); openingPath(x, style); x.lineWidth = 34; x.strokeStyle = style === 'brick' ? '#5d3327' : '#59554c'; x.stroke();
      x.lineWidth = 2; x.strokeStyle = 'rgba(0,0,0,0.35)';
      for (let a = 0; a <= 16; a++) {
        const t = Math.PI + (a / 16) * Math.PI, cx = BOX.x + BOX.w / 2, cy = BOX.y + 90;
        x.beginPath(); x.moveTo(cx + Math.cos(t) * (BOX.w / 2 - 17), cy + Math.sin(t) * 73); x.lineTo(cx + Math.cos(t) * (BOX.w / 2 + 17), cy + Math.sin(t) * 107); x.stroke();
      }
      x.restore();
      // mantel: a heavy timber beam on two brackets
      const wood = style === 'brick' ? '#5b3b23' : '#4a3323';
      for (const bx of [x0 + 40, x1 - 80]) { x.fillStyle = rgb(shade(hex(wood), -0.3)); x.beginPath(); x.moveTo(bx, y0); x.lineTo(bx + 40, y0); x.lineTo(bx + 40, y0 + 24); x.lineTo(bx + 20, y0 + 62); x.lineTo(bx, y0 + 62); x.fill(); }
      const mg = x.createLinearGradient(0, SHELF.y, 0, SHELF.y + SHELF.h);
      mg.addColorStop(0, rgb(shade(hex(wood), 0.22))); mg.addColorStop(0.16, wood); mg.addColorStop(1, rgb(shade(hex(wood), -0.35)));
      x.fillStyle = mg; x.fillRect(SHELF.x0, SHELF.y, SHELF.x1 - SHELF.x0, SHELF.h);
      x.strokeStyle = 'rgba(0,0,0,0.2)'; x.lineWidth = 1.5;
      for (let i = 0; i < 9; i++) { const gy = SHELF.y + 8 + i * 5; x.beginPath(); x.moveTo(SHELF.x0, gy); x.bezierCurveTo(800, gy + r() * 8 - 4, 1100, gy + r() * 8 - 4, SHELF.x1, gy + r() * 6 - 3); x.stroke(); }
    } else {
      // painted wood surround with pilasters and a dark tile slip
      const t = hex(st.trim);
      x.fillStyle = rgb(shade(t, -0.1)); x.fillRect(x0, y0, x1 - x0, y1 - y0 + 40);
      x.fillStyle = '#262d2b'; x.fillRect(BOX.x - 56, BOX.y - 56, BOX.w + 112, BOX.h + 56);
      x.strokeStyle = 'rgba(255,255,255,0.07)'; x.lineWidth = 2;
      for (let tx = BOX.x - 56; tx <= BOX.x + BOX.w + 56; tx += 56) { x.beginPath(); x.moveTo(tx, BOX.y - 56); x.lineTo(tx, BOX.y + BOX.h); x.stroke(); }
      for (let ty = BOX.y - 56; ty <= BOX.y + BOX.h; ty += 56) { x.beginPath(); x.moveTo(BOX.x - 56, ty); x.lineTo(BOX.x + BOX.w + 56, ty); x.stroke(); }
      for (const px of [x0, x1 - 104]) {
        const pg = x.createLinearGradient(px, 0, px + 104, 0);
        pg.addColorStop(0, rgb(shade(t, -0.2))); pg.addColorStop(0.3, rgb(t)); pg.addColorStop(1, rgb(shade(t, -0.25)));
        x.fillStyle = pg; x.fillRect(px, y0 + 70, 104, y1 - y0 - 30);
        x.strokeStyle = 'rgba(0,0,0,0.13)'; x.lineWidth = 3; x.strokeRect(px + 22, y0 + 100, 60, y1 - y0 - 110);
      }
      x.fillStyle = rgb(shade(t, -0.04)); x.fillRect(x0, y0, x1 - x0, 76);
      x.strokeStyle = 'rgba(0,0,0,0.13)'; x.lineWidth = 3; x.strokeRect(x0 + 130, y0 + 18, x1 - x0 - 260, 40);
      x.fillStyle = rgb(shade(t, -0.16)); x.fillRect(x0 - 16, y0 - 2, x1 - x0 + 32, 16);
      const mg = x.createLinearGradient(0, SHELF.y, 0, SHELF.y + SHELF.h);
      mg.addColorStop(0, rgb(shade(t, 0.1))); mg.addColorStop(0.25, rgb(t)); mg.addColorStop(1, rgb(shade(t, -0.28)));
      x.fillStyle = mg; x.fillRect(SHELF.x0, SHELF.y, SHELF.x1 - SHELF.x0, SHELF.h);
    }
    // shadow under the shelf, hearth slab
    const ug = x.createLinearGradient(0, SHELF.y + SHELF.h, 0, SHELF.y + SHELF.h + 60);
    ug.addColorStop(0, 'rgba(0,0,0,0.5)'); ug.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = ug; x.fillRect(x0, SHELF.y + SHELF.h, x1 - x0, 60);
    const slab = style === 'brick' ? '#7a5547' : style === 'stone' ? '#77726a' : '#3a4240';
    x.fillStyle = rgb(shade(hex(slab), 0.08));
    x.beginPath(); x.moveTo(x0 - 30, y1); x.lineTo(x1 + 30, y1); x.lineTo(x1 + 78, 956); x.lineTo(x0 - 78, 956); x.closePath(); x.fill();
    x.fillStyle = rgb(shade(hex(slab), -0.35)); x.fillRect(x0 - 78, 956, x1 - x0 + 156, 22);
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(x0 - 78, 978, x1 - x0 + 156, 8);
    // log basket and fire irons
    const bx = 1560, by = 968;
    for (let i = 0; i < 7; i++) {
      const lx = bx + 26 + (i % 4) * 44 + (i > 3 ? 22 : 0), ly = by - 96 - (i > 3 ? 40 : 0);
      x.fillStyle = '#5a3d27'; x.beginPath(); x.ellipse(lx, ly, 25, 25, 0, 0, 7); x.fill();
      x.fillStyle = '#c9a877'; x.beginPath(); x.ellipse(lx, ly, 18, 18, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(90,60,30,0.5)'; x.lineWidth = 1.5; x.beginPath(); x.ellipse(lx, ly, 9, 9, 0, 0, 7); x.stroke();
    }
    const kg = x.createLinearGradient(bx, 0, bx + 200, 0);
    kg.addColorStop(0, '#6d4f2f'); kg.addColorStop(0.5, '#9b7646'); kg.addColorStop(1, '#5a4026');
    x.fillStyle = kg; x.beginPath(); x.moveTo(bx - 6, by - 90); x.lineTo(bx + 206, by - 90); x.lineTo(bx + 186, by); x.lineTo(bx + 14, by); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 2;
    for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(bx, by - 90 + i * 15); x.lineTo(bx + 200, by - 90 + i * 15); x.stroke(); }
    x.strokeStyle = '#1b1a19'; x.lineCap = 'round';
    x.lineWidth = 7; x.beginPath(); x.moveTo(428, 966); x.lineTo(428, 770); x.stroke();
    x.lineWidth = 5; for (const dx of [-22, 22]) { x.beginPath(); x.moveTo(428 + dx, 960); x.lineTo(428 + dx * 0.5, 790); x.stroke(); }
    x.fillStyle = '#1b1a19'; x.beginPath(); x.ellipse(428, 968, 44, 8, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(428, 764, 9, 9, 0, 0, 7); x.fill();
  }

  paintDecor(x, decor, lights, st, r) {
    const top = SHELF.y;
    // over the mantel: a wreath at Christmas, otherwise a framed landscape
    if (decor === 'christmas') {
      for (let i = 0; i < 520; i++) {
        const a = r() * Math.PI * 2, rad = 92 + (r() - 0.5) * 44, px = 960 + Math.cos(a) * rad, py = 196 + Math.sin(a) * rad, l = 16 + r() * 16, b = a + (r() - 0.5) * 1.6;
        x.strokeStyle = rgb(hex(r() < 0.5 ? '#1f4a2c' : '#2d6238')); x.lineWidth = 3;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(b) * l, py + Math.sin(b) * l); x.stroke();
      }
      for (let i = 0; i < 9; i++) { const a = i * 0.7 + 0.3; x.fillStyle = '#b3262a'; x.beginPath(); x.arc(960 + Math.cos(a) * 92, 196 + Math.sin(a) * 92, 7, 0, 7); x.fill(); }
      x.fillStyle = '#a81f24'; x.beginPath(); x.ellipse(932, 296, 30, 17, -0.4, 0, 7); x.ellipse(988, 296, 30, 17, 0.4, 0, 7); x.fill();
      x.fillRect(950, 286, 20, 20); x.beginPath(); x.moveTo(952, 300); x.lineTo(934, 340); x.lineTo(954, 334); x.lineTo(960, 304); x.lineTo(966, 334); x.lineTo(986, 340); x.lineTo(968, 300); x.fill();
    } else {
      const fx = 760, fy = 96, fw = 400, fh = 218;
      x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(fx - 14, fy - 8, fw + 40, fh + 40);
      x.fillStyle = '#8a6a34'; x.fillRect(fx - 20, fy - 20, fw + 40, fh + 40);
      x.strokeStyle = '#c4a15a'; x.lineWidth = 4; x.strokeRect(fx - 12, fy - 12, fw + 24, fh + 24);
      const fall = decor === 'autumn';
      const sg = x.createLinearGradient(0, fy, 0, fy + fh);
      sg.addColorStop(0, fall ? '#c98f52' : '#8fb0c4'); sg.addColorStop(1, fall ? '#f0d09a' : '#e6dcc0');
      x.save(); x.beginPath(); x.rect(fx, fy, fw, fh); x.clip();
      x.fillStyle = sg; x.fillRect(fx, fy, fw, fh);
      const hills = fall ? ['#8a5a32', '#a8502a', '#6e3f22'] : ['#7f9a86', '#5f8468', '#3f6249'];
      hills.forEach((col, i) => {
        x.fillStyle = col; x.beginPath(); x.moveTo(fx, fy + fh);
        for (let px = 0; px <= fw; px += 20) x.lineTo(fx + px, fy + 104 + i * 34 + Math.sin(px * 0.012 * (i + 1) + i * 2) * (26 - i * 6));
        x.lineTo(fx + fw, fy + fh); x.fill();
      });
      x.fillStyle = 'rgba(255,240,200,0.75)'; x.beginPath(); x.arc(fx + 290, fy + 62, 20, 0, 7); x.fill();
      x.restore();
    }
    const lit = [255, 226, 196];
    const candle = (cx, h, w = 22, col) => { candleBody(x, cx, top, w, h, lit, col); this.flames.push({ x: cx, y: top - h - 2, s: 9 }); };
    if (decor === 'christmas') {
      // evergreen garland along the shelf, with stockings below it
      const pts = [];
      for (let i = 0; i <= 150; i++) {
        const u = i / 150, px = lerp(SHELF.x0 + 10, SHELF.x1 - 10, u), sw = Math.abs(Math.sin(u * Math.PI * 3)) * 34, py = top + 22 + sw;
        pts.push([px, py]);
        for (let k = 0; k < 6; k++) { const a = r() * 7, l = 16 + r() * 22; x.strokeStyle = rgb(hex(r() < 0.5 ? '#1f4a2c' : '#2b5c36')); x.lineWidth = 3; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l * 0.8); x.stroke(); }
        if (i % 9 === 4) this.bulbs.push({ x: px, y: py + 8, ph: r() * 7, sp: 0.5 + r(), c: ['#ffd9a0', '#ff8f7a', '#a9e0a0', '#ffe6c2'][(i / 9 | 0) % 4] });
      }
      [[650, '#a3262a'], [800, '#2d5c3a'], [1120, '#a3262a'], [1270, '#2d5c3a']].forEach(([sx, col]) => {
        x.fillStyle = col; x.beginPath(); x.moveTo(sx - 22, top + 70); x.lineTo(sx + 22, top + 70); x.lineTo(sx + 22, top + 150);
        x.quadraticCurveTo(sx + 24, top + 186, sx - 22, top + 190); x.quadraticCurveTo(sx - 62, top + 190, sx - 60, top + 166); x.quadraticCurveTo(sx - 58, top + 148, sx - 22, top + 146); x.closePath(); x.fill();
        x.fillStyle = '#efe7d8'; x.beginPath(); x.roundRect(sx - 27, top + 56, 54, 26, 8); x.fill();
      });
      candle(586, 74, 22, '#b03030'); candle(1334, 74, 22, '#b03030');
      this.paintTree(x, r);
    } else if (decor === 'autumn') {
      pumpkin(x, 600, top, 46, '#d9772b', lit); pumpkin(x, 676, top, 30, '#e6dcc4', lit, '#6f6a3e'); pumpkin(x, 1330, top, 40, '#c9612a', lit, '#5f5a2e', 0.8);
      candle(1244, 86); candle(1206, 58); candle(742, 66);
      for (let i = 0; i < 26; i++) { const lx = lerp(770, 1180, r()), col = ['#b5522a', '#d08a2e', '#8f3d24', '#c9a03a'][i % 4]; x.fillStyle = col; x.save(); x.translate(lx, top - 5 - r() * 3); x.rotate(r() * 3); x.beginPath(); x.ellipse(0, 0, 13, 6, 0, 0, 7); x.fill(); x.restore(); }
    } else {
      candle(590, 96); candle(630, 64); candle(1290, 78);
      // a clock, a stack of books and a plant
      x.fillStyle = '#3a2a1e'; x.beginPath(); x.roundRect(1140, top - 96, 82, 96, [40, 40, 4, 4]); x.fill();
      x.fillStyle = '#e9dfc8'; x.beginPath(); x.arc(1181, top - 54, 28, 0, 7); x.fill();
      x.strokeStyle = '#2a1f17'; x.lineWidth = 3; x.beginPath(); x.moveTo(1181, top - 54); x.lineTo(1181, top - 74); x.moveTo(1181, top - 54); x.lineTo(1194, top - 48); x.stroke();
      [['#7a3b34', 96, 18], ['#3d5a4e', 84, 16], ['#b59a5c', 90, 14]].reduce((y, [col, w, h]) => { x.fillStyle = col; x.fillRect(700 + (96 - w) / 2, y - h, w, h); return y - h; }, top);
      x.fillStyle = '#b9a58a'; x.beginPath(); x.moveTo(1354, top); x.lineTo(1400, top); x.lineTo(1408, top - 46); x.lineTo(1346, top - 46); x.fill();
      for (let i = 0; i < 16; i++) { const a = -Math.PI / 2 + (r() - 0.5) * 2.2, l = 40 + r() * 56; x.strokeStyle = rgb(hex(r() < 0.5 ? '#3f6a48' : '#57845a')); x.lineWidth = 5; x.lineCap = 'round'; x.beginPath(); x.moveTo(1377, top - 46); x.quadraticCurveTo(1377 + Math.cos(a) * l * 0.5, top - 46 - l * 0.7, 1377 + Math.cos(a) * l, top - 46 + Math.sin(a) * l); x.stroke(); }
    }
    if (lights && decor !== 'christmas') {
      x.strokeStyle = 'rgba(30,25,20,0.8)'; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i <= 120; i++) {
        const u = i / 120, px = lerp(SHELF.x0 + 14, SHELF.x1 - 14, u), py = top + SHELF.h + 6 + Math.abs(Math.sin(u * Math.PI * 4)) * 30;
        if (i) x.lineTo(px, py); else x.moveTo(px, py);
        if (i % 6 === 3) this.bulbs.push({ x: px, y: py + 6, ph: r() * 7, sp: 0.4 + r() * 0.8, c: '#ffd9a0' });
      }
      x.stroke();
    }
  }

  paintTree(x, r) {
    const tx = 190, base = 990;
    x.fillStyle = '#3a2a1c'; x.fillRect(tx - 14, base - 60, 28, 60);
    x.fillStyle = '#7a2b2b'; x.beginPath(); x.moveTo(tx - 50, base - 30); x.lineTo(tx + 50, base - 30); x.lineTo(tx + 40, base + 14); x.lineTo(tx - 40, base + 14); x.fill();
    for (let tier = 0; tier < 6; tier++) {
      const ty = base - 60 - tier * 104, hw = 232 - tier * 34;
      for (let i = 0; i < 300; i++) {
        const u = r(), px = tx + (r() - 0.5) * 2 * hw * (1 - u * 0.8), py = ty - u * 150, a = Math.PI / 2 + (r() - 0.5) * 1.8, l = 18 + r() * 26;
        x.strokeStyle = rgb(shade(hex(r() < 0.5 ? '#1d4429' : '#2a5a35'), -u * 0.1)); x.lineWidth = 4;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l * (px < tx ? -1 : 1) * 0.6, py + Math.sin(a) * l * 0.6); x.stroke();
      }
      for (let i = 0; i < 7 - tier; i++) {
        const px = tx + (r() - 0.5) * 1.7 * hw * 0.8, py = ty - 20 - r() * 100;
        x.fillStyle = ['#c23a35', '#d6b24c', '#3f7fa8', '#e9e2d0'][i % 4]; x.beginPath(); x.arc(px, py, 9, 0, 7); x.fill();
        this.bulbs.push({ x: px + (r() - 0.5) * 80, y: py + (r() - 0.5) * 50, ph: r() * 7, sp: 0.5 + r(), c: ['#ffd9a0', '#ff9a86', '#b6e6ad'][i % 3] });
      }
    }
    x.fillStyle = '#f0cf6a'; x.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 11 : 26; x.lineTo(tx + Math.cos(a) * rr, base - 716 + Math.sin(a) * rr); }
    x.fill();
    [[60, '#2f5f8a', 84, 60], [330, '#a3262a', 70, 50], [286, '#d8c9a0', 54, 74]].forEach(([px, col, w, h]) => {
      x.fillStyle = col; x.fillRect(px, base + 20 - h, w, h);
      x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillRect(px + w / 2 - 5, base + 20 - h, 10, h); x.fillRect(px, base + 20 - h / 2 - 5, w, 10);
    });
  }

  // ---- every frame --------------------------------------------------------------------------------
  draw(ctx, t, dt) {
    if (!this.room) return;
    ctx.drawImage(this.inner, BOX.x, BOX.y);
    ctx.drawImage(this.room, 0, 0);
    // the room is lit by the fire: darken the corners, then add a glow that breathes with the flames
    ctx.drawImage(this.dark, 0, 0, W, H);
    const fl = 0.62 + 0.5 * fbm1(t * 2.3) + 0.1 * Math.sin(t * 13.7) * fbm1(t * 0.7 + 9);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, Math.min(1, fl * 0.62));
    ctx.drawImage(this.glow, -200, 60, W + 400, H + 160);
    ctx.globalAlpha = 1;
    for (const b of this.bulbs) {
      const k = 0.65 + 0.35 * Math.sin(t * b.sp + b.ph);
      const g = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, 34);
      g.addColorStop(0, `rgba(255,205,140,${0.5 * k})`); g.addColorStop(1, 'rgba(255,180,100,0)');
      ctx.fillStyle = g; ctx.fillRect(b.x - 34, b.y - 34, 68, 68);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const b of this.bulbs) { ctx.fillStyle = b.c; ctx.beginPath(); ctx.ellipse(b.x, b.y, 4.5, 6.5, 0, 0, 7); ctx.fill(); }
    this.flames.forEach((f, i) => flame(ctx, f.x, f.y, f.s, t, i * 2.1));
    this.cat.draw(ctx, t, dt);
  }

  thumb(ctx, w, h) {
    this.build();
    const g = ctx.createRadialGradient(w / 2, h * 0.75, 2, w / 2, h * 0.7, w * 0.16);
    g.addColorStop(0, '#ffd27a'); g.addColorStop(0.5, '#e8702a'); g.addColorStop(1, '#1a0b05');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.room, 0, 0, w, h);
    ctx.drawImage(this.dark, 0, 0, w, h);
  }
}
