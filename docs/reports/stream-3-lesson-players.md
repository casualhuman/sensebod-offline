# Stream 3 — Lesson players: technical report

12 Nov 2026. Covers `app/src/features/lessons/**` (the `/lesson` URL space). Branch: `worktree-agent-a547795e3a77b0019`.

State at hand-over: typecheck, lint, 130 unit tests (69 of them new, for this feature) and the production build all pass; the size budgets are met. The production build was exercised in headless Chrome 157 on this Mac at 320, 390, 800 and 1440 px wide. **No Raspberry Pi, no physical Android device and no Chromium 58 were used for this stream.** Codec support, memory, touch and speed on real devices are untested; section 6 lists exactly what was and was not verified.

Where to start: `app/src/features/lessons/README.md` (map of the folder and its rules).

## 1. What I built

Two screens, one player per lesson type. Everything shown comes from `GET /lessons/{id}`; no lesson text, question or answer is written into a component.

| Screen / player | File | Boards | What it does |
|---|---|---|---|
| Lesson screen | `screens/LessonScreen.tsx` | all lesson boards | Loads the lesson, draws the shared frame (header, "Lesson 2 of 4", "What you will learn", "Up next", help card) and chooses the player from `lesson.content`. Loading, error (Try again + Go to Home) and "not in this bag" states inside `PageShell`. |
| Watch | `players/WatchPlayer.tsx`, `media/*` | V3-Components "Video player · 3 states", CPB-Video, AGB-Agri-Video | A Ready: poster, big Play, "Tap Play when you are ready." B Playing / paused: elapsed and length, seek bar, Back 10s · Play/Pause · Forward 10s, Captions on/off, Sound, Full screen; captions drawn as the board's dark line. C Finished: "Well done! You finished this video.", saved note, next lesson or "Take the quiz", Watch again, Back to lessons/topics. |
| Watch and answer | same file, `quiz/*` | CPB-WatchAnswer, CPB-WatchAnswer-Tab | The video pauses at each question; "Paused for a question" chip; question card over the lower part of the picture; markers on the seek bar with the "= a question" legend; "Continue video" only after the answer (when the question says to wait). No Full screen, as on the board. Tablet: answers side by side and five controls in one row. |
| Listen + Read along | `players/ListenPlayer.tsx` | CPB-Audio | Cover, seek bar, Back 10s · round Play/Pause · Forward 10s, "Read along: on/off", Sound, "The words of the story" with the current line marked (icon + bold + frame + "Now:" for screen readers), "The story never starts by itself." |
| Read | `players/ReadPlayer.tsx` | CPB-Read, CPB-Read-Tab | Cover; Read along panel ("Play the reading", "Highlight: on/off", Text size A− / A+, remembered on the phone); typed text (headings, paragraphs, numbered and bulleted lists, pictures with captions); photos of notes and document pages one per page with Next / Previous page; "I have finished reading". Tablet: cover beside the tools, 640px text column, page controls in one row. |
| Try it · tap the picture | `players/TryItHotspots.tsx` | CPB-TryIt, CPB-TryIt-Tab | Instruction with "n of N found" and dots; the scene with numbered, named spots (to find / found / showing now); speech card with portrait, name, "Found", role and words; the recorded voice plays on the tap; Next person, Replay; "When you find all N" preview, then the green "Well done" card with the next lesson. Goal `all` or `any`. |
| Try it · animation package | `players/TryItPackage.tsx` | none for learners (ADM-M-Animation is the admin side) | Start button; the package's `index.html` in `<iframe sandbox="allow-scripts">`, loaded only after Start; Start again, Full screen, "I have finished". Missing package and unreachable bag have their own states. |
| Check quiz | `players/CheckQuiz.tsx`, `quiz/Answers.tsx` | AGB-Agri-Quiz, V3-Components "Quiz question" | "Question 2 of 3" with segments, picture card with the question and "Listen to the question", answers A/B/C with the reason inside the chosen row, "Let's think again" + "Try again" for a wrong answer, "Next question" / "See your result", "No timer. Take your time." |
| Picture lesson | `players/PictureLesson.tsx` | CLB-Climate-Lesson | Topic and lesson number, hero card with Listen, "Watch it step by step" with numbered pictures, "Play animation" (one picture at a time, slowly, never by itself), Back / I have finished. |
| Finished screen | `screens/LessonDoneScreen.tsx`, `parts/Finished.tsx` | AGB-Agri-Done | Picture, tick badge (pops in once, still under reduced motion), "Well done! You finished …", Listen, "Quiz: 2 of 3 correct" with a mark per question, "Saved for Aminata · Your progress stays in this bag", "…: 2 of 12 done" with segments, big Next lesson button, "… again" and "Back to topics / lessons". |
| Shared parts | `parts/LessonParts.tsx`, `parts/steps.ts` | CPB-Video and others | Type pill or badge + "You take part", facts row, phone Listen bar, series progress in words and segments (five at most, around the open lesson), "What you will learn", "Up next" card, Child protection "Get help now" card. |
| Progress | `progress/progress.ts` | — | `started` on open, position on pause / leaving a video or audio, `finished` (with quiz results) at the end; only for a learner who saves progress. Carries on from the saved place ("Tap Play to carry on from where you stopped (0:08)"). |

