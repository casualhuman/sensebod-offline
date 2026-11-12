# Reviewer A (Code quality) — Final report

12 Nov 2026. Scope: `main` at `9339fbd` (all four streams and fix round 1 merged). Part 1 re-verifies the pass-1 findings A-01 to A-15. Part 2 is the first review of `app/src/features/learner` (stream 2), `app/src/features/lessons` (stream 3) and `app/src/features/admin` (stream 4). Reviewer B covers dependencies, bundle, offline and network verification, fonts and assets, performance and memory, legacy browsers, security and deployment; those rows are marked as theirs.

Nothing in the application was changed by this review. Everything written is under `docs/reviews/`.

## A. Executive summary

**Decision within Reviewer A's focus: FAIL, on one High finding (A-16). Not ready for release yet.** The rule in section 23 leaves no other outcome while a High finding is open. The gap is small: A-16 is a local fix in one hook, and with it and the four Medium findings fixed and re-verified the result in this focus would be PASS WITH CONDITIONS. Release readiness of the product as a whole is INSUFFICIENT EVIDENCE whatever happens here, because nothing has run on a Raspberry Pi, an Android 8 device or Chrome 58.

**Overall assessment.** The code is careful and consistent across all four streams. The fix round did what it claimed: 11 of the 15 pass-1 findings are closed, 3 are partly closed with Low residue, and 1 (A-10) is open by decision. The three features use the shared client, `useApi`, the shared components and the tokens correctly; there are no cross-feature imports, no `any`, no `@ts-ignore`, and three justified `eslint-disable` lines in the whole of `src/features`. Timers, listeners, object URLs, uploads and media elements are released on unmount. Double-submit protection in admin is real (a ref lock plus one idempotency key per submission). Wording matches the boards on every string sampled (20 of 20, section F), and the deviations the engineers listed are real and reasoned.

The defects found are where unit tests in jsdom cannot see: the behaviour of a real media element, a real 401 in the middle of work, and widths nobody measured.

**New findings: 0 Critical, 1 High, 4 Medium, 5 Low.**

| | Critical | High | Medium | Low |
|---|---|---|---|---|
| Stream 2 (learner) | 0 | 0 | 0 | 2 (A-21, A-25) |
| Stream 3 (lessons) | 0 | 1 (A-16) | 2 (A-17, A-18) | 1 (A-23) |
| Stream 4 (admin) | 0 | 0 | 2 (A-19, A-20) | 2 (A-22, A-24) |

**Major risks**

1. **A video or sound file that does not arrive when Play is tapped is reported as "This video cannot play on this phone … try another phone", with no Try again (A-16, High).** Confirmed in Chrome on the production build for a dropped connection and for a 503 from the bag. It is the most likely failure on the bag's Wi-Fi, on the product's main content type, and the advice given is wrong.
2. **The place in a video or story is not saved when the learner leaves while it is playing (A-17).** Confirmed in Chrome. The unit test passes only because jsdom's `load()` is a stub.
3. **A Child protection lesson that is loading or failed to load has no "Leave this page" (A-18).** Confirmed in Chrome.
4. **An admin session that ends during editing throws away the unsaved work (A-19).** Confirmed with a test.
5. **The admin Library scrolls sideways between 1100 and 1353px wide (A-20)**, which includes 1280px laptops and tablets in landscape.

**Critical blockers:** none found in this focus.

**Performance observations:** nothing measured on target hardware (Not Tested; Reviewer B). In source: no render-path problem found; time updates are throttled to two renders a second; no polling in the learner features; admin polls upload processing every 3 s, bounded at 60 polls per file. Avoidable requests: A-21.

**Compatibility status:** Not Tested by this reviewer. The CSS floor check and strict lint now pass over 89 files.

**Offline compliance status:** Not Tested by this reviewer. A-16 and the A-03 residue are the offline-recovery defects seen from the source side.

**Product risks that are not code defects:** every Listen button says "No sound here yet" (no recordings exist); the Krio switch changes no text; lesson cards print `[length]` (A-10); the Child protection help page shows five bracketed contact placeholders, correctly as plain text and never as links, but the page cannot help a child until the content owner fills them.

## B. Verification results

