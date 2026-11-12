# Sensebod round 5 — section screens in the chosen V3 style

The owner chose **V3 · Scene + badge (light version)**. Design the inside of each portal in exactly that style.

## Style source (read these fully first — copy their look precisely)
- `project/Main.dc.html` (V3 Home), `project/V3-Agriculture.dc.html`, `project/V3-SignIn.dc.html`, `project/V3-Components.dc.html` (tokens, ratios, components, video player, quiz states).
- Light flat page #F4F7FB (Agriculture #F3F8F4), white cards with 2px boundary ≥3:1, 150px flat illustrations on light tint panels with a 76px round icon badge (white ring, thick 3px-stroke icon) on the picture edge, extra-large titles, D-style bold icons with labels everywhere, Back + Home white buttons with blue border, English | Krio switch, gold Listen, blue #085CAA main buttons/badges (green #1F7A3A for Agriculture), red #C41E2A/#B3122A only for wrong/error/destructive. Reuse the exact token values and component markup from those files.
- Format rules: ROUND2-BRIEF.md (the `.dc.html` skeleton and "rules that bite"), UX rules from ROUND2/3/4 briefs. Each board is 390 wide, fixed; root height == `$preview` height; report exact heights. Logos: Sensebod `/_blob/85b192cd7d9b6351c5c7df6e9a0a36d1`, EasySTEM `/_blob/c8b3025900ccf14ef057b2b5da4b95e4`.
- Links: Home is `Main.dc.html`; Back goes to the previous screen in your flow; link between your own boards. Do not link to boards that don't exist (existing: Main, V3-SignIn, V3-Agriculture, V3-Components, plus the boards listed below for all agents: V3-Primary, V3-JSS, V3-CP-Who, V3-CP-Child, V3-CP-Parent, V3-CP-Elder, V3-CP-Help, V3-Climate, V3-Climate-Lesson, V3-Agri-Video, V3-Agri-Quiz, V3-Agri-Done).

## Content rules
- No invented statistics, phone numbers, laws or facts. Where a real detail is needed but unknown, write a clear placeholder in square brackets, e.g. "[Child helpline number — confirm]".
- Plain simple English, short sentences, 18px instructions. Krio only "Kushɛ!" and "Wi dae make u sensebod".
- Illustrations: simple, respectful, local (zinc roofs, school uniforms, river, farm); no trees on Child protection screens.
- Content shown on boards is sample curriculum structure, not lessons; keep it believable for Sierra Leone (Classes 1–6; JSS 1–3; subjects such as English Language, Mathematics, Integrated Science, Social Studies, Agricultural Science, Krio/local language is optional—do not claim an official syllabus).

Write ONLY your own files into `project/` (Write tool, one at a time). Do not publish, render, or edit any other file. Final report ≤120 words: files, exact heights, any placeholders you left, rules bent.
