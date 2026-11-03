#!/usr/bin/env bash
# Downloads candidate 4K fireplace clips, probes and measures them, and makes contact sheets.
set -u
OUT=cand; mkdir -p "$OUT" dl
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
python3 tools/fire/resolve_pixabay.py dl $PIXABAY > "$OUT/pixabay.jsonl" 2> "$OUT/pixabay.err" || true
cat "$OUT/pixabay.jsonl"
: > "$OUT/list.txt"
for p in $PEXELS; do [ "${p%%|*}" = 0 ] && continue; echo "pexels-${p%%|*} ${p#*|}" >> "$OUT/list.txt"; done
for f in dl/pixabay-*.mp4; do [ -f "$f" ] && echo "$(basename "$f" .mp4) file://$f" >> "$OUT/list.txt"; done
cat "$OUT/list.txt"
grep -v "^#" "$OUT/list.txt" > "$OUT/todo.txt"
while read -r name url; do
  f="dl/$name.mp4"
  case "$url" in file://*) ;; *) curl -sL --max-time 300 -A "$UA" -o "$f" "$url";; esac
  if ! ffprobe -v error "$f" >/dev/null 2>&1; then echo "$name download failed ($(stat -c %s "$f" 2>/dev/null) bytes)" | tee -a "$OUT/report.txt"; continue; fi
  {
    echo "== $name  $url"
    ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt,color_transfer,color_primaries,bit_rate:format=duration,size -of compact "$f"
  } | tee -a "$OUT/report.txt"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  ffmpeg -nostdin -v error -y -i "$f" -vf "fps=12/$dur,scale=480:-2,tile=4x3:padding=4" -frames:v 1 "$OUT/$name-sheet.jpg"
  ffmpeg -nostdin -v error -y -ss 5 -i "$f" -frames:v 1 -vf "crop=iw/2:ih/2:iw/4:ih/4,scale=960:-2" "$OUT/$name-detail.jpg"
  python3 tools/fire/analyze.py "$f" "$name" "$OUT" < /dev/null | tee -a "$OUT/report.txt"
done < "$OUT/todo.txt"
rm -f "$OUT"/*-W.npy
