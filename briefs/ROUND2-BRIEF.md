# Sensebod round 2 — shared brief for all 5 design directions

Product: Sensebod (by EasySTEM) — an offline learning site served from a Raspberry Pi "in a bag" to rural Sierra Leone. Users: learners, teachers, farmers; many are first-time phone users, low literacy, old Android phones, bright sun, shared phones. Home is a GATEWAY to 5 portals: Primary school (Class 1–6), Junior secondary (JSS 1–3), Child protection, Agriculture, Climate. Everything works without signing in; signing in is optional and short (name + who you are; no password, no phone number).

The product owner REJECTED round 1 ("most horrible design") because it used a different loud colour for every portal. Round 1 files are in `round1/` beside this file (Main.dc.html, SignIn.dc.html, Agriculture.dc.html, Components.dc.html) — read-only reference — reuse their COPY, content and accessibility patterns, NOT their look.

## Colour rule (non-negotiable)
- Maximum two colours: **blue is the main colour**, plus white/neutrals (ink #15233B, greys for borders/backgrounds are fine).
- ALL portal cards are blue (shades/tints of blue allowed). The ONLY exception: the **Agriculture** portal card may be **green** (#1F7A3A, white text 5.4:1).
- A second accent colour may appear ONLY on a few buttons (e.g. Listen, or the single main call-to-action). Not on cards, not on headings, not decoration. No multicolour circles, no rainbow.
- Brand blue: #085CAA (white text 6.73:1). Darker #064A8A (8.9:1), #0A3A6B. Tints allowed, e.g. #E6EFF8, #EEF4FA, #F5F8FC. Brand gold (optional button accent) #E4AA09 — ink text only on it (7.5:1), never gold text on white.
- Correct/try-again quiz states and success/error messages may use green/orange because they carry meaning, always with icon + words.
- Text contrast WCAG AA (4.5:1; 3:1 for 24px+). Compute any new pair (python3 -I) before using it.

## Hard UX rules
Buttons 56–64px tall (full width on phones for main actions), all targets ≥48px, icon + text label on important buttons, named actions ("Play video", "Save and start learning", never "Submit"). Body ≥16px, instructions 18px, headings 22–30px, Poppins 400–800, no thin weights, no all-caps sentences. Visible Back + Home on inner screens. English | Krio switch as words. A Listen (speaker) button on main screens. No hamburger, no swipe-only, no emoji icons (inline stroke SVG only). Status never by colour alone. Krio: only "Kushɛ!" and "Wi dae make u sensebod"; everything else English.

## Content (real)
Agriculture videos really in the bag (Access Agriculture, 64 livestock videos), e.g. "Quail housing", "Breeding rabbits", "How to build a rabbit house", "Taking care of young rabbits", "Feeding rabbits" (Rabbits = 4 videos), "Taking care of local chickens", "Feeding improved chickens", "Hand milking of dairy cows", "Making yoghurt at home", "Keeping milk clean and fresh", "Feeding snails", "Managing cattle ticks". Topics on the Agriculture screen: Chickens and quail (started, 1 of 5 done), Rabbits (not started, 4 videos), Milk and dairy cows (finished), Crops (not in this bag yet — ask your facilitator). Continue card: "Quail housing", Chickens and quail · Lesson 2 of 5. A "Quick quiz: keeping quail" entry. Sample people: Aminata Kamara (Learner · JSS 2), Mohamed Sesay (Farmer). Do not invent statistics or durations; for a video length write nothing or use the player sample time only inside the component library.

## The 4 artboards each direction makes
1. Home (guest) — 390px wide phone, fixed width, height as needed (≈1200–1400).
2. Sign-in — 390px wide: "Save my progress": returning names first ("Used this phone before? Tap your name"), then name + who are you (Learner / Teacher / Parent, farmer or other), main button "Save and start learning", full-size secondary "Skip — learn as a guest", note "No password. No phone number. Your name stays in this bag."
3. Agriculture portal — 390px wide (green may be used here as the portal colour for the header/accents, since green = Agriculture; still keep it to green + neutrals + at most one button accent).
4. Component library — 1440px wide, height as needed (≈1600–2200): colour tokens with contrast ratios, type scale, buttons (primary default/pressed/focus/working/not-ready, secondary, Listen, Back+Home, language switch, person chip), portal card (blue + the green agriculture variant), topic card 4 states, progress (words first), **the VIDEO PLAYER — fully redesigned (round 1's was rejected)**, quiz question + answer states (default, chosen, correct with reason, try again with reason), messages (saved / info / "not in this bag" with recovery button).

### Video player (redo — show it well)
Show it as a proper mobile player, at phone width (≈360px) inside the library, in 3 states side by side: (a) ready: 16:9 poster area (simple illustration, e.g. quail house, in the direction's palette) with ONE big centred Play button and title + "Video 2 of 5" + "Chickens and quail"; (b) playing: thick seek bar with elapsed/total time, a control row of large labelled buttons — Back 10s · Pause (largest, centre) · Forward 10s — and a second row: Captions on/off, Sound, Full screen; captions shown in the picture; (c) finished: "Well done! You finished this video." with one main button "Take the quiz" and secondary "Watch again" / "Next video". Labels under every icon. Video never auto-plays.

## The .dc.html format (follow exactly — the canvas fails silently otherwise)
Each artboard file = one self-contained page:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Short screen name</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet">
<style>
body{margin:0;font-family:Poppins,Arial,sans-serif;color:#15233B}
a{color:#085CAA}a:hover{color:#064A8A}
</style>
</helmet>
<div style="width: 390px; min-height: 1300px; box-sizing: border-box; ...">
  ... all markup, styles INLINE (style="…") ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":390,"height":1300}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
```
Rules that bite: keep the `<script src="./support.js"></script>` head line exactly; close every non-void element; quote every attribute; inline `style` for everything except page basics in `<helmet><style>`; layout with flex/grid + gap (grids as `repeat(N, minmax(0, 1fr))`); no `{{ }}` expressions (none needed — static mockups); no `<iframe>`, no external images except the two logo URLs below, no data: URIs, no emoji; inline stroke SVG icons (`aria-hidden="true"` when a text label is beside it; `role="img" aria-label` for meaningful illustrations); real `<button>`, `<a href>`, `<input>` + `<label>`; `$preview` width/height must equal the root's size and the size you report. Escape `&` as `&amp;` in attributes. Root width FIXED (390 or 1440).
Links between your own artboards: `<a href="FILE.dc.html">` (styled as the button itself) — Home → your Sign-in (Add name) and Agriculture card; Sign-in buttons → your Agriculture/Home; Agriculture Back/Home → your Home.

Logos (use these exact URLs in `<img src>`): Sensebod wordmark `/_blob/85b192cd7d9b6351c5c7df6e9a0a36d1` (wide, multicolour — it is the brand mark, allowed as-is; keep it small, ~30–36px tall, on white), EasySTEM logo `/_blob/c8b3025900ccf14ef057b2b5da4b95e4` (footer, small).

## Deliverable
Write ONLY your 4 files into `project/` with the exact names you are given, using the Write tool (one file at a time). Do not publish, do not touch any other file, do not render/screenshot. Finish with ≤120 words: the direction's idea in one line, the exact height of each artboard you made, and any rule you had to bend.