| Category | Status | Findings |
|---|---|---|
| React best practices | Partial | Components well scoped; state local; effects cleaned up. Defects: unmount order in the media hook (A-17), work lost on a 401 (A-19), one small race (A-24). |
| TypeScript quality | Pass | Strict, no `any`, no `@ts-ignore`. Three `eslint-disable` lines in features, each justified (`admin/session.tsx:89`, `admin/screens/Upload.tsx:67`, plus `shared/api/useApi.ts:86`). Type assertions are few and local (prefixed fullscreen APIs, `error as { status }`). |
| Dependency hygiene | Not Tested | Reviewer B. |
| Offline operation | Not Tested | Reviewer B. See A-16 and A-03. |
| Local asset hosting | Not Tested | Reviewer B. |
| Performance | Not Tested | No target hardware. |
| Legacy browser compatibility | Not Tested | Reviewer B. Enforcement gap of pass 1 is closed (A-07 items 1 to 4). |
| Accessibility | Partial | Labels, roles, live regions, focus moves, reduced motion (opt-in) and "never colour alone" are right on every screen sampled. 16px minimum text holds on 30 pages. Defects: A-18; small targets and smaller items in A-23, A-24, A-25. No screen reader was run; nothing verified on Android. |
| Security | Not Tested | Reviewer B. Seen in passing: return addresses are restricted to in-app paths in both features; packages run in `sandbox="allow-scripts"`; nothing about the admin session is stored. |
| Deployment readiness | Not Tested | Reviewer B. |
| API integration | Partial | Shared client and `useApi` used throughout; cancellation and stale-answer handling correct; no retries, no polling for learners. Defects: A-19, A-22; avoidable requests A-21. |
| Forms and admin work | Partial | Validation, double-submit lock, idempotency keys, kept input on failure, typed draft kept on the phone, `beforeunload` warning: all present and tested. Defects: A-19, A-22. |
| Quiz and player logic | Partial | Rules are pure functions with tests; scoring, retry, "cannot skip a question", resume and release are right. Defects: A-16, A-17. |
| CSS architecture | Pass | One prefix per feature, tokens only, shared classes reused, no duplication of shared components beyond the local variants the reports declare. A-20 is the one layout defect. |
| Design fidelity | Pass | Wording 20 of 20 strings found on the named boards; listed deviations spot-checked and real. By eye and by text only; no pixel comparison. |
| Test quality | Partial | 347 tests, behaviour-level, none trivial. Gaps in section F. |
| Team conventions | Pass | No cross-feature imports (lint), no edits outside lanes found, no dependency added. Obsolete workarounds: A-21, A-23. |

## C. Detailed findings

Evidence is in `docs/reviews/evidence/`. Scripts ending `.mjs` drive headless Chrome against `vite preview` of the production build; their output is beside them as `.out.txt`. The `*.evidence.test.*` files pass while the defect is present; run them from `app/` with `npx vitest run --config ../docs/reviews/evidence/vitest.evidence.config.mjs`.

### C1. Reverification of pass 1

