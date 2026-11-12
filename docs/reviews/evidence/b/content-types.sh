#!/bin/sh
# Reviewer B: Content-Type the server gives each file extension under /media/types/
# (folder made by make-probe-media.mjs).   sh content-types.sh http://127.0.0.1:48080
for ext in mp4 m4v m4a mp3 webm 3gp ogg oga opus wav aac mov mkv gif png jpg jpeg webp svg ico bmp pdf docx doc txt xml json js mjs css html htm vtt srt woff woff2 ttf otf wasm zip h5p; do
  printf '%-6s %s\n' ".$ext" "$(curl -s -o /dev/null -D - "$1/media/types/file.$ext" | tr -d '\r' | sed -n 's/^[Cc]ontent-[Tt]ype: //p')"
done
