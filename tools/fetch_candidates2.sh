#!/usr/bin/env bash
# Second round of fireplace candidates: longer 4K clips from Pixabay and Pexels (both free licenses).
set -u
OUT=media-candidates2; mkdir -p "$OUT" dl
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
probe() { # name url
  local n=$1 u=$2 f="dl/$1.mp4"
  curl -sL -A "$UA" -o "$f" "$u"
  if ! ffprobe -v error "$f" >/dev/null 2>&1; then echo "$n -> not a video ($u)" >> "$OUT/report.txt"; rm -f "$f"; return; fi
  { echo "== $n  $u"; ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,pix_fmt,codec_name,bit_rate:format=duration,size -of compact "$f"; } >> "$OUT/report.txt"
  local d; d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  ffmpeg -v error -y -i "$f" -vf "fps=9/$d,scale=640:-2,tile=3x3:padding=6" -frames:v 1 "$OUT/$n-sheet.jpg"
  rm -f "$f"
}
# Pixabay: read the download link from each video page
for slug in fire-fireplace-burning-crackling-234515 fire-fireplace-campfire-bonfire-239514 fire-flame-wood-fireplace-oven-123069 \
            fire-log-burning-flames-flaming-8647 fire-wood-fire-fireplace-logs-4834 fireplace-fire-wood-house-winter-7069 \
            fireplace-fire-wood-house-winter-7070 fire-fireplace-flame-burn-hot-44699; do
  id=${slug##*-}
  page=$(curl -sL -A "$UA" "https://pixabay.com/videos/$slug/")
  u=$(echo "$page" | grep -oE 'https://cdn\.pixabay\.com/video/[0-9/]+'"$id"'_large\.mp4' | head -1)
  [ -z "$u" ] && u=$(echo "$page" | grep -oE 'https://cdn\.pixabay\.com/video/[0-9/]+'"$id"'_[a-z]+\.mp4' | head -1)
  if [ -n "$u" ]; then probe "pixabay-$id" "$u"; else echo "pixabay-$id -> no link found (page ${#page} bytes)" >> "$OUT/report.txt"; fi
done
# a known direct link, in case the page lookup is blocked
grep -q "pixabay-234515" "$OUT/report.txt" 2>/dev/null && grep -q "== pixabay-234515" "$OUT/report.txt" || probe "pixabay-234515b" "https://cdn.pixabay.com/video/2024/10/03/234515_large.mp4"
# Pexels: more fireplace clips
for id in 855381 855624 6611724 32575073; do
  got=""
  for res in uhd_3840_2160 uhd_4096_2160 uhd_2560_1440 hd_1920_1080; do for fps in 60 50 30 29.97 25 24; do
    u="https://videos.pexels.com/video-files/$id/$id-${res}_${fps}fps.mp4"
    [ "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" -I "$u")" = 200 ] && { got=$u; break 2; }
  done; done
  [ -z "$got" ] && got=$(curl -s -o /dev/null -w "%{redirect_url}" -A "$UA" "https://www.pexels.com/download/video/$id/")
  if [ -n "$got" ]; then probe "pexels-$id" "$got"; else echo "pexels-$id -> no link" >> "$OUT/report.txt"; fi
done