| ID | Pass-1 severity | Status | Evidence of the result |
|---|---|---|---|
| A-01 `useApi` stale render | Medium | **Closed** | `a01-…evidence.test.tsx` now fails for the right reason (no commit with the new id and the old data). `useApi.ts:93-98` decides freshness during render. No regression seen: reload keeps data, failure after success keeps data, 10 new tests. |
| A-02 state kept across path params | Medium | **Closed** | `a02-…evidence.test.tsx` fails. `router.tsx:182-189`, key = pattern + named params; wildcard excluded; `instance` opt-out used once (`learner/routes.tsx:26-28`), and `Browse` handles changing params itself (keys its children, checks ids). |
| A-03 failed chunk never retried | High | **Partly closed; residue Low** | Feature chunks: closed. `a03-…evidence.test.tsx` fails; `measure-layout.final.out.txt` section 3 reaches the real screens after recovery. Screen chunks: see below. |
| A-04 idempotency key per call | Medium | **Closed** | First test of `a04-…evidence.test.ts` fails (same key, same learner); the control test passes. `client.ts:288-316`. See the note on its limits below. |
| A-05 `useQuery` identity | Medium | **Closed** | Both tests fail (same object; 1 request). `router.tsx:162-165`. |
| A-06 header at 320px | Medium | **Closed in emulation** | `measure-layout.final.out.txt` and `measure-features.out.txt`: `scrollWidth` equals the viewport on 30 pages at 320, 360, 390 and 800. Not checked on a real 320px phone. |
| A-07 conventions not enforced | Medium | **Partly closed; residue Low** | Items 1 to 4 closed: `lint-probes.mjs` gives an error for each probe; `check-css` runs in `npm run lint` over 89 files. Item 5 (unhandled promises) open by the engineer's choice. New gap: nothing flags `React.lazy` in a routes file (probe 5: 0 errors). |
| A-08 untested core | Medium | **Closed** | Test files now exist for every piece named; 347 tests pass. |
| A-09 session trusts storage | Low | **Closed** | Both tests in `a09-…evidence.test.ts` fail. |
| A-10 bracket placeholders | Low | **Open (by decision)** | `measure-layout.final.out.txt`: "Length: [length]" still on lesson pages. Waiting for the design and content owner. Detail below. |
| A-11 `lang="kri"` over English | Low | **Closed** | No write to `documentElement.lang` remains in `src`. |
| A-12 cache | Low | **Closed** | `client.ts:113-120`, `:235-244`; documents corrected for in-flight sharing. Progress is never cached, so keeping the content cache across progress saves shows no stale state. |
| A-13 small accessibility items | Low | **Closed** | All seven checked in source; logo link is a 48px target; no small target reported on learner or lesson pages. |
| A-14 duplicate history entry | Low | **Closed** | `router.tsx:94-97`. |
| A-15 contradictory documents | Low | **Partly closed; residue Low** | ARCHITECTURE corrected. Still stale: `features/learner/README.md:33-44, 64` and `features/admin/README.md:15-26, 46` (`lazy()` and the long prefixes). `.sb-motion-ok` and `.sb-listen-note` are still unused. Owners: stream 2 and stream 4 for their READMEs, stream 1 for the two classes. |

**A-03 residue — screen chunks made with `React.lazy` (Low; owners stream 2 and stream 4)**

- **Location:** `app/src/features/learner/routes.tsx:19, 23, 25` (3 screens); `app/src/features/admin/routes.tsx:25-45` (16 screens). The lessons feature has no screen chunks.
- **Evidence:** `a03-screen-chunk.out.txt`: `Browse` chunk blocked → error screen; network restored, phone Back → Home; the same card tapped again → error screen again, 0 new requests, 0 page loads; "Try again" → one page load → the portal opens.
- **Impact:** Recovery works through the error screen, so this is no longer High. A learner who leaves with the phone's Back button sees the error once more on the next visit before "Try again" clears it.
- **Recommendation:** replace `lazy(` with `lazyScreen(` from `@shared/router` in the two routes files (same signature). Stream 1: add a `no-restricted-imports` entry for `lazy` from `react` in `src/features/**` so it cannot come back.
- **Validation:** rerun `a03-screen-chunk.mjs`; the second tap must open the portal.

**Regression check of the fix round.** No regression found in `lazyScreen`, `recover.ts`, the boundary, `useApi`, route instances or the lint rules. Two limits of the A-04 fix to keep in mind, not counted as findings: (1) a key is kept for 10 minutes after a try that got no answer, so an admin who deletes the draft that did arrive and then submits the identical body again inside that time is answered according to the server's idempotency rule, which the contract does not define for deleted records; (2) two people who type the same name and role on one phone within 5 seconds share one record. Both are narrow and documented by the engineer.

**A-07 item 5 (Low, stream 1), A-10 (Low, stream 1 with the design owner):** unchanged from pass 1. A-10: `app/src/shared/components/lessonTypes.tsx` (`formatLength`, `formatPages`) and `LessonTags.tsx`; the smallest change is to leave the fact out when the value is `null` and never show a length for `check` and `try`.

### C2. New findings

### A-16 — A media file that does not arrive is reported as "cannot play on this phone", with no way to try again

