// Live conditions for Germantown from Open-Meteo (free, no key). Refreshes every 10 minutes.
import { HOME, store } from './util.js';

const URL = `https://api.open-meteo.com/v1/forecast?latitude=${HOME.lat}&longitude=${HOME.lon}` +
  '&current=temperature_2m,apparent_temperature,weather_code,cloud_cover,wind_speed_10m,precipitation,is_day' +
  '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=1' +
  '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York';

// WMO weather codes -> a scene condition and words for the caption
function describe(code) {
  if (code === 0) return ['clear', 'Clear'];
  if (code === 1) return ['clear', 'Mostly clear'];
  if (code === 2) return ['cloudy', 'Partly cloudy'];
  if (code === 3) return ['overcast', 'Overcast'];
  if (code === 45 || code === 48) return ['fog', 'Fog'];
  if (code >= 51 && code <= 57) return ['drizzle', 'Drizzle'];
  if (code === 61 || code === 80) return ['rain', 'Light rain'];
  if (code === 63 || code === 81) return ['rain', 'Rain'];
  if (code === 65 || code === 82) return ['heavyrain', 'Heavy rain'];
  if (code === 66 || code === 67) return ['rain', 'Freezing rain'];
  if (code === 71 || code === 85) return ['snow', 'Light snow'];
  if (code === 73 || code === 77) return ['snow', 'Snow'];
  if (code === 75 || code === 86) return ['heavysnow', 'Heavy snow'];
  if (code >= 95) return ['storm', 'Thunderstorm'];
  return ['cloudy', 'Cloudy'];
}

const listeners = new Set();
let current = store.get('weather', null);

export const weather = {
  get now() { return current; },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  async refresh() {
    try {
      const r = await fetch(URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('weather ' + r.status);
      const j = await r.json();
      const c = j.current;
      const [kind, words] = describe(c.weather_code);
      current = {
        at: Date.now(),
        temp: Math.round(c.temperature_2m),
        feels: Math.round(c.apparent_temperature),
        hi: Math.round(j.daily.temperature_2m_max[0]),
        lo: Math.round(j.daily.temperature_2m_min[0]),
        code: c.weather_code, kind, words,
        cloud: c.cloud_cover / 100,
        wind: c.wind_speed_10m,
        precip: c.precipitation,
        isDay: !!c.is_day
      };
      store.set('weather', current);
      listeners.forEach(fn => fn(current));
    } catch (e) {
      console.warn('Weather unavailable:', e.message);
    }
    return current;
  },
  start() {
    this.refresh();
    setInterval(() => this.refresh(), 10 * 60 * 1000);
  }
};

// Condition used for painting: live, or forced from the scene options.
export function conditionFor(mode) {
  if (mode && mode !== 'live') return { kind: mode, cloud: { clear: 0.1, cloudy: 0.5, overcast: 0.95, rain: 0.9, snow: 0.9, fog: 0.8, storm: 1 }[mode] ?? 0.4, wind: mode === 'storm' ? 20 : 6, temp: mode === 'snow' ? 28 : 50 };
  const n = current;
  if (!n) return { kind: 'cloudy', cloud: 0.4, wind: 5, temp: 50 };
  return { kind: n.kind, cloud: n.cloud, wind: n.wind, temp: n.temp };
}
