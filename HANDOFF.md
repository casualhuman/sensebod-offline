# Sensebod — designer handoff

Designs for **Sensebod by EasySTEM**, the offline learning site that runs on the Raspberry Pi in the "DLH in a bag" kit. Phones, tablets and laptops join the bag's Wi-Fi (no internet) and open the site in a browser. This folder holds every current design, the illustrations, the brand tokens and the decisions behind them, so another designer or agent can continue without the original conversation.

Status: **designs only.** Nothing here is built into the Pi's site yet. Last updated 12 Nov 2026.

---

## 1. Folder map

| Path | What it is |
|---|---|
| `HANDOFF.md` | This note — start here |
| `design/boards/` | All 71 current design boards (`*.dc.html`), the canvas layout (`canvas.json`), the runtime that renders them (`support.js`) and a browsable list (`index.html`) |
| `design/archive-earlier-rounds/` | 39 superseded boards from earlier rounds (directions A–E, variations V1–V5, round-1 boards, the old type-first admin step) — reference only, not on the canvas |
| `illustrations/child-protection/` | Style B cast portraits (`cast/`, 13 people) and scenes (`scenes/`) |
| `illustrations/climate/` | Climate cast (8 people) and scenes |
| `illustrations/agriculture/` | Agriculture cast (8 people) and scenes |
| `brand/` | Logos (`sensebod-logo.png`, `sensebod-logo-full.png`, `easystem-logo.png`) and `tokens.json` (colours, contrast ratios, sizes, lesson types) |
| `briefs/` | `ROUND2…ROUND13-BRIEF.md` — the design brief for each round, in order; the record of every decision |
| `content/agriculture-videos.csv` | The 64 livestock videos on the Pi mapped to Agriculture topics |

The live, editable version is the Claude Design canvas **"Sensebod Learning Gateway"**: https://claude.ai/artifact/XcnfEXbNXsR9hhjDvr8Dxz (private to the owner; share it from its Share menu). The files here are a snapshot of that canvas (version of 12 Nov 2026).

## 2. How to view the boards

The boards need a local web server (they load `support.js` and the logos by relative path):

```bash
cd ~/Desktop/EasySTEM/easystemoffline/design/boards && python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html` and click any board. Interactive boards (Try it, Watch and answer, quizzes) respond to taps when opened this way. Fonts come from Google Fonts, so Poppins only shows with internet; offline it falls back to Arial.

Changes made in this folder do **not** update the online canvas. To publish changes to the canvas, an agent with the Artifact tool edits the matching `project/<board>.dc.html` and republishes to the canvas URL above (see section 9).

## 3. The product in one page

- **Users:** learners (children and youth), teachers, parents, farmers, community elders in rural Sierra Leone. Many are first-time phone users, low literacy, prefer Krio, use old Android phones (Android 8 tested), shared phones, bright sun.
- **Home is a gateway to 5 portals:** Primary school (Class 1–6) · Junior secondary (JSS 1–3) · Child protection · Agriculture · Climate.
- **No sign-in needed.** "Save my progress" is optional: name + who you are; no password, no phone number. Shared phones pick their name from a short list.
- **Content model:** Portal → (class / audience / topic) → series → lessons in order.
- **Lesson types** (tag by what the learner does; icon + word, never colour alone):

| Tag | Icon | From | Learner button |
|---|---|---|---|
| Watch | play in a screen | video | Watch video |
| Listen | headphones | audio, voice note (+ Read along) | Play audio |
| Read | open book | typed text, notes, PDF, Word, photos of notes (+ optional Read along) | Read |
| Try it | tapping hand | animation package (.zip with index.html) | Start |
| Check | clipboard with tick | questions | Start the quiz |
| *You take part* (modifier) | small tapping hand pill | any lesson where the learner answers or taps; interactive video button = "Watch and answer" | — |

Learner filter above lesson lists: **All · Watch · Listen · Read · Try it** (Check sits at the end of each series).

- **Admin:** facilitators add content mostly from their **phone** over the bag's Wi-Fi: Upload files (video, audio/voice notes, PDF/Word, photos) · Take photos of your notes · Type it yourself · Upload an animation. Then "Where does it go?" (portal → audience/class/topic → series → position; type set automatically) → choose a picture → check and publish. No WhatsApp integration (owner decision): files from WhatsApp are just files on the phone.

## 4. Chosen direction and design rules

