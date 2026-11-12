# Sensebod API contract

The agreement between the frontend streams, and between the frontend and the backend that will run on the Pi. **There is no backend yet**: the app is built against the mock in `app/mock`, which implements everything below.

- Types, field by field: `app/src/shared/api/types.ts` (the source of truth for shapes; this document explains behaviour).
- Client functions: `app/src/shared/api/learner.ts` and `admin.ts` (one function per endpoint).
- Owner: stream 1. To change anything here, add an entry to `docs/team/REQUESTS.md`.

Status of this contract: **proposed by the frontend**. Nothing has been agreed with a backend engineer, because there is none yet. Section 9 lists the decisions a backend engineer must confirm.

## 1. Rules for every endpoint

| Rule | Detail |
|---|---|
| Base path | `/api/v1`, same origin as the app. The client uses a relative path, so it works on any hostname or IP the bag hands out. Override at build time with `VITE_API_BASE` only if the API moves. |
| Format | JSON, UTF-8. Request bodies are `Content-Type: application/json`, except file uploads (section 6.2). |
| Ids | URL-safe strings, stable once published (they appear in URLs learners may keep open). |
| URLs in answers | Root-relative paths served by the Pi: `/media/…` for uploaded content, `/illustrations/…` and `/pictures/…` for drawings. Never an absolute `http://` address. |
| Unknown values | `null` means "not known": the UI then shows the board's placeholder (`[length]`, `[pages] pages`). The backend must not invent values. |
| Times | Durations in seconds (number). Dates ISO 8601 UTC strings. |
| Caching | Content answers (`/portals`, `/groups`, `/series`, `/lessons`) should send an `ETag` and `Cache-Control: no-cache`. The client also reuses them for 60 s in memory. Everything under `/learners` and `/admin` is `Cache-Control: no-store`. |
| Compression | gzip for JSON. |
| Writes | `PUT` and `DELETE` are idempotent. `POST` requests that create something carry an `Idempotency-Key` header; repeating a request with the same key must return the first result instead of creating a second record (shared phones, double taps, retries after a Wi-Fi drop). |
| Paging | List endpoints take `page` (from 1) and `pageSize`; answers carry `page`, `pageSize`, `total`. |
| Language | Text is returned in the language it was authored in. `language` on a lesson is an ISO code (`en`, `kri`, and at present `es` / `hi` for three agriculture videos, see section 8). Translated UI text is not part of this contract yet. |

### Errors

Every non-2xx answer has this body (`ApiErrorBody`):

```json
{ "error": { "code": "validation", "message": "Type your name first.", "fields": { "name": "Type your name first." } } }
```

`message` is a plain sentence that may be shown to the user as it is. `fields` is optional (form validation).

| Status | `code` | Meaning | What the app does |
|---|---|---|---|
| 401 | `unauthorised`, `bad_credentials` | Admin session missing or wrong password | Sends the admin to sign in |
| 404 | `not_found` | Not in this bag (or not published) | "This is not in this bag." |
| 405 | `method_not_allowed` | | Generic error |
| 409 | `conflict`, `not_placed`, `wrong_type` | The thing changed, or the action does not fit its state | Shows `message` |
| 415 | `unsupported_file` | File kind not accepted | Shows `message` |
| 422 | `validation` | A field is missing or wrong | Shows `message`, marks `fields` |
| 5xx | any | Server problem. The reverse proxy answers `503 {"error":{"code":"unavailable",…}}` while the backend is down or starting | "Something went wrong. Nothing is lost. Please try again." with a **Try again** button |

The client (`shared/api/client.ts`) adds three failures of its own, with no HTTP status: `network` (the phone cannot reach the bag), `timeout` (15 s by default) and `aborted` (the screen went away). It never retries by itself.

## 2. Content model

```
Portal ──< Group ──< Series ──< Lesson
            │                    └─ one Check quiz per series, always last (position null)
            └─ kind: "class" (Primary, JSS) · "audience" (Child protection) · "topic" (Agriculture, Climate)
```

- 5 portals with fixed ids: `primary`, `jss`, `child-protection`, `agriculture`, `climate`. Only `agriculture` has `theme: "agriculture"` (green); the rest are `"blue"`.
- A group or series can be listed while its content is absent: `availability: "not-in-bag"` (dashed card, not a link).
- Learner endpoints only ever return **published** lessons that are placed in a series.

