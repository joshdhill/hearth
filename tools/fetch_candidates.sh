#!/usr/bin/env bash
# Downloads candidate fireplace clips from Pexels (free license) and makes contact sheets.
set -u
OUT=media-candidates; mkdir -p "$OUT"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
for id in $IDS; do
  f="$OUT/$id.mp4"; got=""
  for res in uhd_3840_2160 uhd_4096_2160 uhd_2560_1440 hd_1920_1080; do
    for fps in 60 59.94 50 30 29.97 25 24 23.976; do
      u="https://videos.pexels.com/video-files/$id/$id-${res}_${fps}fps.mp4"
      code=$(curl -s -o /dev/null -w "%{http_code}" -A "$UA" -I "$u")
      if [ "$code" = "200" ]; then got="$u"; break 2; fi
    done
  done
  if [ -z "$got" ]; then
    # fall back to the download endpoint (redirects to the original upload)
    loc=$(curl -s -o /dev/null -w "%{redirect_url}" -A "$UA" "https://www.pexels.com/download/video/$id/")
    [ -n "$loc" ] && got="$loc"
  fi
  echo "$id -> ${got:-NOT FOUND}" | tee -a "$OUT/report.txt"
  [ -z "$got" ] && continue
  curl -sL -A "$UA" -o "$f" "$got" || continue
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,codec_name,bit_rate:format=duration,size -of compact "$f" | tee -a "$OUT/report.txt"
  ffprobe -v error -select_streams a -show_entries stream=codec_name -of compact "$f" | sed "s/^/  audio: /" | tee -a "$OUT/report.txt"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  # 3x3 sheet across the clip + first/last frame pair for loop checking
  ffmpeg -v error -y -i "$f" -vf "fps=9/$dur,scale=640:-2,tile=3x3:padding=6" -frames:v 1 "$OUT/$id-sheet.jpg"
  ffmpeg -v error -y -ss 0 -i "$f" -frames:v 1 -vf scale=960:-2 "$OUT/$id-first.jpg"
  ffmpeg -v error -y -sseof -0.2 -i "$f" -frames:v 1 -vf scale=960:-2 "$OUT/$id-last.jpg"
done
rm -f "$OUT"/*.mp4
