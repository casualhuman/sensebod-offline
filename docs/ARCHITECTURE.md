# Sensebod frontend — architecture

Written by stream 1 (Foundation). Streams 2–4 build on this. Read `docs/TEAM.md` first for who owns what.

What this is: a static React + TypeScript + Vite build, served by a small web server on the Raspberry Pi in the bag, to old Android phones, tablets and laptops on the bag's Wi-Fi. No internet, ever, at run time.

Every number in this document was measured on the development Mac on 12 Nov 2026 unless it says otherwise. **Nothing here was measured on a Raspberry Pi or a physical Android device**; section 13 lists what that leaves open.

## 1. Quick start

```bash
cd app
npm ci                 # Node 20.19+ (developed on 23.10); internet needed for this step only
npm run dev            # http://localhost:5173  app + mock API + sample media; also on your LAN IP for a real phone
npm run typecheck      # tsc, strict
npm run lint           # eslint (no warnings allowed) + the CSS floor check (scripts/check-css.mjs)
npm test               # vitest + jsdom + Testing Library (npm run test:watch while working)
npm run build          # typecheck → vite build → postbuild checks → dist/
npm run size           # sizes of dist/ against the budgets (run after build)
npm run preview        # serves dist/ with the mock API on http://localhost:4173
npm run gen:mock       # regenerate mock data from content/ and illustrations/
```

Component kitchen sink (development only): `http://localhost:5173/__dev`.

## 2. Folder structure

```
app/
  index.html               the shell: fonts preload, boot line, one script
  vite.config.ts           build target, plugins, aliases           ┐
  vitest.config.ts         test runner (separate, no build plugins) │ stream 1
  eslint.config.js         lint rules incl. floor + boundaries      │
  build/                   Vite plugins: illustrations, mock API    │
  scripts/                 postbuild checks, size report, mock gen  │
  deploy/                  nginx.conf, Caddyfile, security headers  │
  public/                  copied as-is: brand/ logos, pictures/portals/, favicon
  mock/                    mock API: handler, seed, sample media (never bundled)
  src/
    app/                   entry, feature registry (the app router), error boundary, dev kitchen sink
    shared/                everything the features share                ┘
      styles/              fonts.css, tokens.css, base.css, index.css
      fonts/               WOFF2 files + licences
      icons/               inline SVG icon components
      components/          buttons, cards, lesson tags, filter, progress, messages, forms
      shell/               PageShell, ListenButton, ListenBar
      router/              router + `paths` (the URL scheme)
      api/                 types (the contract), client, learner + admin calls, useApi
      session/             who is learning on this phone, language (small localStorage)
      illustrations/       URL helpers for the drawings
      test/                test setup
    features/
      learner/             stream 2 ── routes.tsx + README.md
      lessons/             stream 3 ── routes.tsx + README.md
      admin/               stream 4 ── routes.tsx + README.md
docs/ARCHITECTURE.md, docs/API-CONTRACT.md      stream 1
```

Import aliases: `@shared/*` → `app/src/shared/*`; `@mock/*` → `app/mock/*` (tests only).

## 3. Conventions for streams 2–4

### 3.1 Adding a screen

Each feature folder has a `routes.tsx` that exports `routes: RouteDef[]`. The app router lazy-loads that file the first time one of the feature's URLs is opened. **You only ever edit your own `routes.tsx`.**

```tsx
// src/features/learner/routes.tsx
import { lazyScreen, type RouteDef } from '@shared/router';

export const routes: RouteDef[] = [
  { path: '/', component: lazyScreen(() => import('./screens/Home')) },
  { path: '/save-progress', component: lazyScreen(() => import('./screens/SaveProgress')) },
  { path: '/portal/child-protection/help', component: lazyScreen(() => import('./screens/Help')) },   // specific first
  { path: '/portal/:portalId', component: lazyScreen(() => import('./screens/PortalPage')) },
  { path: '/portal/:portalId/:groupId', component: lazyScreen(() => import('./screens/GroupPage')) },
  { path: '/portal/:portalId/:groupId/:seriesId', component: lazyScreen(() => import('./screens/SeriesPage')) },
];
```

- Screens are components with a default export. Paths are absolute; first match wins.
- `:name` matches one segment; a trailing `/*` matches the rest, including nothing.
- **One screen instance per route and set of named params.** Going from `/lesson/a` to `/lesson/b` unmounts the screen and mounts a new one: no `useState`, `useRef` or running effect is carried into the next lesson, and you do not reset anything by hand. A change of the query string keeps the instance. So does a change of the wildcard part, so one `/admin/*` screen keeps its state across its own sub-steps.
- **Opting out: `instance`.** Routes that name the same `instance` (and use the same component) share one mounted screen across those routes and across param changes: `{ path: '/portal/:portalId', component: Browse, instance: 'browse' }`. The learner feature does this so a portal page stays on screen while a class opens under it. Such a screen must itself cope with params that change under it (key its children on the ids, reset its own state).
- **Use `lazyScreen`, not `React.lazy`, for screens.** `React.lazy` keeps a failed download for the life of the page: every later visit shows the error again without asking the bag. `lazyScreen(() => import('./screens/X'))` shows the error screen for the failed visit, asks again on the next visit, and if that fails too loads a fresh page, but only when the bag answers. `React.lazy` still works (the error screen recovers from it, see section 10); it only lacks the retry on the next visit.
- A feature's routes must stay inside its URL space (a test enforces it):

| Feature | Owns | Stream |
|---|---|---|
| `lessons` | `/lesson` and below | 3 |
| `admin` | `/admin` and below | 4 |
| `learner` | everything else (`/`, `/save-progress`, `/portal/…`) | 2 |

### 3.2 The URL scheme (`paths`)

Build every link with `paths` from `@shared/router`; never write path strings by hand and never import another feature.

| Helper | URL | Screen | Owner |
|---|---|---|---|
| `paths.home()` | `/` | Home (gateway) | learner |
| `paths.saveProgress()` | `/save-progress` | Save my progress | learner |
| `paths.portal(portalId)` | `/portal/:portalId` | portal page (class picker, Who are you?, topics) | learner |
| `paths.group(portalId, groupId)` | `/portal/:portalId/:groupId` | a class, audience or topic | learner |
| `paths.series(portalId, groupId, seriesId)` | `/portal/:portalId/:groupId/:seriesId` | lesson list of a series | learner |
| `paths.help()` | `/portal/child-protection/help` | Get help now (`help` is a reserved group id) | learner |
| `paths.lesson(lessonId)` | `/lesson/:lessonId` | the lesson, any type | lessons |
| `paths.lessonDone(lessonId)` | `/lesson/:lessonId/done` | finished screen | lessons |
| `paths.admin(rest?)` | `/admin`, `/admin/<rest>` | admin (stream 4 decides what is below) | admin |

