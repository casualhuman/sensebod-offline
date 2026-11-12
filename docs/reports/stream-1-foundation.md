# Stream 1 — Foundation: technical report

12 Nov 2026. Covers everything in stream 1's paths: `app/` project config, `app/src/shared/**`, `app/src/app/**`, `app/public/**`, `app/mock/**`, `app/deploy/**`, `docs/ARCHITECTURE.md`, `docs/API-CONTRACT.md`.

State at hand-over: typecheck, lint, 61 unit tests and the production build all pass. The built app was run in current Chrome and in an archived Chromium 58 desktop build, through nginx with the security headers on. **No Raspberry Pi and no physical Android device were used**; section 6 says exactly what that leaves untested.

Where to start: `docs/ARCHITECTURE.md` (conventions, catalogue, budgets, deployment), `docs/API-CONTRACT.md` (endpoints and the mock), and the `README.md` in each feature folder.

## 1. What I built

| Area | Where | Implements |
|---|---|---|
| Project | `app/package.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `tsconfig*.json` | Vite 8 + React 18 + strict TypeScript; scripts `dev`, `build`, `typecheck`, `lint`, `test`, `size`, `preview`, `gen:mock` |
| Build for the floor | `vite.config.ts`, `scripts/postbuild.mjs`, `scripts/size-report.mjs` | One SystemJS build for Chrome 58+; postbuild checks (CSP hash, no external URLs, no dev or mock code, `.gz` twins); size report with budgets |
| Tokens and theme | `src/shared/styles/tokens.css`, `base.css` | Every value in `brand/tokens.json` and the V3-Components "Colour tokens" and "Type" sections; Agriculture green theme via `data-theme` |
| Fonts | `src/shared/fonts`, `styles/fonts.css` | Self-hosted Poppins 400/600/700/800 (WOFF2 subsets), Krio letter supplement, `font-display: swap`, Arial fallback |
| Icons | `src/shared/icons` | 58 inline SVG icons with the boards' own path data (V3-Components "Icons · badge style" plus the icons used on Main, V3-SignIn, CPB-*, AGB-*, ADM-M-Home) |
| Buttons | `components/Button.tsx` | "Buttons · 64–72px": primary default / pressed / focus / working / not ready, secondary, Listen, remove (red), Agriculture green, stacked player buttons, quick-exit style |
| Cards | `components/Cards.tsx`, `Illustration.tsx` | "Portal card · scene + badge", "Topic card · 4 states", "Card anatomy" lesson card; tappable edge contrast rule |
| Lesson types | `components/LessonTags.tsx`, `lessonTypes.tsx` | "Lesson types": 5 tags with bold labelled icons, "You take part", state chips, facts row, header pill, button words from the data tag |
| Filter | `components/LessonFilter.tsx` | "Filter · above every lesson list": All · Watch · Listen · Read · Try it; 3 + 2 on phones, one row from tablet |
| Progress | `components/Progress.tsx` | "Progress · words first"; segmented per-lesson bar from CPB-Child |
| Messages and states | `components/Message.tsx` | "Messages": saved, good to know, not in this bag, error; plus loading, error-with-retry, empty and success helpers |
| Forms and chips | `components/Forms.tsx`, `Chips.tsx` | Name field and "Who are you?" rows (V3-SignIn), quiz answer rows (default / chosen), person chip, language switch, info strip |
| Page shell | `src/shared/shell` | Header with Back, Home, Listen; Child protection "Leave this page"; phone / tablet / laptop layouts from CPB-Child, CPB-Child-Tab, AGB-Agriculture, Main; skip link, focus handling, footer |
| Router | `src/shared/router`, `src/app/features.ts`, `src/app/App.tsx` | Own 1.2 KB router; one lazy entry per feature; URL scheme in `paths`; error boundary and not-found screen |
| Feature stubs | `src/features/{learner,lessons,admin}/routes.tsx` + `README.md` | A working placeholder per feature that shows the conventions; nothing else |
| Data layer | `src/shared/api`, `src/shared/session` | Shared types, API client, `useApi`, learner and admin calls, session store |
| Contract | `docs/API-CONTRACT.md` | Content model, Save my progress, all admin operations on the ADM boards |
| Mock API | `app/mock`, `build/mockApiPlugin.ts` | Every endpoint, in memory, for the dev server, `vite preview` and tests; seeded from the boards and `content/agriculture-videos.csv` (5 portals, 23 groups, 46 series, 231 lessons) |
| Illustrations | `build/illustrationsPlugin.ts`, `src/shared/illustrations` | Served by URL from `illustrations/`, copied unchanged to `dist/`, versioned URLs, lazy loading |
| Deployment | `app/deploy/nginx.conf`, `security-headers.conf`, `Caddyfile` | SPA fallback, pre-compressed assets, cache rules, CSP and security headers, byte ranges for media, sandbox for animation packages, API proxy |
| Dev kitchen sink | `src/app/dev` | Every shared component at `/__dev`; not in the production bundle (checked by the build) |
| Tests | 6 files, 61 tests | Router, API client, mock handler and seed integrity, components, shell, app wiring |

Not built, on purpose: any real screen (streams 2–4), the video / audio / quiz players themselves (stream 3; the library's "Video player" and "Quiz question" sections are specified there and the pieces they need — stacked buttons, answer rows, icons — are shared), admin layout chrome (stream 4), service worker or sync (section 2).

## 2. Technical decisions and trade-offs

| Decision | Chosen | Rejected, and why | Cost of the choice |
|---|---|---|---|
| Browser floor | Chrome / WebView 58 (Android 8.0 as shipped, never updated offline) | Assuming an updated Chrome: the handoff names Android 8 without a version | A SystemJS build and 36 KB gzip of polyfills + loader for everyone |
| Build shape | **One build** for all devices (`plugin-legacy`, `renderModernChunks: false`) | Modern + legacy builds: plugin-legacy 8 only calls Chrome 105+ modern, so Chrome 61–104 would download both (measured 149 KB gzip of JS instead of 94 KB) and the CSP would need `script-src data:`. Modules only: blank page before Chrome 61–63 | Current browsers get about 39 KB gzip more JS than they need. CSS travels inside the JS chunks, so the CSP needs `style-src 'unsafe-inline'` |
| React | 18.3.1 (45.6 KB gzip) | React 19.3.1: 68.9 KB for the same code. Preact compat: 6.8 KB, but a compatibility layer under four parallel streams on untestable browsers is the larger risk | About 39 KB more than Preact; revisit once screens exist and devices are available |
| Router | Own code, 1.2 KB gzip | `react-router` 8: +14.4 KB. `wouter` 3: +2.3 KB and a dependency | We maintain about 150 lines; no nested layouts or data loaders (not needed) |
| Back button | Each screen states its parent (`backTo`) | `history.back()`: wrong after a deep link, a refresh or a shared link | Back does not retrace an unusual path through the app |
| Styling | Plain CSS + custom properties, `sb-` prefix; CSS Modules allowed in features | Tailwind, CSS-in-JS, Sass | Class naming discipline is manual |
| Flex `gap` | Banned (Chrome 84); margins and helper classes instead | Using it, as the boards do | Slightly more CSS; a rule every stream must remember (documented, not lint-enforced) |
| Motion | Opt-in inside `prefers-reduced-motion: no-preference` | Opt-out with `reduce`: Chrome before 74 cannot answer the query and would always animate | Phones older than Chrome 74 see a still spinner, with words beside it |
| Fonts | Poppins subsets + six Krio letters from Montserrat | Leaving ɛ ɔ ŋ to the phone's fallback font; shipping latin-ext (does not contain them either) | A substitution a designer should confirm; 4.8 KB |
| Font weights | 400, 600, 700, 800 | 500: used twice on current screens | `font-weight: 500` renders as 400 |
| API client | `fetch` wrapper: timeout, cancel, typed errors, in-flight sharing, 60 s bounded cache, no auto-retry | A data-fetching library; automatic retries (many tablets retrying against a struggling Pi) | Screens call "Try again" explicitly |
| Uploads | One file per request, raw body, `XMLHttpRequest` | `multipart/form-data` (server must parse and buffer); `fetch` (no upload progress on the targets) | Needs backend agreement (API-CONTRACT section 9) |
| Mock API | Node-side middleware in the dev / preview server + a `fetch` stub in tests, one shared handler | MSW (a dependency and a service worker); mock code in the browser bundle | State resets when the dev server restarts |
| Names on a phone | Kept in `localStorage` on that phone; no `GET /learners` | Listing every learner in the bag to every phone | A cleared browser forgets the list (the learner still exists in the bag) |
| Listen | Plays a recording from the bag | Speech synthesis: unreliable offline on old Android, no Krio voice | Needs recordings; without one the button says "No sound here yet" |
| Illustrations | Served as files by URL, unchanged, lazy | Inlining into JS (as the boards do): megabytes of script. SVGO: −16% after gzip, risk to faces | SVG text inside scenes uses the device font |
| Compression | `.gz` twins made at build time, served with `gzip_static` | Compressing on the Pi per request; Brotli (HTTPS only) | `dist/` is larger on disk (3.9 MB) |
| Mode A vs Mode B | Mode A only | Service worker + offline cache: not asked for by the handoff, and impossible without a secure origin on the bag (ARCHITECTURE section 10) | A phone away from the bag's Wi-Fi shows a clear error, not content |
| Web server | nginx recommended; Caddyfile provided | — | Caddyfile is unexecuted |

## 3. Deviations from the design

| # | Where | Difference | Reason |
|---|---|---|---|
| 1 | Krio letters ɛ ɔ ŋ | Drawn with Montserrat glyphs, not Poppins | Poppins has no such glyphs (verified in the font files) |
| 2 | Lesson filter | The library's version (5 separate buttons, 3 + 2 on phones) everywhere; CPB-Child shows an older joined 4-segment control without Read | The component library is newer (Read was added later) and says "5 big buttons" |
| 3 | Agriculture pressed state | `#145A28` with a `#0E4520` inset edge | The boards define pressed only for blue; derived the same way |
| 4 | Pressed states for secondary, Listen, red buttons | Tint fill (secondary), darker gold / red | Not drawn on the boards; added so every button gives feedback |
| 5 | Header on tablet and laptop for non-Child-protection screens | Back, Home, then language, Listen, logo on the right | No tablet or laptop boards exist for Agriculture, Climate, Primary, JSS; extended from CPB-Child-Tab |
| 6 | Laptop (1440) learner layout | Content column up to 1328px, lists in 3 columns | No laptop learner boards exist |
| 7 | Home header | The Sensebod logo is not a link on Home; on inner screens it links Home | Convenience; boards show a plain image |
| 8 | "Leave this page" | Also stops narration and forgets the audience choice, and replaces the history entry | Makes the quick exit do more of what its name promises |
| 9 | Listen with no recording | Button stays; says "No sound here yet" when tapped | Boards do not show this state; recordings do not exist yet |
| 10 | Check quiz card | No "You take part" pill | Follows CPB-Child's quiz card |
| 11 | Facts-row separator dot | A wrapped line can start with the dot | Same markup behaviour as the boards; cosmetic |
| 12 | SVG text in scenes (sign boards) | Device sans-serif instead of Poppins | Images cannot use page fonts |
| 13 | Logos | Resized, palette-reduced copies (6.8 KB and 2.9 KB) | The originals are 59 KB and 22 KB for a 34px-high image |
| 14 | Boot line | "Opening Sensebod…" before the app starts | Not on the boards; avoids a blank first paint |
| 15 | Topic and lesson pictures | Cropped to a fixed shape with `object-fit: cover` | Boards draw each picture at its own size; cards need equal heights |

