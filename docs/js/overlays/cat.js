// A cat that wanders across now and then. Sometimes it sits down to look out of the window.
import { rand, clamp, lerp, easeInOut } from '../util.js';

const MODES = { off: 0, sometimes: [240, 540], often: [70, 170] };

export class Cat {
  constructor({ ground, x0, x1, scale = 1, mode, rim = null, sitView = 'back' }) {
    this.ground = ground; this.x0 = x0; this.x1 = x1; this.s = scale;
    this.mode = mode; this.rim = rim; this.sitView = sitView;
    this.state = 'away';
    this.wait = /catnow/.test(location.search) ? 0.5 : rand(20, 50);
    this.x = 0; this.dir = 1; this.ph = 0; this.tail = 0; this.blend = 0;
  }

  draw(ctx, t, dt) {
    const m = this.mode ? this.mode() : 'off';
    if (!m || m === 'off') { this.state = 'away'; return; }
    const span = MODES[m] || MODES.sometimes;
    const speed = 92 * this.s;
    switch (this.state) {
      case 'away':
        this.wait -= dt;
        if (this.wait <= 0) {
          this.dir = Math.random() < 0.5 ? 1 : -1;
          this.x = this.dir > 0 ? this.x0 - 320 * this.s : this.x1 + 320 * this.s;
          this.sitAt = Math.random() < 0.55 ? rand(lerp(this.x0, this.x1, 0.3), lerp(this.x0, this.x1, 0.7)) : null;
          this.state = 'walk';
        }
        return;
      case 'walk':
        this.x += this.dir * speed * dt;
        this.ph += dt * 2.4;
        if (this.sitAt != null && Math.abs(this.x - this.sitAt) < speed * dt * 1.5) { this.state = 'sitting'; this.blend = 0; this.sitFor = rand(14, 40); this.sitAt = null; }
        if ((this.dir > 0 && this.x > this.x1 + 340 * this.s) || (this.dir < 0 && this.x < this.x0 - 340 * this.s)) {
          this.state = 'away'; this.wait = rand(span[0], span[1]);
        }
        break;
      case 'sitting':
        this.blend = Math.min(1, this.blend + dt / 0.7);
        this.sitFor -= dt;
        if (this.sitFor <= 0) this.state = 'standing';
        break;
      case 'standing':
        this.blend = Math.max(0, this.blend - dt / 0.6);
        if (this.blend <= 0) this.state = 'walk';
        break;
    }
    this.tail += dt;
    const b = easeInOut(this.blend);
    ctx.save();
    ctx.translate(this.x, this.ground);
    ctx.scale(this.s, this.s);
    // soft contact shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 2, 120 * (1 - b * 0.45), 10, 0, 0, 7); ctx.fill();
    if (b < 1) { ctx.globalAlpha = 1 - b; this.walker(ctx, t); }
    if (b > 0) { ctx.globalAlpha = b; this.sitter(ctx, t); }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  body(ctx, fill, path) {
    if (this.rim) { ctx.save(); ctx.translate(0, -2.5); ctx.fillStyle = this.rim; ctx.strokeStyle = this.rim; path(); ctx.restore(); }
    ctx.fillStyle = fill; ctx.strokeStyle = fill; path();
  }

  walker(ctx, t) {
    const d = this.dir;
    const ph = this.ph * Math.PI * 2 / 2.4 * 1.0;
    ctx.save(); ctx.scale(d, 1);
    const draw = () => {
      // legs: far pair first (drawn with the same fill so they read as one silhouette)
      const leg = (hipX, hipY, upper, lower, off, front, w) => {
        const a = ph + off * Math.PI * 2;
        const footX = hipX + Math.sin(a) * 34;
        const lift = Math.max(0, Math.cos(a)) * 16;
        const footY = -lift;
        const kx = ik(hipX, hipY, footX, footY, upper, lower, front ? -1 : 1);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kx[0], kx[1]); ctx.stroke();
        ctx.lineWidth = w * 0.62; ctx.beginPath(); ctx.moveTo(kx[0], kx[1]); ctx.lineTo(footX, footY - 3); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(footX + 4, footY - 4, 9, 5, 0, 0, 7); ctx.fill();
      };
      leg(62, -80, 46, 42, 0.25, true, 19);
      leg(-70, -84, 46, 46, 0.75, false, 27);
      // tail
      const sw = Math.sin(this.tail * 1.6) * 0.18;
      ctx.lineCap = 'round'; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(-88, -96);
      ctx.bezierCurveTo(-150, -110 + sw * 40, -170, -160 + sw * 60, -150 + sw * 40, -205 + sw * 30);
      ctx.stroke();
      // torso: deep chest, round rump
      const bob = Math.sin(ph * 2) * 2.5;
      ctx.beginPath();
      ctx.moveTo(94, -104 + bob);
      ctx.bezierCurveTo(62, -130 + bob, -28, -124 + bob, -74, -121 + bob);
      ctx.bezierCurveTo(-120, -117 + bob, -122, -54 + bob, -82, -50 + bob);
      ctx.bezierCurveTo(-40, -40 + bob, 36, -42 + bob, 72, -50 + bob);
      ctx.bezierCurveTo(106, -56 + bob, 112, -88 + bob, 94, -104 + bob);
      ctx.fill();
      // neck and head
      ctx.beginPath();
      ctx.moveTo(78, -112 + bob); ctx.lineTo(114, -140 + bob); ctx.lineTo(128, -104 + bob); ctx.lineTo(92, -78 + bob); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(130, -132 + bob, 31, 27, 0.08, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(154, -122 + bob, 13, 10, 0.2, 0, 7); ctx.fill();
      // ears
      ctx.beginPath(); ctx.moveTo(108, -150 + bob); ctx.lineTo(113, -186 + bob); ctx.lineTo(131, -156 + bob); ctx.fill();
      ctx.beginPath(); ctx.moveTo(130, -157 + bob); ctx.lineTo(147, -182 + bob); ctx.lineTo(153, -144 + bob); ctx.fill();
      leg(56, -80, 46, 42, 0.75, true, 20);
      leg(-64, -84, 46, 46, 0.25, false, 28);
    };
    this.body(ctx, '#17120f', draw);
    ctx.restore();
  }

  sitter(ctx, t) {
    // seen from behind, looking out of the window
    const draw = () => {
      const tw = Math.sin(this.tail * 2.2) * Math.max(0, Math.sin(this.tail * 0.37)) * 10;
      ctx.lineCap = 'round'; ctx.lineWidth = 13;
      ctx.beginPath(); ctx.moveTo(30, -10);
      ctx.bezierCurveTo(90, -2, 140, -6, 160, -24 - tw);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-62, 0);
      ctx.bezierCurveTo(-78, -60, -58, -130, -34, -150);
      ctx.bezierCurveTo(-20, -162, 20, -162, 34, -150);
      ctx.bezierCurveTo(58, -130, 78, -60, 62, 0);
      ctx.closePath(); ctx.fill();
      const tilt = Math.sin(this.tail * 0.5) * 0.08;
      ctx.save(); ctx.translate(0, -172); ctx.rotate(tilt);
      ctx.beginPath(); ctx.ellipse(0, 0, 34, 30, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-30, -10); ctx.lineTo(-26, -50); ctx.lineTo(-6, -26); ctx.fill();
      ctx.beginPath(); ctx.moveTo(30, -10); ctx.lineTo(26, -50); ctx.lineTo(6, -26); ctx.fill();
      ctx.restore();
    };
    this.body(ctx, '#17120f', draw);
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