So a lesson card links with `paths.lesson(lesson.id)`, and a lesson's Back goes to `paths.series(lesson.portal.id, lesson.group.id, lesson.series.id)` (all three ids come with `GET /lessons/{id}`).

Router API (`@shared/router`): `<Link to>`, `navigate(to, { replace?, keepScroll? })`, `useParams<'lessonId'>()`, `useQuery()` (a `URLSearchParams`; the same object for as long as the query string is the same, so it is safe in a dependency list; read-only), `useLocation()`, `matchPath()`, `lazyScreen()`. Navigation scrolls to the top and moves focus to the main area (without scrolling the header away). Navigating to the URL already open replaces the history entry instead of adding one, so a card tapped twice does not break the browser's Back.

### 3.3 Shared components

```tsx
import { Button, ButtonLink, LessonCard, LessonFilter, LoadingState, ErrorState } from '@shared/components';
import { IconBack, IconTick } from '@shared/icons';
import { PageShell, ListenBar, ListenButton } from '@shared/shell';
```

The catalogue with examples is section 7. Do not copy a shared component into a feature; if one is missing or wrong, write it up in `docs/team/REQUESTS.md`.

### 3.4 Calling the API

```tsx
import { useApi, learnerApi, adminApi, describeError, ApiError, type SeriesDetail } from '@shared/api';

function SeriesPage() {
  const { seriesId } = useParams<'seriesId'>();
  const { data: series, error, loading, reload } = useApi((signal) => learnerApi.getSeries(seriesId, { signal }), [seriesId]);
  // Loading and error states go INSIDE the page shell, so Back, Home and (on
  // Child protection) "Leave this page" are there while a screen loads or has failed.
  return (
    <PageShell title={series ? series.title : 'Lessons'} backTo={paths.home()} quickExit={series?.portal.id === 'child-protection'}>
      {loading && !series ? <LoadingState label="Opening the lessons…" /> : null}
      {error ? <ErrorState title="These lessons did not open" error={error} onRetry={reload} /> : null}
      {series ? <LessonList series={series} /> : null}
    </PageShell>
  );
}
```

- `useApi(load, deps)` cancels the request when the screen goes away or `deps` change, keeps the old data on screen during "Try again", and never lets a stale answer overwrite a newer one.
- **The answer belongs to the inputs it was asked with.** From the first render with new `deps` the hook returns `data: undefined`, `error: null`, `loading: true`; the previous answer is never handed to the screen under new inputs, not even for one render. An effect of the usual shape ("when loaded, save progress") therefore never sees lesson A's data with lesson B's id.
- **List everything the request reads in `deps`**, exactly as for `useEffect`. Lint checks it (`react-hooks/exhaustive-deps` with `useApi`, as an error), and wants the loader written inline: `useApi((signal) => getSeries(id, { signal }), [id])`. Values are compared with `Object.is`: pass strings and numbers, not objects or arrays made during render (join ids into one string and read them back from it).
- **Skipping a request**: return a resolved promise from the loader, `(signal) => (learner ? getProgress(learner.id, undefined, { signal }) : Promise.resolve(null))`, with `learner?.id` in `deps`.
- **Cached answers are shared objects.** Content GETs are reused for 60 s, and every reader gets the same object: never sort or edit an answer in place; copy first (`[...series.lessons].sort(…)`).
- For actions (save, publish), call the function directly, disable repeat taps with `<Button working workingLabel="Saving…">`, and catch `ApiError`: `error.fields` for form problems, `describeError(error)` for a plain sentence, `error.retryable` to decide whether to offer "Try again".
- **Creating things is safe to repeat.** `createLearner`, `createLesson` and `createSeries` keep one `Idempotency-Key` per submission: calling again with the same input (a double tap, "Try again" after a timeout or a Wi-Fi drop) sends the same key, and the server answers with the record it already made. The key is renewed when the input changes, when the server refuses the submission (4xx), 5 seconds after success and after 10 minutes; it lives in memory, so a page reload starts a new submission. You do not need to pass a key. If you do pass `{ idempotencyKey }` it is used as given (keep it in a ref across retries). For another creating POST use `submitOnce(path, body)` from `@shared/api`.
- Uploads: `adminApi.uploadContent(file, options, onProgress)` returns `{ promise, abort }`.
- Endpoints, shapes and rules: `docs/API-CONTRACT.md`. The mock (dev server and tests) is section 7 of that document.

### 3.5 Session (who is learning, language)

```tsx
import { useSession, setLearner, learnAsGuest, forgetLearner, setChildProtectionAudience } from '@shared/session';
const { learner, knownLearners, language, childProtectionAudience } = useSession();
```

Small settings in `localStorage` (with an in-memory fallback when storage is unavailable). Progress itself lives in the bag, through the API. "Leave this page" clears `childProtectionAudience`. What is read from the phone is checked, never trusted: a damaged or older value gives a guest session, and a stored learner without a string `id` and `name` is dropped.

The language choice is remembered, but `<html lang>` stays `en` for now: every string on screen is still English, and marking the page as Krio would make a screen reader read English words by the wrong rules. When translations exist, set `document.documentElement.lang` in `setLanguage` and at start-up in `app/main.tsx` (from `getSession().language`).

### 3.6 Illustrations

The drawings stay in the repository's `illustrations/` folder and are served as files, never imported into JavaScript.

```tsx
import { Illustration, ScenePicture } from '@shared/components';
import { sceneUrl, castUrl, illustrationUrl } from '@shared/illustrations';

<ScenePicture picture={lesson.picture} />                                  // API data → card picture, lazy
<Illustration src="child-protection/cast/fatmata" alt="Fatmata" />          // by key (no extension)
<Illustration src={sceneUrl('agriculture', 'quail-house')} alt="…" eager /> // by URL; eager only for the top picture
```

Path scheme (stable): `/illustrations/<portal>/<cast|scenes>/<name>.svg?v=<hash>`, where `<portal>` is `child-protection`, `climate` or `agriculture`, mirroring the folder exactly. Details in section 9.

### 3.7 CSS rules (they exist because of Android 8)

