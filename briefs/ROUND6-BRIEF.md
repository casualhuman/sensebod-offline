# Sensebod round 6 — Child protection as lessons (video + audio), phone and tablet

Style: exactly V3 light (read `project/Main.dc.html`, `project/V3-Components.dc.html`, `project/V3-Agri-Video.dc.html`, and the current `project/V3-CP-*.dc.html` boards first). Format rules: ROUND2-BRIEF.md ("rules that bite", skeleton). UX/content rules: ROUND3–5 briefs (no trees on Child protection, red only for urgent help/errors, placeholders in [brackets] for any real contact or legal detail, never invent numbers). Every Child protection screen keeps: Back, Home (`Main.dc.html`), Listen, and the "Leave this page" quick-exit (links to `Main.dc.html`).

## New content model
Each audience has a **lesson series**. A lesson is ONE item of one type: **Video** or **Audio** (later maybe Picture story). Show the type clearly on every lesson card with a big D-style icon + word ("Video" with a play-in-screen icon, "Audio" with a headphones icon) — never by colour alone — plus the lesson number, title, length placeholder "[length]", and state (Not started / Started / Finished, icon + words). Above the list: a big 3-way filter "All lessons · Videos · Audio" (segmented buttons ≥56px, "All lessons" selected) and progress in words ("You finished 1 of 4 lessons"). End each series with "Check what you learned" (a short quiz, icon + label).

| Audience | Lesson 1 | Lesson 2 | Lesson 3 | Lesson 4 |
|---|---|---|---|---|
| Child | Video · My body belongs to me (Finished) | Audio · Safe and unsafe touch — a story to listen to (Started) | Video · Who can I tell? | Audio · It is not my fault |
| Parent or carer | Video · Keeping children safe at home (Finished) | Audio · Signs a child may need help (Started) | Video · How to listen when a child tells you | Audio · Where to report [confirm local services] |
| Community elder | Video · Your role in protecting children (Finished) | Audio · Talking with families (Started) | Video · How to refer a case [confirm local referral path] | Audio · Child marriage and the law [confirm local guidance] |

Keep each audience page's other helpful parts (e.g. the Elder 4-step "If a child tells you" card, the Child "Talk to someone you trust" card, Get help now button).

## Lesson screens (new)
- **Video lesson** — example: Child · "Lesson 1 · Video · My body belongs to me". Reuse the V3 video player (dark 16:9 area with a gentle, non-frightening illustration, captions line, thick seek bar with "[length]", big labelled Back 10s · Pause · Forward 10s, second row Captions · Sound · Full screen). Below: "Lesson 1 of 4" in words + segmented progress, one-line "What you will learn", and the next-step card "Next: Lesson 2 · Audio · Safe and unsafe touch".
- **Audio lesson** — example: Child · "Lesson 2 · Audio · Safe and unsafe touch". Large square cover illustration (blue tints, no trees), title, type chip "Audio · A story to listen to", thick progress bar with elapsed/"[length]", huge round Play/Pause (≥96px) with label, Back 10s / Forward 10s labelled, a "Read along" button that shows the words (show 3 short transcript lines, the current one highlighted), Sound control, and "Next: Lesson 3 · Video · Who can I tell?". Note: audio never auto-plays.

## Sizes
- Phone boards: 390 wide (fixed), height as needed.
- Tablet boards: **800 wide × as tall as needed** (portrait, low-cost Android tablet). Do NOT stretch the phone: use the space — 2-column card grids (e.g. the three "Who are you?" cards in a row or 2+1; lesson cards 2 per row), max text line ≈ 60–70 characters, larger illustrations, side-by-side layouts where useful (e.g. video/audio player on top full width, then "What you will learn" and the lesson list in two columns). Same components, same sizes or larger (touch targets ≥56px), same top bar (logo, Leave this page, English | Krio, then Back + Home row).

Each root fixed width × height equals its `$preview`. Write ONLY your files into `project/` (Write tool; one at a time). Do not publish or render. Report ≤120 words: files, exact sizes, placeholders, rules bent.
