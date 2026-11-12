# features/lessons — Lesson players (stream 3)

Everything under `/lesson`: one screen per lesson, whatever its type, and the finished screen. Full write-up: `docs/reports/stream-3-lesson-players.md`.

| URL | Screen | File |
|---|---|---|
| `/lesson/:lessonId` | the lesson (player chosen from `lesson.content`) | `screens/LessonScreen.tsx` |
| `/lesson/:lessonId/done` | finished: result, saved or not, next lesson | `screens/LessonDoneScreen.tsx` |

## Map

```
routes.tsx              the two routes (imported directly: the feature is one lazy chunk)
lessons.css             all styles, prefix les-
screens/                LessonScreen (frame + which player), LessonDoneScreen
players/
  WatchPlayer.tsx       Watch, and Watch and answer (questions over the video)
  ListenPlayer.tsx      Listen + Read along
  ReadPlayer.tsx        Read: typed text, photos of notes / document pages, optional voice
  PictureLesson.tsx     picture lesson (Climate): a Read lesson made only of pictures
  TryItHotspots.tsx     Try it: tap the picture
  TryItPackage.tsx      Try it: uploaded animation package in a sandboxed frame
  CheckQuiz.tsx         Check quiz
media/                  useMedia (the one hook behind <video>/<audio>), controls, seek bar, full screen
quiz/                   question rules (pure) and the answer rows with feedback
parts/                  header, "Lesson 2 of 4", What you will learn, Up next, help card, finished actions
progress/               started / position / finished through the API; guest = nothing sent
logic.test.ts           the pure rules
lessons.test.tsx        every screen against the mock API
```

## Rules this folder keeps

- **Media**: native elements only. No `src` and no request before the learner taps Play (`preload="none"` as well); no autoplay; source chosen with `canPlayType`; a file that fails to decode falls back to the next source, then to a plain message; on unmount the element is paused, its `src` removed and `load()` called. Never `fetch()` a media file.
- **Only the bag**: media and package addresses must be root-relative (`media/localUrl.ts`); anything else is not opened.
- **Animation packages**: `<iframe sandbox="allow-scripts">`, nothing else in the sandbox list, loaded only after Start.
- **Quizzes**: no timers; a wrong answer shows the reason and can be tried again; state is said in words and an icon, never by colour alone. Questions come from the API, never from a component.
- **Progress**: only when `useSession().learner` is set. Sent on open (`started`), on pause / leaving a video or audio (position), and at the end (`finished`, with quiz results). No polling.
- **A fresh player per lesson**: the body is rendered with `key={lesson.id}`; the router keeps the same screen instance when only `:lessonId` changes.
- **CSS**: the Android 8 rules in `docs/ARCHITECTURE.md` section 3.7 (no flex `gap`, no `aspect-ratio`, no `inset`, no `clamp()`); movement only inside `prefers-reduced-motion: no-preference`; laid out from 320px.
- **Polyfills are paid by every phone at start-up**, not by this chunk. `Array.reduce`, `Number.toFixed` and `String.split(/pattern/)` in this folder added 1.8 KB gzip to the start script and were written out by hand instead. Check `npm run size` after using a new built-in.

## Adding a lesson type

1. Add the player in `players/` (props: `lesson`, its `content`).
2. Branch on `lesson.content.type` in `screens/LessonScreen.tsx`.
3. Call `finishLesson(lesson.id)` when the learner reaches the end; show `<SaveNote>` or go to `paths.lessonDone(lesson.id)`.
