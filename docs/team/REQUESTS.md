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