**Chosen: V3 "Scene + badge", light version, with the Style B cast drawn in scenes.**

- Light flat page `#F4F7FB` (Agriculture `#F3F8F4`), white cards, 2px card edges that pass 3:1 where a card is tappable.
- **Blue `#085CAA` does the work** (badges, main buttons, selected states, progress). Agriculture uses green `#1F7A3A`. Gold `#E4AA09` only on Listen. Red `#C41E2A` only for wrong answers, errors, delete and urgent help. Owner rejected multicolour portals and deep-blue backgrounds.
- **Bold, thick icons with labels everywhere** (round-2 "D" style, ~3px strokes) — the owner said they make reading easier.
- Illustrations: original characters drawn as realistic cartoons (Style B: clean outlines, cel shading, natural Sierra Leonean skin tones), **acting in real places** (village, school, home, clinic, barray, farm). Diverse cast. **No trees on any Child protection screen**; trees fine elsewhere. Sensitive topics show the supportive moment, never harm.
- Every Child protection screen has **Leave this page** (quick exit to Home), Back, Home and Listen.
- Accessibility: WCAG 2.2 AA contrast (ratios in `brand/tokens.json` and the component library), primary buttons 64–72px, targets ≥48px, body 18px, no thin weights, no colour-only meaning, no timers on quizzes, no autoplay, respect reduced motion.
- Plain English; Krio only where verified ("Kushɛ!", "Wi dae make u sensebod"); everything else needs translation.

Full detail and history: `briefs/` (ROUND3 merged direction, ROUND4 light background, ROUND6 lessons, ROUND8–9 cast and scenes, ROUND10 tags, ROUND11–13 admin and Read).

## 5. Board map

**Current = use these.** "Alternative" and "earlier" boards are kept for comparison only.

