"""Reviewer B: glyph coverage of the shipped WOFF2 files against fonts.css.
Run:  python font-coverage.py app/src/shared/fonts app/src   (needs fontTools + brotli)
"""
import glob, os, sys
from fontTools.ttLib import TTFont

font_dir, src_dir = sys.argv[1], sys.argv[2]
KRIO = [0x190, 0x25B, 0x186, 0x254, 0x14A, 0x14B]
covered = set()
for path in sorted(glob.glob(os.path.join(font_dir, '*.woff2'))):
    f = TTFont(path)
    cmap = set(f.getBestCmap().keys())
    covered |= cmap
    name = f['name'].getDebugName(1)
    os2 = f['OS/2']
    hhea = f['hhea']
    print('%-28s %5d B  family=%-12s weight=%d upm=%d xHeight=%s cap=%s asc=%d desc=%d glyphs=%d cmap=%d krio=%s' % (
        os.path.basename(path), os.path.getsize(path), name, os2.usWeightClass, f['head'].unitsPerEm,
        getattr(os2, 'sxHeight', '?'), getattr(os2, 'sCapHeight', '?'), hhea.ascent, hhea.descent,
        len(f.getGlyphOrder()), len(cmap),
        ''.join(chr(c) if c in cmap else '-' for c in KRIO)))
    if 'poppins' in path:
        declared = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | {0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026}
        print('   declared unicode-range not in file:', ['U+%04X' % c for c in sorted(declared - cmap)],
              ' in file not declared:', ['U+%04X' % c for c in sorted(cmap - declared)])

# every non-ASCII character that appears in the given source tree, and whether a shipped font has it
used = {}
for root, _, files in os.walk(src_dir):
    for fn in files:
        if not fn.endswith(('.ts', '.tsx', '.html', '.css')):
            continue
        p = os.path.join(root, fn)
        for ch in set(open(p, encoding='utf8').read()):
            if ord(ch) > 0x7E:
                used.setdefault(ch, set()).add(os.path.relpath(p, src_dir))
print('\nnon-ASCII characters in', src_dir)
for ch in sorted(used):
    print('  U+%04X %s  %s  %s' % (ord(ch), ch, 'in font ' if ord(ch) in covered else 'FALLBACK', sorted(used[ch])[:4]))
