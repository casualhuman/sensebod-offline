# Sensebod round 12 — Admin, phone-first, by content source

## What the owner clarified
The admin's job is to POPULATE the learner portals with content that arrives in three ways:
1. **Sent to them on WhatsApp** (videos, voice notes, photos, PDFs/documents forwarded by EasySTEM or partners).
2. **Typed by themselves** (a short reading lesson, notes, instructions).
3. **Their own notes/files** (handwritten notes photographed with the phone camera, PDFs, Word documents).
…and then they **choose which portal it goes to** (portal → audience/class/topic → series), check it, and publish. Admins are facilitators/teachers using mostly their **phone** (390 wide) while connected to the bag's Wi-Fi; a laptop is secondary. Keep it very simple: big cards, plain words, one decision per screen, visible progress ("Step 2 of 4").

## Lesson types (updated)
Existing tags: Watch (video), Listen (audio), Try it (interactive), Check (quiz), modifier "You take part". ADD **Read** — icon: an open book — for typed text, notes and documents (PDF, Word, photos of notes); main learner button "Read". The type is set AUTOMATICALLY from what was added and can be changed: video → Watch; voice note / audio → Listen; typed text, PDF, Word, photos of notes → Read; questions → Check. Interactive (Try it / Watch and answer) is set up on the laptop (existing boards `ADM-TryIt`, `ADM-Questions`).

## Realistic constraints (show them honestly, plainly)
- Phone browser file picker: "Choose from your phone" opens the phone's files, where WhatsApp keeps media in folders such as "WhatsApp Video", "WhatsApp Audio" (voice notes), "WhatsApp Documents", "WhatsApp Images". Show a picker grouped by those folders with thumbnails, sizes, dates, multi-select. (Sharing straight from WhatsApp's Share button would need Sensebod installed as an app — show it only as a small "Coming later" note.)
- Voice notes are .opus files — accepted; "We will convert it so all phones can play it."
- Big videos: show size and "This may take a few minutes. Keep this page open."; offer "Make a smaller copy for old phones" (on).
- Photos of notes: show pages as thumbnails with Move left/right and Rotate, "Add another page", and a tip "Take the photo flat, in good light".
- Typed lessons: plain editor with big buttons (Heading, List, Bold, Add picture), autosave note "Saved on this bag", optional "Record yourself reading it" (makes it also Listen-able — show as a Read lesson with a "Read along" audio).
- No internet anywhere; everything is saved on the bag.

## Look and format
V3 light design (read `project/V3-Components.dc.html` incl. its Lesson types section, `project/Main.dc.html`, `project/ADM-Library.dc.html` and `project/ADM-Add-3.dc.html` for the admin look and the learner card preview, `project/CPB-Child.dc.html` for the learner card). Blue #085CAA, ink #15233B, slate #4A5568, page #F4F7FB, white cards, green #1F7A3A success/Agriculture, red only for errors/delete, gold only on Listen. WhatsApp should be recognisable by name and a neutral chat-bubble icon — do NOT use WhatsApp's logo or brand green. Bold D-style icons with labels; targets ≥48px. Phone boards: fixed 390 wide root, height as needed. Laptop boards: fixed 1440 wide root (NOT fluid this time), height as needed. `.dc.html` rules in ROUND2-BRIEF.md. Root size == `$preview`; report exact sizes. Use realistic sample items: "Quail housing.mp4" (34 MB), a WhatsApp voice note "PTT-[date].opus" (1:42) titled by the admin "Safe and unsafe touch — story", "Fatmata's science notes" (3 photo pages), "[Partner] guide.pdf". Unknowns as [placeholders]. Under 220 KB per board. You may render to check layout. Do not publish; write only your files into `project/`.

## Shared admin phone frame
Top bar: Sensebod logo (`/_blob/85b192cd7d9b6351c5c7df6e9a0a36d1`) + "Admin" pill + a person chip "[Staff name]"; bottom of screen: a sticky bar with the main action. Status line somewhere: "Saved on this bag · No internet needed".
