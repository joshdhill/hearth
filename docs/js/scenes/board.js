// The bird board, full screen in TV mode with its slides rotating. Its own music button is hidden;
// Hearth plays the music.
import { W, H } from '../util.js';

export class BoardScene {
  constructor(app, preset) { this.app = app; this.p = preset; this.transparent = true; }
  get o() { return this.p.opts; }

  async enter() {
    const f = document.createElement('iframe');
    const src = this.o.boardUrl || '/bird-board/';
    const q = ['tv', 'rotate', 'music=off'];
    if (this.o.view === 'hour') q.push('view=hour');
    f.src = src + (src.includes('?') ? '&' : '?') + q.join('&');
    f.setAttribute('tabindex', '-1');
    f.setAttribute('allow', 'autoplay');
    f.className = 'board-frame';
    this.app.layer.appendChild(f);
    this.frame = f;
    // never let the board steal the remote's focus
    f.addEventListener('load', () => { try { f.contentWindow.addEventListener('focus', () => window.focus()); } catch (e) { /* cross-origin */ } window.focus(); });
  }

  update() { this.exit(); this.enter(); }

  exit() { if (this.frame) { this.frame.remove(); this.frame = null; } }

  draw(ctx) { ctx.clearRect(0, 0, W, H); }

  thumb(ctx, w, h, img) {
    ctx.fillStyle = '#e9e4d6'; ctx.fillRect(0, 0, w, h);
    if (img) ctx.drawImage(img, w * 0.08, h * 0.12, w * 0.4, h * 0.5);
    ctx.fillStyle = 'rgba(60,50,40,0.5)';
    for (let i = 0; i < 3; i++) ctx.fillRect(w * (0.55 + i * 0.12), h * 0.7, w * 0.08, h * 0.04);
  }
}