### Admin — phone (current)
`ADM-M-Home` Home with 4 sources, drafts waiting, recent · `ADM-M-Menu` jumbo menu · `ADM-M-Upload` Upload files · `ADM-M-Notes` photos of notes / PDF / Word · `ADM-M-Type` type a lesson (+ record yourself) · `ADM-M-Animation` upload an animation with offline checks · `ADM-M-Place` Where does it go? · `ADM-M-Picture` choose a picture (gallery) · `ADM-M-Done` check and publish.
### Admin — laptop (current)
`ADM-Source` where is your content from? · `ADM-Library` library and lesson table · `ADM-Add-2` upload files · `ADM-Picture` picture gallery · `ADM-Add-3` details + live card preview · `ADM-Questions` interactive-video question editor · `ADM-TryIt` Try it setup (package or picture + hotspots) · `ADM-Series` series order · `ADM-SignIn`.
### Learner — Home and sign-in (current)
`Main` Home (gateway) · `V3-SignIn` Save my progress.
### Agriculture
Current (cast in scenes): `AGB-Agriculture` topics with real counts · `AGB-Agri-Video` Quail housing, Lesson 2 · Watch · `AGB-Agri-Quiz` interactive quiz · `AGB-Agri-Done` finished · `AGB-Cast` character sheet.
Earlier (flat): `V3-Agriculture`, `V3-Agri-Video`, `V3-Agri-Quiz`, `V3-Agri-Done`.
### Primary and JSS (flat; no cast yet)
`V3-Primary` choose class → subjects · `V3-JSS` choose JSS 1–3 → subjects + practice quiz.
### Child protection
Current (Style B cast in scenes):
- Phone: `CPB-Who` (I am a child / parent or carer / community elder) · `CPB-Child` · `CPB-Parent` (incl. Lesson 5 · Read) · `CPB-Elder` · `CPB-Help` · `CPB-Video` (L1 Watch) · `CPB-Audio` (L2 Listen + Read along) · `CPB-TryIt` (L3 "Who can I tell?", interactive) · `CPB-WatchAnswer` (L4 "It is not my fault", interactive) · `CPB-Read` (L5 Read).
- Tablet (800px): `CPB-Who-Tab` · `CPB-Child-Tab` · `CPB-TryIt-Tab` · `CPB-WatchAnswer-Tab` · `CPB-Read-Tab`.
- Cast: `CPB-Cast`.
Alternatives / earlier: flat phone `V3-CP-*`, flat tablet `T-CP-*` (full set incl. Parent, Elder, Help on tablet — Style B tablet versions of those don't exist yet), Style A `CPA-*`.
### Climate
Current: `CLB-Climate` topics · `CLB-Climate-Lesson` floods picture lesson · `CLB-Cast`. Earlier: `V3-Climate`, `V3-Climate-Lesson`.
### Component library
`V3-Components` — colour tokens with ratios, type scale, buttons and states, cards, progress, video player (3 states), quiz states, messages, Lesson types (5 tags, auto rule, filter, data tag).

## 6. Casts (original characters)

- **Child protection (13):** Fatmata 11, Ibrahim 9, Mariama 6, Abu 13 (glasses, hearing aid), Kadiatu 15 (headscarf), Isatu (mother), Mohamed (father), Haja (grandmother carer), Pa Alimamy (chief), Ya Bintu (women's leader), Mr Koroma (teacher), Nurse Aminata, Officer Sesay (Family Support Unit, no weapon).
- **Climate (8):** Pa Foday (rice farmer), Mama Kumba (vegetable farmer/trader), Sahr (fisherman), Hawa 14 (climate club), Musa 10, Ya Sento (grandmother), Idrissa (flood volunteer), Mabinty (radio presenter).
- **Agriculture (8):** Mama Fatu (poultry), Kemoh 12, Aminata 17 (rabbits), Pa Sorie (dairy herder), Adama (yoghurt), Yeabu (market trader), Musa (goats), Mr Bangura (extension officer).

Reuse rule: boards copy these drawings inline and never redraw the characters, so each person looks the same everywhere. Each SVG's internal ids are prefixed per use to avoid clashes.

## 7. Interaction pattern (for interactive boards)

Boards use the canvas's Design Component format. Working pattern (see `CPB-WatchAnswer`, `CPB-TryIt`, `AGB-Agri-Quiz`): real `<button onClick="{{ handler }}">`; handlers and display values returned from `renderVals()` in `class Component extends DCLogic`; state via `this.setState({...})`; show/hide with `style="display: {{ x }}"` or `<sc-if value="{{ flag }}">`. CSS `:checked` tricks do **not** work in the runtime. Keep braces balanced — a syntax error makes the runtime silently fall back to a static board. On the canvas, interactions only respond in **Play** mode.

## 8. Open items and placeholders

- **Placeholders to fill:** child helpline number, police Family Support Unit contact, nearest police station, emergency number, local referral contacts and path, local guidance on child marriage law, media `[length]`, storage totals, staff names, password-reset steps, partner names, sign texts `[ Police post name ]` etc.
- **Sample text to replace:** quiz questions and reasons (agriculture ones need an agriculture expert), lesson titles/counts in Primary/JSS, the Read lesson text, captions.
- **Agriculture topic counts** (12 / 7 / 10 / 8 / 27 = 64) come from matching words in video titles (`content/agriculture-videos.csv`); check by hand.
- **Not designed yet:** "Check what you learned" quiz screens for Child protection; Learners and progress; Storage and backup; Settings; Primary/JSS cast and scenes; Style B tablet Parent/Elder/Help/Video/Audio; Climate and Agriculture tablet views; Krio translations; Lessons 3–4 for Agriculture.
- **Technical notes for the build:** self-host Poppins; Android 8 Chrome CSS limits (no `:has()`, container queries, `color-mix`); "Make a smaller copy for old phones" needs server-side video conversion; voice notes (.opus) need converting; H5P needs an H5P player on the Pi; animation packages must run with no internet.

## 9. Working on it with another agent

- Read this note, then `briefs/` newest first for the latest rules.
- **Board format:** each board is a self-contained `.dc.html` (see `briefs/ROUND2-BRIEF.md` "The .dc.html format"): keep `<script src="./support.js"></script>` exactly; inline styles; root width fixed (390 phone, 800 tablet, 1440 laptop/library) and root height equal to `$preview` in `data-props`; images by relative path (here `../../brand/…`; on the canvas the logos are uploaded assets `/_blob/85b192cd7d9b6351c5c7df6e9a0a36d1` = Sensebod, `/_blob/c8b3025900ccf14ef057b2b5da4b95e4` = EasySTEM).
- **Keep boards under ~220 KB** (scene-heavy boards are near the limit).
- To update the online canvas: edit the board in the canvas project, check it renders (local server + `support.js`), then publish only changed files plus `canvas.json` if the layout changes. When copying a board from this folder back to the canvas, switch the logo paths back to the `/_blob/…` addresses above.