Child protection lessons keep **Leave this page**, **Back**, **Home** and **Listen** (the shell's `quickExit`, the phone Listen bar under the title, the header Listen from tablet width) and add **Get help now** on every lesson, quiz and finished screen. Agriculture lessons are green through the theme tokens only.

Layouts: phone (designed at 390, checked down to 320), tablet from 720px (design width 800; two-column lower area, one-row controls, side-by-side answers, cover beside tools, scene beside speech card), laptop (1440: the tablet layout in an 880px centred column; no laptop lesson board exists).

## 2. Technical decisions and trade-offs

| Decision | Chosen | Rejected, and why | Cost |
|---|---|---|---|
| Media engine | Native `<video>` / `<audio>` behind one hook, `media/useMedia.ts` | Any player library: tens of KB for what the platform does | Our own state handling to maintain (about 250 lines, unit-tested) |
| When media is requested | The element has **no `src` until Play is tapped**, and `preload="none"` as well | `preload="metadata"` (shows the length before play): one extra request per lesson per phone, and some old browsers treat it as "load a lot" | The length is unknown before play: the board's `[length]` placeholder shows unless the lesson data has it. The seek bar is disabled until then |
| Captions | `<track>` added only after play starts, kept `hidden` and drawn by the page from `cuechange` | Native caption rendering: cannot look like the board and differs per browser | Captions do not show in iPhone-style native full screen (only our own full-screen stage shows them) |
| Seek bar | A native `<input type="range">`, styled | A custom slider with pointer tracking: more code, more bugs on old WebViews, worse for screen readers | Styling relies on `::-webkit-slider-*` (Chrome, Android WebView, Safari) and `::-moz-range-*`; fill is a CSS custom property |
| Source choice and fallback | `canPlayType` picks the first playable source; a decode error moves to the next source (the "smaller copy"); then a plain message. A network error is told apart and offers Try again from the same place | `<source>` children: their errors do not reach the element, so a fallback cannot be shown reliably | — |
| Release | On unmount: pause, remove `src`, `load()`; listeners removed; exit full screen | — | — |
| One sound at a time | Lesson play stops the Listen narration; Listen starting pauses the lesson; spot voices in Try it use the shared narration player | A second audio element per spot | Needs a deep import from shared code (REQUESTS) |
| Time updates | State rounded to half seconds (at most two re-renders a second); question timing uses the exact time outside React state | Re-rendering on every `timeupdate` | The elapsed label can be up to 0.5 s behind |
| Full screen | Our own stage goes full screen (prefixed API for Chrome 58), with Play/Pause and "Leave full screen" always visible; iPhone falls back to the video's native full screen; no API → no button | Full-screening the `<video>` only: our captions and controls would vanish | A bar covers the bottom of the picture in full screen |
| Quiz interaction | Follows AGB-Agri-Quiz and CPB-WatchAnswer (the current boards): tap = answer, feedback inside the row, orange "Let's think again" | V3-Components' older flow (choose, then "Check my answer", red "Not this one") | One less step; differs from the library board (section 3) |
| Quiz scoring | A question is correct when the learner **ends** on the right answer; any number of tries; they may move on after any answer | First-try-only scoring: punishes the retry the boards invite | "3 of 3" says less about first attempts |
| Answer rows | Local `quiz/Answers.tsx` on the shared `.sb-choice` classes | Shared `ChoiceGroup`: has no slot for in-row feedback | A local component to keep in step with the shared look |
| Finish record | One in-memory record of the last finished lesson; after a refresh the finished screen reads the saved result from the API | `sessionStorage`; putting results in the URL | A guest who refreshes the finished screen is sent back to the lesson |
| Progress writes | Three moments only (open, pause/leave, finish); duplicates of the same place suppressed; failures of `started` / position are silent, a failed `finished` is shown with Try again | Periodic position saves | A crash mid-video loses the place since the last pause |
| Read along highlight (Read) | Estimated from each block's share of the words, because the data has no timing | No highlight at all | It can drift; the learner can switch it off; exact timing needs a contract change (REQUESTS) |
| Animation packages | `sandbox="allow-scripts"` only, loaded after Start, a `HEAD` request first so a missing package is a clear message, root-relative addresses only | `allow-same-origin`: the package could then read the app's storage and call the API | A package that needs storage or forms will not work; completion cannot be detected, so the learner taps "I have finished" |
| Code splitting | The two screens are imported directly in `routes.tsx`: the feature is **one** lazy chunk | `lazy()` per screen or per player: measured 3 requests in a row (0.25 + 12.7 + 9.1 KB) for the first lesson instead of one of 20.6 KB | A learner who only ever watches videos also downloads the quiz and Try it code (about 20 KB once, then cached) |
| Polyfills | `Array.reduce`, `Number.toFixed`, `String.split(/…/)` written by hand | Using them: +1.8 KB gzip in the start script of **every** phone (measured 38.2 → 36.4 KB) | Slightly longer code in three places |
| Styles | One `lessons.css`, `les-` prefix, tokens only | CSS Modules per component: more `<style>` blocks; no gain at this size | One 37 KB source file (6.5 KB gzip) |

Foundation notes from Reviewer A that I applied: the player is keyed by `lesson.id` (and a test covers `/lesson/a` → `/lesson/b`); effects use ids from the loaded lesson, not `useParams()`; `useQuery()` is not used; `useApi` dependency lists were checked by hand; the CSS was scanned for flex `gap`, `aspect-ratio`, `inset`, `clamp()`, `min()`, `max()`, `:has()` (none; the video frame uses the padding-top box); loading and error states are inside `PageShell`; content inside `<main>` fits 320px (measured); cached API answers are never changed in place; refetches after a save are expected (REQUESTS).

## 3. Deviations from the design

| # | Where | Difference | Reason |
|---|---|---|---|
| 1 | Quiz answers vs V3-Components | No "Check my answer" step and no red "Not this one" panel; tap gives feedback, wrong is orange | AGB-Agri-Quiz and CPB-WatchAnswer are the current boards and behave this way |
| 2 | Quiz "Next question" / "See your result" | Dashed "not ready" until an answer is chosen, outlined after a wrong answer, filled after the right one | The board shows it outlined before any answer; a button that does nothing would confuse |
| 3 | "Your answer" | Under the answer text, not at the right of the row | At 320–390px it squeezed the answer onto three lines |
| 4 | Child protection "Check what you learned" | Uses the AGB quiz screen and finished screen, in blue, plus the help card | Not designed (HANDOFF section 8) |
| 5 | AGB-Agri-Video | One "Up next" card in the CPB style, not two upcoming lessons with thumbnails; "Next: Take the quiz" only when the next item is the quiz; no "Watch to the end, then take the quiz." | The contract has one `next` and a quiz per series, not per video |
| 6 | Agriculture, Climate lessons | A phone Listen bar is not shown on AGB-Agri-Video's header (as the board); other lesson types in those portals follow the CPB layout | Only the video is designed for Agriculture |
| 7 | CPB-Read | Listen stays under the title (the board shows only the language switch) | Rule: every Child protection screen has Listen |
| 8 | CPB-Read | No "Sample text" notes; the facts row has no "Not started" chip (progress is shown below); typed text is one page; the last page's button is "I have finished reading" | Design annotations; no page breaks in the data |
| 9 | CPB-Read highlight | Position is an estimate (section 2) | No timing in the data |
| 10 | CPB-TryIt | Spots are squares from the data's circles, not the board's individual rectangles; names can wrap to two lines; near an edge the name is aligned to that side; label text is 16px (board 15px) | Data model; 320px; the 16px floor |
| 11 | CPB-TryIt | The "When you find all N" preview shows the next lesson as words, not a second link | The "Up next" card below is the link |
| 12 | CPB-TryIt "Moves gently" | Three slow pulses on the spots still to find, then still | The board does not specify the movement; continuous animation costs battery |
| 13 | CPB-TryIt-Tab | The same portrait scene beside the speech card, not the separate landscape drawing; speech card has no pointer notch | One scene in the contract |
| 14 | CPB-TryIt initial state | Nobody found at the start (the board starts with Mr Koroma found) | The board shows a mid-way state |
| 15 | CPB-WatchAnswer | Play in the control row is "not ready" while a question waits; "Continue video" reads "Tap an answer first" until answered; markers turn white once passed | States the board does not draw |
| 16 | Video states | "Paused" chip and the big Play on the picture when paused (from AGB-Agri-Video) on all videos; no dark scrim; "Loading…" chip while buffering; Sound shows "Sound off" when muted | Missing states; one behaviour for both themes |
| 17 | CLB-Climate-Lesson | No "Step 2 of 4" counter, per-step title or "Remember:" line; Back / "I have finished" instead of Back / Next step; pictures cropped to one shape | Not in the data (REQUESTS); fixed shape stops the page jumping |
| 18 | Animation package (learner) | New screen from the player card pattern | Not designed |
| 19 | Finished screen | Also used after Read, picture lesson and package (not only the quiz); a guest sees "Not saved" with "Save my progress"; a failed save shows a red message with Try again; Back goes to the lesson list (board: back to the quiz); no "Design note" box; a wrong question shows an orange outlined mark and "Not yet" | Missing states; the note is an annotation |
| 20 | Video and audio finished | Listen has an in-player "Well done! You listened to the end." with the same buttons as video state C | Not designed |
| 21 | Series progress | For a guest: "You are learning as a guest · progress is not saved"; a lesson started earlier is a lighter part-filled segment | Guests have no progress to show |
| 22 | Tablet and laptop | Non-interactive video, audio, quiz, finished and picture lesson have no tablet board; laptop has none at all | Extended from the three tablet boards |
| 23 | Resume | "Tap Play to carry on from where you stopped (0:08)." | Not designed; a silent jump would confuse |

## 4. Footprint (measured, `npm run size`, gzip level 9)

| What | Raw | gzip |
|---|---|---|
| `feature-lessons` chunk: all players, both screens, all lesson CSS | 83.4 KB | **20.6 KB** (budget 60) |
| of which `lessons.css` (measured on the source file) | 37.0 KB | 6.5 KB |
| Shared `api` chunk (already existed) | 2.3 KB | 1.1 KB |
| Start JS, before → after this stream | 287.6 → 291.0 KB | 94.0 → **94.7 KB** (budget 200) |
| — polyfills | 101.3 KB | 36.4 KB, unchanged |
| — entry | 186.4 → 189.7 KB | 57.6 → 58.3 KB: shared components and icons that nothing used before are now reachable |
| Critical resources for the first screen | | 115.2 → 115.9 KB (budget 350) |

- Requests to open the first lesson: the feature chunk + `api` chunk + `GET /lessons/{id}` + the pictures on screen. Later lessons: the API call and pictures only. A guest sends no other API request; a saved learner adds one series, one progress read and one `PUT`.
- Media: nothing before Play; then byte-range requests made by the browser (206 seen). Captions: one small file after play starts.
- New dependencies: none. No assets added (icons are five small inline SVGs on the shared base).
- Source: 25 files; about 3,100 lines of TypeScript/TSX, 1,900 of CSS, 800 of tests.
- Memory, desktop Chrome only: 30 round trips between a video and an audio lesson, each started: DOM nodes 744 → 744, listeners 192 → 192, one media element, JS heap 2.35 → 2.61 MB after forced GC. Indicative only; says nothing about a 1 GB Android phone.

## 5. Offline and compatibility

- **External requests: none.** Checked by (1) the build's own scan (`postbuild: … no external URLs`), (2) the request log of headless Chrome over every player at four widths (single origin), (3) `isLocalUrl()`: media and package addresses that are not root-relative are never opened (unit-tested).
- Media files are never fetched by script, never turned into blobs or object URLs, never read into memory; the browser streams them.
- The animation package runs with `sandbox="allow-scripts"`; in Chrome its document was confirmed unreachable from the app (opaque origin). Whether a package itself tries to use the internet is controlled by the Pi's CSP for `/media/tryit/` (stream 1's nginx config) and by the admin-side checks, not by this code. Not tested behind nginx by this stream.
- Browser features relied on:

