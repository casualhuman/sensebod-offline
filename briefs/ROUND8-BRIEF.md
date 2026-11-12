# Sensebod round 8 — Style B with a diverse cast (Child protection)

The owner chose **Style B · Character portraits** (see `round7/CPB-*.dc.html`) but wants it far more extensive and DIVERSE — many different cartoon people, like a real animated series cast, not the same three faces repeated. Keep Style B's look exactly: original characters, head-and-shoulders (or two people side by side for pair scenes), clean dark-brown outlines (~2px at card size), cel shading (base + shadow + highlight, light from top-left), big friendly eyes with highlights, warm expressions, plain light-blue rounded/circular backgrounds (#E8F0F9 / #D6E6F7) so faces read at small sizes. Respectful, calm, never frightening, never stereotyped. No trees. Original characters only (do not imitate Akili and Me, Ubongo, Disney/Pixar, etc.).

## The cast (draw each exactly like this, everywhere)
Skin tones vary across the Sierra Leonean range — use base/shadow/highlight triples, e.g. deep #4A2A1A/#36200F/#6A4430, dark #6B3E26/#52301C/#8A5A3E, medium #8A5234/#6E3F27/#A86E4C, light-brown #A9714C/#8C5A3A/#C48C66.
| id | Who | Age | Look |
|---|---|---|---|
| fatmata | Child, girl | 11 | dark skin, cornrows, blue-and-white school uniform collar, small gold stud earrings |
| ibrahim | Child, boy | 9 | medium skin, short hair, big gap-tooth smile, white school shirt with blue tie |
| mariama | Child, girl | 6 | light-brown skin, two puff ponytails with blue bobbles, round cheeks, yellow-white dress |
| abu | Child, boy | 13 | deep skin, short hair, round glasses, hearing aid on one ear, blue polo |
| kadiatu | Teen girl | 15 | dark skin, light-blue hijab/headscarf, gentle smile, white top |
| isatu | Mother | ~35 | medium skin, blue patterned head tie (gele), blue lappa top with white beads |
| mohamed | Father | ~40 | dark skin, short beard, blue cap, white shirt |
| haja | Grandmother (carer) | ~65 | deep skin, grey hair under a white head tie, thin round glasses, warm wrinkles |
| pa-alimamy | Community elder (chief) | ~70 | dark skin, white beard, white kufi with blue embroidery, light gown |
| ya-bintu | Women's leader | ~55 | medium skin, tall blue head wrap, bead necklace, confident smile |
| mr-koroma | Teacher | ~45 | light-brown skin, short hair, rectangular glasses, shirt and blue tie |
| nurse-aminata | Health worker | ~30 | dark skin, short braids tucked, white nurse cap with blue band, white uniform |
| officer-sesay | Police Family Support Unit officer | ~35 | medium skin, police-style blue beret and light-blue uniform shirt with a plain badge (no real insignia, no weapon), kind expression |

Pair scenes (two people in one picture) are welcome: e.g. mr-koroma listening to fatmata; isatu kneeling and hugging mariama; mohamed and ibrahim talking; haja holding abu's hand; pa-alimamy speaking with isatu and mohamed; ya-bintu with kadiatu; nurse-aminata with mariama.

## Format and other rules
`.dc.html` rules in ROUND2-BRIEF.md (skeleton, "rules that bite"); V3 light UI and Child protection rules in ROUND3–7 briefs (quick-exit "Leave this page" on every screen, Back/Home/Listen, placeholders for contacts, lesson model with Video/Audio from ROUND6). Inline SVG only; gradients only inside `<defs>` with ids unique per file (prefix ids with the board name); each picture `role="img"` with a descriptive aria-label naming who is shown. Keep boards reasonably light (< 180 KB each).

## Phase 2 — building screens from the cast
The cast now exists: `cast/<id>.svg.txt` (13 portraits, viewBox 0 0 200 200) and `cast/pair-*.svg.txt` (4 scenes), shown together on `project/CPB-Cast.dc.html`. REUSE these exact drawings — copy the `<svg>` markup inline, replace every `__ID__` with a unique prefix per use (e.g. `whoChild1`), and size it with width/height (keep the viewBox). Do not redraw characters; you may combine 2–3 portraits side by side or overlapping in one picture slot to make a group or a new pair (e.g. mohamed + ibrahim, haja + abu, ya-bintu + kadiatu). Every picture slot on a screen should show DIFFERENT people where sensible, so the whole section shows the full, diverse cast. Base each screen on its current source board (layout, copy, lessons, links, quick-exit) and only change the pictures and the minimum layout needed. Root size == `$preview`; report exact sizes. Write only your files; do not publish.
