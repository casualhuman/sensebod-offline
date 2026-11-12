# Fonts shipped with the app

All files are WOFF2, served from the Pi, content-hashed by the build.

| File | Source | Licence | Contents |
|---|---|---|---|
| `poppins-latin-{400,600,700,800}.woff2` | Poppins 4.x via `@fontsource/poppins` 5.3.0 (`poppins-latin-*-normal.woff2`), re-subset with fontTools `pyftsubset` | SIL OFL 1.1 (`OFL-Poppins.txt`) | U+0020-007E, U+00A0-00FF, – — ‘ ’ “ ” • … (199 code points), kerning kept, hinting dropped |
| `krio-letters-{400,600,700,800}.woff2` | Montserrat via `@fontsource/montserrat` 5.3.0 (`montserrat-latin-ext-*-normal.woff2`), subset with `pyftsubset` | SIL OFL 1.1 (`OFL-Montserrat.txt`) | Only Ɛ ɛ Ɔ ɔ Ŋ ŋ (U+0190, U+025B, U+0186, U+0254, U+014A, U+014B) |

Why two families: **Poppins has no glyphs for the Krio letters ɛ, ɔ and ŋ** (checked with
fontTools in the latin, latin-ext and devanagari files: none of the code points is in the
cmap). Without help the browser would draw those letters in whatever system font the
phone has. `krio-letters-*` supplies just those six glyphs from Montserrat, whose
proportions are close to Poppins (x-height 525-542 vs 548-561 per 1000 units, cap height
700 vs 698-709). The `@font-face` rules in `../styles/fonts.css` restrict it with
`unicode-range`, so it is only downloaded on a page that actually shows one of the letters.

Weights: 400, 600, 700 and 800 only. Weight 500 appears twice on the current boards and
is not shipped; do not use `font-weight: 500` (the browser would silently pick 400).

Regenerate (needs Python fontTools + brotli, build-time only):

```
pyftsubset poppins-latin-<w>-normal.woff2 \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026" \
  --layout-features='kern,liga,locl,mark,mkmk,ccmp' --flavor=woff2 --no-hinting --desubroutinize
pyftsubset montserrat-latin-ext-<w>-normal.woff2 \
  --unicodes="U+0186,U+0190,U+0254,U+025B,U+014A,U+014B" --layout-features='kern' --flavor=woff2 --no-hinting --desubroutinize
```

Characters outside these sets (for example → or ◆, or accented letters beyond Latin-1)
fall back to Arial / the system sans-serif.
