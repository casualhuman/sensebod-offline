# Sensebod round 3 — one merged direction, 5 variations

Read ROUND2-BRIEF.md (beside this file) for the product, users, hard UX rules, real content, the 4 artboards and — most important — the exact `.dc.html` format rules. Everything there still holds EXCEPT where this file changes it.

The product owner reviewed round 2 (reference files in `round2/`, read-only) and asked for ONE merged direction:

1. **Layout and cards from E** (`round2/E-Home.dc.html`, `round2/E-Agriculture.dc.html`, `round2/E-Components.dc.html`): portal cards with a simple flat illustration plus a title and a short description. Keep the illustrated, storybook warmth.
2. **Legibility and icons from D** (`round2/D-*.dc.html`): big, bold, instantly readable icons — thick strokes (≈3px at 24px, scale up proportionally), simple filled/outlined shapes, large sizes (40–88px), always with a bold label. Use this icon style EVERYWHERE: portal cards (an icon badge alongside the illustration), Back, Home, Listen, Play, Pause, Back 10s, Forward 10s, Captions, Sound, Full screen, Take the quiz, Watch again, Next, Save, Skip, person, language, check/correct, try again, error. The owner said D's icons make reading easier — make them even clearer, not thinner.
3. **Thick blue background from B** (`round2/B-*.dc.html`): the screen background is a deep, strong brand blue (e.g. #0A3A6B → #085CAA) that gives contrast and hierarchy; content sits on white cards. Agriculture screen may use deep green (#155A2A → #1F7A3A) the same way.
4. **Child protection illustration: NO tree.** Show an adult and child (hand in hand), maybe a home/heart/shield — nothing else. In general keep illustrations uncluttered; no trees except where farming/climate clearly needs plants.
5. **Bigger components** in the component library: primary buttons 64–72px tall, control buttons in the video player ≥72px with icons ≥36px, quiz answers ≥76px, body text 18px, labels ≥16px. Show the library at a size that reads clearly when zoomed out.
6. **Colour rule (updated):** blue is the main colour, white cards, ink text. Agriculture = green. Gold #E4AA09 (ink text) only on Listen. **Red is allowed for meaning**: wrong answer / try again, errors, and destructive actions such as "Remove a name" — use #C41E2A (white text 5.9:1) or red text #B3122A on white/very light red (#FDECEE), always with an icon + words. Green #1F7A3A for correct/saved. Do not use red or green decoratively. Keep it harmonious — no extra colours beyond blue, white/neutrals, green (agriculture + success), red (errors/wrong), gold (Listen). Check every text pair is WCAG AA (python3 -I) and print ratios in the colour section.
7. Video player: as specified in ROUND2-BRIEF (ready / playing / finished states) but bigger and with the D-style icons; "Take the quiz" is the big main button when finished.

## The 4 artboards per variation
Home (390 wide), Sign-in (390 wide), Agriculture (390 wide), Component library (1440 wide). Heights as needed; each root's fixed height must equal its `$preview` height, and report the exact heights. Logos: Sensebod `/_blob/85b192cd7d9b6351c5c7df6e9a0a36d1` (place on a white pill/area since it is multicolour), EasySTEM `/_blob/c8b3025900ccf14ef057b2b5da4b95e4`.

Write ONLY your 4 files into `project/` with the exact names you are given (Write tool, one at a time). Do not publish, render or touch any other file. Final report ≤120 words: the variation's idea in one line, exact heights, rules bent.
