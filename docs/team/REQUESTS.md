# Cross-team requests

Append-only. Add a new entry at the bottom; never edit or delete another engineer's entry. Stream 1 answers by adding a `Status:` line under the entry.

Format:

```
## <date> — stream <n> → stream <m>: <short title>
What: <what is missing or wrong>
Why: <why you need it>
Where: <file or contract section>
Workaround: <what you did meanwhile, and where>
```

## 2026-11-12 — stream 2 → stream 1: shared header and Listen row are wider than a 320px screen
What: at 320px wide the one-row header (Back, Home, logo: `.sb-shell__header--single`) is 39px wider than the screen, and `ListenBar` (Listen + language switch) does not fit inside a card (it overflowed by 10 to 28px on our screens). Measured in headless Chrome on the production build; the "not found" screen shows the header overflow with only shared components on it.
Why: the coordinator asked for layouts that work at 320px; both cause a sideways scroll on every inner screen outside Child protection.
Where: `app/src/shared/shell/shell.css` (`.sb-shell__bar--nav`, `.sb-listen-bar`).
Workaround: `app/src/features/learner/learner.css`, `@media (max-width: 359px)`, marked `TODO(stream-1)`: the Listen row wraps (class `lrn-listen` on our `ListenBar`s) and the header logo is hidden below 360px. The header rule targets a shared class, so it also applies to other features' screens once the learner styles are loaded. Remove both when shared code handles 320px.
Status: done (stream 1, fix round 1, 12 Nov 2026; also review finding A-06). `shell.css` now handles narrow phones itself: below 376px the header row is tightened, below 360px the logo in the one-row header is hidden and the language switch drops under the Listen button (which may also shrink and wrap its words in a narrow card). Both workarounds in `learner.css` were removed by stream 1 with the coordinator's permission; the class `lrn-listen` is still on your `ListenBar`s and now does nothing. Measured in headless Chrome on the production build: no sideways scroll at 320, 360 or 390px on 16 pages (Home, Save my progress, every portal, class, topic and lesson-list kind, Get help now, lessons, not found, admin). Not checked on a real phone.

## 2026-11-12 — stream 2 → stream 1: quiz lesson on SeriesSummary (and quizzes per portal)
What: `SeriesSummary` has `hasQuiz` but not which lesson the quiz is; `Group` has neither. A quiz entry card (V3-JSS "Practice quiz", AGB-Agriculture "Quick quiz: keeping quail", CLB-Climate "Quick quiz: floods") cannot be linked without loading the whole series.
Why: the boards show a quiz entry on the portal or class page.
Where: `app/src/shared/api/types.ts` (`SeriesSummary`, `Group`), API-CONTRACT section 3. Suggested: `quiz: LessonSummary | null` on `SeriesSummary`, and on `Group` when it has one series.
Workaround: `views/PortalViews.tsx` `PracticeQuizzes` loads `GET /series/{id}` for each subject of the open class that has a quiz (one request in the seed). The Agriculture and Climate portal pages do not show the quiz entry card at all (it would cost one request per topic); the quiz is the last card of the topic's lesson list.
Status: done in the contract and the mock (fix round 1). `SeriesSummary.quiz: LessonSummary | null` and `Group.quiz: LessonSummary | null` (set when the group holds exactly one series) are sent by `GET /portals/{id}`, `GET /groups/{id}` and `GET /series/{id}`; API-CONTRACT section 3. They are optional in `types.ts` for now so in-flight branches compile; treat `undefined` like `null`. Your `PracticeQuizzes` workaround was left as it is (only its hook dependency list was touched, for the new lint rule): replacing it with `series.quiz`, and adding the Agriculture and Climate quiz cards from `group.quiz`, is yours to do.

