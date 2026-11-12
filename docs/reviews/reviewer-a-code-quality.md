# Reviewer A (Code quality) — Pass 1: foundation

12 Nov 2026. Scope: the Stream 1 foundation only, as it stands on `main` at `affbf44` (`app/src/shared/**`, `app/src/app/**`, the lint and test configuration, and the conventions imposed on streams 2–4). Streams 2–4 are not in this snapshot and are not reviewed here. Reviewer B covers dependencies, bundle, offline and network verification, fonts and assets, performance and memory measurement, legacy browsers, security and deployment config; those rows are marked as theirs below.

All findings are addressed to **stream-1**. Nothing in the application was changed by this review; everything written is under `docs/reviews/`.

## A. Executive summary

**Decision for the foundation, within Reviewer A's focus: PASS WITH CONDITIONS.** This is a decision that streams 2–4 can keep building on the foundation. It is not a release approval: no Raspberry Pi and no Android device were available, and release readiness depends on Reviewer B's areas and on the second pass.

**Overall assessment.** The foundation is small, readable and carefully made. The shared components follow the V3-Components board closely (sizes, radii, colours and states were spot-checked against the board's own values and match), every colour pair in the shared CSS meets its contrast target (recomputed, section D), semantics and labels are mostly right, reduced motion is opt-in, and typecheck, lint, 61 tests and the production build all pass. The defects are concentrated in the three pieces every screen leans on: the data hook, the router and the error boundary.

**Findings: 0 Critical, 1 High, 7 Medium, 7 Low.**

**Major risks**

1. **A failed code download is permanent for that page load (A-03, High).** After one failed download of a feature chunk, every later in-app visit to that feature shows the error again and never retries, and "Go to Home" does nothing when the failed chunk is the learner feature. Only "Try again" (a full reload) recovers, and a reload while the bag's Wi-Fi is still down replaces the app with the browser's own error page. Confirmed in the production build.
2. **`useApi` shows an old answer under new inputs for one committed render (A-01)**, and **the router keeps a screen's state when only a path parameter changes (A-02)**. Together they make "lesson → next lesson" on the single `/lesson/:lessonId` route hazardous for stream 3: answers and player state carry over, and screen effects see lesson A's data with lesson B's id.
3. **The default `Idempotency-Key` gives no protection (A-04).** A new key is generated inside every call, so a retried "Save and start learning" creates a second learner.
4. **Narrow phones (A-06).** The inner page header is 39px wider than a 320px screen and has 1px to spare at 360px.
5. **The floor rules for CSS are not enforced by anything, and the hook lint rules cannot fail the build (A-07).** The most likely Android 8 regressions from three parallel streams (flex `gap`, `aspect-ratio`, `inset`) will pass every check.

**Critical blockers:** none found in this focus.

**Performance observations:** nothing measured on target hardware (Not Tested). In source, no render-path problem was found in the shared components; the one confirmed request-loop hazard is A-05 (`useQuery()` as a dependency).

**Compatibility status:** Not Tested by this reviewer (Reviewer B). The shared CSS and JS were read against the floor rules in `docs/ARCHITECTURE.md` section 3.7 and no violation was found in stream 1's own code.

**Offline compliance status:** Not Tested by this reviewer (Reviewer B). A-03 is the one offline-recovery defect found from the source side.

**Product risks that are not code defects** (already disclosed by stream 1, repeated because they affect the people this is for): every Listen button says "No sound here yet" because no recordings exist; the Krio switch changes no text; lesson cards print the board placeholder `[length]` (A-10).

## B. Verification results

| Category | Status | Findings |
|---|---|---|
| React best practices | Partial | Components are well scoped and typed. Defects in the data hook (A-01), route remounting (A-02), the error boundary's recovery (A-03) and an unstable hook result (A-05). |
| TypeScript quality | Pass | Strict with `noUncheckedIndexedAccess`; no `any`, no `@ts-ignore`; one justified `eslint-disable` (`useApi.ts:61`). API answers and stored session data are cast, not validated (A-09, Low). |
| Dependency hygiene | Not Tested | Reviewer B. Runtime dependencies are `react` and `react-dom` only (read from `package.json`). |
| Offline operation | Not Tested | Reviewer B. See A-03 for recovery after a dropped connection. |
| Local asset hosting | Not Tested | Reviewer B. |
| Performance | Not Tested | No target hardware. Source review only: A-05 (request loop hazard), A-12 (cache defeated by progress saves). |
| Legacy browser compatibility | Not Tested | Reviewer B. Enforcement gap for the CSS floor rules: A-07. |
| Accessibility | Partial | Contrast, labels, landmarks, focus handling after navigation and touch targets verified in current Chrome. Fails at 320px width (A-06); smaller issues in A-13. No screen reader was run; nothing verified on Android. |
| Security | Not Tested | Reviewer B. |
| Deployment readiness | Not Tested | Reviewer B. |
| Design fidelity (shared components, tokens, shell) | Pass | Spot-checked against `V3-Components.dc.html` and `CPB-Child.dc.html`: button heights 72/64/56, radii 18–20, type sizes, chip, badge, message, filter and header values match the boards. By eye only in a current browser; no pixel comparison. |
| API client and data hook | Partial | Timeouts, cancellation, typed errors and no auto-retry are correct and tested. Defects: A-01, A-04, A-12. |
| Test quality | Partial | 61 tests, all meaningful, none trivial. The most depended-on code has no tests at all (A-08). |
| Conventions for streams 2–4 | Partial | The feature boundary rules work (verified). Gaps and contradictions: A-07, A-15. |

## C. Detailed findings

Evidence files are in `docs/reviews/evidence/`. The `*.evidence.test.*` files are written so that each **passes while the defect is present**; run them from `app/` with `npx vitest run --config ../docs/reviews/evidence/vitest.evidence.config.mjs` (result at review time: 6 files, 9 tests, all passing, so all defects present).

### A-03 — A failed feature download is never retried; recovery needs a full reload

- **Severity:** High
- **Category:** React, offline recovery
- **Owner:** stream-1
- **Location:** `app/src/app/App.tsx:77-97` (`featureScreens` caches one `React.lazy` per feature for the life of the page), `:99-109` (`resetKey={pathname}`), `:63` (`onRetry` is `window.location.reload()`), `:65-67` ("Go to Home" is an in-app link). The same applies to every `lazy(() => import('./screens/X'))` that `docs/ARCHITECTURE.md:72-79` and the feature READMEs tell streams 2–4 to write at module level.
- **Problem:** `React.lazy` keeps a rejected import forever. The boundary clears its error when the path changes, then renders the same rejected lazy component, which throws again. So after one failed download: (a) every later in-app visit to that feature fails without a new request, even with the network back; (b) when the failed chunk is the learner feature, "Go to Home" on the error screen changes nothing (the path is already `/` or the target is in the same feature); (c) the only recovery is "Try again", a full reload, and if the bag's Wi-Fi is still down at that moment the browser's own offline page replaces the app.
- **Evidence:** `evidence/a03-chunk-failure-recovery.evidence.test.tsx` (the download is attempted exactly once across three navigations). Production build in headless Chrome, `evidence/measure-layout.out.txt` section 3: lessons chunk blocked → error screen; block removed → "Go to Home" works → the same lesson opened again in-app → error screen again. Learner chunk blocked on first load → block removed → "Go to Home" → still the error screen. Point (c) was not run (it follows from `location.reload()` with no network and no service worker).
- **Impact:** The bag's Wi-Fi is expected to be unstable and shared by many devices. Each feature, and each lazy screen streams 2–4 add, is one more download that can hit a blip. A learner who taps the friendlier "Go to Home" ends up with lessons that will not open for the rest of the session, with no hint that a reload is needed; one who taps "Try again" during the outage loses the app to a browser error page that has no Sensebod wording.
- **Recommendation:** Keep the full reload as the recovery (in the SystemJS build a failed module may also stay cached in the loader, so an in-place `import()` retry is not safe to assume), but make every way out do it, and never reload into an outage:
  1. In `ScreenBoundary`, before reloading, ask the bag for the shell (`fetch('/', { cache: 'no-store' })` with the client's timeout). Reload only on success; otherwise stay on the error screen and show the "cannot reach the bag" sentence.
  2. When the boundary has caught an error, render "Go to Home" as a plain `<a href="/">` (a full page load) through the same check, not as an in-app `ButtonLink`.
  3. Optionally, drop the cached entry (`featureScreens.delete(feature.id)`) when its load rejects, and give streams a shared `lazyScreen()` helper so screen-level chunks are treated the same way; verify against the production build before relying on it.
- **Validation:** `node docs/reviews/evidence/measure-layout.mjs` section 3 against `vite preview`: after the block is removed, "Go to Home" and a second visit to the lesson must both reach the real screen; with everything blocked, "Try again" must leave the Sensebod error screen in place. `a03-…evidence.test.tsx` must fail (rewrite it as a regression test in `src/app/App.test.tsx`).

### A-01 — `useApi` commits one render with the new inputs, the old answer and `loading: false`

- **Severity:** Medium
- **Category:** React hooks, stale state
- **Owner:** stream-1
- **Location:** `app/src/shared/api/useApi.ts:35-45` (the old answer is cleared inside the effect, after the render with the new `deps` has already committed) and `:65`.
- **Problem:** When `deps` change, the hook returns the previous `data`, `error` and `loading: false` for one committed render, then clears them from the effect. The hook's own comment (`:38`, "new inputs must not show the old answer") and `docs/ARCHITECTURE.md:136` promise the opposite, so screens will not guard against it.
- **Evidence:** `evidence/a01-useapi-stale-render.evidence.test.tsx`: the committed log contains `{ id: 'b', data: 'lesson-a', loading: false }`, and a screen effect of the usual shape ("if loaded, save progress") runs once with id `b` and lesson `a`.
- **Impact:** One painted frame of the previous lesson, series or library page under the new URL with no loading state (slow phones make the frame long). Worse, any effect in a screen that pairs the route id with the loaded data acts once on a mismatched pair: progress saved against the wrong lesson, the wrong title, the wrong media started. It is reachable on the main learner journey because of A-02.
- **Recommendation:** Decide freshness during render, not in the effect. Keep the inputs the answer belongs to in the state and compare them on every render:

  ```ts
  const [state, setState] = useState({ key: deps, data: undefined, error: null, loading: true });
  const fresh = sameInputs(state.key, deps);            // length + Object.is per item
  // in the effect: setState({ key: deps, ... }) on start, success and failure
  return { data: fresh ? state.data : undefined, error: fresh ? state.error : null, loading: fresh ? state.loading : true, reload };
  ```

  "Try again" keeps `key` unchanged, so it still keeps the old answer on screen.
- **Validation:** `a01-…evidence.test.tsx` must fail; add it (inverted) to a new `useApi.test.tsx` together with the cases in A-08.

### A-02 — A screen keeps its state when only a path parameter changes

- **Severity:** Medium
- **Category:** Router, React state
- **Owner:** stream-1
- **Location:** `app/src/shared/router/router.tsx:154-164` (`<Screen />` is rendered without a key).
- **Problem:** Going from `/lesson/a` to `/lesson/b` matches the same route, so React keeps the same component instance: every `useState`, `useRef` and running effect of the screen survives into the next lesson. The foundation prescribes exactly this shape ("One route, `/lesson/:lessonId`, serves every type", with `lesson.next` for "Up next"; stream-1 report section 7), and nothing in `docs/ARCHITECTURE.md` or the feature READMEs mentions it.
- **Evidence:** `evidence/a02-route-param-state.evidence.test.tsx`: an answer chosen in lesson `a` is still chosen after `navigate('/lesson/b')`.
- **Impact:** Quiz answers, "finished" flags, playback position and open panels leak from one lesson into the next unless every stream remembers to reset them by hand. The same applies to `/portal/:portalId/:groupId` (a filter chosen in one topic stays on in the next).
- **Recommendation:** Key the screen on the matched pattern and its named parameters, leaving the wildcard out so stream 4 can keep one stateful screen across `/admin/*` sub-steps:

  ```tsx
  const key = match.route.path + '|' + Object.keys(match.params).filter((k) => k !== '*').map((k) => match.params[k]).join('|');
  return <ParamsContext.Provider value={match.params}><Screen key={key} /></ParamsContext.Provider>;
  ```

  Document the rule in ARCHITECTURE section 3.1 either way.
- **Validation:** `a02-…evidence.test.tsx` must fail; add a router test that a wildcard-only change does not remount.

### A-04 — The default `Idempotency-Key` changes on every call, so a retry creates a second record

- **Severity:** Medium
- **Category:** API integration, data integrity
- **Owner:** stream-1
- **Location:** `app/src/shared/api/learner.ts:48-51`, `app/src/shared/api/admin.ts:76-79` and `:108-111`, `app/src/shared/api/client.ts:239-242`; guidance in `docs/ARCHITECTURE.md:137` ("call the function directly").
- **Problem:** `createLearner`, `createLesson` and `createSeries` call `newRequestKey()` inside the function. A second call for the same submission therefore carries a different key and is a new request to the server. The contract (`docs/API-CONTRACT.md:23`) says the key exists for "double taps, retries after a Wi-Fi drop"; the doc comment at `learner.ts:48` says "Safe to repeat". Neither is true unless the screen passes its own key, which no document tells it to do. The existing test (`client.test.ts:81-85`) passes only because it bypasses `createLearner` and sets `k1` by hand.
- **Evidence:** `evidence/a04-idempotency-key.evidence.test.ts`: two calls to `createLearner` with the same form send two different keys and return two different learner ids; with one caller-supplied key they return the same learner.
- **Impact:** The realistic sequence on a slow Pi: the POST arrives, the answer is lost or passes the 15 s timeout, the screen says "cannot reach the bag", the learner taps again. The bag now holds two learners with the same name (the phone remembers only the second), or two draft lessons or two series for an admin.
- **Recommendation:** Make the key belong to the submission, not to the call. Either require it (`createLearner(input, { idempotencyKey })` with no default, so forgetting it is a type error) or give streams a small helper, for example `const save = useSubmission(createLearner)`, that creates one key when the form is first submitted, reuses it for every retry and renews it only after success or when the input changes. State the rule in ARCHITECTURE section 3.4.
- **Validation:** The first test in `a04-…evidence.test.ts` must fail; add a test through the real helper that a timed-out submission followed by "Try again" yields one learner.

### A-05 — `useQuery()` returns a new object on every render

- **Severity:** Medium
- **Category:** React hooks, unstable reference
- **Owner:** stream-1
- **Location:** `app/src/shared/router/router.tsx:141-143`.
- **Problem:** `new URLSearchParams(...)` is created on every call. As a dependency (`useApi(load, [query])`, or any `useEffect` on `query`) it changes on every render, the request runs again, its answer sets state, and the component renders again: an endless request loop. ESLint cannot catch it because `useApi`'s dependency list is not checked (A-07).
- **Evidence:** `evidence/a05-usequery-identity.evidence.test.tsx`: two renders at the same URL give two different objects, and `useApi(load, [query])` issues more than 10 requests in 150 ms with the URL unchanged.
- **Impact:** A filtered list with the filter in the URL is the natural design for the admin library and the learner filter (`navigate(..., { keepScroll: true })` exists for it). Written the obvious way it hammers the Pi from every device showing that screen, which is the failure the "no automatic retries" rule was meant to prevent.
- **Recommendation:** `const { search } = useLocation(); return useMemo(() => new URLSearchParams(search), [search]);`
- **Validation:** Both tests in `a05-…evidence.test.tsx` must fail.

### A-06 — The page header does not fit a 320px-wide phone and has no margin at 360px

- **Severity:** Medium
- **Category:** CSS, last-mile usability
- **Owner:** stream-1
- **Location:** `app/src/shared/shell/shell.css:20-31`, `:40-50`, `:55-73`, `:112-123`; `app/src/shared/shell/PageShell.tsx:121-131`.
- **Problem:** The single-row inner header (Back, Home, logo) needs 359px: 16 + 108 + 10 + 116 + 10 + 99. Nothing in the row may shrink or drop out. At 320px the row is 39px too wide and the page scrolls sideways (or the browser zooms the whole page out). At 360px, the commonest Android width, the logo ends 1px from the screen edge, inside the 16px gutter, so a wider fallback font or a longer translated word for "Back" overflows there too. On the Child protection layout at 320px the header rows fit but the page is 326px wide: the Listen-plus-language row (`.sb-listen-bar`) is 6px too wide.
- **Evidence:** Production build, headless Chrome: `evidence/measure-header-320.out.txt` (row geometry: `barClientWidth 320`, `barScrollWidth 359`; logo from 259 to 359) and `evidence/measure-layout.out.txt` section 1 (`scrollWidth 359` at 320px on the lesson, not-found and admin screens; `326` on the Child protection lesson; no overflow at 360, 390 or 800). Measured with Poppins loaded, in current desktop Chrome, not on a phone.
- **Impact:** 480×854 screens at 1.5× (320 CSS px wide) are common on the entry-level Android phones this product is for. Every inner screen is affected. The boards are drawn at 390px only, so this is not a deviation from a board; it is the missing handling below the design width.
- **Recommendation:** Below 360px, drop what is redundant instead of letting the row overflow: hide `.sb-shell__logo-link` in the single-row header (`@media (max-width: 359px)`; the Home button next to it does the same job), allow the nav buttons to shrink (`min-width: 0`, smaller side padding), and let `.sb-listen-bar` wrap or the language switch drop under the Listen button. Give the row a few pixels of slack at 360px (for example 8px between items).
- **Validation:** `node docs/reviews/evidence/measure-layout.mjs`: no "HORIZONTAL OVERFLOW" line at 320px on any page; then check on a real 320px-wide phone.

### A-07 — The conventions imposed on streams 2–4 are only partly enforced

- **Severity:** Medium
- **Category:** Lint configuration, maintainability, compatibility
- **Owner:** stream-1
- **Location:** `app/eslint.config.js:44-55` and `:57-62`; `app/package.json:14` (`"lint": "eslint ."`); `docs/ARCHITECTURE.md:169-183`.
- **Problem and evidence** (ESLint run on probe snippets through `--stdin`, nothing written to `app/`):
  1. **CSS floor rules have no check at all.** The table of banned CSS (`gap` on flex, `aspect-ratio`, `inset`, `clamp()`, `:has()`, container queries, `color-mix()`) is documentation only; ESLint does not read CSS, `build.cssTarget` does not reject these, and `scripts/postbuild.mjs` does not look for them. Stream 1's report says so for flex `gap` ("documented, not lint-enforced"). The boards the streams copy from use flex `gap` throughout.
  2. **`react-hooks/exhaustive-deps` is a warning and warnings do not fail lint.** A `useEffect` with a missing dependency: 1 warning, exit code 0.
  3. **`useApi`'s dependency list is not checked.** `useApi((signal) => getSeries(id, { signal }), [])` with `id` missing: no message.
  4. **Shared code may import a feature.** `import { routes } from '../../features/learner/routes'` from `src/shared/components/`: no message.
  5. Unhandled promises are not checked (no type-aware rules). A bare `fetch(...)` statement: no message.
  The rules that do exist work: a cross-feature import, a `@mock` import and `String.replaceAll` in a feature file each produced an error.
- **Impact:** The foundation's answer to Android 8 is "follow these rules", and three engineers are writing CSS in parallel from boards that break them. A flex `gap` or `aspect-ratio` that slips in is invisible on every machine available to the team and only shows as collapsed spacing or squashed pictures on the oldest phones. Stale-closure bugs from missing dependencies pass "lint green" the same way.
- **Recommendation:** No new dependency is needed.
  1. Add a CSS floor check to `scripts/postbuild.mjs` (or a `lint:css` script run by `npm run lint`): scan `src/**/*.css` for `aspect-ratio`, `inset:`, `clamp(`, `min(`/`max(` in values, `:has(`, `@container`, `color-mix(`, nested rules, and for `gap` in a rule that has `display: flex` or `inline-flex`; fail with the file and line.
  2. `"lint": "eslint . --max-warnings 0"`.
  3. `'react-hooks/exhaustive-deps': ['warn', { additionalHooks: '(useApi)' }]` and remove the need for the disable comment in `useApi.ts` if possible.
  4. Add `**/features/**` to the restricted imports for `src/shared/**`.
- **Validation:** Re-run the same probes: each of 1–4 must now fail lint or the build.

### A-08 — The code every screen depends on has no tests

- **Severity:** Medium
- **Category:** Test quality
- **Owner:** stream-1
- **Location:** No test file exists for `app/src/shared/api/useApi.ts`, `app/src/shared/session/session.ts` and `storage.ts`, `app/src/shared/shell/listen.ts`, `uploadFile` in `app/src/shared/api/client.ts:255-301`, the `ScreenBoundary` in `app/src/app/App.tsx:41-75`, or the lazy path of `app/src/shared/components/Illustration.tsx:31-58`.
- **Problem:** The 61 existing tests are good: they assert behaviour, roles and words, not implementation. But they cover the leaves (components, `matchPath`, the client's happy and error paths) and skip the stateful pieces. `useApi` is used by every screen and has no test for a change of inputs, a slow answer arriving after a newer one, "Try again", or unmount; A-01 would have been caught by the first of these. The error boundary, the one place that handles a dropped connection during navigation, is untested; A-03 would have been caught.
- **Evidence:** File listing and reading of all six test files; `grep` for `useApi`, `ScreenBoundary`, `forgetLearner`, `startListening`, `uploadFile` in `*.test.*` finds only the indirect use of `useApi` through the feature stubs.
- **Impact:** Three streams will change how these pieces are exercised; stream 1 will be asked to change them in response. Without tests, a fix for one stream can silently break another.
- **Recommendation:** Add focused tests, no new tooling:
  - `useApi`: inputs change (no old answer, see A-01); two answers arriving out of order; `reload` keeps data and clears the error on success; failure after success keeps data and sets error; unmount before the answer; the no-`AbortController` path (delete the global for one test).
  - `ScreenBoundary`: a rejected feature load shows the error screen; the recovery chosen for A-03; a render error in a screen is contained and clears on navigation.
  - Session: at most 8 names, most recent first; `forgetLearner` of the current learner; storage that throws on read and on write; malformed stored data (A-09); `clearSensitiveChoices` keeps the learner.
  - `listen.ts`: only one source at a time; `error` and a rejected `play()` mark the source as failed; unmount stops playback.
  - `uploadFile`: progress, abort (`kind: 'aborted'`), HTTP error body mapped to `fields`, 2xx with an unreadable body.
  - Focus moves to `<main>` after in-app navigation and not on first load (`PageShell.tsx:68-75`).
- **Validation:** The new tests fail against the current code where a defect exists (A-01, A-03) and pass after the fixes.

### A-09 — The session store trusts whatever is in `localStorage`

- **Severity:** Low
- **Category:** TypeScript, error handling
- **Owner:** stream-1
- **Location:** `app/src/shared/session/session.ts:33-41`, `app/src/shared/session/storage.ts:8-22`.
- **Problem:** `readStored` returns `JSON.parse(raw) as T` unchecked. A stored value of `null` makes `load()` throw (`stored.learner` on `null`); `useSession()` is called by `LanguageSwitch` in the page shell of every screen, including the error screen, so the result is a blank page on every start until site data is cleared. A learner or list entry of the wrong shape is accepted and fails later, wherever a screen reads `.name` or `.id`.
- **Evidence:** `evidence/a09-session-corrupt-storage.evidence.test.ts`.
- **Impact:** Unlikely today (the app only writes well-formed data under a versioned key), but phones are shared and long-lived, and the next schema change makes old data "malformed". The cost of the failure is total.
- **Recommendation:** In `load()`, accept only a plain object; keep `learner` only if it has string `id` and `name`; filter `knownLearners` the same way; fall back to the empty session on anything else.
- **Validation:** Both tests in `a09-…evidence.test.ts` must fail.

### A-10 — Bracket placeholders are printed on lesson cards

- **Severity:** Low (release-gating content decision, not a coding error)
- **Category:** Design fidelity, usability
- **Owner:** stream-1 (with the design and content owner)
- **Location:** `app/src/shared/components/lessonTypes.tsx:41-54`, `app/src/shared/components/LessonTags.tsx:79-90`; locked in by `app/src/shared/components/components.test.tsx:85-97` and `:111`.
- **Problem:** A lesson with no known length shows the literal text `[length]`, and a Read lesson with no page count shows `[pages] pages`. This is faithful to the boards, which print the same brackets, but `HANDOFF.md` section 8 lists `[length]` under "Placeholders to fill". Check and Try it lessons have no length to fill in, and still show it.
- **Evidence:** `evidence/measure-layout.out.txt` section 4: the quiz lesson's facts row reads "Length: [length]"; all five lessons of `cp-child-staying-safe` in the mock have `length: null`.
- **Impact:** A first-time reader is shown a clock icon followed by a bracketed English word on every card.
- **Recommendation:** Before release, get a decision from the design owner; the smallest change is to leave the fact out when the value is `null`, and never show a length for `check` or `try`.
- **Validation:** Kitchen sink and a series list show no bracketed text.

### A-11 — Choosing Krio sets `<html lang="kri">` over English text, and the setting is lost on reload

- **Severity:** Low
- **Category:** Accessibility
- **Owner:** stream-1
- **Location:** `app/src/shared/session/session.ts:88-91`; `app/index.html:2`.
- **Problem:** `setLanguage('kri')` marks the whole document as Krio while every string on screen is still English, and nothing applies the stored language at start-up, so after a reload the document says `en` while the session says `kri`.
- **Evidence:** Code reading; `grep` finds one write to `documentElement.lang` and none at boot.
- **Impact:** A screen reader may pick the wrong voice or pronunciation rules for English text. Small today; it becomes a real defect the day translations arrive and the attribute is wrong after every reload.
- **Recommendation:** Do not change `documentElement.lang` until translated text exists; when it does, set it from the session in `main.tsx` before rendering as well as in `setLanguage`.
- **Validation:** Unit test on `setLanguage` and on start-up with a stored `kri`.

### A-12 — The GET cache and in-flight sharing do less than documented

- **Severity:** Low
- **Category:** API client, network efficiency
- **Owner:** stream-1
- **Location:** `app/src/shared/api/client.ts:104-110`, `:196-229`.
- **Problem:** (1) Every write clears the whole cache (`:224-228`), including each `saveLessonProgress`, so the "Back is instant" cache is emptied every time a learner's progress is saved, which is exactly when they go back to the lesson list. (2) In-flight sharing is skipped whenever a `signal` is passed (`:205`), and the documented `useApi` pattern always passes one on browsers with `AbortController`, so "identical GETs in flight are shared" (ARCHITECTURE section 8) holds only on Chrome below 66. (3) Cached objects are handed out by reference; a screen that sorts or edits an answer in place changes it for the next reader. (4) Eviction removes the oldest insertion even when the key being written is already present.
- **Evidence:** Code reading; `client.test.ts:73-79` asserts behaviour (1) as intended.
- **Impact:** More requests to the Pi than the design intends, most of all while many learners are finishing lessons. No wrong data.
- **Recommendation:** Clear the content cache only for writes that change content (admin calls), not for learner and progress writes; state in the docs that cached answers must be treated as read-only; either share in-flight requests with a subscriber count or correct the claim in the document.
- **Validation:** Extend `client.test.ts`: a progress save followed by `getSeries` makes no new content request.

### A-13 — Smaller accessibility and semantics issues in shared components

- **Severity:** Low
- **Category:** Accessibility
- **Owner:** stream-1
- **Location and problem:**
  - `app/src/shared/shell/shell.css:40-50`: the logo link in the inner header is a 99×30px target (113×34 from tablet width), under the 48px rule the foundation sets for everyone else. It duplicates the Home button beside it. Measured: `evidence/measure-layout.out.txt` section 1.
  - `app/src/shared/components/Cards.tsx:53`: `aria-disabled` on a plain `<div>` has no effect and is not allowed on an element without a role. The card's own words ("Not in bag") already carry the meaning; remove the attribute.
  - `app/src/shared/components/Illustration.tsx:57`: the lazy placeholder has `role="img"` and no name when `alt` is empty; give it `aria-hidden="true"` in that case.
  - `app/src/shared/components/Cards.tsx:195` with `LessonTags.tsx:82`: `FactsRow` puts a `<ul>` inside a `<span>` inside the card's `<a>`. Browsers cope, but it is invalid nesting and screen readers announce a list inside a link; inside a card render the facts as spans.
  - `app/src/shared/components/Forms.tsx:116-143`: `role="radiogroup"` with every row a tab stop and no arrow keys. Fine for touch and TalkBack; a keyboard user on a laptop gets radios that do not behave like radios. Either add arrow-key handling or use `aria-pressed` buttons in a `group`, as the filter does.
  - `app/src/shared/shell/ListenButton.tsx:48` and `:55`: the button changes its words to "Stop" and also sets `aria-pressed="true"`, which reads as "Stop, pressed". Use one or the other.
  - `app/src/shared/components/Illustration.tsx:59-70`: no handling of a picture that fails to load; the browser's broken-image mark and the alt text are drawn over the tint. Hide the image on `error` so the card keeps its tint.
- **Evidence:** Code reading; target sizes measured in Chrome. No screen reader was run.
- **Validation:** Unit tests on roles and attributes; re-run `measure-layout.mjs` for target sizes.

### A-14 — `navigate()` and `Link` add a history entry for the URL the learner is already on

- **Severity:** Low
- **Category:** Router
- **Owner:** stream-1
- **Location:** `app/src/shared/router/router.tsx:78-83`.
- **Problem:** A tap on a link to the current URL (for example "Home" in the not-found screen's body after "Home" in the header, or a card tapped twice on a slow phone) pushes a duplicate entry, so the browser's Back appears to do nothing once per duplicate.
- **Evidence:** Code reading: `pushState` is unconditional.
- **Recommendation:** Use `replaceState` when `to` equals the current `pathname + search + hash`.
- **Validation:** Router test: two navigations to the same URL leave `history.length` one higher, not two.

### A-15 — The documents streams 2–4 follow contradict each other in places

- **Severity:** Low
- **Category:** Maintainability, conventions
- **Owner:** stream-1
- **Location and problem:**
  - CSS class prefix: `docs/ARCHITECTURE.md:167` says `lrn-`, `les-`, `adm-`; `app/src/features/*/README.md:46` say `learner-`, `lessons-`, `admin-`.
  - Loading and error states: the example in `docs/ARCHITECTURE.md:127-133` returns `<LoadingState />` and `<ErrorState />` on their own, with no page shell, so a learner on a failed screen has no Back, Home or quick exit; the READMEs (`:41`) say every screen is wrapped in `PageShell`; the stubs in `features/*/routes.tsx` do the right thing (states inside the shell). The architecture example should match the stubs. On Child protection screens this matters: "Leave this page" must be present while a screen is loading or has failed.
  - `docs/ARCHITECTURE.md:136` states the `useApi` guarantee that A-01 disproves, and section 8 states the sharing that A-12 disproves.
  - `app/src/shared/components/feedback.css:64-93` uses the raw blue palette for the default (info) message and `card.css:27` uses `--sb-page-blue`, while section 3.7 tells streams to use role tokens so screens "turn green by themselves". Confirm with the design owner whether an info message on an Agriculture screen is meant to stay blue, then either switch to role tokens or note the exception.
- **Evidence:** The cited lines.
- **Recommendation:** Correct the documents in one pass together with the fixes above.

### Suspected risks (not confirmed, not counted as findings)

- **SystemJS may also cache a failed module load**, which would make an in-place `import()` retry fail even with a new `React.lazy`. Not isolated in this pass; it is why A-03 recommends keeping the reload and checking reachability first.
- **The sticky Child protection header is 144–150px tall on a phone** (measured at 360 and 320px wide), which is the approved design (the board's header is sticky with both rows). On a 320×569 screen with the browser's own bars, or in landscape, it takes a large share of the viewport. To be judged on a real phone, not changed on a reviewer's opinion.
- **Scroll position after the browser's Back**: `navigate()` scrolls to the top, but Back relies on the browser restoring the position before the screen's data has arrived. Likely to land at the top of long lists. Not tested.
- **API answers are cast to their types, not validated** (`client.ts:178`). Acceptable without a backend; when one exists, a drifted response becomes a render error caught by the boundary ("This page did not open"), with no hint of the cause.

### Recommendations (not defects)

- `useApi` has no way to skip a request (for example "progress only when a learner is chosen"). Document the pattern `(signal) => (learner ? getProgress(learner.id, undefined, { signal }) : Promise.resolve(null))`, or add an `enabled` option, before each stream invents its own.
- There is no shared helper for actions (save, publish): each stream will write its own working / error / double-tap state around `<Button working>`. The helper suggested in A-04 would cover it.
- `app/src/shared/styles/base.css:89-93` (`.sb-motion-ok`) sets a duration with no property and is unused; remove it or make it the documented transition helper.

## D. Performance results

No performance measurement was possible on target hardware, and performance measurement belongs to Reviewer B. The only numbers taken by this reviewer are layout and contrast checks.

| Metric | Baseline | Current | Target | Status | Device and conditions |
|---|---|---|---|---|---|
| Cold start, time to usable screen, interaction latency, memory | none | Not Tested | to be set on hardware | Not Tested | No Raspberry Pi, no Android device |
| Start JavaScript, gzip (`npm run size`) | none (new codebase) | 94.0 KB | 200 KB | Pass | Build on the development Mac; Reviewer B verifies independently |
| Critical resources for the first screen, gzip (`npm run size`) | none | 115.2 KB | 350 KB | Pass | Same |
| Horizontal overflow, inner header, 320px wide | none | 359px content in a 320px viewport | none | **Fail** (A-06) | Headless desktop Chrome, production build via `vite preview`, Poppins loaded |
| Horizontal overflow at 360, 390, 800px | none | none | none | Pass | Same |
| Interactive targets under 48px | none | 1 kind: header logo link 99×30 | 48px | Fail, minor (A-13) | Same; 50 controls on the kitchen sink, 4–9 on each app page |
| Smallest text | none | 16px | 16px | Pass | Same |
| Text and edge contrast, 36 pairs recomputed from `tokens.css` | `brand/tokens.json` | text 5.38–14.6 : 1; tappable edges 3.13–3.91 : 1; focus ring 10.3–10.7 : 1 | 4.5 text, 3.0 edges | Pass | WCAG formula, computed; matches the ratios stated in `brand/tokens.json` |
| Focus after in-app navigation | none | moves to `#sb-main`, scroll at top | as documented | Pass | Headless desktop Chrome |

## E. Dependency and asset inventory

Reviewer B's area; not audited here. Noted in passing for them, not investigated:

- ESLint bans `replaceAll`, `.at()` and `Object.fromEntries` "because they are not polyfilled", while the same document says the build adds the core-js polyfills the code uses; one of the two statements is probably out of date.
- `tsconfig.app.json:9` puts `vitest/globals` and `@testing-library/jest-dom` types into application code, so `describe` or `expect` in a non-test file would typecheck.
- `<img loading="lazy">` in `Illustration.tsx:60-66` sets `src` before `loading`; harmless in Chrome, a known problem only in older Firefox.

Definite unused items found while reading the shared CSS: `.sb-motion-ok` (`base.css:89-93`) and `.sb-listen-note` (`shell.css:124-130`) are not referenced by any component. A few bytes each; candidates for removal after checking that no stream uses them.

## F. Testing results

Run in this worktree on macOS, Node 23.10, after `npm ci`.

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | Completed (audit notice for dev tooling only; Reviewer B) |
| Typecheck | `npm run typecheck` | Pass, exit 0 |
| Lint | `npm run lint` | Pass, exit 0, no output |
| Unit tests | `npm test` | Pass: 6 files, 61 tests |
| Production build | `npm run build` | Pass, including the postbuild checks |
| Size budgets | `npm run size` | Pass: 94.0 / 200 KB, 115.2 / 350 KB, 1.0 / 60 KB |
| Reviewer repro tests | `npx vitest run --config ../docs/reviews/evidence/vitest.evidence.config.mjs` | 6 files, 9 tests pass, meaning the defects of A-01, A-02, A-03, A-04, A-05 and A-09 are present |
| Lint rule probes | `npx eslint --stdin --stdin-filename …` on four snippets | Boundary and floor rules fire; gaps listed in A-07 |
| Layout, targets, focus, chunk recovery | `node docs/reviews/evidence/measure-layout.mjs` (headless Chrome, production build and dev kitchen sink, 320 / 360 / 390 / 800px) | Output in `evidence/measure-layout.out.txt` |
| Header geometry at 320 and 360px | `node docs/reviews/evidence/measure-header-320.mjs` | Output in `evidence/measure-header-320.out.txt` |
| Design fidelity | Values extracted from `V3-Components.dc.html` and `CPB-Child.dc.html`, compared with the shared CSS | Match on every value checked |

Evidence files (`docs/reviews/evidence/`): `vitest.evidence.config.mjs`, `a01-useapi-stale-render.evidence.test.tsx`, `a02-route-param-state.evidence.test.tsx`, `a03-chunk-failure-recovery.evidence.test.tsx`, `a04-idempotency-key.evidence.test.ts`, `a05-usequery-identity.evidence.test.tsx`, `a09-session-corrupt-storage.evidence.test.ts`, `measure-layout.mjs` with `measure-layout.out.txt`, `measure-header-320.mjs` with `measure-header-320.out.txt`. None is wired into the app or its test run.

**Not tested**

- Any physical Android phone or tablet, any Android WebView, Chrome 58 or any other old browser. Every browser result above is from current desktop Chrome in headless mode with device emulation.
- Any Raspberry Pi; nginx or Caddy; behaviour with many devices.
- Screen readers (TalkBack), switch access, real touch input, the virtual keyboard over form fields.
- "Try again" (full reload) while the network is down: reasoned in A-03, not run.
- The dev-only kitchen sink in an old browser; visual fidelity by pixel comparison.
- Real audio through the Listen button (no recordings exist), and `uploadFile` against a real server.
- The API contract against a backend (none exists).
- Streams 2–4 (not in this snapshot).

## G. Prioritised remediation plan

All items are for stream-1. Order follows section 19G of the reviewer instructions; items 1–3 change behaviour that streams 2–4 are coding against now, so they should land first.

1. **Release blockers:** none in this focus.
2. **Security and data integrity:** A-04 (idempotency key per submission). A-01 with A-02 (stale answer and surviving state on "next lesson").
3. **Offline functionality failures:** A-03 (recovery after a failed download).
4. **Legacy browser compatibility:** A-07 item 1 (an automatic check for the CSS floor rules) before streams 2–4 merge their CSS.
5. **Major performance problems:** A-05 (request loop through `useQuery`). A-12 is minor.
6. **Maintainability:** A-07 items 2–4, A-08 (tests for `useApi`, the boundary, the session and Listen stores, uploads), A-15 (documents), A-09.
7. **Minor code quality and usability:** A-06 (320px header; small change, visible on the cheapest phones, do it with the shell work), A-10, A-11, A-13, A-14.

### What streams 2–4 should know now

- **Stream 3:** until A-02 is fixed, `/lesson/a` → `/lesson/b` keeps your component and all its state. Reset on `lessonId`, or put your player in a child rendered with `key={lessonId}`. Until A-01 is fixed, do not pair `useParams()` ids with `useApi` data in effects; use the ids inside the loaded object (`lesson.id`).
- **Streams 2 and 4:** for `createLearner`, `createLesson` and `createSeries`, create one key with `newRequestKey()` when the form is first submitted, keep it (a ref) across retries, and pass it as `{ idempotencyKey }`. The default does not protect you (A-04).
- **Everyone:** do not put the result of `useQuery()` in a dependency list; depend on `useLocation().search` or on the strings you read from it (A-05). `useApi`'s dependency list is not checked by lint; check it by hand (A-07). Lint and the build will not catch flex `gap`, `aspect-ratio`, `inset`, `clamp()` or `:has()` in your CSS (A-07). Keep loading and error states inside `PageShell`, as the stubs do, not as the example in ARCHITECTURE section 3.4 shows (A-15). Lay screens out to work at 320px wide, not only at the 390px board width (A-06). Cached API answers are shared objects: do not sort or edit them in place (A-12).

## Release decision

**PASS WITH CONDITIONS**, for the Stream 1 foundation within Reviewer A's focus.

No Critical finding. One High finding (A-03) and seven Medium findings are confirmed with reproductions; all have small, local fixes and none requires a redesign or a new dependency. The conditions: A-03, A-01, A-02, A-04 and A-05 are fixed and A-07 item 1 is in place before the stream 2–4 branches are merged, and each is re-verified by this reviewer (a finding is closed only on re-verification). This is not a statement about release readiness of the product: device, Pi, offline, compatibility, performance and security verification are outside this focus or were not possible here, and are listed above as Not Tested.
