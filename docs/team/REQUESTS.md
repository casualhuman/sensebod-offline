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