| Feature | Floor (Chrome 58) | Fallback |
|---|---|---|
| `<video>`, `<audio>`, `canPlayType`, `preload`, `playsInline`, media events, `play()` returning a promise (50+) | yes | a missing promise is handled |
| `<track>`, `TextTrack.mode`, `cuechange` | yes | no captions if absent; toggle hidden when the lesson has none |
| `<input type="range">` with `::-webkit-slider-*` and a custom property in the track | yes (expected; not run on 58) | unstyled but working slider |
| Fullscreen API | prefixed only (`webkitRequestFullscreen`) | handled; iPhone native video full screen; else no button |
| `<iframe sandbox>` | yes | — |
| `fetch` with `HEAD` | yes | a 405 is treated as "try to show it" |
| `localStorage` (text size) through shared `readStored` | yes | in memory |
| CSS: flexbox with margins, `order`, `flex-wrap`, `object-fit`, `calc()`, `vw`/`vh`, transforms, `max-content` (46+) | yes | — |
| `prefers-reduced-motion` | no (74) | no movement at all (opt-in pattern) |
| `:fullscreen` | no (71) | a separate `:-webkit-full-screen` rule |

- Codecs are not something the frontend can fix: an Android 8 phone will play H.264 Baseline/Main + AAC in MP4 and AAC in M4A; WebM/VP9, HEVC or Opus voice notes depend on the phone. When a file cannot be decoded the learner sees "This video cannot play on this phone … Ask your facilitator, or try another phone." **Not verified on any phone.**
- Mode A only (as the architecture says): a lesson needs the bag's Wi-Fi. A dropped connection during playback shows "The video stopped … Try again", which reloads from the same second.

