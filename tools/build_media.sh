#!/usr/bin/env bash
# Builds seamless fireplace loops from Pexels footage (Pexels license: free use, modification allowed).
# usage: build_media.sh <pexels-url> <name> <crossfade-seconds>
set -euo pipefail
URL=$1; NAME=$2; D=$3
OUT=out; mkdir -p "$OUT" work
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"
curl -sL -A "$UA" -o work/$NAME.mp4 "$URL"
L=$(ffprobe -v error -show_entries format=duration -of csv=p=0 work/$NAME.mp4)
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 work/$NAME.mp4)
HASA=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 work/$NAME.mp4 | head -1)
OFF=$(python3 -c "print(round($L-2*$D,3))")
echo "$NAME: duration $L fps $FPS crossfade $D offset $OFF audio=${HASA:-none}"
VF="[0:v]trim=start=$D:end=$L,setpts=PTS-STARTPTS[a];[0:v]trim=start=0:end=$D,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=$D:offset=$OFF[v]"
if [ -n "$HASA" ]; then
  AF=";[0:a]atrim=start=$D:end=$L,asetpts=PTS-STARTPTS[aa];[0:a]atrim=start=0:end=$D,asetpts=PTS-STARTPTS[ab];[aa][ab]acrossfade=d=$D:c1=tri:c2=tri[ao]"
  MAPA=(-map "[ao]" -c:a aac -b:a 192k)
else AF=""; MAPA=(-an); fi
# 4K HEVC for the TV
ffmpeg -v error -y -i work/$NAME.mp4 -filter_complex "$VF$AF" -map "[v]" "${MAPA[@]}" \
  -c:v libx265 -preset medium -crf 21 -pix_fmt yuv420p -tag:v hvc1 \
  -x265-params "vbv-maxrate=26000:vbv-bufsize=52000:log-level=error" -movflags +faststart "$OUT/$NAME-4k.mp4"
# 1080p H.264 for browsers and as a fallback
ffmpeg -v error -y -i work/$NAME.mp4 -filter_complex "$VF$AF;[v]scale=1920:-2[v2]" -map "[v2]" "${MAPA[@]}" \
  -c:v libx264 -preset slow -crf 21 -maxrate 9M -bufsize 18M -pix_fmt yuv420p -movflags +faststart "$OUT/$NAME-1080.mp4"
ffmpeg -v error -y -ss 3 -i "$OUT/$NAME-1080.mp4" -frames:v 1 -vf scale=640:-2 -q:v 3 "$OUT/$NAME-poster.jpg"
# loop-seam check: last frame vs first frame, and frames around the seam for review
LL=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$NAME-1080.mp4")
ffmpeg -v error -y -sseof -0.05 -i "$OUT/$NAME-1080.mp4" -frames:v 1 -vf scale=480:-2 work/last.png
ffmpeg -v error -y -i "$OUT/$NAME-1080.mp4" -frames:v 1 -vf scale=480:-2 work/first.png
ffmpeg -v error -y -i work/last.png -i work/first.png -filter_complex hstack "$OUT/$NAME-seam.jpg"
{ echo "$NAME loop length $LL"; ls -la $OUT/$NAME-*; } >> "$OUT/report.txt"
if [ -n "$HASA" ]; then
  ffmpeg -v info -i "$OUT/$NAME-1080.mp4" -map 0:a -af ebur128=framelog=quiet -f null - 2>&1 | grep -E "I:|LRA:" | sed "s/^/$NAME audio /" >> "$OUT/report.txt" || true
  ffmpeg -v error -y -i "$OUT/$NAME-1080.mp4" -map 0:a -filter_complex "showspectrumpic=s=960x320:legend=0" "$OUT/$NAME-spectrum.png"
fi