- **Severity:** High
- **Category:** Offline recovery, player logic
- **Owner:** stream-3
- **Location:** `app/src/features/lessons/media/useMedia.ts:253-264` (`onError`); message at `app/src/features/lessons/media/MediaControls.tsx:174-178`.
- **Problem:** Only `MediaError` code 2 is treated as a network problem. When the file cannot be fetched at all at the moment Play is tapped (connection refused or dropped, HTTP 503 or 404), Chrome reports code 4 (`MEDIA_ERR_SRC_NOT_SUPPORTED`), the same code as an unplayable format. The hook then tries the next source and ends in `unsupported`, which shows "This video cannot play on this phone. This phone cannot show this kind of video. Ask your facilitator, or try another phone." and offers no button.
- **Evidence:** `lessons-media.out.txt` section 2, production build in Chrome: file blocked → `error: 4`, that message, "Try again offered: false"; file answered with 503 → the same.
- **Impact:** A blip of the bag's Wi-Fi, or the Pi refusing a media request while many phones start videos, is the commonest failure for the main content type. The learner is told their phone is the problem and to find another one. The only recovery is to leave the lesson and open it again, which nothing suggests. Listen and Read-along audio share the hook.
- **Recommendation:** Decide by what the phone said beforehand, not by the error code alone. If `canPlayType` accepted the source (or it has no `mimeType`) and no data ever arrived (`element.readyState === 0` / `networkState === NETWORK_NO_SOURCE`), report `network` and keep "Try again"; reserve `unsupported` for a failure after data arrived (code 3, or code 4 with `readyState > 0`) once every source has been tried. Alternatively give the `unsupported` note a "Try again" as well.
- **Validation:** rerun `lessons-media.mjs`: both cases in section 2 must show "The video stopped … Try again", and Try again must play once the block is removed. Add a unit test with `error.code = 4` and `readyState = 0`.

### A-17 — The place is not saved when a learner leaves a video or story that is playing

- **Severity:** Medium
- **Category:** React effects (cleanup order), progress
- **Owner:** stream-3
- **Location:** `app/src/features/lessons/media/useMedia.ts:286-296` (cleanup detaches the source and calls `load()`); `app/src/features/lessons/players/WatchPlayer.tsx:114-119`; `app/src/features/lessons/players/ListenPlayer.tsx:41-46`.
- **Problem:** Both players save the position in an effect cleanup that reads `element.currentTime`. That effect is declared after `useMedia`'s effect, so on unmount `useMedia`'s cleanup runs first, removes `src` and calls `load()`, which resets `currentTime` to 0. The players' cleanup then sees 0 and saves nothing.
- **Evidence:** `lessons-media.out.txt` section 1: after Pause a `PUT … {"state":"started","positionSeconds":3}` is sent (control); after 7 s of playing and a tap on Back, no `PUT` at all. The existing unit tests cannot see it because `load` is a `vi.fn()`.
- **Impact:** Leaving mid-video without pausing first is the usual way to leave. "Carry on from where you stopped" then offers an older place or none.
- **Recommendation:** Save inside `useMedia`'s own cleanup before the source is detached: read `element.currentTime` first and call `optionsRef.current.onPause(time)` when the element was started and has not ended; then remove the two player effects.
- **Validation:** rerun `lessons-media.mjs` section 1: a `PUT` with `positionSeconds` near 7 after Back. Make the test stub of `load` reset `currentTime` to 0 so the unit test guards it.

### A-18 — A Child protection lesson that is loading, or failed to load, has no "Leave this page"