## 6. Testing

**Automated (final code)**

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 warnings |
| `npm test` | 8 files, **130 tests, all pass** (61 existing + 69 new: 26 rule tests in `logic.test.ts`, 43 screen tests in `lessons.test.tsx`) |
| `npm run build` | pass, postbuild checks ok |
| `npm run size` | all three budgets met (94.7 / 200, 115.9 / 350, 20.6 / 60 KB) |

The screen tests run every lesson type against the mock API with `installMockApi()`: loading, error + retry, not in this bag; state A/B/C; no `src`, no autoplay, no track before Play; skip, seek bar, captions, mute; decode fallback (two ways), network error + retry at the same time; release on unmount; resume; question pause, locked continue, gentle wrong answer, no skipping past a question, going back allowed; Read along line; text size; hotspots; sandboxed frame; quiz states; result, saved / guest / failed-then-retried; refresh of the finished screen; picture animation with fake timers; fresh player when only the id changes. jsdom has no media engine: `play`, `pause`, `load`, `canPlayType` are stubs and media events are fired by hand.

**In a browser: production build, `vite preview` with the mock API, headless Chrome 157 on macOS, driven over the DevTools protocol with real mouse events**

| Width | Result |
|---|---|
| 390 | 66 of 66 checks pass |
| 800 | 66 of 66 |
| 1440 | 66 of 66 |
| 320 | every lesson screen: nothing inside `<main>` wider than the viewport, also with the players started. The shared header is 359px wide there (REQUESTS), which also made click coordinates unreliable in my script, so the interaction run was not repeated at 320 |

