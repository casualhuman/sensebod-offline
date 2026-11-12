#!/bin/sh
# Reviewer B: header / routing / caching / range checks against a running server.
#   sh server-checks.sh http://127.0.0.1:48080 > server-checks-nginx.log
# The server must serve app/dist as the site root and app/mock/media as /media/.
B="$1"
ENTRY=$(curl -s "$B/" | sed -n 's/.*data-src="\([^"]*\)".*/\1/p')
FONT=$(curl -s "$B/" | sed -n 's/.*href="\(\/assets\/poppins-latin-400[^"]*\)".*/\1/p')
h() { # h <label> <curl args...>  -> status line + selected headers
  label="$1"; shift
  echo "### $label"
  curl -s -o /dev/null -D - "$@" | tr -d '\r' | grep -i -E '^(HTTP/|content-type|content-encoding|content-length|content-range|accept-ranges|cache-control|etag|vary|location|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|server|content-security-policy)' | sed 's/^\(content-security-policy: .\{60\}\).*/\1 .../I'
  echo
}
echo "entry chunk: $ENTRY   font: $FONT"; echo
h "1 shell /" "$B/"
h "1b shell / gzip" -H 'Accept-Encoding: gzip' "$B/"
h "2 deep link /portal/agriculture (SPA fallback)" -H 'Accept-Encoding: gzip' "$B/portal/agriculture"
h "2b deep link /lesson/abc/done" "$B/lesson/abc/done"
h "2c /index.html directly" "$B/index.html"
h "3 missing asset must be 404, not the shell" "$B/assets/nope-12345678.js"
h "3b missing illustration" "$B/illustrations/nope.svg"
h "4 entry chunk gzip" -H 'Accept-Encoding: gzip' "$B$ENTRY"
h "4b entry chunk identity" "$B$ENTRY"
h "5 font" -H 'Accept-Encoding: gzip' "$B$FONT"
h "6 illustration gzip, versioned" -H 'Accept-Encoding: gzip' "$B/illustrations/agriculture/cast/mama-fatu.svg?v=abc"
h "7 logo (unhashed)" "$B/brand/sensebod-logo.png"
ETAG=$(curl -s -o /dev/null -D - "$B/brand/sensebod-logo.png" | tr -d '\r' | sed -n 's/^[Ee][Tt]ag: //p')
h "7b logo If-None-Match -> 304" -H "If-None-Match: $ETAG" "$B/brand/sensebod-logo.png"
ETAG=$(curl -s -o /dev/null -D - "$B/" | tr -d '\r' | sed -n 's/^[Ee][Tt]ag: //p')
h "7c shell If-None-Match -> 304" -H "If-None-Match: $ETAG" "$B/"
h "8 favicon" "$B/favicon.png"
h "9 portal picture gzip" -H 'Accept-Encoding: gzip' "$B/pictures/portals/primary.svg"
h "10 media full" "$B/media/sample-video.mp4"
h "10b media range 1000-1999 -> 206" -H 'Range: bytes=1000-1999' "$B/media/sample-video.mp4"
h "10c media suffix range" -H 'Range: bytes=-500' "$B/media/sample-audio.m4a"
h "10d media unsatisfiable range -> 416" -H 'Range: bytes=99999999-' "$B/media/sample-video.mp4"
h "10e captions" -H 'Accept-Encoding: gzip' "$B/media/sample-captions.vtt"
h "10f missing media" "$B/media/nope.mp4"
h "11 animation package index.html" "$B/media/tryit/sample/index.html"
h "11b animation package directory" "$B/media/tryit/sample/"
h "11c animation package missing file" "$B/media/tryit/sample/nope.js"
h "12 API GET (json, gzip)" -H 'Accept-Encoding: gzip' "$B/api/v1/portals"
h "12b API 404" "$B/api/v1/lessons/nope"
h "13 traversal /assets/../index.html" --path-as-is "$B/assets/../index.html"
h "13b traversal /media/../../../etc/passwd" --path-as-is "$B/media/../../../etc/passwd"
h "13c traversal encoded" --path-as-is "$B/media/%2e%2e/%2e%2e/etc/passwd"
h "14 pre-compressed twin requested directly" "$B/index.html.gz"
h "15 HEAD on shell" -I "$B/"
h "16 POST to an app path" -X POST "$B/save-progress"
echo "### 17 body of the deep link equals index.html"
[ "$(curl -s "$B/portal/x/y/z" | shasum | cut -d' ' -f1)" = "$(curl -s "$B/index.html" | shasum | cut -d' ' -f1)" ] && echo same || echo DIFFERENT
echo "### 18 gzip body of entry decodes to the identity body"
[ "$(curl -s -H 'Accept-Encoding: gzip' "$B$ENTRY" | gunzip | shasum | cut -d' ' -f1)" = "$(curl -s "$B$ENTRY" | shasum | cut -d' ' -f1)" ] && echo same || echo DIFFERENT
