// Hearth: scene manager, TV-remote menu, music and the bridge to the Google TV app.
import { W, H, store, clamp, loadImage } from './util.js';
import { weather } from './weather.js';
import { SCENES, OPTIONS } from './scenes/index.js';
import { WindowScene } from './scenes/window.js';
import { FireplaceScene, FIRES } from './scenes/fireplace.js';
import { BoardScene } from './scenes/board.js';
import { spotify, login, pickDevice, PRESETS } from './spotify.js';
import { resumeAudio } from './audio/fire.js';

const $ = id => document.getElementById(id);
const native = window.HearthNative || null;
const params = new URLSearchParams(location.search);

class App {
  constructor() {
    this.canvas = $('scene');
    this.ctx = this.canvas.getContext('2d');
    this.layer = $('layer');
    this.videoEl = $('video');
    this.scene = null;
    this.t = 0;
    this.fit();
    addEventListener('resize', () => this.fit());
  }

  fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cw = innerWidth * dpr, ch = innerHeight * dpr;
    const cap = Math.min(1, (W * 1.25) / cw);                // keep big desktop previews light
    cw = Math.round(cw * cap); ch = Math.round(ch * cap);
    this.canvas.width = cw; this.canvas.height = ch;
    const k = Math.max(cw / W, ch / H);
    this.view = { k, ox: (cw - W * k) / 2, oy: (ch - H * k) / 2 };
  }

  // ---- scenes ------------------------------------------------------------
  preset(id) {
    const def = SCENES.find(s => s.id === id) || SCENES[0];
    const saved = store.get('opts:' + def.id, {});
    return { ...def, opts: { ...def.defaults, ...saved } };
  }

  // the scene being shown, or the one on its way in while it loads
  get cur() { return (this.scene && this.scene.p) || this.pending; }

  async show(id) {
    const p = this.preset(id);
    this.pending = p;
    if (this.scene && this.scene.p.id === p.id) return;
    const old = this.scene;
    this.scene = null;
    if (old) old.exit();
    const S = p.type === 'fire' ? FireplaceScene : p.type === 'board' ? BoardScene : WindowScene;
    const s = new S(this, p);
    store.set('scene', p.id);
    document.body.classList.toggle('see-through', !!s.transparent);
    await s.enter();
    this.scene = s;
    this.showWeatherCard();
    music.sceneChanged(p);
  }

  setOpt(key, value) {
    const s = this.scene; if (!s) return;
    s.p.opts[key] = value;
    const saved = store.get('opts:' + s.p.id, {});
    saved[key] = value;
    store.set('opts:' + s.p.id, saved);
    if (key === 'music') music.sceneChanged(s.p, true);
    else s.update();
    this.showWeatherCard();
  }

  resetScene() {
    const s = this.scene; if (!s) return;
    store.del('opts:' + s.p.id);
    Object.assign(s.p.opts, SCENES.find(x => x.id === s.p.id).defaults);
    s.update();
    music.sceneChanged(s.p, true);
  }

  // ---- video layer (native player on the TV, <video> in a browser) ---------
  video(f) {
    if (native && native.playVideo) {
      if (f) native.playVideo(f.tv); else native.stopVideo();
      return;
    }
    const v = this.videoEl;
    if (!f) { v.pause(); v.removeAttribute('src'); v.load(); v.style.backgroundImage = ''; return; }
    v.style.backgroundImage = `url("${f.poster}")`;
    // start muted so phones allow it to play on its own; the first tap turns sound on
    v.muted = !this.touched; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    if (v.dataset.src !== f.web) { v.dataset.src = f.web; v.src = f.web; v.load(); }
    v.play().catch(() => { v.muted = true; v.play().catch(() => this.toast('Tap to start the fire', 5000)); });
  }

  // any tap or key press: allowed to make sound now, and restart anything the phone held back
  wake() {
    this.touched = true;
    resumeAudio();
    const v = this.videoEl;
    if (v.dataset.src && document.body.classList.contains('see-through')) {
      v.muted = false;
      if (v.paused) v.play().catch(() => {});
    }
    if (this.amb && this.amb.paused && this.amb.dataset.src) this.amb.play().catch(() => {});
  }

  // looping background sound; on the TV it plays through the app so Spotify isn't interrupted
  ambient(url, vol = 0.5) {
    if (native && native.playAmbient) { if (url) native.playAmbient(url, vol); else native.stopAmbient(); return; }
    let a = this.amb;
    if (!url) { if (a) { a.pause(); } return; }
    if (!a) { a = this.amb = new Audio(); a.loop = true; }
    if (a.dataset.src !== url) { a.dataset.src = url; a.src = url; }
    a.volume = clamp(vol, 0, 1);
    a.play().catch(() => {});
  }

  videoVolume(x) {
    if (native && native.setVideoVolume) native.setVideoVolume(x);
    this.videoEl.volume = clamp(x, 0, 1);
  }

  // ---- captions -------------------------------------------------------------
  caption(title, sub) {
    const c = $('caption');
    c.querySelector('b').textContent = title;
    c.querySelector('span').textContent = sub || '';
    c.classList.add('on');
    clearTimeout(this.capT);
    this.capT = setTimeout(() => c.classList.remove('on'), 8000);
  }

  toast(text, ms = 4000) {
    const t = $('toast');
    t.textContent = text; t.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('on'), ms);
  }

  showWeatherCard() {
    const card = $('wx');
    const n = weather.now;
    const on = this.scene && this.scene.p.showWeather && n;
    card.classList.toggle('on', !!on);
    if (on) {
      card.querySelector('b').textContent = n.temp + '°';
      card.querySelector('span').textContent = `${n.words}. High ${n.hi}, low ${n.lo}.`;
    }
  }

  // ---- loop ---------------------------------------------------------------
  loop(now) {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now; this.t += dt;
    const { ctx } = this;
    if (this.scene) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (this.scene.transparent) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const v = this.view;
      ctx.setTransform(v.k, 0, 0, v.k, v.ox, v.oy);
      try { this.scene.draw(ctx, this.t, dt); } catch (e) { console.error(e); }
    }
    requestAnimationFrame(n => this.loop(n));
  }
}