What the 66 checks cover: no `/media/` request before Play; the sample H.264 video really plays; Forward 10s, Back 10s and the seek bar change `currentTime` (17.6 s after seeking to 17); **byte ranges answered 206**; captions file requested only after play; captions and mute toggles; state C; element detached after leaving; audio plays and the right Read along line is marked; hotspot flow and labels inside the picture without overlapping; the video stops at 6.0 s for question 1, cannot be skipped, stops at question 2 after seeking forward; quiz with "Try again"; finished screen with "Quiz: 1 of 2 correct"; Read with the voice and a marked paragraph, bigger text; package in a sandboxed frame that the app cannot reach; picture animation; green theme; a saved learner: resume at 0:08, "Saved for Aminata", the `PUT`; missing lesson; **no request to another origin; no console errors** (the deliberate 404 aside). Screenshots of each state were compared by eye with the boards; that led to the label, "Your answer", spacing and 320px fixes.

**Not tested — do not assume any of it works**

- Any physical Android phone or tablet, any Android WebView, Android 8. Therefore: codec support, hardware decoding, memory with a real 30 MB video, touch on the seek bar and hotspots, the prefixed full-screen path, captions timing, sound routing, battery.
- Chromium 58. Stream 1's archived build was not available to me; the lessons chunk is compiled for the floor by the same build and avoids the banned CSS, but **has not been run on Chrome 58**. The range-input styling and `cuechange` there are the first things to check.
- A Raspberry Pi, nginx, the CSP in front of the players and the package frame, the media rate limit, many phones playing at once.
- Real content: only the 20 s test clip, 12 s tone, hand-written captions and the one-file sample package were used. No long video, no real animation export, no photos of notes (the seed has none in a published lesson; the page-image path is covered by a unit test of `readPages` only).
- Safari / iPhone (the native full-screen fallback is written from documentation), Firefox.
- Screen readers (TalkBack). Roles, names and live regions are asserted in tests; no assistive technology was run.
- `allowRetry: false` and `pauseUntilAnswered: false` questions: covered by rule tests, not by seed data or the browser run.
- Pixel-level fidelity: compared by eye only.

