// Sky colour and light level from the sun's elevation and the weather.
import { hex, mix, clamp, smooth, lerp } from './util.js';

// [elevation, zenith, horizon] keyframes for a clear sky
const CLEAR = [
  [-18, '#070b18', '#121a30'],
  [-10, '#0d1530', '#24304f'],
  [-5, '#1f2f5a', '#7a5f7a'],
  [-1.5, '#35508a', '#e08a5e'],
  [2, '#4f71a8', '#f2b07a'],
  [8, '#5f88c0', '#f0cfa0'],
  [18, '#5b8dc8', '#c9dceb'],
  [40, '#4f86c6', '#bfd6ea']
];
const GREY_DAY = ['#8a96a3', '#c3c9ce'];
const GREY_NIGHT = ['#10141c', '#1b2029'];

function keyAt(el) {
  for (let i = 0; i < CLEAR.length - 1; i++) {
    const a = CLEAR[i], b = CLEAR[i + 1];
    if (el <= b[0]) {
      const t = clamp((el - a[0]) / (b[0] - a[0]), 0, 1);
      return [mix(hex(a[1]), hex(b[1]), t), mix(hex(a[2]), hex(b[2]), t)];
    }
  }
  const l = CLEAR[CLEAR.length - 1];
  return [hex(l[1]), hex(l[2])];
}

// Returns everything the painters need about light.
export function skyState(el, cond) {
  const cloud = clamp(cond.cloud ?? 0.4, 0, 1);
  const wet = /rain|drizzle|storm/.test(cond.kind) ? 1 : 0;
  const snowy = /snow/.test(cond.kind) ? 1 : 0;
  const foggy = cond.kind === 'fog' ? 1 : 0;
  let [zen, hor] = keyAt(el);
  // daylight 0 (night) .. 1 (full day)
  const day = smooth(clamp((el + 9) / 21, 0, 1));
  const grey = clamp(cloud * 0.9 + wet * 0.25 + snowy * 0.2 + foggy * 0.4 - 0.15, 0, 1);
  const g = [mix(hex(GREY_NIGHT[0]), hex(GREY_DAY[0]), day), mix(hex(GREY_NIGHT[1]), hex(GREY_DAY[1]), day)];
  zen = mix(zen, g[0], grey);
  hor = mix(hor, g[1], grey * 0.85);
  if (snowy) hor = mix(hor, [205, 210, 218], 0.25 * day);
  if (foggy) { zen = mix(zen, hor, 0.6); }
  const light = day * (1 - 0.35 * cloud - 0.15 * wet);
  // colour of daylight falling on things (warm low sun, cool overcast, blue night)
  let tint = mix([120, 135, 175], [255, 246, 232], day);
  if (el > -3 && el < 10) tint = mix(tint, [255, 196, 140], (1 - Math.abs(el - 3) / 7) * (1 - grey) * 0.8);
  tint = mix(tint, [215, 220, 228], grey * day * 0.6);
  return {
    el, day, light: clamp(light, 0, 1), cloud, grey, wet, snowy, foggy,
    zen, hor, tint,
    stars: clamp((-el - 8) / 6, 0, 1) * (1 - cloud),
    sunVisible: el > -2 && el < 35 && cloud < 0.7,
    lamp: 1 - smooth(clamp((el + 4) / 14, 0, 1)) * (1 - 0.4 * cloud)   // how much the room lamps matter
  };
}

// Moon phase 0..1 (0 new, 0.5 full)
export function moonPhase(date = new Date()) {
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - ref) / 86400000;
  return ((days % 29.530588) + 29.530588) % 29.530588 / 29.530588;
}

export function atmos(c, sky, depth) {
  // push a colour toward the horizon haze; depth 0 near .. 1 far
  const haze = lerp(0.12, 0.75, depth) * (1 + sky.foggy * 0.8);
  return mix(c, sky.hor, clamp(haze, 0, 0.95));
}