- **Severity:** Medium
- **Category:** Accessibility and safety rule (HANDOFF: every Child protection screen has Leave this page, Back, Home and Listen)
- **Owner:** stream-3
- **Location:** `app/src/features/lessons/screens/LessonScreen.tsx:119`; `app/src/features/lessons/screens/LessonDoneScreen.tsx:165`.
- **Problem:** `quickExit` is true only once the lesson has loaded, because `/lesson/:id` does not say which portal it belongs to. While loading, and on the error screen, the quick exit is absent. The finished screen opened without a finish record ("This lesson is not finished yet") also has no Listen control on a phone.
- **Evidence:** `lessons-media.out.txt` section 3: loaded → `leaveThisPage: true`; lesson request answered 503 → `false` on both screens. `measure-features.out.txt`: "Finished screen (CP), opened directly: MISSING: listen".
- **Impact:** The failed state is the one a child stays on longest (reading, trying again). The quick exit also replaces the history entry; without it, Home leaves the lesson one Back away.
- **Recommendation:** Fail safe from what is already known: show the quick exit while the lesson is unknown when the session says the reader is in Child protection (`useSession().childProtectionAudience !== null`, set by stream 2's lesson list and cleared by Leave this page). Add `ListenBar` to the "not finished yet" state.
- **Validation:** rerun `lessons-media.mjs` section 3 after opening a Child protection lesson list first; add a unit test for the error state.

### A-19 — An admin session that ends during editing discards the unsaved work

- **Severity:** Medium
- **Category:** Forms, preservation of user work
- **Owner:** stream-4
- **Location:** `app/src/features/admin/session.tsx:78-84` and `:123-127` (`RequireAdmin` navigates to sign-in on status `out`, unmounting the screen); `app/src/features/admin/lib/hooks.ts:51` (`useAction` routes a 401 there and shows no error).
- **Problem:** When Save answers 401 (session expired, bag restarted), the editor is unmounted, the facilitator signs in and is returned to the same address, and the editor loads again from the bag. Everything typed is gone and nothing says so. This affects Questions, Try it setup, Series order, Place and Notes; only "Type it yourself" survives, because it keeps a copy on the phone.
- **Evidence:** `a19-admin-session-expiry-loses-work.evidence.test.tsx` (passes): a rewritten question is replaced by the original after signing in again, and the button reads "Nothing to save".
- **Impact:** Facilitators type on phones, slowly, and the bag is switched off and on in the field. A set of quiz questions can be twenty minutes of work.
- **Recommendation:** Keep the screen mounted when a session is lost in the middle of work: in `RequireAdmin`, once children have been shown, render the sign-in form in place of them visually (children kept in the tree under `hidden`) and reveal them again on success, with no navigation. Navigation to `/admin/sign-in` stays for the first load. Then let `useAction` show "Sign in again, then tap Save. Your changes are still on this page."
- **Validation:** the evidence test must fail (typed text still present after signing in); add it inverted to `flows.test.tsx`.

### A-20 — The admin Library scrolls sideways between 1100 and 1353px

- **Severity:** Medium
- **Category:** CSS, usability
- **Owner:** stream-4
- **Location:** `app/src/features/admin/admin.css:1003-1024` (`.adm-table`, laptop layout from 1100px); `app/src/features/admin/screens/Library.tsx:356`.
- **Problem:** With the side menu, the lesson table needs up to 1354px. From 1100 to 1353px the whole page scrolls sideways and the last column, the row actions, starts off screen.
- **Evidence:** `measure-admin-library.out.txt`: `scrollWidth` 1354 (Child protection), 1310 (one series) and 1294 (Agriculture) at 1100 and 1280; no overflow from 1366. The engineer's report says only 1440 was checked.
- **Impact:** 1280×800 laptops and 10-inch tablets in landscape get the laptop layout with the Publish, Edit and Delete column hidden to the right.
- **Recommendation:** Keep the stacked card layout of the table up to the width the table needs (move its breakpoint from 1100 to about 1360px), or wrap the table in a container with `overflow-x: auto` and let the title column shrink (`min-width: 0`, wrapping text).
- **Validation:** rerun `measure-admin-library.mjs`: no overflow line at 1100 and 1280.

### A-21 — Workarounds that fix round 1 made obsolete still cost requests and tie screens to English titles and seeded ids

- **Severity:** Low
- **Category:** Network efficiency, maintainability
- **Owner:** stream-2
- **Location and problem:**
  - `app/src/features/learner/views/PortalViews.tsx:257-271`: one `getSeries` per subject that has a quiz on every class page; `SeriesSummary.quiz` now carries the lesson. If one of those requests fails, all quiz cards disappear silently.
  - `app/src/features/learner/screens/Browse.tsx:25-41`: an extra `getGroup` per lesson list; `SeriesDetail.group.seriesCount` now answers it.
  - `app/src/features/learner/icons.tsx:193-218`: icons chosen by regular expressions on English titles; `Group.icon` and `SeriesSummary.icon` exist.
  - `app/src/features/learner/views/ChildProtectionExtras.tsx:88-113`: audiences recognised by seeded ids; `Group.audience` exists.
  - `app/src/features/learner/views/PortalViews.tsx:27-55`: local `AudienceCard`; `PortalCard` now takes `actionLabel` (the tablet layout request is still open, so this one may stay).
  - The guards "useApi can show the previous answer" (`Browse.tsx:43-45` and others) are now redundant; harmless.
- **Evidence:** the fields are in `app/src/shared/api/types.ts:92-118, 165` and the mock sends them (`mock/handler.test.ts:86-101`).
- **Recommendation:** use the new fields and delete the five `TODO(stream-1)` notes; stream 1 then makes the fields required.
- **Validation:** request log of a class page shows one group request and no series requests; tests still pass.

### A-22 — The idempotency key of a typed lesson and of a notes lesson is not renewed when its content changes

- **Severity:** Low
- **Category:** API integration, data integrity
- **Owner:** stream-4
- **Location:** `app/src/features/admin/screens/TypeLesson.tsx:69-77` with `app/src/features/admin/lib/typedLesson.ts:35, 136`; `app/src/features/admin/screens/Notes.tsx:44, 79-86`.
- **Problem:** The key is fixed for the life of the draft. If the answer to "create lesson" is lost, the facilitator edits the text (or adds a page) and taps Next again, the bag answers with the first version, the app moves on and clears the local draft. The edits are lost without a word. The engineer's report lists this as open item 4 and says it needs server work; it does not.
- **Evidence:** code reading; stream 2's form renews its key on every change (`learner/screens/SaveProgress.tsx:176-179`).
- **Recommendation:** renew `requestKey` whenever title, blocks, voice or the page list change after a failed try. The cost is a possible second draft, which is visible under "Waiting to be placed" and can be deleted; that is the better failure.
- **Validation:** flow test: lost answer, edit, Next → the placed lesson has the edited text.

### A-23 — Smaller items in the lesson players

- **Severity:** Low
- **Owner:** stream-3
- **Location and problem:**
  - `screens/LessonDoneScreen.tsx:90`: after a refresh, if the progress request fails the screen shows "Opening…" for ever (`useSeriesProgress` reports failure as "unknown"). Show the lesson link after an error.
  - `players/TryItPackage.tsx:53`: the `HEAD` check has no time limit and no cancellation; a hung request leaves "Opening…" spinning. Use `AbortController` with the client's timeout.
  - `lessons.css:486-510`: the seek bar is 32px high with a 32px thumb, under the 48px rule (`measure-features.out.txt`: "Video time 248x32"). Back 10s and Forward 10s are full size, so there is another way; give the input a 48px hit height with the track centred.
  - `players/WatchPlayer.tsx:69-82`: a saved learner resuming an interactive video is told "carry on from where you stopped (0:30)" and is then taken back to the first question, because answered questions are not remembered. Either say so or mark questions before the resume point as passed.
  - `quiz/Answers.tsx:54-62, 81`: `role="radiogroup"` without arrow keys, the same point A-13 fixed in the shared `ChoiceGroup`.
  - `media/useMedia.ts:17-20, 282`: deep import of `@shared/shell/listen` and a test on the first character of its snapshot string. Stream 1 has not exported the subscription yet; the request is still open.
  - `lessons.css:31-38`: `TODO(stream-1)` wrap rule for the Listen bar, obsolete since A-06 was fixed.
- **Evidence:** code reading; the seek bar measured.

### A-24 — Smaller items in admin

- **Severity:** Low
- **Owner:** stream-4
- **Location and problem:**
  - `screens/TypeLesson.tsx:100-115`: choosing a second recording while the first is uploading aborts the first; its late rejection handler then sets `voiceHandle.current = null` and the state to `none`, hiding the new upload's progress and making it impossible to cancel on unmount. Compare the handle before clearing.
  - `lib/uploadQueue.ts:258-261`: a failed poll stops watching and leaves "being prepared" on screen with no end.
  - Inline text links under 48px: "Go to the learning site" 176×23 (`screens/SignIn.tsx`), "See everything in the Library" 253×25 (Home), "Use Upload an animation" 203×23 (Upload). Measured in `measure-layout.final.out.txt` and `measure-features.out.txt`.
  - `routes.tsx:42-43`: `/admin/series` and `/admin/series/:seriesId` are two routes without a shared `instance`, so choosing a series remounts the screen. Harmless today; note it if state is added.
  - `README.md:15-26, 46`: still tells readers to use `lazy()` and the `admin-` prefix (A-15).
- **Evidence:** code reading and the measurements named.

### A-25 — Smaller items in learner browsing

- **Severity:** Low
- **Owner:** stream-2
- **Location and problem:**
  - `components.tsx:39-54`: the "not in this bag" screen under a Child protection address has Leave this page, Back and Home but no Listen (`measure-features.out.txt`).
  - `views/PortalViews.tsx:168, 200, 320-328`: the module-level flag `showSubjectsNext` stays set if the class request fails, so a later, unrelated load scrolls and moves focus. Clear it on error or keep it in a ref.
  - `README.md:33-44, 64`: stale `lazy()` and `learner-` lines (A-15).
- **Evidence:** code reading and the measurement named.

### Suspected risks (not confirmed, not counted)

- **Interactive video, seek before the length is known** (`WatchPlayer.tsx:138-154` with `useMedia.ts:164-178`): Forward 10s while the file is still loading stores a pending seek past a question; the question opens, but the pending seek is applied on `loadedmetadata`. Narrow timing window; not reproduced.
- **`notReady` buttons are `disabled`** (`shared/components/Button.tsx:86`): the message "Type your name first." in `SaveProgress.tsx:149-151` can then only be reached by Enter in the field, and a browser may skip implicit submission when the default button is disabled. Not tested on Android keyboards.
- **28 lesson cards in one list** (Feed and animal health): scrolling cost on an old phone is unknown. Reviewer B.
- The pass-1 risks about the 144–150px sticky Child protection header, scroll position after browser Back, and unvalidated API answers stand as written then.

## D. Performance results

No performance measurement was possible on target hardware, and it belongs to Reviewer B. Numbers below are layout checks and the build's own size report.

| Metric | Baseline (pass 1) | Current | Target | Status | Device and conditions |
|---|---|---|---|---|---|
| Cold start, interaction latency, memory, video on a phone | none | Not Tested | to be set on hardware | Not Tested | No Raspberry Pi, no Android device |
| Start JavaScript, gzip (`npm run size`) | 94.0 KB | 101.5 KB | 200 KB | Pass | Build on the development Mac; Reviewer B verifies |
| Critical resources for the first screen, gzip | 115.2 KB | 122.6 KB | 350 KB | Pass | Same |
| Largest lazy chunk, gzip | 1.0 KB | 20.6 KB (`feature-lessons`) | 60 KB | Pass | Same |
| Horizontal overflow, learner and lesson pages, 320 / 360 / 390 / 800 | 359px at 320 (A-06) | none on 18 pages | none | Pass | Headless desktop Chrome, production build, device emulation |
| Horizontal overflow, admin, 320 / 390 / 800 | not built | none on 12 pages | none | Pass | Same |
| Horizontal overflow, admin Library, 1100–1353 | not built | 1294–1354px content | none | **Fail** (A-20) | Same, 1100 / 1280 / 1366 / 1440 / 1536 |
| Smallest text | 16px | 16px on 30 pages | 16px | Pass | Same |
| Touch targets under 48px | 1 kind | seek bar 32px high; 3 inline admin links | 48px | Fail, minor (A-23, A-24) | Same |
| Child protection controls on every such screen | not built | present on 10 of 12 loaded states measured (Listen missing on two: A-18, A-25); Leave this page missing on the lesson error states (A-18) | all four | Partial | Same |

## E. Dependency and asset inventory

Reviewer B's area; not audited. Noted in passing for them, not investigated:

- `TryItPackage.tsx:53` sends a `HEAD` request to `/media/tryit/…/index.html`; the Pi must answer `HEAD` there and the CSP must allow the frame.
- `bagReachable()` (`shared/router/recover.ts:50`) relies on `GET /?reach=…` being answered with the app page by the deployed server.
- The pass-1 notes on `tsconfig.app.json` test types in app code and on the ESLint ban list versus polyfills still stand.

Definite unused items: `.sb-motion-ok` (`base.css:90`), `.sb-listen-note` (`shell.css:129`).

## F. Testing results

Run in this worktree on macOS, Node 23.10, after `npm ci`.

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | Completed |
| Typecheck | `npm run typecheck` | Pass |
| Lint | `npm run lint` | Pass: 0 problems, 0 warnings; `check-css: ok · 89 file(s)` |
| Unit tests | `npm test` | Pass: 22 files, 347 tests |
| Production build | `npm run build` | Pass, postbuild checks ok |
| Size budgets | `npm run size` | Pass: 101.5 / 200, 122.6 / 350, 20.6 / 60 KB |
| Pass-1 repro tests | evidence vitest config | 8 of 9 now fail, each for the reason its finding names (A-01, A-02, A-03, A-04 first test, A-05 ×2, A-09 ×2); the A-04 control passes |
| New repro test | `a19-…evidence.test.tsx` | Passes: defect present |
| Lint probes | `node ../docs/reviews/evidence/lint-probes.mjs` from `app/` | Probes 1 to 4: one error each. Probe 5 (`React.lazy` in a feature): 0 errors |
| Pass-1 layout and recovery script | `measure-layout.mjs` → `measure-layout.final.out.txt` | No overflow; focus on `sb-main`, `scrollY` 0; both recovery cases reach the real screen |
| Screen-chunk recovery | `a03-screen-chunk.mjs` | Second visit fails again without a request; "Try again" recovers |
| Media behaviour | `lessons-media.mjs` | A-16, A-17, A-18 confirmed |
| Feature pages | `measure-features.mjs` | 30 pages × up to 4 widths; results in section D |
| Admin Library widths | `measure-admin-library.mjs` | A-20 confirmed |
| Wording against boards | `grep -F` of 20 on-screen strings in `design/boards/*.dc.html` | 20 found on the boards the engineers name ("Which class are you in?" is split across markup on V3-Primary; "Which class" and "Tap your class." found) |
| Listed deviations | spot checks | Stream 3 no. 1 (no "Check my answer" on AGB-Agri-Quiz, present on V3-Components): real. Stream 4 no. 19 (`[How to reset — confirm]` on ADM-SignIn replaced by a sentence): real; note that this fills a placeholder with wording nobody confirmed. Stream 2 nos. 1 to 3 follow from the contract fields (see A-21 for the ones now available). |

**Test quality.** The feature tests render real route tables against the mock API and assert words, roles and requests; the rule tests cover the quiz, hotspot, placement, question and upload-queue logic as pure functions. Critical cases missing:

- Lessons: media stubs never reset `currentTime` on `load()` and never raise error code 4 with no data, so A-16 and A-17 pass unseen; no test of the Child protection quick exit in loading and error states (the existing test checks the loaded state only).
- Admin: no test of a 401 during Save with unsaved input (A-19); the "session ends" test only covers a navigation; nothing between 1100 and 1440px.
- Learner: no test that a failed quiz-series request leaves the class page usable; otherwise the important journeys are covered.

**Not tested**

- Any physical Android phone or tablet, Android WebView, Chrome 58; any Raspberry Pi, nginx or Caddy. Every browser result is current desktop Chrome, headless, with device emulation.
- Screen readers, switch access, real touch, the virtual keyboard over forms and over the admin's sticky action bar.
- Real media: only the 20 s sample clip; no long video, no real codec failure, no captions timing.
- Real uploads, `capture` inputs, photo rotation on a camera photo, a real backend honouring idempotency keys and sessions.
- Not reached in this pass, so no statement is made about them: line-by-line reading of `ReadPlayer`, `TryItHotspots`, `PictureLesson`, `Finished`, `LessonParts` (skimmed), and of the admin screens `Library`, `Series`, `Picture`, `Animation`, `TryIt`, `Done`, `Home`, `Menu` and `AdminFrame` (measured in the browser and grepped for timers, listeners and suppressions, not read in full); admin and lesson CSS against the boards value by value; tablet and laptop layouts by eye; keyboard-only operation.

## G. Prioritised remediation plan

1. **Release blockers:** none Critical. **Must fix before release: A-16** (stream 3).
2. **Security and data integrity:** A-19 (stream 4, work lost on 401); A-17 (stream 3, position not saved); A-22 (stream 4, key not renewed).
3. **Offline functionality failures:** A-16 again; A-03 residue (streams 2 and 4: `lazyScreen`; stream 1: lint rule).
4. **Legacy browser compatibility:** nothing new from this focus.
5. **Major performance problems:** none found in source. A-21 (stream 2) removes avoidable requests.
6. **Maintainability:** A-21; A-07 item 5 and A-15 residue (stream 1 and the README owners); the test gaps in section F.
7. **Usability and minor quality:** A-18 (stream 3, should land with A-16), A-20 (stream 4), A-23, A-24, A-25, A-10 (design owner).

## Release decision

**FAIL within Reviewer A's focus, on one unresolved High finding (A-16).** No Critical finding. The source is in good order and the pass-1 conditions were met: every pass-1 High and Medium finding is closed or reduced to Low residue. A-16 is a contained fix in `useMedia.ts`; the four Medium findings (A-17 to A-20) are each a local change with a reproduction ready to re-run. Once A-16 is fixed and re-verified the decision in this focus becomes PASS WITH CONDITIONS, the conditions being A-17 to A-20 and the content decisions (A-10, the Child protection contacts).

This is not a statement that the product can ship after that: device, Pi, offline, compatibility, performance and security verification are outside this focus or were not possible here, and for the product as a whole the evidence is insufficient until they are done.