### The lesson data tag

Every lesson carries the tag from the component library (`LessonTag`). Cards, the filter, headers and buttons are all drawn from it.

| Field | Type | Effect in the UI |
|---|---|---|
| `type` | `"watch" \| "listen" \| "read" \| "try" \| "check"` | Icon, tag word and main button: Watch video · Play audio · Read · Start · Start the quiz. The filter uses it (Check is never in the filter). |
| `interactive` | boolean | Shows "You take part". On a Watch lesson the button becomes "Watch and answer". Try it lessons always show the pill; the Check quiz never does. |
| `captions` | boolean | Adds "Captions" to the facts row (Watch). |
| `readAlong` | boolean | Adds "Read along" (Listen, and Read when a voice was recorded). |
| `needsSound` | boolean | Adds "Needs sound" (Watch, Listen). |
| `length` | seconds or `null` | `null` shows `[length]`. On Read lessons a number shows "N min read". |
| `pages` | number or `null` | Read lessons. `null` shows `[pages] pages`. Counted from the file by the server. |

The type is set by the server from what was uploaded (the "automatic type rule"): video → `watch`; audio or voice note → `listen`; typed text, notes, PDF, Word, photos of notes → `read`; animation package (.zip with index.html) or .h5p → `try`; questions → `check`.

## 3. Learner endpoints: content

| Method and path | Answer | Client function |
|---|---|---|
| `GET /portals` | `Portal[]`, in Home order | `learnerApi.getPortals()` |
| `GET /portals/{portalId}` | `PortalDetail` = portal + `groups: Group[]` | `getPortal(id)` |
| `GET /groups/{groupId}` | `GroupDetail` = group + `portal` + `series: SeriesSummary[]` | `getGroup(id)` |
| `GET /series/{seriesId}` | `SeriesDetail` = series + `portal` + `group` + `lessons: LessonSummary[]` in learner order (quiz last) | `getSeries(id)` |
| `GET /lessons/{lessonId}` | `Lesson` = summary + `portal`, `group`, `series`, `next` (the next lesson or the quiz, or `null`), `listenUrl`, `content` | `getLesson(id)` |

Notes

- `Group.lessonCount` and `SeriesSummary.lessonCount` count published lessons **without** the quiz. `Group.lessonTypes` lists the types present (for lines such as "Watch · 12 videos"). `Group.onlySeriesId` is set when a group has exactly one series, so a topic card can link straight to its lesson list.
- `listenUrl` (portal, series, lesson, quiz question) is the recorded narration for the gold Listen button, or `null` when nothing is recorded. The app never uses speech synthesis.
- `Lesson.content` depends on `type`:

