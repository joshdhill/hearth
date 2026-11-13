// The scene presets. Each one can be changed from the menu; changes are remembered per scene.
import { TRICKS } from '../overlays/tooncat.js';

export const SCENES = [
  {
    id: 'fireside', name: 'Fireside', type: 'hearth',
    blurb: 'A brick fireplace filling the screen, a real fire, candles on the mantel, and the cat doing her tricks.',
    defaults: { sound: 'medium', crackle: true, cat: 'often', candles: true, room: 'evening', music: 'search:Jazz by the fireplace' }
  },
  {
    id: 'fireplace', name: 'Fireplace', type: 'fire',
    blurb: 'A brick fireplace in 4K, a long loop with no visible restart.',
    defaults: { fire: 'brick', sound: 'medium', crackle: true, cat: 'off', lights: false, music: 'search:Jazz by the fireplace' }
  },
  {
    id: 'birdwindow', name: 'Bird Window', type: 'window', branch: true, view: 'woods', wall: '#8a8b79',
    blurb: 'Birds heard in the yard today land on the branch.',
    defaults: { birds: true, names: true, calls: true, weather: 'live', time: 'live', season: 'auto', cat: 'sometimes', music: 'spotify:playlist:37i9dQZF1DX4sWSpwq3LiO' }
  },
  {
    id: 'weather', name: 'Weather Window', type: 'window', branch: false, view: 'field', wall: '#86806f', showWeather: true,
    blurb: 'The sky over Germantown right now.',
    defaults: { weather: 'live', time: 'live', season: 'auto', cat: 'off', music: 'spotify:playlist:37i9dQZF1DX3Ogo9pFvBkY' }
  },
  {
    id: 'thanksgiving', name: 'Thanksgiving', type: 'window', branch: true, view: 'woods', decor: 'autumn', wall: '#7a5c46', trim: '#e2d6c0',
    blurb: 'Pumpkins and candles on the sill, leaves coming down.',
    defaults: { birds: true, names: true, calls: false, weather: 'live', time: 'golden', season: 'autumn', leaves: true, cat: 'sometimes', music: 'search:Acoustic autumn' }
  },
  {
    id: 'winter', name: 'Winter Night', type: 'window', branch: true, view: 'woods', decor: 'winter', wall: '#5f5551', trim: '#e7e2d8',
    blurb: 'Snow falling past the window lights.',
    defaults: { birds: true, names: true, calls: false, weather: 'snow', time: 'dusk', season: 'winter', lights: true, cat: 'sometimes', music: 'search:Christmas jazz' }
  },
  {
    id: 'christmas', name: 'Christmas Hearth', type: 'fire', decor: 'christmas',
    blurb: 'The fire, with a garland of lights.',
    defaults: { fire: 'roaring', sound: 'medium', crackle: true, cat: 'sometimes', lights: true, music: 'search:Christmas classics' }
  }
];

// Options shown in the menu, by scene type. Values cycle with OK.
export const OPTIONS = [
  { key: 'fire', label: 'Fire', types: ['fire'], values: [['brick', 'Brick fireplace'], ['logs', 'Roaring logs'], ['roaring', 'Hearth with grate'], ['stove', 'Wood stove']] },
  { key: 'trick', label: 'Cat, do a trick', types: ['hearth'], action: true, hint: 'Pick one', values: TRICKS },
  { key: 'room', label: 'Room', types: ['hearth'], values: [['evening', 'Evening'], ['dark', 'Lights out'], ['lamp', 'Lamp on']] },
  { key: 'candles', label: 'Candles', types: ['hearth'], values: [[true, 'Lit'], [false, 'Out']] },
  { key: 'sound', label: 'Fire sound', types: ['fire', 'hearth'], values: [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
  { key: 'birds', label: 'Birds', types: ['window'], branch: true, values: [[true, 'On'], [false, 'Off']] },
  { key: 'names', label: 'Bird names', types: ['window'], branch: true, values: [[true, 'On'], [false, 'Off']] },
  { key: 'calls', label: 'Bird calls', types: ['window'], branch: true, values: [[true, 'On'], [false, 'Off']] },
  { key: 'weather', label: 'Weather', types: ['window'], values: [['live', 'Live'], ['clear', 'Clear'], ['cloudy', 'Cloudy'], ['rain', 'Rain'], ['snow', 'Snow'], ['fog', 'Fog'], ['storm', 'Storm']] },
  { key: 'time', label: 'Time of day', types: ['window'], values: [['live', 'Live'], ['day', 'Day'], ['golden', 'Golden hour'], ['dusk', 'Dusk'], ['night', 'Night']] },
  { key: 'season', label: 'Season', types: ['window'], values: [['auto', 'Live'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']] },
  { key: 'leaves', label: 'Falling leaves', types: ['window'], values: [[false, 'Off'], [true, 'On']] },
  { key: 'lights', label: 'String lights', types: ['window', 'fire'], values: [[false, 'Off'], [true, 'On']] },
  { key: 'cat', label: 'Cat', types: ['window', 'fire', 'hearth'], values: [['off', 'Off'], ['sometimes', 'Now and then'], ['often', 'Often'], ['loop', 'Non-stop tricks']] }
];
