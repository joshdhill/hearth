#!/usr/bin/env bash
# Downloads candidate 4K fireplace clips, probes and measures them, and makes contact sheets.
set -u
OUT=cand; mkdir -p "$OUT" dl
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
python3 tools/fire/resolve_pixabay.py $PIXABAY > "$OUT/pixabay.jsonl" 2> "$OUT/pixabay.err" || true
cat "$OUT/pixabay.jsonl"
{
  for p in $PEXELS; do echo "pexels-${p%%|*} ${p#*|}"; done
  python3 - "$OUT/pixabay.jsonl" <<'PY'
import json, re, sys
for line in open(sys.argv[1]):
    d = json.loads(line)
    for u in d.get('large', [])[:1]:
        m = re.search(r'-(\d+)/?$', d['page'].rstrip('/'))
        print(f"pixabay-{m.group(1) if m else 'x'} {u}")
PY
} > "$OUT/list.txt"
cat "$OUT/list.txt"
while read -r name url; do
  f="dl/$name.mp4"
  curl -sL -A "$UA" -e "https://pixabay.com/" -o "$f" "$url"
  if ! ffprobe -v error "$f" >/dev/null 2>&1; then echo "$name download failed ($(stat -c %s "$f" 2>/dev/null) bytes)" | tee -a "$OUT/report.txt"; continue; fi
  {
    echo "== $name  $url"
    ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt,color_transfer,color_primaries,bit_rate:format=duration,size -of compact "$f"
  } | tee -a "$OUT/report.txt"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  ffmpeg -v error -y -i "$f" -vf "fps=12/$dur,scale=480:-2,tile=4x3:padding=4" -frames:v 1 "$OUT/$name-sheet.jpg"
  ffmpeg -v error -y -ss 5 -i "$f" -frames:v 1 -vf "crop=iw/2:ih/2:iw/4:ih/4,scale=960:-2" "$OUT/$name-detail.jpg"
  python3 tools/fire/analyze.py "$f" "$name" "$OUT" | tee -a "$OUT/report.txt"
done < "$OUT/list.txt"
rm -f "$OUT"/*-W.npy