| `content.type` | Shape | Notes |
|---|---|---|
| `watch` | `sources[]` (first = default; a smaller copy for old phones may follow), `poster`, `captions[]` (WebVTT), `questions[]` (`VideoQuestion`: a quiz question plus `atSeconds` and `pauseUntilAnswered`; empty unless interactive, sorted by time), `learningPoints[]` | Media must be served with byte-range support. |
| `listen` | `sources[]`, `cover`, `transcript[]` (`{start, text}`; `start` is `null` when the words are not timed) | Empty transcript = Read along text not added. |
| `read` | `blocks[]` (heading / paragraph / list / picture), `pageImages[]` (photos of notes or rendered document pages), `audio` (recorded voice or `null`), `cover` | Typed lessons use `blocks`; photographed or PDF lessons use `pageImages`. |
| `try` | `mode: "package"` with `packageUrl` (the package's `index.html`, to be shown in a sandboxed iframe), **or** `mode: "hotspots"` with `instruction`, `scene`, `spots[]` (`label`, `role`, `says`, `audioUrl`, `portrait`, and a circle `x`, `y`, `r` in percent of the scene), `goal: "all" \| "any"`, `finishMessage`, `gentleMovement` | |
| `check` | `questions[]`: `prompt`, `listenUrl`, `answers[]` (`text`, `correct`, `feedback`), `allowRetry` | `correct` and `feedback` are sent to the client on purpose: quizzes are for learning, have no stakes and no timer, and must keep working if the Wi-Fi blips mid-quiz. |

## 4. Learner endpoints: Save my progress (optional)

No password, no phone number. A learner is a name plus who they are, stored in the bag.

| Method and path | Body | Answer | Client function |
|---|---|---|---|
| `POST /learners` (+ `Idempotency-Key`) | `NewLearner` `{ name, role }`, `role` = `learner \| teacher \| other` | `201 Learner` `{ id, name, role, roleLabel }` | `createLearner()` |
| `GET /learners/{id}` | | `Learner`, or 404 if the name was removed or the bag was reset | `getLearner()` |
| `DELETE /learners/{id}` | | `204`; removes the learner and their progress | `deleteLearner()` |
| `GET /learners/{id}/progress?portalId=&seriesId=` | | `LearnerProgress` `{ learnerId, lessons: LessonProgress[] }` (only lessons that were started or finished) | `getProgress()` |
| `PUT /learners/{id}/progress/{lessonId}` | `ProgressUpdate` `{ state, positionSeconds?, correct?, total? }` | `LessonProgress` | `saveLessonProgress()` |
| `GET /learners/{id}/continue?portalId=` | | `ContinueLesson` (`lesson`, `seriesTitle`, `lessonCount`) for "Continue where you stopped", or `null` | `getContinueLesson()` |

Rules

- `name` is trimmed, 1–40 characters. Two learners may share a name.
- A lesson that is `finished` stays finished when it is opened again (a later `started` update does not downgrade it).
- **Which names a phone offers** ("Used this phone before? Tap your name") is kept on the phone, not listed by the server: there is deliberately no `GET /learners`. See `shared/session` (`knownLearners`, at most 8, in `localStorage`). This keeps one phone from showing every name in the bag.
- A guest has no learner id and nothing is saved for them.

## 5. Admin: session

Admin endpoints live under `/admin` and need a session. The session is a cookie set by the server (`HttpOnly`, `SameSite=Strict`, `Path=/`); the client never sees a token and sends requests with `credentials: "same-origin"`.

| Method and path | Body | Answer | Client function |
|---|---|---|---|
| `POST /admin/session` | `{ username, password }` | `200 AdminSession` `{ username, displayName }` + `Set-Cookie`; 401 `bad_credentials` | `adminApi.signIn()` |
| `GET /admin/session` | | `AdminSession`, or 401 | `getSession()` |
| `DELETE /admin/session` | | `204`, clears the cookie | `signOut()` |

Every other `/admin/…` call answers 401 `unauthorised` without a valid session. Mock credentials: `admin` / `sensebod`.

## 6. Admin: content

### 6.1 Library (ADM-Library, ADM-M-Home)

| Method and path | Answer | Client function |
|---|---|---|
| `GET /admin/lessons?portalId=&groupId=&seriesId=&type=&status=&unplaced=&search=&page=&pageSize=` | `LibraryPage` `{ items: AdminLesson[], page, pageSize, total, publishedCount, draftCount }`, ordered by portal, group, series, position | `getLibrary(query)` |
| `GET /admin/lessons/{id}` | `AdminLesson` | `getAdminLesson()` |
| `GET /admin/portals` | `PortalCount[]` (lesson count per portal) | `getPortalCounts()` |
| `GET /admin/storage` | `StorageInfo` (`usedBytes`, `totalBytes`, `breakdown[]`; `null` until measured) | `getStorage()` |

- `unplaced=true` returns the drafts that are on no portal yet ("Waiting to be placed"); other filters are ignored with it.
- `search` matches the title, the placement label and the original file names.
- `AdminLesson` = `LessonSummary` + `status` (`draft` \| `published`), `placement` (or `null`), `placementLabel` ("Child protection → I am a child → Staying safe"), `source`, `fileNames`, `questionCount`, `pictureId`, `updatedAt`, `notes[]` (things to know before publishing, e.g. "Read along text not added…").

### 6.2 Upload (ADM-M-Upload, ADM-M-Notes, ADM-M-Animation, ADM-Add-2)

```
POST /admin/uploads?smallerCopy=true
Content-Type: <the file's MIME type, or application/octet-stream>
X-File-Name: <file name, URI-encoded>
<request body = the raw bytes of ONE file>
→ 201 Upload
```

One request per file, raw body, **not** `multipart/form-data`: the Pi can stream the bytes straight to disk without holding a 34 MB video in memory, and the browser reports upload progress per file ("21 of 34 MB sent"). The proxy must not buffer the request (`proxy_request_buffering off`) and must allow large bodies.

`Upload` = `{ id, fileName, sizeBytes, kind, becomes, durationSeconds, pages, processing, checks }`

- `kind`: `video`, `audio`, `voice-note`, `pdf`, `word`, `photo`, `animation`, `h5p`, `unknown`. `becomes` is the lesson type from the automatic rule; an unusable file is refused with 415.
- `processing`: `{ state: "working" | "ready" | "failed", note }`. Work done after the bytes arrive: converting voice notes (.opus) so every phone can play them, making the smaller video copy, rendering PDF/Word pages. While `working`, poll `GET /admin/uploads/{id}` every few seconds (not faster).
- `checks` (animation packages): `{ id: "offline" | "index" | "size" | "player", ok, title, detail }[]`, the "We checked it" list.

| Method and path | Answer | Client function |
|---|---|---|
| `POST /admin/uploads` | `201 Upload` | `uploadContent(file, { smallerCopy }, onProgress)` → `{ promise, abort }` |
| `GET /admin/uploads/{id}` | `Upload` | `getUpload()` |
| `DELETE /admin/uploads/{id}` | `204` | `deleteUpload()` |

### 6.3 Lessons: create, place, choose a picture, publish

| Method and path | Body | Answer | Client function |
|---|---|---|---|
| `POST /admin/lessons` (+ `Idempotency-Key`) | `NewLesson` | `201 AdminLesson`, a **draft with `placement: null`** | `createLesson()` |
| `PATCH /admin/lessons/{id}` | `LessonPatch` (any subset) | `AdminLesson` | `updateLesson()` |
| `POST /admin/lessons/{id}/publish` | | `AdminLesson`; 409 `not_placed` if it has no placement | `publishLesson()` |
| `POST /admin/lessons/{id}/unpublish` | | `AdminLesson` (back to draft; keeps its place) | `unpublishLesson()` |
| `DELETE /admin/lessons/{id}` | | `204`; the lessons after it are renumbered | `deleteLesson()` |

`NewLesson` by `source`:

| `source` | Board | Required | Becomes |
|---|---|---|---|
| `upload` | Upload files | `uploadIds: [one id]` | from the file |
| `notes-photos` | Take photos of your notes | `uploadIds: [photo ids in page order]` | `read`, `pages` = number of photos |
| `typed` | Type it yourself | `blocks: ReadBlock[]`; optional `readAlongUploadId` (recorded voice) | `read` |
| `animation` | Upload an animation | `uploadIds: [one id]` | `try` |
| `questions` | Add questions | nothing more | `check` (edit with 6.5) |

`LessonPatch` fields: `title`, `summary`, `placement` (`{ portalId, groupId, seriesId, position }` or `null` to take it off the portal), `pictureId` (or `null`), `type` and `interactive` (the "Change" override of the automatic type), `blocks` (Read text), `transcript` (Read along words for a Listen lesson).

- **Placement** ("Where does it go?"): `position` is 1-based. The server inserts the lesson there and renumbers the lessons after it. The quiz always stays last. The answer carries the final `position` and `placementLabel`.
- Learners see a lesson only when it is both placed and published. "Changes reach learners the next time they open the portal."

### 6.4 Pictures (ADM-M-Picture, ADM-Picture)

| Method and path | Answer | Client function |
|---|---|---|
| `GET /admin/pictures?group=&suggestForLessonId=&page=&pageSize=` | `PicturePage` `{ suggested: GalleryPicture[], items: GalleryPicture[], page, pageSize, total }` | `getPictures()` |
| `POST /admin/pictures?alt=<description>` (raw body + `X-File-Name`, as 6.2) | `201 GalleryPicture`, added to group `own` | `uploadPicture(file, alt)` |

`group`: `child-protection`, `agriculture`, `climate`, `school`, `people-places`, `own`. `suggested` holds up to three pictures matched to the lesson's title and portal ("Suggested for this lesson"). `alt` is required for an uploaded photo. Choosing a picture = `PATCH /admin/lessons/{id}` with `pictureId`. "Use a frame from the video" is not in this contract yet (section 9).

### 6.5 Series and order (ADM-M-Place, ADM-Series)

| Method and path | Body | Answer | Client function |
|---|---|---|---|
| `GET /admin/series/{id}` | | `AdminSeries` = series + `lessons: AdminLesson[]` including drafts, in order | `getAdminSeries()` |
| `POST /admin/series` (+ `Idempotency-Key`) | `NewSeries` `{ portalId, groupId, title }` | `201 AdminSeries` ("Start a new series") | `createSeries()` |
| `PUT /admin/series/{id}/order` | `SeriesOrder` `{ lessonIds }` | `AdminSeries` | `saveSeriesOrder()` |

`lessonIds` must contain **every** lesson id of the series except the quiz, exactly once. If the list does not match the series as it is now (another admin added or removed a lesson meanwhile) the server answers 409 `conflict` and changes nothing; the editor reloads the series. Draft lessons keep their place but learners do not see them.

### 6.6 Questions (ADM-Questions) and Try it setup (ADM-TryIt)

| Method and path | Body / answer | Client function |
|---|---|---|
| `GET /admin/lessons/{id}/questions` | `QuestionSet` `{ lessonId, kind: "video" \| "check", questions[] }` | `getQuestions()` |
| `PUT /admin/lessons/{id}/questions` | the whole `QuestionSet`; returns it as saved | `saveQuestions()` |
| `GET /admin/lessons/{id}/try-it` | `TryItSetup` | `getTryItSetup()` |
| `PUT /admin/lessons/{id}/try-it` | the whole `TryItSetup`; returns it as saved | `saveTryItSetup()` |

- Questions are saved as a whole set: add, edit, delete and reorder are one `PUT`. For `kind: "video"` each question has `atSeconds` and `pauseUntilAnswered`; the server sorts them by time and sets the lesson's `interactive` flag (true when there is at least one question). Validation (422): every question needs a prompt, at least two answers and exactly one correct answer. Only Watch and Check lessons have questions (409 `wrong_type` otherwise).
- `TryItSetup` is either `mode: "package"` (`uploadId` of a new .zip or the current `packageUrl`, plus `checks`) or `mode: "hotspots"` (`instruction`, `scene` or `sceneUploadId`, `spots[]` with `label`, `role`, `says`, `audioUrl` or `audioUploadId`, circle `x`/`y`/`r` in percent, `goal`, `finishMessage`, `gentleMovement`). Validation: a scene and at least one spot. A spot without audio is allowed ("Learners will only read the words").

## 7. The mock API

`app/mock` implements this contract in memory. It is used by the dev server, by `vite preview` and by the unit tests, and is never part of the production bundle (the build fails if it is: `scripts/postbuild.mjs`).

| File | What |
|---|---|
| `mock/handler.ts` | One pure function, `handleMockRequest(request) → response`, with every endpoint above |
| `mock/data/seed.ts` | The seed: 5 portals, 23 groups, 46 series, 231 lessons, 2 learners with progress, 2 drafts waiting to be placed, the picture gallery |
| `mock/data/generated.ts` | Generated from `content/agriculture-videos.csv` and the illustrations' own descriptions (`npm run gen:mock`) |
| `mock/installMockFetch.ts` | Test helper: routes `fetch` and `XMLHttpRequest` to the handler |
| `mock/media/` | Tiny sample video, audio, captions and a one-file animation package, served at `/media/…` with byte ranges |
| `build/mockApiPlugin.ts` | Mounts the handler on the dev and preview servers |

**In the dev server** (`npm run dev`) nothing needs to be set up: `/api/v1/*` and `/media/*` just work. State is in memory; restart the server, or `curl -X POST localhost:5173/api/v1/__mock/reset`, to go back to the seed. Editing a mock file restarts the server by itself.

- Every answer is delayed by 150 ms so loading states are visible. `MOCK_DELAY_MS=0 npm run dev` turns that off; `MOCK_DELAY_MS=3000` imitates a struggling Pi. At run time: `curl -X POST -H 'Content-Type: application/json' -d '{"ms":3000}' localhost:5173/api/v1/__mock/delay`.
- To see an error state: `curl -X POST -H 'Content-Type: application/json' -d '{"status":503,"count":1}' localhost:5173/api/v1/__mock/fail-next`. The next request fails.
- These `__mock` paths are development helpers, not part of the contract.

**In tests**

```ts
import { installMockApi } from '@mock/installMockFetch';

let mock: ReturnType<typeof installMockApi>;
beforeEach(() => { mock = installMockApi(); });   // fresh seed, empty cache, signed out

mock.failNext(503);      // the next request fails → test the error state
mock.setDelay(200);      // slow answers → test the loading state or a timeout
mock.signInAdmin();      // skip the sign-in form in admin tests
```

**Seeded ids worth knowing**

| What | Id |
|---|---|
| Child protection audiences (groups) | `cp-child`, `cp-parent`, `cp-elder` |
| Their series | `cp-child-staying-safe`, `cp-parent-keeping-children-safe`, `cp-elder-protecting-our-children` |
| Lessons | `<seriesId>-<n>` and `<seriesId>-quiz`, e.g. `cp-child-staying-safe-1` (Watch), `-2` (Listen), `-3` (Try it, hotspots), `-4` (Watch and answer, 2 questions), `-quiz`; `cp-parent-keeping-children-safe-5` (Read with Read along) |
| Agriculture topics | `agriculture-chickens-and-quail`, `agriculture-rabbits`, `agriculture-milk-and-dairy-cows`, `agriculture-goats-snails-and-grasscutters`, `agriculture-feed-and-animal-health`, `agriculture-crops` (not in bag); series = `<groupId>-videos`; "Quail housing" = `agriculture-chickens-and-quail-videos-2` |
| Classes | `primary-class-1` … `primary-class-6`, `jss-1` … `jss-3`; series = `<groupId>-<subject>`, e.g. `primary-class-4-mathematics` |
| Climate topics | `climate-floods-stay-safe` (series `…-lessons`), and four more |
| Learners | `learner-aminata` (progress in Child protection and Agriculture), `learner-mohamed` |
| Drafts waiting to be placed | `draft-safe-touch-story` (Listen), `draft-fatmata-science-notes` (Read, 3 photo pages) |
| Try it by package | any lesson created from a `.zip`; sample package at `/media/tryit/sample/index.html` |

## 8. What the seed data shows (for the content owner)

- The agriculture counts match the board: 12 / 7 / 10 / 8 / 27 = 64 videos. Titles are cleaned from the file names in `content/agriculture-videos.csv`; topics are the CSV's ("matched by title words — check by hand").
- **Three of the 64 files are not English** according to their file names: "Natural ways to keep chickens healthy" (Spanish), "Making and using wood vinegar" (Hindi), "A goat revolving scheme" (Hindi). They are seeded with `language: "es"` / `"hi"`. Decide whether to replace them.
- Lesson lengths are `null` everywhere (the boards show `[length]`), except the sample voice-note draft (1:42, as on ADM-M-Home).
- Primary and JSS lesson titles are samples, marked `[Sample]`, with the counts from the boards for Class 4 and JSS 2.
- Climate "picture lessons" predate the lesson-type tags; they are seeded as `read` lessons made of picture blocks. The right type needs a design decision.
- Quiz questions are the boards' sample content (`[Sample]` where invented to fill a set) and need checking by subject experts, as the handoff says.

## 9. Open points for the backend

1. **Confirm the whole contract.** It was designed from the boards without a backend engineer.
2. Raw-body upload (6.2) versus multipart; maximum file size; whether very large videos need resumable upload.
3. Admin accounts, password rules, session lifetime, sign-in throttling, password reset (the board shows "[How to reset — confirm]").
4. Who may create or delete a learner: today anyone on the bag's Wi-Fi can call `/learners`. Acceptable for "name only, no password", but `DELETE` lets one person remove another's progress if they know the id. Ids should be unguessable.
5. Video conversion ("smaller copy for old phones"), .opus conversion, PDF/Word page rendering, H5P: all server-side work behind `Upload.processing`. Codec and bitrate choices must be tested on the real phones.
6. "Use a frame from the video" as a lesson picture; "Learners and progress", "Storage and backup" and "Settings" (not designed yet).
7. Krio: how translated lesson text and UI text will be delivered.
8. Content-change signal: learners see changes "the next time they open the portal"; the client caches content for 60 s. An `ETag` on content answers is enough.
