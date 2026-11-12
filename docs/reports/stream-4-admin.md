# Stream 4 — Admin: technical report

12 Nov 2026. Covers `app/src/features/admin/**`, this report, and the entries stream 4 appended to `docs/team/REQUESTS.md`. Nothing outside those paths was edited.

State at hand-over: typecheck, lint, 136 unit tests (75 of them stream 4's) and the production build pass; the size budgets are met. The production build was walked in headless Chrome 157 at 390, 320, 800 and 1440 wide against the mock API. **No Raspberry Pi and no physical Android device were used.** File pickers, camera and recorder capture, upload speed and memory behaviour on real phones are untested; section 6 lists exactly what that leaves open.

## 1. What I built

All screens live under `/admin` (URL scheme: `adminPaths.ts`). Every screen is a lazy chunk; every screen except sign-in is wrapped in `RequireAdmin`.

| Screen | URL | Board(s) | File |
|---|---|---|---|
| Sign in | `/admin/sign-in` | ADM-SignIn | `screens/SignIn.tsx` |
| Home: 4 sources, drafts waiting, recently published, storage | `/admin` | ADM-M-Home | `screens/Home.tsx`, `SourceCards.tsx` |
| Jumbo menu | `/admin/menu` | ADM-M-Menu | `screens/Menu.tsx` |
| Where is your content from? | `/admin/add` | ADM-Source (laptop); the 4 source cards on a phone | `screens/AddSource.tsx` |
| Upload files | `/admin/add/upload` | ADM-M-Upload (both states), ADM-Add-2 | `screens/Upload.tsx`, `UploadList.tsx` |
| Photos of notes, PDF, Word | `/admin/add/notes` | ADM-M-Notes | `screens/Notes.tsx` |
| Type it yourself + record yourself | `/admin/add/type` | ADM-M-Type | `screens/TypeLesson.tsx` |
| Upload an animation with the offline checks | `/admin/add/animation` | ADM-M-Animation | `screens/Animation.tsx` |
| Where does it go? / Details with live card preview | `/admin/lessons/:id/place` | ADM-M-Place (phone), ADM-Add-3 (laptop) | `screens/Place.tsx` |
| Choose a picture | `/admin/lessons/:id/picture` | ADM-M-Picture, ADM-Picture | `screens/Picture.tsx` |
| Check and publish | `/admin/lessons/:id/check` | ADM-M-Done | `screens/Done.tsx` |
| Library and lesson table | `/admin/library` | ADM-Library | `screens/Library.tsx` |
| Series and order | `/admin/series[/:id]` | ADM-Series | `screens/Series.tsx` |
| Questions (interactive video, Check quiz) | `/admin/lessons/:id/questions` | ADM-Questions | `screens/Questions.tsx` |
| Try it setup (package, or picture + spots) | `/admin/lessons/:id/try-it` | ADM-TryIt | `screens/TryIt.tsx` |
| Learners and progress, Storage and backup, Settings, unknown admin URL | `/admin/learners` … | not designed (HANDOFF 8) | `screens/NotAvailable.tsx`: plain "Not available yet" |

Supporting code

| Piece | File | What it does |
|---|---|---|
| Frame | `frame/AdminFrame.tsx`, `admin.css` | Phone and tablet: top bar with labelled Menu, "Saved on this bag" line, Back + step bar, sticky main action above the four tabs. Laptop (1100px+): side menu, bag status, who is signed in, Sign out. Skip link, focus moved to main after navigation |
| Session and guard | `session.tsx` | In-memory session state rebuilt from `GET /admin/session`; `RequireAdmin`; every 401 from any admin call goes through `noteAdminError` → sign-in with a `next` address |
| Upload queue | `lib/uploadQueue.ts` | Sequential uploads with progress, stop, retry, removal, background polling of server-side processing; plain class, tested without React |
| Placement rules | `lib/placement.ts` | What resets what, position options, "how the series will look", missing-step words, reorder helper |
| Other logic | `lib/files.ts`, `chosenFiles.ts`, `typedLesson.ts`, `questions.ts`, `rotateImage.ts`, `flow.ts`, `hooks.ts` | File classification and validation, typed-lesson blocks and the local draft, question model and validation, photo rotation, flow steps, `useAction` (double-submit lock), `useLeaveWarning` |
| Shared admin parts | `components.tsx`, `icons.tsx` | 56px fields, radio rows, switch, file picker, progress bar, two-tap confirm, non-link lesson preview; 23 icons with the boards' path data |

How the requirements are met

- **Guarded routes.** The guard is a convenience; the mock (and the future server) refuses every `/admin` call without the cookie. Tested: a 401 in the middle of work sends the person to sign in and back.
- **No credentials in the browser.** The password is sent once in the POST body and dropped from state on success. Nothing about the session is written to storage (asserted in a test). `next` only accepts paths inside `/admin` (open-redirect test).
- **Uploads.** One file per request via `adminApi.uploadContent` (XHR, raw body): the `File` is handed over as a reference, never read into memory. Visible progress ("21 of 34 MB sent · 62%" + bar), Stop uploading, Try again that only sends what is left, per-file Remove.
- **Double submission.** `UploadQueue.start()` is a no-op while running; every other action goes through `useAction`, whose lock is a ref (stops two taps in the same frame). Creating POSTs carry one idempotency key per form or per file, kept across retries (coordinator note 1). Tested for upload, typed lesson, new series, publish and delete.
- **Preserving work.** A finished upload becomes a draft on the bag at once, so a refresh or dropped Wi-Fi loses nothing that arrived. Typed lessons are copied to `localStorage` as they are typed and restored after a refresh (tested). A `beforeunload` warning covers chosen-but-unsent files and unsaved editors. Failed saves keep everything on screen.
- **States.** Every data load has loading, error with Try again, and empty states inside the frame; every action has working, error and success feedback.

## 2. Technical decisions and trade-offs

| Decision | Chosen | Rejected, and why | Cost |
|---|---|---|---|
| One URL per step, two layouts | The same route renders the phone board below 1100px and the laptop board above (`useIsLaptop`, `matchMedia`) | Separate phone and laptop URL trees: two copies of every flow and broken links when a tablet rotates. CSS-only switching: both navigations would sit in the DOM | A little branching in `Place`, `Picture`, `AddSource` |
| When a draft is created | As soon as each upload finishes | Creating it at "Publish": uploads would be orphaned by a refresh (the contract has no list of uploads) | A facilitator who abandons the flow leaves a draft under "Waiting to be placed" (visible, deletable) |
| Upload concurrency | One at a time | Parallel uploads: faster on a laptop, but several phones share one Pi and one radio | Slower for many small files |
| Upload state | A plain class + `useSyncExternalStore` | A reducer inside the screen (hard to test, tied to render timing); an upload library (dependency) | About 250 lines to maintain |
| Typed lesson autosave | Local copy on the phone, sent to the bag on Next | Autosave to the bag on every pause: needs a create-then-patch dance per keystroke burst and fails exactly when Wi-Fi drops | The line under the editor says "Kept on this phone", not the board's "Saved on this bag" |
| Editor | Plain blocks (paragraph, heading, list, picture), each a labelled field | `contentEditable` rich text: fragile on old Android keyboards, and an HTML-injection surface | Less like a word processor |
| Reordering | Move up / Move down buttons | Drag and drop: HTML5 drag does not fire on touch, and a library was not allowed | No drag handle |
| Spots on the Try it scene | Tap the picture to place the selected spot; arrow and size buttons | Pointer dragging: needs Pointer Events (Chrome 55, flaky on old WebViews) and has no keyboard path | Coarser placement (2% steps) |
| Photo rotation | Canvas re-encode of rotated photos only, capped at 2000px | A `rotation` field: not in the contract. CSS-only rotation: would lie about what is stored | A turned photo is re-compressed (JPEG 0.9) |
| "Recently published" | Ids of lessons published from this phone, in `localStorage` | Paging 231 lessons to sort them client-side | Per phone, not per bag |
| Lesson card preview | Composed from the shared parts and classes, not a link | Using `LessonCard`: it is always a link, and a draft's link leads to "not in this bag" | A local composition to keep in step with the shared card |
| Confirmation | Two-tap inline confirm | `window.confirm`: easy to tap through, cannot be styled or worded per case | — |
| Dependencies | None added | — | — |

Coordinator notes applied (Reviewer A's foundation findings): (1) one idempotency key per submission, kept across retries, for `createLesson` and `createSeries`; (2) `useQuery()` is never in a dependency list (strings from `useLocation().search`); (3) banned CSS checked by grep (none) and dependency lists checked by hand; (4) loaded objects are matched against the current id before use (`data.id === lessonId`); (5) forms are keyed by lesson or series id; (6) loading and error states render inside `AdminFrame`; (7) verified at 320px: no horizontal overflow on 9 screens; (8) API answers are copied before sorting or accumulating (`Series`, `Picture`, `placement.ts`).

## 3. Deviations from the design

| # | Where | Difference | Reason |
|---|---|---|---|
| 1 | Voice recording, photos | `<input type="file" capture>` opens the phone's own recorder or camera; no in-page recorder or live camera view | `getUserMedia` / `MediaRecorder` are blocked on plain HTTP (ARCHITECTURE 10) |
| 2 | Add tab and "Add content" tile | Open the source chooser, not Upload files directly | On the boards three of the four sources are unreachable from Add |
| 3 | Upload files | After uploading, a second tap on "Next" goes on; the board implies one tap | Failures must be seen before moving on |
| 4 | Upload files | Each file becomes its own lesson; said on the screen | The contract takes one file per lesson |
| 5 | ADM-Add-2 | Captions shown as "not available yet"; no cover from a video frame; "For other lesson types" panel left out | Not in the contract; the type-first step it describes was superseded by ROUND12–13 |
| 6 | ADM-Add-3 | No Language or Needs sound fields; Status radios replaced by the two buttons the board also shows | Not in `LessonPatch` |
| 7 | ADM-M-Type | No Bold; "Kept on this phone" instead of "Saved on this bag"; word count without "[minutes] to read" | `ReadBlock` has no emphasis; see section 2; no reading speed is defined |
| 8 | ADM-M-Notes | Extra "Add photos already on your phone" and "Remove page" buttons | Needed in practice; the board has no way to remove a page |
| 9 | ADM-M-Animation | "Test as a learner" appears after the upload (needs the unpacked package); no separate full-screen test; no example failure card | The preview needs a lesson; a fake failure card would confuse |
| 10 | ADM-M-Picture | "All" and "Your own" groups added; search (laptop) filters the pictures loaded so far | No search in the contract |
| 11 | ADM-Library | No up/down arrows in the Order column ("Change order" opens Series and order); a Series filter added; storage card not repeated; "Waiting to be placed" notice added | One place owns reordering and its conflict handling; Primary and JSS groups have several series; the laptop menu has no Home |
| 12 | ADM-Series | No drag handle | Section 2 |
| 13 | ADM-Questions | Video preview only for published lessons; markers are a row of buttons, not a drawn timeline; one question edited at a time | No media URL for drafts in the admin API |
| 14 | ADM-TryIt | Spots placed by tap and buttons, not by dragging; a "role" field added | Section 2; the contract has `role` |
| 15 | Laptop step bar | Same bar style as the phone, not the numbered circles of ADM-Source | One component |
| 16 | Laptop top of ADM-Questions / TryIt / Series | Side menu on every laptop screen | Those three boards draw a different chrome from the other laptop boards |
| 17 | Tappable card edges | `--sb-edge` (3.13:1), not the boards' `#B9CFE6` | Stream 1's contrast rule for tap targets |
| 18 | Small text | Nothing below 16px; the boards use 13–15px in places | ARCHITECTURE 3.7 |
| 19 | Sign-in | "Ask your EasySTEM contact how to reset it" for the board's "[How to reset — confirm]"; no address line | Placeholder content is still open (HANDOFF 8) |
| 20 | Group names | "I am a child" (from the API), where the boards say "Child" | Titles come from data |

Undesigned areas (Learners and progress, Storage and backup, Settings) show "Not available yet". No WhatsApp wording anywhere.

## 4. Footprint (measured, `npm run size`, gzip level 9)

| What | Files | Raw | gzip |
|---|---|---|---|
| All admin chunks together | 27 | 214.0 KB | 74.2 KB |
| Largest admin chunk (`admin-…js`) | 1 | 27.2 KB | 6.8 KB (budget 60) |
| Largest screen chunks: TryIt, Place, Questions, AdminFrame, TypeLesson, Notes | | 12.7–16.3 KB | 4.9–5.4 KB each |
| Start JavaScript, whole app | 2 | 298.6 KB | 97.6 KB (budget 200) |
| Critical resources for the first screen | | | 118.7 KB (budget 350) |

- A facilitator who signs in and uploads one file downloads the frame, session, Home, Upload and Place chunks: roughly 25 KB gzip on top of the app start. The question editor and Try it setup are downloaded only when opened.
- Start JavaScript rose from stream 1's 94.0 KB to 97.6 KB with the admin present. The cause was not investigated (recorded in REQUESTS.md).
- Dependencies added: none. Images added: none. Source: about 10,200 lines including tests and CSS.

## 5. Offline and compatibility

- **External requests: none.** The postbuild scan passes, and the headless walk logged every request across 40+ page loads: all on the local origin.
- Browser features relied on, beyond stream 1's list: `File`, `FormData`-free XHR upload with `upload.onprogress`, `URL.createObjectURL` (thumbnails; revoked on change and unmount), `matchMedia` with `addListener` fallback, `<input capture>`, canvas `toBlob` (Chrome 50; rotation fails with a plain message without it), `<iframe sandbox>`, `beforeunload`. All exist on Chrome 58. **None of it was run on Chrome 58 or on Android.**
- CSS: no flex `gap`, `aspect-ratio`, `inset`, `clamp()`, `:has()`; grids declare `grid-gap` first; the one transition is inside `prefers-reduced-motion: no-preference`.
- Security: typed text is always rendered as text (tested with markup in a title); stored drafts are parsed as untrusted input and only root-relative picture URLs are accepted back; animation packages are framed with `sandbox="allow-scripts"` and only from a root-relative URL; inputs have length limits and are validated before sending.
- Mode A only: with the bag unreachable the screens show "This phone cannot reach the bag…" and Try again (seen in the headless walk).

## 6. Testing

Automated (in `app/`)

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 warnings |
| `npm test` | 136 tests in 9 files pass (stream 4: 29 logic, 11 upload queue, 35 flow tests) |
| `npm run build` | pass, postbuild checks ok |
| `npm run size` | all three budgets met |

The flow tests render the real route table against the mock API: sign-in, wrong password, redirect safety, session expiry, upload → drafts, double tap on Next, failed upload and retry, lost answer and retry without a duplicate, placement step by step, new series on a double tap, failed save keeping input, publish on a double tap, publish failure, series reorder, 409 conflict, undo, typed draft restore, validation, animation checks, library actions, delete confirm, question validation and save.

In a browser: production build served by `vite preview` (mock API), headless Chrome 157, driven over the DevTools protocol.

| Width | Screens | Result |
|---|---|---|
| 390 | Full phone flow: sign in (wrong, then right), Home, Menu, Add, Upload a file, Place, Picture, Check, Publish, Home again; Notes with a photo, Type and refresh, Animation with checks and the sandboxed test, Library, Series, Settings | Completed. No horizontal overflow, no control under 44px high |
| 320 | 9 screens | No horizontal overflow |
| 800 | Home, Library, Place | No horizontal overflow |
| 1440 | Source, Library, Upload, Details, Picture, Questions, Try it, Series (reorder and save), network cut and recovery | Completed |

Console: no script errors or exceptions. Logged entries were the expected 401s (not signed in, wrong password), one 404 for a deleted lesson in the recent list (handled), Chrome's own note that `beforeunload` needs a user gesture, and the deliberate offline request. Screenshots were compared with the boards by eye, not by pixel.

Not tested — do not assume any of it works

- Any Android phone or tablet, any WebView, Chromium 58. In particular: whether `capture` opens the camera and the recorder, what the file picker offers, voice-note MIME types, the virtual keyboard over the sticky bottom bar, and `position: sticky` behaviour there.
- A real upload: the mock counts bytes and answers at once. Progress pacing, Stop mid-transfer, Wi-Fi drops during a 34 MB video, memory while uploading, and phone lock pausing uploads are unverified.
- Photo rotation on a real camera photo (unit-tested for sizes only; jsdom has no canvas) and its memory use on a low-RAM phone.
- A real backend: session cookie, idempotency, 409 on reorder, processing states.
- Screen readers; tablets in landscape between 1100 and 1280px (laptop layout applies; checked only at 1440).
- Firefox, Safari.

## 7. Cross-team notes

Requests appended to `docs/team/REQUESTS.md` (all with workarounds marked `TODO(stream-1)` where code exists): no "most recent" library order; admin cannot read lesson content or media; no captions, video frame, language or Needs sound; Try it setup refuses `sceneUploadId` without `scene`; no rotation, picture search or bold; `LessonCard` is always a link; start JavaScript grew by 3.6 KB.

- Stream 2 and 3: the admin links to `paths.series(portal, group, series)` ("See it as a learner") and `paths.lesson(id)` (Preview, Test as learner; published lessons only). Nothing else is assumed about your screens.
- `LessonPreview` uses the shared `sb-lesson-card` classes; a change to the shared card's markup needs the same change in `features/admin/components.tsx`.
- `localStorage` keys used: `sensebod.admin.typed-draft.v1`, `sensebod.admin.recent-published.v1`.

## 8. Open items and risks

1. **Real devices and a real backend** (section 6). The highest risks are `capture` on old Android and long uploads on the bag's Wi-Fi.
2. **Try it "Build from a picture" cannot be saved for a lesson that has no scene yet** (contract and mock gap, REQUESTS.md). Editing an existing scene's spots works.
3. A typed lesson cannot be edited after it is saved; photo pages cannot be reviewed again (no admin content read).
4. If the answer to "create lesson" is lost and the facilitator then edits a typed draft before retrying, the bag returns the first version (same idempotency key). Rare; fixing it needs server-side draft updates.
5. Leaving an upload screen through an in-app link cancels the upload in flight without asking (the browser warning only covers refresh and close). Finished files are kept.
6. Uploads orphaned by an abandoned notes or recording step stay on the bag; the contract has no clean-up or listing.
7. No resumable upload: a dropped connection restarts that file from zero (API-CONTRACT 9.2).
8. Placeholders still shown as data arrives: `[Staff name]`, `[used] of [total] GB`, `[length]`.
9. Plain HTTP on the bag: the admin password crosses the Wi-Fi unencrypted (stream 1's item 9).