// ---- music --------------------------------------------------------------------
const music = {
  current: null,
  async resolve(m) {
    if (!m || m === 'off') return null;
    if (m.startsWith('spotify:')) return { uri: m, name: nameOf(m) };
    if (m.startsWith('search:')) {
      const q = m.slice(7);
      const hit = store.get('found:' + q, null);
      if (hit) return hit;
      const res = await spotify.search(q);
      if (!res.length) return { uri: PRESETS[0].uri, name: PRESETS[0].name };
      store.set('found:' + q, res[0]);
      return res[0];
    }
    return null;
  },
  sceneChanged(p, now) {
    clearTimeout(this.t);
    // flipping through scenes shouldn't restart the music every time
    this.t = setTimeout(() => this.apply(p), now ? 50 : 3000);
  },
  async apply(p) {
    if (!spotify.signedIn) return;
    try {
      const m = p.opts.music;
      if (m === 'off') {
        if (this.started) { await spotify.pause().catch(() => {}); this.started = false; }
        return;
      }
      const want = await this.resolve(m);
      if (!want) return;
      const st = await spotify.state().catch(() => null);
      if (st && st.is_playing && st.context && st.context.uri === want.uri) { this.current = want; return; }
      let dev = pickDevice(await spotify.devices(), store.get('sp-device', null));
      const look = async n => { for (let i = 0; i < n && !dev; i++) { await sleep(1500); dev = pickDevice(await spotify.devices(), store.get('sp-device', null)); } };
      if (!dev && native && native.wakeSpotify) {
        // first a quiet nudge in the background, then open Spotify for a moment if that isn't enough
        app.toast('Waking up Spotify on the TV…', 6000);
        native.wakeSpotify();
        await look(6);
        if (!dev && native.openSpotify) { app.toast('Opening Spotify for a moment…', 8000); native.openSpotify(); await look(14); }
      }
      if (!dev) { app.toast('Spotify isn’t open on any speaker. Open Spotify on the TV once, then come back.', 8000); return; }
      await spotify.play(want.uri, dev.id);
      spotify.shuffle(true, dev.id).catch(() => {});
      this.current = want; this.started = true;
      app.toast(`Playing ${want.name} on ${dev.name}`);
    } catch (e) {
      if (e.message === 'not-signed-in') return;
      app.toast('Spotify: ' + e.message, 7000);
    }
  }
};
const nameOf = uri => (PRESETS.find(p => p.uri === uri) || {}).name || store.get('names', {})[uri] || 'Playlist';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Now-playing card
const np = {
  last: null,
  async poll() {
    if (!spotify.signedIn || store.get('songcard', true) === false) return;
    try {
      const j = await spotify.playing();
      const it = j && j.item;
      if (!it || !j.is_playing) return;
      if (it.id === this.last) return;
      this.last = it.id;
      const card = $('np');
      const art = it.album && it.album.images && (it.album.images[1] || it.album.images[0]);
      card.querySelector('img').src = art ? art.url : '';
      card.querySelector('b').textContent = it.name;
      card.querySelector('span').textContent = (it.artists || []).map(a => a.name).join(', ');
      card.classList.add('on');
      clearTimeout(this.t);
      this.t = setTimeout(() => card.classList.remove('on'), 9000);
    } catch (e) { /* quiet */ }
  }
};

// ---- menu ------------------------------------------------------------------------
const menu = {
  open: false, row: 0, col: 0, picker: null,
  show() {
    this.open = true; this.row = 0;
    this.col = SCENES.findIndex(s => s.id === app.cur.id);
    $('menu').classList.add('on');
    this.render(); this.thumbs(); this.idle();
  },
  hide() { this.open = false; this.closePicker(); $('menu').classList.remove('on'); },
  idle() { clearTimeout(this.it); this.it = setTimeout(() => this.hide(), 25000); },

  options() {
    const s = app.cur;
    const list = [{ key: 'music', label: 'Music', value: this.musicLabel(s.opts.music) }];
    for (const o of OPTIONS) {
      if (!o.types.includes(s.type)) continue;
      if (o.branch && !s.branch) continue;
      if (o.key === 'birds' && !s.branch) continue;
      const v = o.values.find(x => x[0] === s.opts[o.key]) || o.values[0];
      list.push({ key: o.key, label: o.label, value: v[1], o });
    }
    list.push({ key: '_speaker', label: 'Speaker', value: store.get('sp-device', null) || 'Automatic' });
    list.push({ key: '_spotify', label: 'Spotify', value: spotify.signedIn ? (store.get('sp-name', '') || 'Connected') : 'Connect' });
    list.push({ key: '_songcard', label: 'Song card', value: store.get('songcard', true) ? 'On' : 'Off' });
    list.push({ key: '_reset', label: 'Reset scene', value: '' });
    return list;
  },
  musicLabel(m) {
    if (!m || m === 'off') return 'No music';
    if (m.startsWith('search:')) { const hit = store.get('found:' + m.slice(7), null); return hit ? hit.name : m.slice(7); }
    return nameOf(m);
  },

  render() {
    const focusScene = SCENES[this.col] && this.row === 0 ? SCENES[this.col] : app.cur;
    $('m-title').textContent = focusScene.name;
    $('m-blurb').textContent = focusScene.blurb;
    const shelf = $('shelf');
    if (!shelf.children.length) {
      for (const s of SCENES) {
        const d = document.createElement('div');
        d.className = 'tile'; d.dataset.id = s.id;
        d.innerHTML = `<canvas width="320" height="180"></canvas><span>${s.name}</span>`;
        shelf.appendChild(d);
      }
    }
    [...shelf.children].forEach((d, i) => {
      d.classList.toggle('focus', this.row === 0 && i === this.col);
      d.classList.toggle('active', SCENES[i].id === app.cur.id);
    });
    const opts = $('opts');
    const list = this.options();
    opts.innerHTML = '';
    list.forEach((o, i) => {
      const d = document.createElement('div');
      d.className = 'chip' + (this.row === 1 && i === this.col ? ' focus' : '');
      d.dataset.i = i;
      d.innerHTML = `<small></small><b></b>`;
      d.querySelector('small').textContent = o.label;
      d.querySelector('b').textContent = o.value;
      opts.appendChild(d);
    });
    this.list = list;
    const f = opts.children[this.row === 1 ? this.col : -1];
    if (f) f.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const ft = shelf.children[this.row === 0 ? this.col : -1];
    if (ft) ft.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },

  async thumbs() {
    const tiles = [...$('shelf').children];
    for (let i = 0; i < SCENES.length; i++) {
      const s = SCENES[i], cv = tiles[i].querySelector('canvas'), x = cv.getContext('2d');
      if (cv.dataset.done && Date.now() - +cv.dataset.done < 600000) continue;
      await sleep(30);
      try {
        if (s.type === 'fire') {
          const p = app.preset(s.id), f = FIRES[p.opts.fire] || FIRES.brick;
          const img = await loadImage(f.poster).catch(() => null);
          if (img) x.drawImage(img, 0, 0, 320, 180); else { x.fillStyle = '#2a1408'; x.fillRect(0, 0, 320, 180); }
        } else if (s.type === 'board') {
          const img = await loadImage('/bird-board/cutouts/cardinal.png').catch(() => null);
          new BoardScene(app, app.preset(s.id)).thumb(x, 320, 180, img);
        } else {
          const ws = app.scene && app.cur.id === s.id ? app.scene : new WindowScene(app, app.preset(s.id));
          if (!ws.layers.out) ws.rebuild(true);
          ws.thumb(x, 320, 180);
        }
        cv.dataset.done = Date.now();
      } catch (e) { console.warn('thumb', s.id, e); }
    }
  },

  key(k) {
    this.idle();
    if (this.picker) return this.pickerKey(k);
    const list = this.row === 0 ? SCENES : this.list;
    if (k === 'left') this.col = Math.max(0, this.col - 1);
    if (k === 'right') this.col = Math.min(list.length - 1, this.col + 1);
    if (k === 'down' && this.row === 0) { this.row = 1; this.col = 0; }
    else if (k === 'up' && this.row === 1) { this.row = 0; this.col = SCENES.findIndex(s => s.id === app.cur.id); }
    if (this.row === 0 && (k === 'left' || k === 'right')) app.show(SCENES[this.col].id).then(() => this.render());
    if (k === 'ok') {
      if (this.row === 0) { this.hide(); return; }
      this.activate(this.list[this.col]);
    }
    if (k === 'back') { this.hide(); return; }
    this.render();
  },

  activate(o) {
    if (o.key === 'music') return this.musicPicker();
    if (o.key === '_speaker') return this.speakerPicker();
    if (o.key === '_spotify') {
      if (spotify.signedIn) return this.openPicker('Spotify', [{ label: 'Sign out of Spotify', run: () => { spotify.signOut(); app.toast('Signed out of Spotify'); } }]);
      app.toast('Opening Spotify sign-in…');
      return login(location.href.split('?')[0]);
    }
    if (o.key === '_songcard') { store.set('songcard', !store.get('songcard', true)); return this.render(); }
    if (o.key === '_reset') { app.resetScene(); app.toast(`${app.cur.name} reset`); return this.render(); }
    const vals = o.o.values;
    const i = vals.findIndex(v => v[0] === app.cur.opts[o.key]);
    app.setOpt(o.key, vals[(i + 1) % vals.length][0]);
    this.render();
  },

  async musicPicker() {
    const s = app.cur;
    const items = [{ label: 'No music', run: () => app.setOpt('music', 'off') }];
    const def = SCENES.find(x => x.id === s.id).defaults.music;
    items.push({ label: 'Scene default: ' + this.musicLabel(def), run: () => app.setOpt('music', def) });
    for (const p of PRESETS) items.push({ label: p.name, run: () => app.setOpt('music', p.uri) });
    this.openPicker('Music for ' + s.name, items, 'Loading your playlists…');
    if (!spotify.signedIn) { this.pickerNote('Connect Spotify from the menu to use your own playlists.'); return; }
    try {
      const mine = await spotify.myPlaylists();
      const names = store.get('names', {});
      for (const p of mine) { names[p.uri] = p.name; items.push({ label: p.name, run: () => app.setOpt('music', p.uri), mine: true }); }
      store.set('names', names);
      if (this.picker) { this.picker.items = items; this.pickerNote(mine.length ? '' : 'No playlists of your own yet.'); this.renderPicker(); }
    } catch (e) { this.pickerNote('Couldn’t load your playlists: ' + e.message); }
  },

  async speakerPicker() {
    const items = [{ label: 'Automatic (the TV)', run: () => { store.del('sp-device'); } }];
    this.openPicker('Play music on', items, 'Looking for speakers…');
    try {
      const devs = await spotify.devices();
      for (const d of devs) items.push({ label: `${d.name}`, run: () => { store.set('sp-device', d.name); music.sceneChanged(app.cur, true); } });
      if (this.picker) { this.picker.items = items; this.pickerNote(devs.length ? '' : 'No speakers found. Open Spotify on the TV and try again.'); this.renderPicker(); }
    } catch (e) { this.pickerNote(spotify.signedIn ? e.message : 'Connect Spotify first.'); }
  },

  openPicker(title, items, note = '') {
    this.picker = { title, items, i: 0, note };
    $('picker').classList.add('on');
    this.renderPicker();
  },
  pickerNote(n) { if (this.picker) { this.picker.note = n; this.renderPicker(); } },
  closePicker() { this.picker = null; $('picker').classList.remove('on'); },
  renderPicker() {
    const p = this.picker; if (!p) return;
    $('p-title').textContent = p.title;
    $('p-note').textContent = p.note || '';
    const ul = $('p-list'); ul.innerHTML = '';
    p.items.forEach((it, i) => {
      const li = document.createElement('li');
      li.textContent = it.label;
      li.dataset.i = i;
      if (i === p.i) li.className = 'focus';
      ul.appendChild(li);
    });
    const f = ul.children[p.i]; if (f) f.scrollIntoView({ block: 'nearest' });
  },
  pickerKey(k) {
    const p = this.picker;
    if (k === 'up') p.i = Math.max(0, p.i - 1);
    if (k === 'down') p.i = Math.min(p.items.length - 1, p.i + 1);
    if (k === 'back' || k === 'left') { this.closePicker(); this.render(); return; }
    if (k === 'ok') { const it = p.items[p.i]; this.closePicker(); it.run(); this.render(); return; }
    this.renderPicker();
  }
};