Board text containing `→` or `◆` falls back to the device font for those two characters (not in the Poppins subset).

## 4. Footprint (measured, `npm run size`, gzip level 9)

| What | Files | Raw | gzip |
|---|---|---|---|
| `index.html` | 1 | 1.6 KB | 0.7 KB |
| Start JS: polyfills + SystemJS | 1 | 101.3 KB | 36.4 KB |
| Start JS: entry (React, all shared code, all shared CSS) | 1 | 186.4 KB | 57.6 KB |
| **Start JS total** | 2 | 287.6 KB | **94.0 KB** (budget 200) |
| Lazy chunks (3 feature stubs + shared API calls) | 4 | 4.9 KB | 2.6 KB |
| Shared CSS (inside the entry) | — | 23.6 KB | 5.0 KB |
| Fonts preloaded (Poppins 400, 800) | 2 | 13.8 KB | 13.8 KB |
| Fonts on demand (600, 700, 4 × Krio letters) | 6 | 18.6 KB | 18.6 KB |
| Logos + favicon | 3 | 9.6 KB | 9.6 KB |
| Home portal pictures | 5 | 9.0 KB | 3.3 KB |
| Illustrations | 109 | 2443 KB | 444 KB |
| **Critical resources for the first screen** | | | **115.2 KB** (budget 350) |

