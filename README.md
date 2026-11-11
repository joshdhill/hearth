# Hearth

Ambient scenes for the Google TV Streamer, with Spotify playing in the background.

| Scene | What it is |
| --- | --- |
| Fireside | A photoreal brick fireplace filling the whole screen (a generated picture, recomposed with a lower mantel, a wider firebox and a hearth across the full width), real fire footage in the firebox, firelight flickering over the brick, candles on the mantel, and the family's black cat: their own illustration, animated. She walks by, sits by the fire, has a wash, rolls over, naps, gets the zoomies and jumps up on the mantel. **Cat, do a trick** in the menu picks one; **Random: loop through them all** keeps her going through every trick, non-stop |
| Fireplace | Four real fireplaces in 4K (brick fireplace, roaring logs, hearth with grate, wood stove), each a 5-minute seamless loop; crackles that never repeat |
| Bird Window | Birds heard in the yard today (from the bird board feed) fly in and perch on the branch |
| Weather Window | Live Germantown sky: time of day, clouds, rain, snow, fog, with Sugarloaf on the horizon |
| Thanksgiving | Golden-hour window, pumpkins and candles on the sill, leaves falling |
| Winter Night | Snow at dusk, string lights, frost on the glass |
| Christmas Hearth | The teepee fire with a garland of lights |

Every scene can be changed from the menu (music, the cat, weather, time of day, season, lights, bird names and calls) and remembers your changes.

## Using it

- **OK** opens the menu. **Left/right** flips scenes (with or without the menu open).
- **Down** in the menu goes to the scene's settings; **OK** changes one. **Music** opens a list: the scene default, a few calm presets, and your own Spotify playlists.
- **Back** closes the menu; pressing Back twice leaves Hearth.

## How it fits together

- `docs/` is the scene engine, served by GitHub Pages at https://joshdhill.github.io/hearth/. The TV app loads it, so scene changes ship with a push, no reinstall.
- `android/` is the Google TV app: a native 4K video player under a transparent web view, plus a small bridge for Spotify and sounds. GitHub Actions builds it into the `app` release as `hearth.apk`.
- Music plays in the TV's own Spotify app; Hearth tells it what to play through the Spotify Web API (sign-in with PKCE, no secret).
- Fire footage: free 4K Pixabay clips, about a minute each. `tools/fire/build_long.py` re-cuts each one into a 5-minute loop: it measures how alike every pair of moments is, joins 4-12 second pieces only where the fire matches, blends each join over half a second in linear light, and closes the loop back into its own start. The TV gets 4K 10-bit HEVC (`media-v2` release); browsers and iPhones get 1080p HLS from `docs/media/fire/`.
- Fireside's picture and cat are made in `tools/art/`, with free tools only. The fireplace picture is rearranged by exact pixel work (`compose_scene.py` takes out brick courses to lower the mantel, widens the firebox and runs the hearth across; `clear_hearth.py` re-lays clean bricks in perspective), the gaps are painted in by FLUX Fill and the result is enlarged 4x with Real-ESRGAN, both on GitHub Actions (`art-scene.yml`, `art-upscale.yml`). `room.py` grades it into two layers, the room in the evening and the same room lit by the fire, which the page fades between as the fire flickers.
- The cat starts from one illustration. Free Hugging Face Spaces, called from GitHub Actions without an account (`gen.py`, `art-gen.yml`), re-pose it (FLUX Kontext) and animate it between a few shared poses (Wan 2.2). `cat_sprites.py` cuts every clip out of its paper background into sprite sheets in three sizes (`docs/media/cat/`), finds each gait's seamless stride and how fast the paws travel, and `docs/js/overlays/spritecat.js` chains the clips into tricks. A new trick is a new clip: add it to `tasks.json` and `clips.json`.
- `tools/fire/candidates.sh` scans candidate clips (steadiness, how well they loop) when choosing new footage.

## Installing on the TV (once)

1. On the TV: Settings → System → About → click **Android TV OS build** 7 times to turn on developer options.
2. Settings → System → Developer options → turn on **Wireless debugging**, then open it and choose **Pair device with pairing code**.
3. On the PC, with Android platform-tools:

```
adb pair <ip:pairing-port> <code>
adb connect <ip:port>
adb install -r hearth.apk
adb shell appops set com.joshdhill.hearth SYSTEM_ALERT_WINDOW allow
```

The last line lets Hearth come back to the front after it opens Spotify for a moment.