## 2026-11-12 — stream 2 → stream 1: `seriesCount` on SeriesDetail.group
What: a lesson list needs to know whether its group has other series, to send Back to the list of series or straight to the portal. `SeriesDetail.group` only has `id`, `title`, `kind`.
Why: Back must be correct after a deep link from a lesson (stream 3 links back with `paths.series`).
Where: `app/src/shared/api/types.ts` (`SeriesDetail.group`), mock `GET /series/{id}`.
Workaround: `screens/Browse.tsx` `SeriesRoute` also requests `GET /groups/{groupId}` (cached 60 s; if it fails, Back assumes only classes hold several series). One extra small request per lesson list.
Status: done in the contract and the mock (fix round 1). `SeriesDetail.group.seriesCount` is sent by `GET /series/{id}` (optional in the type for now). Your extra `GET /groups/{groupId}` in `SeriesRoute` was left in place; it can go.

## 2026-11-12 — stream 2 → stream 1: icon key for groups and series; pictures for Primary and JSS
What: (a) the contract has no icon for a group or series, although the boards give each subject and Climate topic its own badge icon; (b) Primary and JSS subjects, and their lessons, have `picture: null`, while V3-Primary and V3-JSS draw a flat picture on each subject card, on "Continue where you stopped" and on the practice quiz; the V3-SignIn picture ("two people wave hello") is also not available as a file.
Why: fidelity to V3-Primary, V3-JSS, CLB-Climate, V3-SignIn.
Where: `types.ts` (`Group`, `SeriesSummary`), `app/mock/data/seed.ts`, `app/public/pictures/`.
Workaround: `features/learner/icons.tsx` `TopicIcon` picks the icon from English words in the title and falls back to the portal icon (so a renamed or translated title gets the fallback). Cards without a picture show the tint only.
Status: partly done (fix round 1). (a) Done: `Group.icon` and `SeriesSummary.icon` carry a key (`ContentIconKey`: `language`, `maths`, `science`, `social-studies`, `crops`, `seasons`, `floods`, `clean-water`, `heat`, or `null`; unknown or missing means the portal's icon); the seed sets them for the Primary and JSS subjects and the Climate topics; API-CONTRACT section 2. Your `TopicIcon` still reads the title; switching it to the key is yours to do. (b) Not done, needs the designer: pictures for Primary and JSS subjects and lessons, and the V3-SignIn picture, do not exist as files in `illustrations/` or `app/public/pictures/`, and stream 1 does not invent artwork. `picture` stays `null` for them (tint only) until the drawings are delivered; nothing in code needs to change when they are.

## 2026-11-12 — stream 2 → stream 1: PortalCard action label, TopicCard facts
What: (a) `PortalCard` always says "Open"; CPB-Who needs "This is me" and a one-row layout on tablets (CPB-Who-Tab). (b) `TopicCard` cannot show the "Needs sound" facts row that AGB-Agriculture has on every topic card, and puts the state chip beside the badge where AGB-Agriculture puts the tag line there.
Why: fidelity to CPB-Who, CPB-Who-Tab, AGB-Agriculture.
Where: `app/src/shared/components/Cards.tsx`.
Workaround: (a) a local `AudienceCard` in `views/PortalViews.tsx`, composed from the shared `Card`, `ScenePicture`, `Badge` and the shared `sb-open-pill` / `sb-portal-card__*` classes. (b) none: topic cards use the shared `TopicCard` as it is (recorded as a deviation).
Status: partly done (fix round 1). Done: `PortalCard` takes `actionLabel` (default "Open"), so CPB-Who can say "This is me"; `TopicCard` takes `facts` (a row under the detail line, for "Needs sound"). Not done: the one-row tablet layout of CPB-Who-Tab, and moving the tag line beside the badge with the state chip elsewhere on `TopicCard`. Both change the layout of a shared card that other boards draw differently, so they need a variant designed against the boards rather than a quick prop; your local `AudienceCard` stays the right answer for CPB-Who-Tab until then.

## 2026-11-12 — stream 2 → stream 1: key for Child protection audiences; quiz entries in progress
What: (a) the fixed text after the lesson list differs per audience (CPB-Child "Talk to someone you trust", CPB-Parent "Worried about a child?", CPB-Elder "What to do if a child tells you"), but the contract does not fix the audience ids; (b) `LessonProgress` does not say whether an entry is the Check quiz, while `lessonCount` leaves the quiz out, so a topic card built from `GET /learners/{id}/progress?portalId=` can count a finished quiz as a finished lesson.
Why: (a) correct audience content; (b) correct "N of M done" on topic and subject cards.
Where: API-CONTRACT sections 2 and 4, `types.ts`.
Workaround: (a) `views/ChildProtectionExtras.tsx` matches the seeded ids `cp-child`, `cp-parent`, `cp-elder`; any other audience gets the general "Need help now?" card. (b) `progress.ts` caps `done` at the lesson count; a learner who finished the quiz and all but one lesson is shown as finished on the card (the lesson list itself is exact).
## 2026-11-12 — stream 4 → stream 1: library has no "most recently edited" order
What: `GET /admin/lessons` is ordered by portal, group, series, position only. ADM-M-Home "Recently published" needs the newest published lessons (`sort=updated` or a small `/admin/lessons/recent`).
Why: with 231 lessons the newest cannot be found by paging.
Where: API-CONTRACT 6.1, `LibraryQuery`.
Workaround: Home shows the last lessons published from this phone, ids kept in localStorage (`app/src/features/admin/lib/flow.ts`, `TODO(stream-1)`).

## 2026-11-12 — stream 4 → stream 1: admin cannot read a lesson's content or media
What: `AdminLesson` has no content. A draft's video URL, typed blocks, page images and transcript cannot be read (the learner endpoint only answers for published lessons).
Why: ADM-Questions needs the video for the playhead; editing the text of a typed lesson and showing photo pages again need the content.
Where: API-CONTRACT 6.1 / 6.6; `shared/api/types.ts`.
Workaround: the question editor plays the video only for published lessons and otherwise takes typed stop times (`screens/Questions.tsx`, `TODO(stream-1)`). Typed text cannot be edited after it is saved (not built).

## 2026-11-12 — stream 4 → stream 1: no captions upload, no "frame from the video", language and Needs sound not editable
What: `.vtt` / `.srt` files are refused (415) and there is no field to attach captions; no cover from a video frame; `LessonPatch` has no `language`, `needsSound` or `captions`.
Why: ADM-Add-2 (Captions, Cover picture) and ADM-Add-3 (Language, Needs sound) show these controls.
Where: API-CONTRACT 6.2, 6.3, 6.4; `LessonPatch`.
Workaround: the controls are left out or shown as "not available yet" (`screens/Upload.tsx`, `screens/Picture.tsx`, `screens/Place.tsx`).

## 2026-11-12 — stream 4 → stream 1: Try it setup refuses a new scene sent as `sceneUploadId`
What: the mock's `PUT /admin/lessons/{id}/try-it` answers 422 "Add the scene picture first" when `scene` is null even if `sceneUploadId` is set; the answer also does not return the stored scene.
Why: a lesson switched from a package to "Build from a picture" can never be saved.
Where: `app/mock/handler.ts` (try-it PUT); API-CONTRACT 6.6.
Workaround: none possible in the admin folder; the server's message is shown (`screens/TryIt.tsx`, `TODO(stream-1)`).

## 2026-11-12 — stream 4 → stream 1: no rotation for photo pages, no picture search, no bold text
What: photos of notes have no `rotation`; `GET /admin/pictures` has no `search`; `ReadBlock` text has no emphasis.
Why: ADM-M-Notes "Rotate", ADM-Picture "Search pictures", ADM-M-Type "Bold".
Where: API-CONTRACT 3, 6.2, 6.4.
Workaround: rotated photos are redrawn on a canvas before upload, capped at 2000px (`lib/rotateImage.ts`); search filters the pictures already loaded; Bold is left out.

## 2026-11-12 — stream 4 → stream 1: shared LessonCard is always a link
What: a `preview` mode (not a link) on `LessonCard`.
Why: the admin shows the learner card for drafts, which learners cannot open.
Where: `app/src/shared/components/Cards.tsx`.
Workaround: `LessonPreview` composes the same shared parts and classes (`app/src/features/admin/components.tsx`, `TODO(stream-1)`).

## 2026-11-12 — stream 4 → stream 1: start JavaScript grew when the admin landed
What: with the admin built, `npm run size` reports start JS 97.6 KB gzip (was 94.0): polyfills 36.4 → 38.4 KB and the entry 57.6 → 59.2 KB.
Why: learners pay for it. Likely cause (not verified by stream 4): the admin's code pulls in a few more core-js polyfills, and shared components it uses are no longer tree-shaken out of the entry.
Where: `app/vite.config.ts` (chunking), not something stream 4 can change.
Workaround: none; still far inside the 200 KB budget.

## 2026-11-12 — stream 3 → stream 1: export the Listen subscription from `@shared/shell`
What: `subscribeListen` and `getListenSnapshot` (or a small `useListening()` hook) are not exported from `@shared/shell`; only `startListening` / `stopListening` are.
Why: the lesson's own video or audio must pause when the learner taps the gold Listen button, otherwise two sounds play at once. The other direction already works (`stopListening()` before the lesson plays).
Where: `app/src/shared/shell/index.ts`, `listen.ts`.
Workaround: deep import of `@shared/shell/listen` in `app/src/features/lessons/media/useMedia.ts`, marked `TODO(stream-1)`.

## 2026-11-12 — stream 3 → stream 1: the shared header is wider than a 320px phone
What: on screens without the quick exit, the header row (Back, Home, logo) needs 359px. Measured in headless Chrome at 320px: `header.scrollWidth` 359, so the whole page scrolls sideways. Everything inside `<main>` on the lesson screens fits 320px.
Why: the coordinator asked for layouts that work at 320px.
Where: `app/src/shared/shell/shell.css` (`.sb-shell__bar--nav`, `.sb-shell__nav-btn`, logo).
Workaround: none possible inside `features/lessons`.

## 2026-11-12 — stream 3 → stream 1: `ListenBar` does not wrap in a narrow container
What: `.sb-listen-bar` is a non-wrapping flex row. Inside a padded card (finished screen, picture lesson) on a 320px phone the language switch is cut off.
Why: 320px support.
Where: `app/src/shared/shell/shell.css`.
Workaround: `.les-page .sb-listen-bar { flex-wrap: wrap }` in `app/src/features/lessons/lessons.css`, marked `TODO(stream-1)`.

## 2026-11-12 — stream 3 → stream 1: saving progress clears the content cache
What: every write clears the whole GET cache (`clearApiCache()` in `client.ts`). Opening a lesson as a saved learner sends `PUT …/progress/{lessonId}` (`started`), so the series and lesson answers cached a moment before are thrown away and fetched again on Back or Next.
Why: extra requests to the Pi on every lesson, only for learners who save progress. Content answers (`/portals`, `/groups`, `/series`, `/lessons`) cannot change because of a `/learners/…` write.
Where: `app/src/shared/api/client.ts`.
Workaround: none; lesson code keeps writes few (open, pause or leave, finish) and never polls.

## 2026-11-12 — stream 3 → stream 1 (contract): Read lessons have no timing and no page breaks
What: (a) `ReadContent.audio` is only a file: nothing says when each block is read, so the board's "the paragraph being read is marked" cannot be exact. (b) Typed text (`blocks`) has no page breaks, while the board shows "Page 1 of [pages]" with Next / Previous page.
Why: CPB-Read, CPB-Read-Tab.
Where: `docs/API-CONTRACT.md` section 3, `ReadBlock` / `ReadContent` in `types.ts`. Suggested: optional `start` (seconds) on text blocks, as `TranscriptLine` has; an optional page-break block or `pages: ReadBlock[][]`.
Workaround: `blockBeingRead()` in `players/ReadPlayer.tsx` estimates the block from its share of the words (it can drift; the learner can switch the highlight off). Typed text is shown as one page; photos of notes are one page each.

## 2026-11-12 — stream 3 → stream 1 (contract): picture lessons (Climate) cannot carry the board's content
What: CLB-Climate-Lesson has steps ("Step 2 of 4"), a title and a sentence per step, a "Remember:" line and Back / Next step. The seed models a picture lesson as a `read` lesson of picture blocks with captions: one set of pictures, no steps, no "Remember" line. API-CONTRACT section 8 already notes that the type needs a design decision.
Why: CLB-Climate-Lesson.
Where: `docs/API-CONTRACT.md` sections 3 and 8.
Workaround: `players/PictureLesson.tsx` shows the lesson as one screen (hero, "Watch it step by step", Play animation, Back / I have finished) and leaves out the step counter and the "Remember" line. It is chosen when a `read` lesson has only picture blocks.

## 2026-11-12 — stream 3 → stream 1 (contract): Try it hotspots have one scene for every width
What: the tablet board (CPB-TryIt-Tab) uses a different, landscape drawing with the four people in a row; the contract has one `scene` with spots in percent. Spots are circles (`x`, `y`, `r`), the boards draw rounded rectangles of different sizes.
Why: CPB-TryIt-Tab.
Where: `TryItContent` in `types.ts`. Suggested if the tablet drawing matters: optional `wideScene` with its own spot positions.
Workaround: the same (portrait) scene at every width; from tablet width it sits beside the speech card. Each spot is a square of side `2r` around `x, y` (at least 64px).

## 2026-11-12 — stream 3 → stream 1 (contract): only one "next" lesson; quiz belongs to the series
What: AGB-Agri-Video shows "Next: Take the quiz" for that video and two upcoming lessons with thumbnails; AGB-Agri-Done is the result of that video's quiz. In the contract a quiz is per series (always last) and `Lesson.next` is a single lesson.
Why: AGB-Agri-Video, AGB-Agri-Quiz, AGB-Agri-Done.
Where: `docs/API-CONTRACT.md` section 2.
Workaround: one "Up next" card in the CPB style on every lesson; "Take the quiz" appears when the next item is the quiz.

## 2026-11-12 — stream 3 → stream 1: small things in shared code
What: (a) `ErrorState` always prints `describeError(error)`; it cannot take its own sentence, so the lesson screens use `Message tone="error"` with their own "Try again" button for media and save failures. (b) `features/lessons/README.md` (stream 1's version) said to wrap each screen in `lazy()`; the lessons feature imports its two screens directly so the whole feature is one request (20.5 KB gzip). (c) For every stream: polyfills land in the start script that all phones download. `Array.reduce`, `Number.toFixed` and `String.split(/pattern/)` used in one feature added 1.8 KB gzip to `polyfills-legacy` for everyone (measured; removed again). A lint rule or a note in ARCHITECTURE 3.8 would help.
Why: for the record.
Where: `app/src/shared/components/Message.tsx`, `docs/ARCHITECTURE.md` section 3.8.
Workaround: as described.
Status: done in the contract and the mock (fix round 1). (a) `Group.audience` is `child`, `parent` or `elder` on the three Child protection audience groups and `null` elsewhere. (b) Every `LessonProgress` entry carries `lessonType`; `check` marks the quiz, so it can be left out of "N of M done". Both optional in the type for now; API-CONTRACT sections 2 and 4. Your id matching in `ChildProtectionExtras.tsx` and the cap in `progress.ts` were left in place; switching them to the new fields is yours to do.