- Requests for a cold first screen: 17 (Home, through nginx).
- Shared modules on their own (minified, gzip): components 7.1 KB, shell 3.5, API 3.1, icons 2.8 (all 58), router 1.2, session 0.7.
- Runtime dependencies: `react` 18.3.1, `react-dom` 18.3.1. Nothing else.
- Dev dependencies: 17 (listed in ARCHITECTURE section 5). `npm audit --omit=dev`: 0 findings. With dev tools: 10 (2 critical, 8 moderate), all inside Vitest 3 / typescript-eslint, none in the build output.
- There is no "before" to compare with: this is a new codebase.

## 5. Offline and compatibility

- **External requests: none.** Checked three ways: (1) `scripts/postbuild.mjs` scans every built text file for URLs on every build and fails on any that is not a known harmless string (XML namespaces, links inside React's error texts); (2) request logs from headless Chrome on the production build show one origin only, across Home, a deep-linked lesson, an unknown URL, admin and in-app navigation; (3) the CSP (`default-src 'self'`, `connect-src 'self'`) would block one.
- Fonts, icons, logos, pictures, scripts and styles are all in `dist/`. The design boards' Google Fonts links are not used anywhere.
- Browser features relied on, with the fallback:

| Feature | Floor (58) has it | Fallback |
|---|---|---|
| CSS custom properties, grid (`grid-gap`), flexbox, `position: sticky`, `object-fit` | yes | — |
| `fetch`, Promise, History API, `localStorage` | yes | storage: in-memory if unavailable |
| ES modules, dynamic import | no | SystemJS build |
| `AbortController` | no (66) | stale answers are ignored instead of cancelled |
| `loading="lazy"` | no (77) | `IntersectionObserver` (51+), then eager |
| `:focus-visible` | no (86) | focus ring on every focus |
| `prefers-reduced-motion` | no (74) | no motion at all |
| WOFF2, `unicode-range`, `font-display` | yes (36 / 36 / 60: `font-display` is ignored on 58–59, text may be invisible for up to 3 s while a font loads) | Arial |

- Secure-context limits on plain HTTP (no service worker, no in-page camera or microphone): ARCHITECTURE section 10. **Stream 4: use `<input type="file" capture>` for photos and voice.**

## 6. Testing

**Automated, all passing**

| Command | Result |
|---|---|
| `npm run typecheck` | pass (strict, `noUncheckedIndexedAccess`) |
| `npm run lint` | pass, 0 warnings; confirmed the floor and boundary rules fire on a deliberate violation |
| `npm test` | 61 tests in 6 files, pass |
| `npm run build` | pass, including the postbuild checks |
| `npm run size` | all three budgets met |

**In browsers**

| What | How | Result |
|---|---|---|
| Production build, current Chrome 157 headless, 390 / 800 / 1440 | `vite preview` + DevTools protocol | Home, lesson deep link, refresh, hard refresh, unknown URL, admin, in-app navigation: correct screens, single origin, no console errors, no horizontal scrolling |
| Same build behind **nginx 1.22.1** (container, linux/arm64) with the CSP | curl + headless Chrome | Config test passes; SPA fallback; 404 for a missing asset; `.gz` served; cache headers; `206` range answers; `<video>` seeks; sandboxed animation package isolated; 503 JSON when the API is down; 304 revalidation; **no CSP violations** |
| Wi-Fi drop and recovery | network cut in DevTools after load | Error message "This phone cannot reach the bag…", then **Try again** recovers |
| **Chromium 58.0.3029** (archived desktop Linux build, x86-64 emulated in a container) through the same nginx | DevTools protocol | Home with portals from the API, deep link, refresh, in-app navigation, Agriculture theme colours, Poppins loaded, pictures loaded through the `IntersectionObserver` path, no script errors. Confirmed in that browser: no modules, no `AbortController`, no flex `gap`, no native lazy loading |
| Kitchen sink, dev server | screenshots at 390 / 800 / 1440, blue and green | Compared by eye with V3-Components; fixed header alignment, spacing-helper specificity and the quiz pill as a result |
| Krio letters | kitchen sink | ɛ ɔ ŋ Ɛ Ɔ Ŋ render at 400, 600, 700, 800 |
| Feature conventions | temporary probe screen (lazy route, CSS Module, `learnerApi`, `sceneUrl`) | typecheck, lint and build pass; removed afterwards |

Two findings from Chromium 58 changed the deployment config: `Referrer-Policy: same-origin` is unknown there (now `no-referrer, same-origin`), and `worker-src` is behind a flag (removed).

**Not tested — do not assume any of it works**

- Any physical Android phone or tablet, any Android WebView, any Android 8 device. The Chromium 58 run shares the rendering engine version but not the platform: touch, virtual keyboard, viewport behaviour, media codecs, memory limits and real speed are all unverified.
- Any Raspberry Pi. nginx was run in a container on a Mac; Pi CPU, SD-card I/O, the Wi-Fi access point and many simultaneous clients are unmeasured. The media rate limit value is a guess.
- The Caddyfile (written, never executed).
- Firefox, Safari and old Edge.
- Load time, memory and main-thread measurements on weak hardware; long sessions; 20+ devices at once.
- Real video and audio: the mock uses generated test clips. No player exists yet.
- Screen readers (TalkBack) and switch access: roles and labels are unit-tested, no assistive technology was run.
- Visual fidelity was checked by eye against the boards, not by pixel comparison.
- The kitchen sink cannot be opened in Chromium 58 (the dev server serves ES modules); only the production build was checked there.

## 7. Cross-team notes

For everyone

- **Add screens only in your `features/<name>/routes.tsx`**: `export const routes: RouteDef[] = [{ path: '/…', component: lazy(() => import('./screens/X')) }]`. Paths are absolute and must stay in your URL space (`/lesson…` stream 3, `/admin…` stream 4, everything else stream 2). The placeholder in each file is a working example to replace.
- Imports: `@shared/components`, `@shared/icons`, `@shared/shell`, `@shared/router`, `@shared/api`, `@shared/session`, `@shared/illustrations`. Never another feature, `src/app`, or `mock/` (lint enforces it; tests may import `@mock/installMockFetch`).
- Links: `paths.*` only. API: `useApi(signal => learnerApi.getX(id, { signal }), [id])`. Pictures: `<ScenePicture picture={x.picture} />` or `<Illustration src="child-protection/cast/fatmata" alt="…" />`.
- CSS: no flex `gap`; `grid-gap` before `gap`; motion only inside `prefers-reduced-motion: no-preference`; no weight 500; tokens, not hex values. Full table in ARCHITECTURE section 3.7.
- Mock: `npm run dev` gives you the API and sample media with nothing to set up. Admin sign-in is `admin` / `sensebod`. Useful ids are listed in API-CONTRACT section 7.
- Each lazy screen chunk has a 60 KB gzip budget; `npm run size` reports it.
- `docs/team/REQUESTS.md` has no entries from stream 1.

Stream 2

- `GET /portals/child-protection` returns the three audiences; store the choice with `setChildProtectionAudience()`. `help` is a reserved group id (`paths.help()`), so put that route before `/portal/:portalId/:groupId`.
- Home's flat portal pictures are at `/pictures/portals/<portalId>.svg` and already come with `GET /portals`. Primary and JSS have no illustrations: `picture` is `null` and cards draw the tint.
- Known names on a phone come from `useSession().knownLearners`, not from the API.
- On phones the boards put Listen + language under the title: use `<ListenBar>`; Home uses a full-width `<ListenButton>` (see the placeholder).

Stream 3

- One route, `/lesson/:lessonId`, serves every type; branch on `lesson.content.type`. `lesson.next`, `lesson.series`, `lesson.group`, `lesson.portal` give you Up next, Back and the theme.
- Use `quickExit` when `lesson.portal.id === 'child-protection'` (the placeholder shows it).
- Player controls: `<Button stacked>` with `IconBack10`, `IconPlay`, `IconPause`, `IconForward10`, `IconCaptions`, `IconSound`, `IconFullScreen`. Quiz answers: `ChoiceGroup` covers default and chosen; correct / try-again panels are yours (colours: `--sb-green*`, `--sb-red*`).
- Media rules for the floor: `preload="none"`, no autoplay, check `canPlayType`, show `ErrorState` on a media error. Fullscreen needs prefixed APIs on old Chrome. Show animation packages in `<iframe sandbox="allow-scripts">`.
- Sample media: `/media/sample-video.mp4` (20 s, with captions), `/media/sample-audio.m4a`, `/media/tryit/sample/index.html`.

Stream 4

- In-page recording and live camera do not work over plain HTTP; use file inputs with `capture`.
- `adminApi.uploadContent(file, { smallerCopy }, onProgress)` → `{ promise, abort }`; one call per file. Poll `getUpload(id)` while `processing.state === 'working'`.
- The shared `PageShell` is the learner frame. The admin chrome (phone bottom bar, laptop side menu) is yours; `PageShell` with `noFooter`, or your own frame, are both fine.
- Every `/admin` call returns 401 without a session; handle it once, centrally, in your feature.

## 8. Open items and risks

1. **Real devices.** Nothing has run on Android or on a Pi. Highest-value next step: load `dist/` on the oldest real phone through a real Pi and work through ARCHITECTURE section 13.
2. **The API contract is one-sided.** No backend engineer has seen it. Raw-body uploads, the session cookie, idempotency keys and learner privacy (API-CONTRACT section 9) need agreement before a backend is written.
3. **`style-src 'unsafe-inline'`** is the price of the single build. If it must go, the options are hashing the injected style blocks at build time, or the dual build with its double download for mid-age browsers.
4. **Krio letters** come from Montserrat. Needs a designer's eye, or real Poppins-style glyphs.
5. **Krio translations do not exist.** The language switch stores the choice (`useSession().language`); no text changes yet. No translation mechanism was built: nothing exists to translate and the delivery format is undecided.
6. **Listen recordings do not exist**, and the contract assumes pre-recorded audio per page.
7. **Three agriculture videos are not in English** by their file names (one Spanish, two Hindi). For the content owner.
8. **Climate "picture lessons"** have no lesson type on the boards; seeded as Read. Needs a design decision.
9. **Plain HTTP on the bag's Wi-Fi**: the admin password crosses the air unencrypted. An infrastructure decision; it also blocks Mode B and in-page recording.
10. **Tooling**: Node 23.10 here forces Vitest 3 (which brings the dev-only audit findings). Move the build machine to Node 24 LTS, then Vitest 5.
11. **Preact** would cut about 39 KB gzip from the start script. Worth an experiment once real screens and a real phone exist.
12. **SVGO** not applied (ARCHITECTURE section 9). The ten `-Tab-` scene duplicates could be removed from `illustrations/` by the design owner.
13. **Not designed yet**, so not catered for beyond the contract's open points: Check quiz screens for Child protection, Learners and progress, Storage and backup, Settings, tablet and laptop views for most portals.
14. `font-display` is ignored by Chrome 58–59: text can stay invisible for up to 3 s while Poppins loads on those two versions. Preloading the two main weights limits it; verify on a real device.
15. One commit message (`b22c731`) describes more than the commit contains: it only changed the deployment headers; the preload and chunk naming it mentions went in with the scaffold commit. Left as it is rather than rewrite shared history.