- Plain CSS only, next to the component: `Name.module.css` (CSS Modules, class names made unique by the build) or `name.css` with your feature prefix: `lrn-`, `les-`, `adm-` (the feature READMEs say `learner-`, `lessons-`, `admin-`; the short forms are the rule, the merged learner feature uses `lrn-`, and either is accepted as long as one feature uses one prefix). Shared classes use `sb-`. No CSS-in-JS, no utility framework.
- Use the tokens: `var(--sb-accent)`, `var(--sb-edge)`, `var(--sb-space-4)`, `var(--sb-radius-card)` … (`shared/styles/tokens.css`). Use the role tokens (`--sb-accent…`), not the raw palette, so a screen turns green inside the Agriculture theme by itself. Known exception, kept as the boards draw it and still to be confirmed with the design owner: the default (info) `Message` and the page-blue card edge use the blue palette on every screen, also on Agriculture.
- **Not available on the floor browser: do not use.** `npm run lint` checks this table (`scripts/check-css.mjs`, every `.css` file under `src/` and inline `style={{ … }}` in `.tsx`) and fails with the file and line. A line that is right although it matches (an enhancement with a working fallback) takes a comment `floor-ok: <reason>` on the same line or the line above.

| Do not use | Since Chrome | Use instead |
|---|---|---|
| `gap` on flex containers | 84 | margins; helpers `.sb-stack`, `.sb-row` |
| `gap` alone on grids | 66 | write `grid-gap` first, then `gap` (as `.sb-grid` does) |
| `:has()`, container queries, `color-mix()`, CSS nesting, `@layer`, range media queries (`width >= …`) | 99–112 | plain selectors, media queries, fixed colours |
| `:is()`, `:where()` | 88 | write the selectors out (an unknown selector drops the whole rule) |
| `aspect-ratio` | 88 | `ScenePicture` (padding box), or the `.sb-picture` pattern |
| `inset`, `clamp()`, `min()`, `max()` | 79–87 | `top/right/bottom/left`, media queries |
| `:focus-visible` on its own | 86 | nothing: focus styling is global (`base.css`) |
| `position: sticky` without `-webkit-sticky` | fine from 56 | include both, as `shell.css` does |

- Breakpoints: phone below 720px, tablet from 720px, laptop from 1100px (`@media (min-width: 720px)`, `(min-width: 1100px)`). Design widths are 390, 800 and 1440. **Lay every screen out to work at 320px wide**, the width of the cheapest phones (480×854 at 1.5×): the boards are drawn at 390 only. The shell handles its own part: below 376px the header row is tightened, below 360px the logo in the one-row header is hidden (Home is beside it) and the language switch drops under the Listen button. Helpers: `.sb-phone-only`, `.sb-from-tablet`, `.sb-grid` (1 / 2 / 3 columns), `.sb-container`.
- Movement is opt-in: put every animation and transition inside `@media (prefers-reduced-motion: no-preference) { … }`. Browsers that cannot answer that query (Chrome before 74) then get the still version, which is the safe one.
- Text never below 16px; touch targets at least 48px; do not use `font-weight: 500` (not shipped).

### 3.8 JavaScript rules

- The build compiles syntax for Chrome 58 and adds the core-js polyfills your code needs, so modern **syntax** and standard **library** features (`Promise.finally`, `Array.prototype.flat`, `Object.entries` …) are fine. ESLint blocks the common ones that are not polyfilled or easy to miss (`String.replaceAll`, `.at()`, `Object.fromEntries`, `structuredClone`, `ResizeObserver`).
- **Browser APIs are not polyfilled.** Check before use: `AbortController` (Chrome 66; `useApi` already copes), `IntersectionObserver` (51, fine), `ResizeObserver` (64), `navigator.share`, `MediaRecorder`, `getUserMedia` (needs a secure context, section 10).
- No new dependencies without stream 1 (`docs/TEAM.md`). Runtime dependencies today: `react`, `react-dom`. That is all.
- No `console.log` in committed code; clean up timers, listeners and object URLs in effect clean-ups.
- Lint is strict: warnings fail it (`--max-warnings 0`); `react-hooks/exhaustive-deps` is an error and also checks `useApi`; shared code may not import a feature; features may not import each other, the app shell or the mock. Not checked (it needs type-aware lint, which is not set up): a promise nobody handles. Handle or `void` every promise by hand.

### 3.9 Tests

`*.test.ts(x)` next to the code. `installMockApi()` from `@mock/installMockFetch` gives a fresh seeded API per test with no network. Example: `src/app/App.test.tsx`.

## 4. Browser target and build

**Floor: Chrome / Android WebView 58.** Android 8.0 shipped with WebView 58–60, and a phone that only ever joins the bag's offline Wi-Fi never updates it. The handoff names Android 8 as the tested floor without a browser version, so the build assumes the oldest plausible one. Also covered: Firefox 60+, Safari 11+, Edge 16+ (old laptops).

| Decision | Choice |
|---|---|
| Build | **One build for every device**, in SystemJS format, compiled for the floor with only the polyfills the code uses (`@vitejs/plugin-legacy`, `renderModernChunks: false`). Code splitting and lazy routes work the same on every device. |
| Why not a modern build + a legacy build | `plugin-legacy` 8 only treats Chrome 105+, Safari 16.4+ and Firefox 106+ as modern (it tests for `import.meta.resolve`). With both builds, every browser between Chrome 61 and 104 (likely most of this fleet) downloads the modern entry, rejects it, and then downloads the legacy one too. Measured: 54.6 KB gzip of wasted JavaScript on those devices, 149 KB in total instead of 94 KB. The dual build also needs `data:` in the CSP's `script-src`. |
| Why not modules only (no legacy) | `<script type="module">` needs Chrome 61 and dynamic `import()` Chrome 63: an un-updated Android 8.0 phone would get a blank page. |
| Cost of the single build | Devices with a current browser download about 39 KB gzip more JavaScript than they strictly need (94.0 KB instead of about 55 KB) and run transpiled code. They are the devices that can best afford it. |
| CSS delivery | In this mode Vite puts each chunk's CSS inside the chunk and adds it with a `<style>` element; there is no `.css` file. Consequences: CSS is code-split with the features for free; nothing is painted unstyled, because the app only renders after the same script has added the styles; and the CSP must allow inline styles (`style-src 'self' 'unsafe-inline'`). Scripts stay strict. |
| CSS syntax target | `build.cssTarget: chrome58 / safari11 / firefox60`, so the minifier never emits newer syntax. |
| Start-up | `index.html` shows "Opening Sensebod…" at once, preloads the two fonts every screen needs and the entry chunk (added by `scripts/postbuild.mjs`), then loads polyfills + entry. |
| Source maps | Not built (would double the upload to the Pi; nobody debugs on the Pi). |

