// Procedural fire crackle: a low roar, a soft hiss, and randomly timed pops and snaps.
// Never loops, so it doesn't repeat the way a recording does.
let ctx = null;

export class FireSound {
  constructor() { this.on = false; this.level = 0.5; }

  async start(level = 0.5) {
    this.level = level;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* needs a key press */ } }
    if (this.on) { this.setLevel(level); return; }
    this.on = true;
    const sr = ctx.sampleRate;
    // shared noise buffers
    const white = ctx.createBuffer(1, sr * 2, sr);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    const brown = ctx.createBuffer(1, sr * 4, sr);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.white = white;

    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.out.connect(ctx.destination);
    this.out.gain.linearRampToValueAtTime(level, ctx.currentTime + 1.5);

    // roar
    const roar = ctx.createBufferSource(); roar.buffer = brown; roar.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0.5;
    roar.connect(lp).connect(this.roarGain).connect(this.out); roar.start();
    // hiss
    const hiss = ctx.createBufferSource(); hiss.buffer = white; hiss.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 0.7;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0.03;
    hiss.connect(bp).connect(this.hissGain).connect(this.out); hiss.start();
    this.srcs = [roar, hiss];
    this.nextT = ctx.currentTime + 0.2;
    this.burst = 0;
    this.timer = setInterval(() => this.schedule(), 100);
  }

  setLevel(v) {
    this.level = v;
    if (this.out && ctx) this.out.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.5);
  }

  schedule() {
    if (!this.on || !ctx) return;
    const now = ctx.currentTime;
    // slow swell of the roar
    this.roarGain.gain.setTargetAtTime(0.35 + Math.random() * 0.35, now, 1.5);
    while (this.nextT < now + 0.3) {
      // crackles arrive in clusters: a busy spell, then quiet
      if (this.burst <= 0 && Math.random() < 0.08) this.burst = 4 + Math.random() * 14;
      const rate = this.burst > 0 ? 22 : 4;
      this.nextT += -Math.log(1 - Math.random()) / rate;
      this.burst -= 1;
      this.pop(this.nextT, Math.random() < 0.02);
    }
  }

  pop(when, big) {
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = big ? 700 + Math.random() * 600 : 1500 + Math.random() * 4500;
    f.Q.value = big ? 1.2 : 0.8 + Math.random() * 3;
    const g = ctx.createGain();
    const loud = big ? 0.9 : Math.pow(Math.random(), 3) * 0.7 + 0.04;
    const dur = big ? 0.09 + Math.random() * 0.06 : 0.004 + Math.random() * 0.03;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(loud, when + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let node = src.connect(f).connect(g);
    if (pan) { pan.pan.value = (Math.random() - 0.5) * 0.9; node = node.connect(pan); }
    node.connect(this.out);
    src.start(when, Math.random() * 1.5, dur + 0.02);
  }

  stop() {
    if (!this.on || !ctx) return;
    this.on = false;
    clearInterval(this.timer);
    const g = this.out, s = this.srcs;
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    setTimeout(() => { s.forEach(x => { try { x.stop(); } catch (e) { /* already stopped */ } }); g.disconnect(); }, 1000);
  }
}

export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }
