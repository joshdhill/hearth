// Spotify: sign-in with PKCE (no secret), and control of the TV's Spotify app through the Web API.
// Spotify does the playing; Hearth tells it what to play and shows what's on.
import { store } from './util.js';

export const CLIENT_ID = '6f18dc4e5f114e0cad06fdc04f3efbb2';
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative';
const BASE = new URL('./', location.href).href.replace(/\/(tv\/)?$/, '/');
export const REDIRECT = 'https://joshdhill.github.io/hearth/callback.html';
const API = 'https://api.spotify.com/v1';

export const PRESETS = [
  { uri: 'spotify:playlist:37i9dQZF1DX4sWSpwq3LiO', name: 'Peaceful Piano' },
  { uri: 'spotify:playlist:37i9dQZF1DX7K31D69s4M1', name: 'Piano in the Background' },
  { uri: 'spotify:playlist:37i9dQZF1DX3Ogo9pFvBkY', name: 'Ambient Relaxation' },
  { uri: 'spotify:playlist:37i9dQZF1DX4PP3DA4J0N8', name: 'Nature Sounds' }
];

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function login(returnTo = location.href) {
  const v = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const ch = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  store.set('sp-verifier', v);
  store.set('sp-return', returnTo);
  const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: ch, scope: SCOPES });
  location.href = 'https://accounts.spotify.com/authorize?' + q;
}

// Called by callback.html
export async function finishLogin(code) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: store.get('sp-verifier', '') });
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Sign-in failed');
  saveToken(j);
  store.del('sp-verifier');
  return store.get('sp-return', BASE);
}

function saveToken(j) {
  const t = store.get('sp-token', {}) || {};
  store.set('sp-token', { access: j.access_token, refresh: j.refresh_token || t.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 });
}

let refreshing = null;
async function token() {
  const t = store.get('sp-token', null);
  if (!t) return null;
  if (Date.now() < t.exp) return t.access;
  if (!refreshing) {
    refreshing = (async () => {
      const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: CLIENT_ID });
      const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const j = await r.json();
      if (!r.ok) { if (j.error === 'invalid_grant') store.del('sp-token'); throw new Error(j.error_description || 'Spotify sign-in expired'); }
      saveToken(j);
      return j.access_token;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function api(path, opt = {}, retry = true) {
  const tk = await token();
  if (!tk) throw new Error('not-signed-in');
  const r = await fetch(API + path, { ...opt, headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  if (r.status === 401 && retry) { const t = store.get('sp-token', null); if (t) { t.exp = 0; store.set('sp-token', t); } return api(path, opt, false); }
  if (r.status === 204 || r.status === 202) return null;
  const text = await r.text();
  const j = text ? JSON.parse(text) : null;
  if (!r.ok) { const e = new Error((j && j.error && j.error.message) || ('Spotify ' + r.status)); e.status = r.status; e.reason = j && j.error && j.error.reason; throw e; }
  return j;
}

export const spotify = {
  get signedIn() { return !!store.get('sp-token', null); },
  signOut() { store.del('sp-token'); },
  me: () => api('/me'),
  devices: () => api('/me/player/devices').then(j => (j && j.devices) || []),
  state: () => api('/me/player'),
  playing: () => api('/me/player/currently-playing'),
  myPlaylists: () => api('/me/playlists?limit=50').then(j => (j && j.items || []).filter(Boolean).map(p => ({ uri: p.uri, name: p.name, img: p.images && p.images[0] && p.images[0].url }))),
  search: q => api('/search?type=playlist&limit=5&q=' + encodeURIComponent(q)).then(j => (j && j.playlists && j.playlists.items || []).filter(Boolean).map(p => ({ uri: p.uri, name: p.name }))),
  play: (uri, deviceId) => api('/me/player/play' + (deviceId ? '?device_id=' + deviceId : ''), { method: 'PUT', body: JSON.stringify({ context_uri: uri }) }),
  shuffle: (on, deviceId) => api(`/me/player/shuffle?state=${on}` + (deviceId ? '&device_id=' + deviceId : ''), { method: 'PUT' }),
  pause: () => api('/me/player/pause', { method: 'PUT' }),
  resume: () => api('/me/player/play', { method: 'PUT' }),
  next: () => api('/me/player/next', { method: 'POST' }),
  volume: (pct, deviceId) => api(`/me/player/volume?volume_percent=${Math.round(pct)}` + (deviceId ? '&device_id=' + deviceId : ''), { method: 'PUT' })
};

// Choose the speaker: the one picked before, else the TV, else whatever is active.
export function pickDevice(devices, preferName) {
  if (!devices.length) return null;
  return devices.find(d => preferName && d.name === preferName) ||
    devices.find(d => d.type === 'TV' || /tv|streamer|living/i.test(d.name)) ||
    devices.find(d => d.is_active) || null;
}