Verified on the Mac: the built app runs in current Chrome (headless, 157) and in an archived Chromium 58.0.3029 desktop build (section 13). Two headers were adjusted because of what Chromium 58 reported: `Referrer-Policy` now sends `no-referrer, same-origin` (58 does not know `same-origin` and falls back to the first value), and `worker-src` was dropped from the CSP (behind a flag in 58; the app has no workers).

## 5. Dependencies

Runtime (shipped to devices): **2**.

| Package | Version | gzip cost (measured) | Why | Rejected alternatives |
|---|---|---|---|---|
| `react` + `react-dom` | 18.3.1 | 45.6 KB | The team builds in React. 18.3.1 rather than 19: 19.3.1 measured **68.9 KB** for the same code (+23 KB) and offers nothing this app needs. | Preact compat: 6.8 KB, would save about 39 KB. Not chosen: four engineers building in parallel on a compatibility layer, on browsers nobody can test yet, is the bigger risk. It remains a realistic later optimisation because the app uses plain React APIs only. |
| router | own code, `shared/router` | 1.2 KB | Needs: path params, links, lazy screens. | `react-router` 8: **+14.4 KB**. `wouter` 3: **+2.3 KB**, and one more dependency for 150 lines of code. |
| state management | none | 0 | `useState` + two tiny stores on `useSyncExternalStore` (location, session). | Redux, Zustand, React Query: no need at this size. |
| styling | plain CSS + custom properties | 5.0 KB (all shared CSS) | Works on Chrome 49+, no runtime. | Tailwind (build complexity, class soup against inline-style boards), CSS-in-JS (runtime cost on weak phones). |
| icons | 58 inline SVG components | 2.8 KB if all are used | Tree-shaken per icon. | Any icon package or font. |

Sizes above are for the modules on their own (esbuild, minified, gzip -9). Shared code in total, excluding React: router 1.2, API 3.1, components 7.1, shell 3.5, session 0.7, icons 2.8 KB gzip.

Build-time only (never shipped): `vite` 8.3.8, `@vitejs/plugin-react` (fast refresh in dev), `@vitejs/plugin-legacy` + `terser` (the floor build), `typescript` 6.0.3, `eslint` 9 + `typescript-eslint` + `eslint-plugin-react-hooks` + `globals` + `@eslint/js`, `vitest` 3.2.7 + `jsdom` + `@testing-library/react` + `@testing-library/jest-dom`, `@types/*`. Versions are pinned exactly (`.npmrc save-exact`) with a lock file.

