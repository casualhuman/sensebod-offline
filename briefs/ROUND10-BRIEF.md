# Sensebod round 10 — lesson type tags (Child protection)

The owner approved tagging lessons by WHAT THE LEARNER DOES. Apply it everywhere in Child protection. Keep each board's existing look (flat V3, tablet, or Style B scenes); change only tags, filters, buttons, the lesson mix below, and links. Format rules: ROUND2-BRIEF.md. Other rules: ROUND3–9 briefs (quick-exit, Back/Home/Listen, placeholders, no trees in Child protection, contrast ≥ AA, root size == `$preview`). Backups of every current board are in `round9/` (read-only).

## The tags (exact wording and icons)
| Tag | Icon (D-style bold, ≥3px stroke) | Meaning | Main button text |
|---|---|---|---|
| **Watch** | play triangle inside a screen | video | "Watch video" |
| **Listen** | headphones | audio (Read along available) | "Play audio" |
| **Try it** | tapping hand (index finger + tap ripple) | interactive animation | "Start" |
| **Check** | clipboard with tick | quiz at the end of a series | "Start the quiz" |
Modifier badge **"You take part"** (small tapping-hand icon + those words, in a pill) — shown on any lesson that asks the learner to act. An interactive video is a **Watch** lesson with this badge, and its button reads "Watch and answer".
Card anatomy (same position on every card): round type badge (icon) on the picture edge → line "Watch · Lesson 1" (tag word bold) → optional "You take part" pill → state chip (Not started / Started / Finished, icon + word) → title → small facts row: "[length]" · "Needs sound" (speaker icon, on Watch/Listen) · "Captions" (CC icon, on Watch) · "Read along" (on Listen) → full-width main button repeating the action.
Filter above every lesson list: **All · Watch · Listen · Try it** (4 big segmented buttons, "All" selected). Progress in words stays.

## New lesson mix (all audiences, 4 lessons + quiz)
- Child: L1 Watch "My body belongs to me" (Finished) · L2 Listen "Safe and unsafe touch" (Started) · L3 Try it + You take part "Who can I tell?" · L4 Watch + You take part "It is not my fault" (button "Watch and answer") · Check "Check what you learned".
- Parent or carer: L1 Watch "Keeping children safe at home" (Finished) · L2 Listen "Signs a child may need help" (Started) · L3 Watch + You take part "How to listen when a child tells you" ("Watch and answer") · L4 Try it + You take part "Where to report [confirm local services]" · Check.
- Community elder: L1 Watch "Your role in protecting children" (Finished) · L2 Listen "Talking with families" (Started) · L3 Try it + You take part "How to refer a case [confirm local referral path]" · L4 Watch + You take part "Child marriage and the law [confirm local guidance]" ("Watch and answer") · Check.
Lesson-screen headers use the same tag wording: e.g. "Lesson 1 · Watch", "Lesson 2 · Listen".

## Links
Style B Child boards (phone `CPB-Child`, tablet `CPB-Child-Tab`): L1 → `CPB-Video.dc.html`, L2 → `CPB-Audio.dc.html`, L3 → `CPB-TryIt.dc.html` (tablet: `CPB-TryIt-Tab.dc.html`), L4 → `CPB-WatchAnswer.dc.html` (tablet: `CPB-WatchAnswer-Tab.dc.html`). Flat boards keep their existing links (L3/L4 stay `#`). Next-step cards on lesson screens point to the next lesson in the Child series where a board exists.

## New interactive screens (Style B cast in scenes; reuse `cast/`, `scenes/`, `project/CPB-*.dc.html` look)
- **Try it** — Child L3 "Who can I tell?": one large village scene with four trusted adults placed in it (mr-koroma at the school door, nurse-aminata at the clinic, haja at home, officer-sesay at the police post) and fatmata in the middle. Instruction: "Tap each person you can tell." Each person has a large tappable hotspot (≥64px, visible numbered ring + label under them). Show one person already tapped: a speech card with their picture and a short reassuring line (e.g. "Mr Koroma, teacher: You can tell me. I will listen and help."), a tick on their ring, and progress "1 of 4 found" in words + 4 dots. Big "Next person" / "Replay" buttons, Listen button, note "Moves gently. Turns off if your phone is set to reduce motion." Finish state described in a small preview strip: "Well done! You found 4 people you can tell." → "Next: Lesson 4 · Watch and answer".
- **Watch and answer** — Child L4 "It is not my fault": the video player paused on a scene frame (haja with abu) with a question card over the lower half: "Question 1 of 2 — If an adult hurts a child, whose fault is it?" Answers as big cards: "It is never the child's fault" (shown chosen + correct, green, tick, reason: "The adult is always responsible. You did nothing wrong.") and "It is the child's fault" (unchosen). A "Continue video" main button, and the progress/seek bar showing question markers (small diamonds) on the timeline with a legend "◆ = a question". Keep player controls labelled (Back 10s, Play, Forward 10s, Captions, Sound).
Write scenes to `scenes/<board>-<slot>.svg.txt` first; you may render to check faces/layout and fix. Keep each board < 220 KB.