## 7. Cross-team notes

Requests raised in `docs/team/REQUESTS.md` (all to stream 1):

1. Export the Listen subscription from `@shared/shell` (workaround: deep import, `TODO(stream-1)` in `media/useMedia.ts`).
2. The shared header is 359px wide on a 320px phone (no workaround possible here).
3. `ListenBar` does not wrap (workaround in `lessons.css`, `TODO(stream-1)`).
4. Saving progress clears the content cache.
5. Contract: Read lessons have no timing and no page breaks.
6. Contract: picture lessons cannot carry the Climate board's steps.
7. Contract: one Try it scene for every width.
8. Contract: one `next`; quiz per series, not per video.
9. Small things: `ErrorState` cannot take its own sentence; README said `lazy()` per screen; polyfill cost of common built-ins.

For stream 2: link to a lesson with `paths.lesson(id)`; the finished screen is `paths.lessonDone(id)` but is only meaningful after finishing. Lessons link back with `paths.series(...)`, `paths.portal(...)`, `paths.help()` and `paths.saveProgress()`. After a lesson, a saved learner's progress has changed: refetch it when your list is shown again.

For stream 4: what the players need from content. Video: MP4, H.264 + AAC, "fast start"; captions as WebVTT. A Watch lesson with questions needs them sorted by time and inside the video's length (a question placed after the end is never asked). Read along for a Listen lesson needs `start` times on transcript lines, otherwise the words show without a marker. Try it spots are circles in percent of the scene; names longer than about 14 characters wrap. An animation package must work with scripts only: no storage, no forms, no pop-ups, no network.

For the backend: `/media/…` must answer byte ranges (seeking depends on it) and should answer `HEAD` for package `index.html`.

## 8. Open items and risks

1. **Real devices.** Nothing here has run on Android, on Chrome 58 or behind the Pi's nginx. First checks: a real lesson video on the oldest phone (plays? seeks? memory?), the styled seek bar, prefixed full screen, captions, the package frame under the CSP.
2. **Read along highlight is an estimate** until the contract carries timing; it may mislead slow readers. Decide: add timing, or remove the highlight for Read lessons.
3. **Picture lessons** are a reduced version of CLB-Climate-Lesson until the content model has steps.
4. **Tablet Try it** uses the phone scene; the landscape drawing is unused.
5. **Undesigned screens built from the nearest pattern** and needing a designer's eye: Child protection quiz, learner side of animation packages, guest / failed-save notes, Listen finished state, tablet and laptop layouts without boards.
6. **Krio**: all player text is English; nothing is translated (no mechanism exists yet). Caption language follows the language switch when a track in that language exists.
7. **Listen recordings** for pages and questions do not exist; the gold buttons say "No sound here yet".
8. **Quiz results are not stored per question** by the API (only `correct` / `total`), so after a refresh the finished screen shows the total without the per-question marks.
9. **Large series**: the progress bar shows five segments around the open lesson; the finished screen scales "done" onto five segments.
10. **A package cannot report completion**; "I have finished" is the learner's word. H5P is not handled (needs a player on the Pi, as the handoff says).
11. Placeholders left as the data has them: `[length]`, `[pages] pages`, `[Sample]` questions and texts, titles with `[confirm …]`.