Two notes on tooling versions: Node 23.10 on this Mac is an odd-numbered release that the newest Vitest, jsdom, ESLint 10 and TypeScript 7 no longer accept, so npm resolved the newest versions that do. `npm audit` reports 0 problems in runtime dependencies and 10 in development tools (Vitest 3's own older Vite and `tinypool`, and `minimatch` under typescript-eslint); none of that code reaches the build output. Moving the build machine to Node 24 LTS and then to Vitest 5 clears them.

## 6. Design tokens, theme and fonts

- `shared/styles/tokens.css` holds every value from `brand/tokens.json` and the V3-Components board as CSS custom properties, in two layers: the raw palette (`--sb-blue`, `--sb-green`, `--sb-gold`, `--sb-red` …) and theme roles (`--sb-accent`, `--sb-accent-pressed`, `--sb-accent-text`, `--sb-accent-strong`, `--sb-accent-tint`, `--sb-edge`, `--sb-page`, `--sb-divider`, `--sb-focus`).
- **Agriculture theme**: any element with `data-theme="agriculture"` re-points the roles to green (`#1F7A3A`, text `#145A28`, tint `#E6F2E9`, card edge `#4A8F5C`, page `#F3F8F4`). `<PageShell theme="agriculture">` sets it for a screen; `<Card theme="agriculture">` for one card (the green portal card on the blue Home). Gold stays Listen-only and red stays wrong / error / remove / urgent help in both themes.
- Approach: plain CSS custom properties. They work from Chrome 49, cost nothing at run time and need no build step. Rejected: Sass variables (no run-time theming), CSS-in-JS, `color-mix()`-derived shades (not on the floor; every shade is a fixed token).
- **Fonts** (`shared/fonts`, details in its README): Poppins 400, 600, 700, 800 as WOFF2, subset to Basic Latin, Latin-1 and typographic punctuation (199 code points), 7.0–7.2 KB each. `font-display: swap`, fallback `Arial, sans-serif`: text shows at once in the fallback. 400 and 800 are preloaded.
- **Krio letters.** Poppins has **no glyphs for ɛ, ɔ, ŋ** (nor Ɛ, Ɔ, Ŋ): checked with fontTools in the latin, latin-ext and devanagari files. "Kushɛ!" would otherwise be drawn partly in whatever font the phone has. Four 1.2 KB files supply exactly those six letters from Montserrat (SIL OFL, close proportions), declared under the same family with a `unicode-range`, so they are downloaded only on a page that shows one of the letters. Verified in the kitchen sink: all six render at all four weights. This is a substitution, not Poppins; a designer should confirm it or commission the glyphs.
- Not in the font files and drawn by the fallback: `→`, `◆` and letters beyond Latin-1. The boards use `→` and `◆` in a few sentences; prefer the icons.

## 7. Component catalogue

All from `@shared/components` unless noted. Each maps to a section of the V3-Components board. Props are documented in the source.

### Buttons — "Buttons · 64–72px tall, icon and words"

```tsx
<Button size="lg" icon={<IconSave size={32} />} onClick={save}>Save and start learning</Button>
<Button size="lg" working workingLabel="Saving your name…">Save and start learning</Button>   // spinner, aria-busy, ignores taps
<Button size="lg" notReady icon={<IconPencil size={30} />}>Type your name first</Button>     // dashed grey, disabled
<Button variant="secondary" icon={<IconSkip size={30} />}>Skip — learn as a guest</Button>
<Button variant="danger" icon={<IconTrash size={30} />}>Remove Aminata’s name</Button>
<Button variant="danger-outline" icon={<IconTryAgain size={30} />}>Try again</Button>
<Button variant="success" icon={<IconArrowRight size={30} />}>Next question</Button>
<Button stacked variant="secondary" icon={<IconBack10 size={42} />}>Back 10s</Button>         // icon above the word
<ButtonLink to={paths.portal('agriculture')} fullWidth icon={<IconBack size={28} />}>Back to Agriculture</ButtonLink>
```

| Prop | Values |
|---|---|
| `variant` | `primary` (default; blue, green on Agriculture) · `secondary` (outlined) · `listen` (gold; use `ListenButton`) · `danger` · `danger-outline` · `success` · `exit` (quick exit) |
| `size` | `lg` 72px · `md` 64px (default) · `sm` 56px |
| states | pressed (darker fill + inset edge, automatic) · keyboard focus (4px ring, automatic) · `working` · `notReady` / `disabled` |
| other | `icon`, `iconAfter`, `fullWidth`, `stacked` |

`Button` is a `<button type="button">`. `ButtonLink` looks the same and navigates. `ButtonLook` is the look only, for cards that are one link.

### Cards — "Portal card", "Topic card · 4 states", "Card anatomy"

```tsx
<PortalCard to={paths.portal(p.id)} title={p.title} description={p.description} picture={p.picture}
            icon={<IconPortalPrimary size={40} />} theme={p.theme} />

<TopicCard to={paths.group('agriculture', g.id)} title="Chickens and quail" picture={g.picture}
           icon={<MyHenIcon size={32} />} state="started" done={1} total={5}
           tag={<TagLine type="watch" detail="12 videos" />} />
<TopicCard state="not-in-bag" title="Crops" detail="Not in this bag yet. Ask your facilitator." icon={…} picture={…} />

<LessonCard lesson={lesson} to={paths.lesson(lesson.id)} state="started" current />

<Card tappable> … your own content … </Card>      // base card; props: to, tappable, current, frame, unavailable, large, theme
<Badge size="lg" overlap><IconPortalClimate size={40} /></Badge>
<ScenePicture picture={picture} shape="header" eager />
```

- Edge contrast: a card that can be tapped gets the 2px `--sb-edge` border (`#5B8FCC`, 3.13:1 on the page; green `#4A8F5C`, 3.64:1). A card that cannot be tapped keeps the faint divider edge. `current` = 3px accent. `unavailable` = dashed `#6B7C93`, never a link.
- `LessonCard` always renders the anatomy in the same order: picture, type badge, tag line ("Watch · Lesson 4"), "You take part" pill, state chip, title, facts row, main button. It is drawn entirely from the lesson's data tag. The card is one link; the button inside is a look, not a second control. A finished lesson gets the outlined button, as on CPB-Child.
- `TopicCard` states: `started` (words + bar), `not-started`, `finished`, `not-in-bag`. Optional `facts` draws a row under the detail line (AGB-Agriculture "Needs sound"); the card is one link, so pass spans: `facts={<span className="sb-facts"><span className="sb-facts__item">Needs sound</span></span>}`.
- `PortalCard` says "Open" in its pill; `actionLabel="This is me"` changes the words (CPB-Who).
- `FactsRow` is a list (`<ul>`) on its own and plain spans with `inline` (inside a link, as `LessonCard` uses it).
- A card that is not in the bag has no `aria-disabled` (it means nothing on a plain `<div>`); its words say so. To find one in a test use the words or the class `sb-card--unavailable`.
- A picture that fails to load is taken out, so the card keeps its tint; its alt text stays for screen readers.

### Lesson types — "Lesson types · tag by what the learner does"

```tsx
<LessonTypeBadge type="listen" overlap />          // round badge on the picture edge
<TagLine type="watch" detail="Lesson 4" />         // Watch · Lesson 4
<YouTakePart />                                     // modifier pill
<StateChip state="finished" />                      // not-started | started | finished | not-in-bag
<FactsRow tag={lesson} />                           // [length] · Needs sound · Captions · Read along · [pages] pages
<LessonHeaderPill type={lesson.type} detail={lessonPositionLabel(lesson)} />   // Lesson 1 · Watch
<LessonTypeIcon type="try" size={28} />
lessonActionLabel(lesson)   // "Watch video" | "Watch and answer" | "Play audio" | "Read" | "Start" | "Start the quiz"
formatLength(102)           // "1:42";  formatLength(null) → "[length]"
LESSON_TYPES[type]          // { label, action, Icon }
```

The five type icons are the bold 3px-stroke drawings from the board (`IconWatch`, `IconHeadphones`, `IconRead`, `IconTryIt`, `IconCheckQuiz`) and always appear with their word.

### Lesson filter — "Filter · above every lesson list"

```tsx
const [filter, setFilter] = useState<LessonFilterValue>('all');
<LessonFilter value={filter} onChange={setFilter} />
{filterLessons(series.lessons, filter).map(…)}     // the Check quiz always stays, last
```

All · Watch · Listen · Read · Try it. Phone: two rows (3 + 2), nothing hidden. Tablet and laptop: one row. Selected = filled + `aria-pressed`.

### Progress — "Progress · words first"

```tsx
<Progress done={1} total={5} />                                    // "1 of 5 done" + bar
<ProgressSteps states={['finished','started','not-started','not-started']} label="Lesson 1 finished. Lesson 2 started. …" />
<p>{summariseStates(states)}</p>                                   // "1 finished · 1 started · 2 to go"
```

### Messages and states — "Messages"

```tsx
<LoadingState label="Opening the lesson…" />
<ErrorState title="This video did not open" error={error} onRetry={reload} />     // role="alert", red, Try again; `retrying` shows the button busy
<EmptyState action={<ButtonLink to={…} fullWidth>Back to Agriculture</ButtonLink>}>Crops videos are not in this bag. Ask your facilitator.</EmptyState>
<SuccessState>Your progress is saved in this bag, Aminata.</SuccessState>
<Message tone="info" title="Good to know">Videos never play by themselves.</Message>   // tone: success | info | empty | error
<InfoStrip />                                                        // "Everything here is in this bag. No internet needed."
```

### Forms and chips

```tsx
<TextField label="Your name" placeholder="Type your name" value={name} onChange={…} error={problem} autoComplete="given-name" />
<TextArea label="Lesson text" … />
<ChoiceGroup label="Who are you?" value={who} onChange={setWho} chosenNote="Chosen"
             options={[{ value: 'learner', label: 'Learner', mark: <IconPortalJss size={28} /> }, …]} />   // also quiz answers: mark defaults to A, B, C
<ChoiceLink to={…} label="Aminata Kamara" detail="Learner · JSS 2" mark="A" />        // name rows
<PersonChip name="Aminata" changeTo={paths.saveProgress()}>Learning as <strong>Aminata</strong></PersonChip>
<LanguageSwitch />
```

`ChoiceGroup` is a radio group in which every row is its own tab stop (touch, TalkBack and Tab reach each one); on a keyboard the arrow keys also move to and choose the next or previous row.

### Icons (`@shared/icons`)

58 icons, redrawn from the boards with the same path data, 24px grid, 3px round stroke, coloured by `currentColor`. Hidden from screen readers unless given a `title` (they always sit beside a word). See them all at `/__dev`.

Navigation: `IconBack` `IconHome` `IconArrowRight` `IconChevronRight` `IconLeave` `IconSkip` `IconGrid` `IconClose` `IconPlus`. Media: `IconListen` `IconSound` `IconPlay` `IconPause` `IconBack10` `IconForward10` `IconCaptions` `IconFullScreen` `IconReplay` `IconNext`. Lesson types: `IconWatch` `IconHeadphones` `IconRead` `IconTryIt` `IconCheckQuiz` `IconAll`. State: `IconTick` `IconNotStarted` `IconClock` `IconFinished` `IconInfo` `IconInfoMark` `IconTryAgain` `IconError` `IconSpinner` `IconBag` `IconBagTick` `IconQuestion` `IconStar` `IconHeart` `IconLock`. Actions: `IconSave` `IconPencil` `IconTrash` `IconUpload` `IconHelp`. People: `IconPerson` `IconPersonAdd` `IconLanguage`. Portals: `IconPortalPrimary` `IconPortalJss` `IconPortalChildProtection` `IconPortalAgriculture` `IconPortalClimate`. Upload sources: `IconVideoFile` `IconMicrophone` `IconDocument` `IconAnimationPackage` `IconCamera`.

A screen-specific icon (a topic's hen, a rabbit) belongs in the feature, built on the base: `<Icon size={32}><path d="…" /></Icon>`.

### Page shell (`@shared/shell`)

```tsx
<PageShell title="Staying safe" backTo={paths.portal('child-protection')} quickExit listenSrc={series.listenUrl}>
  <h1 className="sb-h1">Staying safe</h1>
  <ListenBar src={series.listenUrl} />        {/* phones: Listen + language under the title, as on the boards */}
  …
</PageShell>

<PageShell title="Agriculture" theme="agriculture" backTo={paths.home()} listenSrc={portal.listenUrl}> … </PageShell>
<PageShell title="Home" variant="home" listenSrc={null}> … </PageShell>
```

| Prop | Effect |
|---|---|
| `title` | Browser title ("… · Sensebod") |
| `variant="home"` | Logo + language switch only |
| `backTo` | Where Back goes: always the parent screen, stated by the page (predictable, and correct after a deep link or refresh) |
| `quickExit` | Child protection: adds **Leave this page** and keeps the header on screen while scrolling |
| `theme="agriculture"` | Green accent and `#F3F8F4` page |
| `listenSrc` | `string` or `null`: shows Listen (and the language switch) in the header from tablet width; `undefined`: no Listen in the header |
| `noFooter`, `flush` | Hide the EasySTEM footer; let content run edge to edge |

- Layouts follow the boards: phone Child protection = logo + Leave this page, then Back + Home (CPB-Child); tablet = logo, language, Leave this page, then Back, Home, Listen (CPB-Child-Tab); other portals = Back, Home, logo in one row (AGB-Agriculture).
- **Leave this page** goes Home with `replace`, so one press of the browser's Back does not return to the page; it also stops any narration and clears the remembered audience choice. It cannot erase earlier history entries (no web page can).
- **Listen** plays a recording from the bag (`listenUrl`), one at a time, never by itself; tap again to stop. With no recording it says "No sound here yet". There is no speech synthesis: it is unreliable offline on old Android and does not speak Krio.
- Accessibility built in: skip link, `<header>` / `<nav aria-label="Go back">` / `<main>` / `<footer>` landmarks, focus moved to `<main>` after navigation, 4px focus ring with 4px offset on every control (keyboard only where the browser can tell; always on older ones).

## 8. Data layer

- `shared/api/types.ts` is the contract in TypeScript. `docs/API-CONTRACT.md` explains behaviour.
- `shared/api/client.ts`: relative base path `/api/v1`; 15 s timeout; cancellation through `AbortSignal` with a fallback where `AbortController` does not exist; one `ApiError` type (`kind`: `network`, `timeout`, `aborted`, `http`, `parse`) with plain-language messages; identical GETs in flight are shared only when the caller passes no `signal` (a request made through `useApi` always has its own signal and is never shared: cancelling one screen's request must not cancel another's); content GETs are reused for 60 s in a cache capped at 40 entries, cleared by any admin write or upload and left alone by learner and progress writes (they do not change content); cached answers are shared objects and must be treated as read-only; **no automatic retries or polling**, so twenty tablets cannot hammer a struggling Pi. One `Idempotency-Key` per submission on creating POSTs (`submitOnce`, section 3.4). Uploads use `XMLHttpRequest` for progress, one file per request, raw body.
- The mock (`app/mock`) is wired into the dev and preview servers by `build/mockApiPlugin.ts`, on the Node side: the browser bundle contains no mock code at all. `src/` may not import it (ESLint), and the build fails if mock markers appear in `dist/`.

## 9. Illustration pipeline

| | |
|---|---|
| Source | `illustrations/<portal>/<cast\|scenes>/<name>.svg`, 109 files, unchanged |
| Dev and preview | served from that folder at `/illustrations/…` by `build/illustrationsPlugin.ts` |
| Build | copied byte for byte to `dist/illustrations/…` |
| URL | `/illustrations/<portal>/<cast\|scenes>/<name>.svg?v=<hash of the whole folder>`; the hash is set at build time, so the Pi can cache for a year and a changed drawing is still picked up after a deploy |
| Loading | as `<img>` by URL, lazily: `loading="lazy"` where it exists (Chrome 77+), `IntersectionObserver` before that, eager as the last resort; never inlined into JavaScript |
| Compression | each file has a `.gz` twin; the Pi sends it with `gzip_static` |

Sizes (measured):

| Folder | Files | Raw | gzip |
|---|---|---|---|
| child-protection/cast | 17 | 227 KB | 48 KB |
| child-protection/scenes | 49 | 1418 KB | 251 KB |
| climate/cast | 8 | 85 KB | 19 KB |
| climate/scenes | 12 | 292 KB | 53 KB |
| agriculture/cast | 8 | 71 KB | 15 KB |
| agriculture/scenes | 15 | 351 KB | 58 KB |
| **Total** | **109** | **2443 KB** | **444 KB** |

Median file 21 KB raw (about 4 KB gzip); largest `CPB-TryIt-village.svg`, 76 KB raw.

**Is SVGO worthwhile?** Measured on a copy with safe settings (viewBox, ids, role and aria kept): raw 2443 → 1851 KB (−24%), but gzip only 444 → 372 KB (−16%), about 0.7 KB per picture on the wire; the climate scenes came out *larger* after gzip (53 → 62 KB). Verdict: **not applied.** The transfer saving is small, and path rounding can change how a face looks, which the handoff forbids. If it is done later: per folder, with a visual diff of every file, and skip any folder that does not shrink after gzip.

Three things to know when using the drawings as `<img>`:

1. Internal ids cannot clash any more (each file is its own document), which the boards had to work around by prefixing.
2. 25 SVGs contain small text (sign boards such as "[ Clinic ]", "Milk centre") set in Poppins. An SVG loaded as an image cannot use the page's web fonts, so that text is drawn in the device's own sans-serif. It is placeholder sign text today.
3. The ten `…-Tab-…` scenes are near copies of the phone scenes. They cost nothing unless requested; prefer the phone file at both sizes unless the crop really differs.

The five flat portal pictures of the Home board exist only inside `Main.dc.html`; they were extracted unchanged to `app/public/pictures/portals/<portalId>.svg` (9 KB in total). Logos: `brand/` PNGs resized to 96px height and palette-reduced for the web (`sensebod-logo.png` 59 KB → 6.8 KB, `easystem-logo.png` 22 KB → 2.9 KB) in `app/public/brand/`. The originals in `brand/` are untouched.

## 10. Offline position: Mode A, not Mode B

**Mode A (local-network operation) is the baseline and the only mode built.** Every byte comes from the Pi; the app needs the bag's Wi-Fi but no internet.

**Mode B (a tablet that keeps working away from the Pi) is not built**, deliberately:

- The handoff does not ask for it. The product is "join the bag's Wi-Fi and open the site"; lessons are videos and audio that live on the Pi and are far too large to keep on a phone.
- It needs a service worker, and **service workers only run in a secure context.** `http://192.168.x.x` or `http://sensebod.local` is not one. Making it one means HTTPS on the Pi with a certificate every phone trusts: either a public certificate for a real domain that resolves to the Pi on the bag's network (and is renewed with internet access every 90 days), or installing a private root certificate on every phone, which is not realistic for learners' own devices.
- Cached shells also create a stale-version problem on shared phones that the simple model avoids: here, `index.html` is never cached without asking, so a phone gets an update the next time it opens the site.

What Mode A already handles: a dropped connection shows "This phone cannot reach the bag. Check you are on the bag's Wi-Fi, then try again." with a **Try again** button (verified in headless Chrome by cutting the network after load and restoring it); screens already open keep working; a failed code download shows a recovery screen instead of a blank page; requests time out after 15 s.

**Recovery after a failed code download.** In this build the module loader (SystemJS) keeps a failed chunk for the life of the page: asking for it again fails at once, with no new request (measured in the production build: rejected after 1 ms, 0 requests). Only a fresh page load clears it, and a page load while the bag is out of reach would replace the app with the browser's own error page. So: (1) every way out of the "This page did not open" screen (Try again, Go to Home, Back, Home, the logo) is a fresh page load, made only after the bag has answered one small request (`GET /?reach=<time>`, `cache: no-store`, 10 s limit); while the bag does not answer, the learner stays on the Sensebod screen and reads "This phone cannot reach the bag…"; (2) screens made with `lazyScreen` ask again on the next visit, and when that fails too they do the same checked page load by themselves, once. Nothing retries in a loop. Code: `shared/router/recover.ts`, `shared/router/lazyScreen.tsx`, `app/App.tsx`. The static server must answer `/?reach=…` like `/` (both deploy configs do).

**The same secure-context limit affects other features. Stream 4 in particular:**

| Feature | On plain HTTP | Use instead |
|---|---|---|
| Record your voice in the page (`getUserMedia`, `MediaRecorder`) | **Blocked** | `<input type="file" accept="audio/*" capture>`: opens the phone's own recorder and returns a file |
| Take a photo of notes in the page | **Blocked** for a live camera view | `<input type="file" accept="image/*" capture="environment">` |
| Clipboard API, Web Share, persistent storage, notifications | Blocked or limited | Not needed |
| `localStorage`, `fetch`, `<video>`, `<audio>`, file inputs, History API | Work | |

If Mode B is ever wanted, the first step is an HTTPS origin for the bag; a precache of the shell would then be a small addition. Until then, do not add service-worker or sync code.

## 11. Performance budgets

Measured on this build (`npm run size`; gzip level 9, as served by `gzip_static`):

| Budget | Limit | Now | Notes |
|---|---|---|---|
| Start JavaScript (polyfills + entry), gzip | 200 KB | **99.0 KB** | 37.6 KB polyfills + SystemJS, 61.4 KB React + all shared code + all shared CSS (94.0 at the first build, 97.6 after stream 2 merged, 99.0 after fix round 1) |
| Critical resources for the first screen, gzip | 350 KB | **120.2 KB** | index.html 0.7 + start JS 99.0 + fonts 400 and 800 13.8 + logo 6.6 |
| CSS | (inside the JS) | 5.0 KB gzip, 23.6 KB raw | shared styles; measured from a split build |
| Any lazy feature chunk, gzip | 60 KB | 1.0 KB (stubs) | **budget for streams 2–4**: keep each screen chunk under 60 KB |
| Fonts, all 8 files | — | 32.4 KB | 4 × Poppins (28.4) + 4 × Krio letters (4.8); WOFF2 is already compressed |
| Requests for the first screen (cold) | 25 | 17 | Home with 5 portal pictures, in headless Chrome through nginx |
| Illustrations per screen | 300 KB gzip | n/a | a lesson list of 5 scenes is about 30 KB gzip; lazy below the fold |
| `dist/` on disk | — | 3.9 MB | of which illustrations 3.4 MB (with their .gz twins) |

`npm run size` exits with an error when a limit is exceeded. It counts as start JavaScript the two scripts in `index.html` and every chunk the entry needs before it can run, so a start bundle that the bundler splits in two is counted in full. That split happens when `src/app` imports the `@shared/api` barrel (lint forbids it there: import `@shared/api/client` instead); it costs one more request before the first screen. Budgets not yet measurable here, to be set on real hardware: cold and warm start time, time to a usable screen, interaction latency, memory during a long session, main-thread blocking, behaviour with many phones at once.

Rules that keep it small: features are lazy; pictures are lazy and served by URL; no data is fetched until a screen needs it; no polling; media is never preloaded (`preload="none"` and no autoplay are the rule for the players).

## 12. Deploying to the Pi

Example configs in `app/deploy/`: **`nginx.conf`** (recommended: smallest memory use, standard on Raspberry Pi OS) with `security-headers.conf`, and an equivalent **`Caddyfile`**.

What the config does:

| Need | How |
|---|---|
| Direct links and refresh | `try_files $uri /index.html` for app paths; **`/assets/` and `/illustrations/` return 404 for a missing file**, never the shell |
| Compression | `gzip_static on`: the build ships `.gz` twins (121 files), so the Pi spends no CPU compressing; `gzip on` only for API JSON. No Brotli: browsers accept it only over HTTPS |
| Hashed assets | `/assets/*`, `/illustrations/*?v=…`: `Cache-Control: public, max-age=31536000, immutable` |
| The shell | `index.html` and every app path: `Cache-Control: no-cache` (one small conditional request; 304 when unchanged) |
| Unhashed files | `/brand/`, `/pictures/`, favicon: `no-cache` (304s) |
| Security headers | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` on every response |
| Media | `/media/` from `/var/lib/sensebod/media/`: byte ranges (206) for seeking and streaming, no gzip, per-connection rate limit after the first 2 MB so one phone cannot starve a class |
| Animation packages | `/media/tryit/`: own CSP with `sandbox allow-scripts`, no network access; show them in `<iframe sandbox="allow-scripts">` |
| API | `/api/` proxied to the backend on `127.0.0.1:8000`, uploads streamed (`proxy_request_buffering off`), `no-store`; a JSON 503 in the API's error shape while the backend is down |

The CSP: `default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`. The one hash covers the single inline line in `index.html` that starts the entry chunk; `npm run build` fails if that line ever stops matching the hash in both config files. `style-src 'unsafe-inline'` is explained in section 4. There is no HSTS because there is no HTTPS.

**Verified in a container** (nginx 1.22.1, the version in Raspberry Pi OS 12, on linux/arm64; not on a Pi): config test passes; deep link returns the shell; missing asset 404; `.gz` served with `Content-Encoding: gzip`; cache headers as above; `Range: bytes=1000-1999` → `206` with `Content-Range`; `<video>` seeks; the sandboxed package loads in an isolated origin; 503 JSON when the backend is down; conditional request → 304; the app runs under the CSP with no violations in the console. The Caddyfile was written to match and **has not been run**.

### Build and release

```bash
# on a machine with internet (not the Pi)
cd app && npm ci && npm run build && npm run size
tar -C dist -czf sensebod-$(date +%Y%m%d-%H%M).tgz .

# on the Pi (copy the archive over the bag's Wi-Fi or on a USB stick)
REL=/var/www/sensebod/releases/20261112-1030
sudo mkdir -p $REL && sudo tar -C $REL -xzf sensebod-20261112-1030.tgz
sudo ln -sfn $REL /var/www/sensebod/current.new && sudo mv -T /var/www/sensebod/current.new /var/www/sensebod/current   # atomic switch
```

- No Node on the Pi, no build on the Pi, no process to keep alive: nginx serves files.
- **Update**: unpack a new release folder, switch the symlink. Phones get the new `index.html` on their next page load (it is never cached without asking); it points at new hashed files. Keep the previous release folder for a while: a phone with the old shell still open can then still load the old chunks. If a chunk is gone anyway, the app shows "This page did not open" with **Try again**, which reloads into the new version.
- **Rollback**: point `current` back at the previous release folder.
- **Environment**: none needed. `VITE_API_BASE` (build time) only if the API is not at `/api/v1` on the same origin.
- **First install**: see the comment at the top of `deploy/nginx.conf`.
- **Troubleshooting**: blank page on an old phone → open `/assets/` requests in the nginx log; a 404 there means a stale shell or an incomplete copy. Fonts or pictures missing → check `mime.types` has `font/woff2` and `image/svg+xml` (the example config sets both). "Cannot reach the bag" → the API is down; `curl -i localhost/api/v1/portals` on the Pi. Video will not seek → check the response is `206` and the file was encoded with the index at the front ("fast start").

## 13. Compatibility matrix and what is not tested

| Target | Status |
|---|---|
| Chrome 157 (headless, macOS) at 390 / 800 / 1440 | **Tested**: dev server, production build via `vite preview`, production build via nginx with CSP |
| Chrome / WebView 58–104 on Android | **Not tested on any device.** Build is compiled and polyfilled for Chrome 58; CSS avoids everything newer than the floor by rule |
| Chromium 58.0.3029 (desktop Linux build, x86-64 emulated in a container, through nginx with the CSP) | **Tested, floor engine**: Home with portals from the API, deep link, refresh, in-app navigation, Agriculture theme, pictures loaded through the `IntersectionObserver` path, Poppins loaded, no script errors. In that browser: no ES modules, no `AbortController`, no flex `gap`, no native lazy loading, so the fallbacks are the paths that ran. It is the same Blink version as Android WebView 58 but **not Android**: touch, the virtual keyboard, media codecs, memory and speed are untested |
| Firefox 60+, Safari 11+, Edge 16+ | Compiled for; **not tested** |
| Raspberry Pi 4 / 5 with nginx | **Not tested.** Config verified in an arm64 container only |
| Physical Android 8 phone or tablet | **Not tested** |

Still to do on real hardware (nothing below may be assumed to pass):

1. Load the app on the oldest real phone; record device, Android version, browser version, RAM, screen.
2. Fonts (including the Krio letters), SVG rendering quality and speed of the large scenes, sticky header, grid layouts, focus rings, virtual keyboard over the name field.
3. Cold and warm start times, scrolling a 27-lesson list, memory after a long session.
4. Video and audio playback and seeking (codec support depends on the phone; H.264 Baseline + AAC is the safe choice), captions.
5. Whether `<input capture>` opens the camera and recorder on those phones.
6. Twenty devices at once on the bag's Wi-Fi; Pi CPU with `gzip_static`; the media rate limit value.
7. Wi-Fi drop and recovery, Pi restart, power cut, update while phones have the app open.
8. The Android WebView (if the site is ever opened inside an app) as well as Chrome.

## 14. Security notes

- No secrets in the client; the admin session is an HttpOnly cookie owned by the backend. Client-side checks are for convenience only: the backend must enforce authorisation on every `/admin` call.
- The CSP blocks any script, connection, frame or form target outside the bag. Uploaded animation packages run in a sandboxed frame with no network access and no access to the app's origin.
- Personal data kept on a phone: up to 8 learner names and ids, the language, and the Child protection audience choice (cleared by "Leave this page"). No progress, no passwords.
- Shared phones: anyone holding the phone can tap a stored name. That is the product's stated trade-off (no passwords); "Remove a name" exists for it.
- The bag's Wi-Fi is plain HTTP: anyone on that Wi-Fi could read traffic, including the admin password at sign-in. Raising this needs HTTPS on the Pi (see section 10). This is an infrastructure decision to record, not something the frontend can fix.
