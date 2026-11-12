# Sensebod round 7 — Child protection with realistic cartoon illustrations (2 alternatives)

The owner wants the Child protection illustrations (e.g. the "I am a child / I am a parent or carer / I am a community elder" cards) redrawn as **realistic cartoons** instead of the current simple flat shapes. Make ONE alternative style per agent. Change ONLY the illustrations (and the minimum layout needed to show them well); keep every other part of the V3 light design, copy, components, quick-exit, links and accessibility exactly as in the source boards.

## Source boards to copy (read fully first)
- Phone: `project/V3-CP-Who.dc.html`, `project/V3-CP-Child.dc.html`, `project/V3-CP-Audio.dc.html`
- Tablet: `project/T-CP-Who.dc.html`
- Format rules: ROUND2-BRIEF.md ("rules that bite", skeleton). Other rules: ROUND3–6 briefs.

## What "realistic cartoon" means here
- People who look like real Sierra Leoneans, drawn as a polished children's-book / animation-style cartoon: believable proportions (child ≈ 10–12 years, adult, older elder), expressive friendly faces (eyes with highlights, eyebrows, nose, mouth, ears), hair (short natural hair, braids/cornrows, head tie), hands, and clothing with folds.
- Natural skin tones in a range of warm browns (e.g. #6B3E26, #8A5234, #A0643F with darker shade and lighter highlight tones) — this is the one place colours beyond blue are allowed; keep everything else harmonious: clothing and backgrounds in the brand blues/whites/neutrals (school uniform in blue/white, parent in a blue lappa and head tie or shirt, elder in a white or light blue gown and kufi cap). No green except grass if truly needed, no red except tiny details. No trees on Child protection screens.
- Depth: 2–3 tones per surface (base, shadow, highlight), soft shapes, consistent light from top-left. Respectful, warm, calm — never frightening, never stereotyped, no violence or distress shown.
- Everything as inline SVG (paths, ellipses, gradients allowed INSIDE illustrations only via `<linearGradient>`/`<radialGradient>` in `<defs>` with unique ids per file). Each illustration `role="img"` with a descriptive `aria-label`. Keep each file reasonably light (aim < 140 KB per board).
- Do not copy or imitate any existing brand's characters (e.g. Akili and Me, Ubongo, Disney/Pixar). Original characters only. Give the three people consistent looks across all boards (the same child, parent, elder), and use them on the Child lessons page (lesson cards/cover thumbnails) and the audio lesson cover.

## Deliverables per alternative (prefix given by your task)
1. `<P>-Who.dc.html` — phone 390 wide (copy of V3-CP-Who with new illustrations).
2. `<P>-Who-Tab.dc.html` — tablet 800 wide (copy of T-CP-Who with new illustrations).
3. `<P>-Child.dc.html` — phone 390 wide (copy of V3-CP-Child with new illustrations on lesson cards and header).
4. `<P>-Audio.dc.html` — phone 390 wide (copy of V3-CP-Audio with a new cover illustration).
Links: the Who boards' child card → `<P>-Child.dc.html`; Child page Lesson 2 → `<P>-Audio.dc.html`; Audio Back → `<P>-Child.dc.html`; other links as in the source (existing boards). Root size == `$preview`; report exact heights. Write only your 4 files into `project/`, one at a time; do not publish or render. Final report ≤120 words: the style in one line, files + heights, anything bent.