// ---- remote control ------------------------------------------------------------------
const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'ok', ' ': 'ok', Escape: 'back', Backspace: 'back', GoBack: 'back', BrowserBack: 'back', MediaPlayPause: 'playpause' };
let backArmed = 0;
function onKey(k) {
  app.wake();
  if (k === 'playpause') { if (spotify.signedIn) spotify.state().then(s => (s && s.is_playing ? spotify.pause() : spotify.resume())).catch(() => {}); return true; }
  if (menu.open) { menu.key(k); return true; }
  if (k === 'ok' || k === 'up' || k === 'down') { menu.show(); return true; }
  if (k === 'left' || k === 'right') {
    const i = SCENES.findIndex(s => s.id === app.cur.id);
    const n = SCENES[(i + (k === 'right' ? 1 : -1) + SCENES.length) % SCENES.length];
    app.show(n.id); app.toast(n.name, 2500);
    return true;
  }
  if (k === 'back') {
    // the app's back button: first press shows a hint, a second press within 3 seconds leaves
    if (Date.now() - backArmed < 3000) return false;
    backArmed = Date.now();
    app.toast('Press back again to leave Hearth', 3000);
    return true;
  }
  return false;
}
addEventListener('keydown', e => {
  const k = KEYS[e.key] || (e.keyCode === 23 || e.keyCode === 66 ? 'ok' : null);
  if (!k) return;
  e.preventDefault();
  onKey(k);
});
// ---- touch (phone and tablet) ---------------------------------------------------------
let touch0 = null, swiped = false;
addEventListener('touchstart', e => { const t = e.touches[0]; touch0 = { x: t.clientX, y: t.clientY }; swiped = false; }, { passive: true });
addEventListener('touchend', e => {
  if (!touch0 || menu.open) return;
  const t = e.changedTouches[0], dx = t.clientX - touch0.x, dy = t.clientY - touch0.y;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; onKey(dx < 0 ? 'right' : 'left'); }
}, { passive: true });
addEventListener('click', e => {
  if (swiped) { swiped = false; return; }
  app.wake();
  const el = e.target;
  if (menu.picker) {
    const li = el.closest('#p-list li');
    if (li) { menu.picker.i = +li.dataset.i; menu.pickerKey('ok'); }
    else if (!el.closest('#picker')) { menu.closePicker(); menu.render(); }
    return;
  }
  if (!menu.open) { menu.show(); return; }
  menu.idle();
  const tile = el.closest('.tile');
  if (tile) {
    menu.row = 0; menu.col = SCENES.findIndex(s => s.id === tile.dataset.id);
    app.show(tile.dataset.id).then(() => menu.render());
    menu.render();
    return;
  }
  const chip = el.closest('.chip');
  if (chip) { menu.row = 1; menu.col = +chip.dataset.i; menu.activate(menu.list[menu.col]); menu.render(); return; }
  if (!el.closest('.menu')) menu.hide();
});

// Called by the TV app for keys the web page can't see (Back, media keys).
window.hearth = { key: k => onKey(k), back: () => onKey('back') };

// ---- start ---------------------------------------------------------------------------
const app = new App();
window.hearthApp = app;
weather.start();
weather.on(() => app.showWeatherCard());
const startId = params.get('scene') || store.get('scene', 'birdwindow');
// test helpers: ?wx=rain&time=dusk&cat=often apply to this visit only
if (params.get('wx') || params.get('time') || params.get('cat')) {
  const def = SCENES.find(s => s.id === startId);
  if (def) {
    if (params.get('wx')) def.defaults.weather = params.get('wx');
    if (params.get('time')) def.defaults.time = params.get('time');
    if (params.get('cat')) def.defaults.cat = params.get('cat');
  }
}
app.show(startId).then(() => { if (params.get('menu')) menu.show(); });
requestAnimationFrame(n => app.loop(n));
setInterval(() => np.poll(), 12000);
if (spotify.signedIn) spotify.me().then(m => store.set('sp-name', m.display_name || m.id)).catch(() => {});
if (native && native.ready) native.ready();
