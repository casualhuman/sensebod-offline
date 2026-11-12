# Mock media (development and tests only)

Tiny generated clips so the players can be built and tested without the real
content. None of this is copied into `dist/`.

| File | What | Made with |
|---|---|---|
| `sample-video.mp4` | 20 s, 320x180, H.264 Baseline + AAC mono, fast-start | `ffmpeg -f lavfi -i smptebars=s=320x180:r=10:d=20 -f lavfi -i sine=frequency=330:duration=20 -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -crf 30 -g 20 -c:a aac -b:a 16k -ac 1 -movflags +faststart` |
| `sample-audio.m4a` | 12 s tone, AAC mono | `ffmpeg -f lavfi -i sine=frequency=262:duration=12 -c:a aac -b:a 16k -ac 1 -movflags +faststart` |
| `sample-voice.m4a` | 3 s tone (a person speaking in Try it) | same, 392 Hz |
| `sample-captions.vtt` | WebVTT captions for the sample video | hand-written |
| `tryit/sample/index.html` | a one-file animation package | hand-written |

Served by the dev and preview servers at `/media/<file>` with byte-range support.
