# Reviewer B — Edge verification (final pass)

12 Nov 2026. Scope: the whole app on `main` at `9339fbd` (foundation, learner browsing, lesson players, admin, fix round 1), within Reviewer B's focus: dependencies, bundle, offline compliance, fonts and assets, performance and resource use, legacy compatibility, security, build and deployment. React, hooks, TypeScript, CSS architecture, accessibility, design fidelity and test quality are Reviewer A's and are marked so below.

Everything was measured on the development Mac (macOS, Node 23.10, headless Chrome 157) against the production build served by the **committed** `app/deploy/nginx.conf` (Debian 12 `nginx-light` 1.22.1, linux/arm64 container) and the **committed** `app/deploy/Caddyfile` (Caddy 2.11.9 container), with the mock API behind them. **No Raspberry Pi, no physical Android device and no Chrome 58 browser were used by this reviewer.** Containers and device emulation are not hardware.

All evidence is in `docs/reviews/evidence/b/` (scripts and their logs). File names in the text below refer to that folder.

## A. Executive summary

**Release decision within Reviewer B's focus: INSUFFICIENT EVIDENCE**, with two High findings that must be fixed and re-verified first (section 23 wording: a mandatory compatibility requirement is unverified, so PASS WITH CONDITIONS is not available; nothing found is Critical, so it is not a FAIL of the application code).

Why:

1. **Compatibility with the floor is unverified for three of the four features.** Only the foundation stubs were ever run in Chromium 58 (by stream 1). Streams 2, 3 and 4 say they did not run it, and I did not obtain an old Chromium build in this pass. What I could establish statically is good: all 37 built scripts parse as ES2017 or lower, the embedded CSS contains none of the banned features, and the polyfill chunk is present. That is not a browser run. No Android device and no Pi exist for anyone.
2. **Two deployment-config defects (both stream 1, both small to fix):**
   - **B-01 (High)**: under the Caddyfile, animation packages are served with the app's CSP instead of the sandbox policy. Packages with inline scripts do not run, and a package opened by its own address runs in the app's origin with access to its storage and the API. The nginx config is correct.
   - **B-02 (High)**: both configs send `Cache-Control: public, max-age=31536000, immutable` on **404** answers under `/assets/` and `/illustrations/`. A phone that asks for a chunk while it is missing (an update followed by a roll-back, or a copy that is not atomic) keeps the 404 for a year; lessons then never open on that phone, and the app's recovery (reload) cannot fix it.

What is solid (verified here, not taken from the reports):

- **Offline compliance: pass.** 570 requests recorded across the learner, lesson and admin journeys on both servers, in a browser whose DNS resolves loopback only: 0 to another origin, 0 CSP violations, 0 script exceptions. The only URLs in `dist/` are XML namespaces and strings inside React and core-js.
- **Start weight: pass.** 101.5 KB gzip start JavaScript in 2 files, 122.6 KB critical resources; cold Home is 20 requests and 162 KB on the wire including headers.
- **Media: pass.** No `/media/` request before Play on any lesson type, `preload="none"`, no `src` until Play, `206` range answers, element removed on leaving.
- **Uploads: pass.** 120 MB + 18 MB sent through nginx with the JS heap flat at 2.3–2.7 MB.
- **Recovery after a failed chunk download: pass** in the production build behind nginx (the fix for A-03).
- **Admin session: pass.** Nothing about the session is stored by the client; the cookie is not readable by script; guarded routes redirect and return.
- **Dependencies: pass.** Two runtime packages; 0 runtime audit findings.

Major risks that remain outside what could be tested: real devices, a real Pi, real media sizes and codecs, many phones at once.

## B. Verification results

| Category | Status | Findings |
|---|---|---|
| React best practices | Not Tested | Reviewer A |
| TypeScript quality | Not Tested | Reviewer A (`tsc -b` passes here) |
| Dependency hygiene | Pass | `react`, `react-dom` only at run time; lockfile complete; audit as claimed. B-07 (polyfill growth, Low) |
| Offline operation | Pass | 0 external requests in 570 across three features on two servers; recovery verified. Local-network mode only; the disconnected-tablet mode is not specified and not built |
| Local asset hosting | Pass | Fonts, icons, logos, 109 illustrations all in `dist/`; Krio letters covered at four weights |
| Performance | Partial | Request counts, transfer sizes, heap and long tasks measured on a Mac: all good. Nothing measured on target hardware |
| Legacy browser compatibility | Not Tested (static checks pass) | No Chrome 58 run by this reviewer; streams 2–4 never ran one |
| Accessibility | Not Tested | Reviewer A |
| Security | Partial | nginx: sandbox and CSP verified. B-01 (Caddy sandbox, High), B-03 (uploaded files in the app's origin, Medium), B-06 (draft kept after sign-out, Low). Plain HTTP for the admin password is an accepted, documented infrastructure risk |
| Deployment readiness | Partial | Both configs executed. nginx correct except B-02 and B-04; Caddyfile has B-01, B-02, B-08. Pi itself Not Tested |

## C. Detailed findings

Counts: Critical 0 · High 2 · Medium 1 · Low 6. By stream: stream 1: B-01, B-02, B-03, B-04, B-05, B-08, B-09; stream 4: B-06; streams 2 and 4 (with stream 1 for the policy): B-07.

### B-01 — Caddyfile: animation packages get the app's CSP, not the sandbox

- **Severity:** High (for any bag that uses the Caddyfile; nginx is not affected). **Owner:** stream 1. **Category:** security, deployment.
- **Location:** `app/deploy/Caddyfile:19-26` (site-wide `header` block, containing `-Server` at line 25) and `:41-47` (`handle_path /media/tryit/*`, CSP at line 43).
- **Problem:** A `header` block that removes a header is applied when the response is written, after the handlers. The site-wide block therefore runs last and overwrites the `Content-Security-Policy` set inside the `/media/tryit/` handler. Packages are answered with `default-src 'self'; script-src 'self' 'sha256-…'; …` and no `sandbox`.
- **Evidence:** `api-down-and-reach.log` (first block: the header as sent for `/media/tryit/sample/index.html`); `sandbox-probe-caddy.log` against `sandbox-probe-nginx.log`:
  - inside the app's `<iframe sandbox="allow-scripts">`: "inline script DID NOT RUN (blocked)". The repo's own sample package is one file with an inline script, so a package like it shows nothing under Caddy.
  - opened as a page by its address: "localStorage of that origin READ/WRITE", "XHR to the bag API with cookies ANSWERED 200". Under nginx the same lines read "denied (SecurityError)" and "blocked".
  - in a frame without the attribute: the package reads `sensebod.session.v1`.
- **Impact:** Try it packages fail for learners on a Caddy bag, and the second line of defence for other people's HTML is absent: a package reached by its URL (a link, the address bar, a redirect inside another package) runs as the app, with an admin's cookie if one is signed in on that phone.
- **Recommendation:** Do not let the site-wide block touch package responses, and make the package policy explicit:
  ```
  @app not path /media/tryit/*
  header @app {
      Content-Security-Policy "default-src 'self'; …"
      X-Content-Type-Options "nosniff"
      X-Frame-Options "SAMEORIGIN"
      Referrer-Policy "no-referrer, same-origin"
      Permissions-Policy "…"
      -Server
  }
  handle_path /media/tryit/* {
      root * /var/lib/sensebod/media/tryit
      header {
          Content-Security-Policy "sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'"
          X-Content-Type-Options "nosniff"
          Cache-Control "no-cache"
          defer
      }
      file_server
  }
  ```
- **Validation:** `sh containers.sh up …`, then `node cdp-sandbox-probe.mjs http://127.0.0.1:48081`: sections A, B and C must match `sandbox-probe-nginx.log` line for line (inline script ran; storage, cookies and API denied).

### B-02 — A missing chunk is answered "404, cache for a year"

- **Severity:** High. **Owner:** stream 1. **Category:** deployment, offline recovery.
- **Location:** `app/deploy/nginx.conf:69-73` and `:76-80` (`add_header Cache-Control "public, max-age=31536000, immutable" always;` with `try_files $uri =404`); `app/deploy/Caddyfile:56-62` (the header is set before `file_server` decides the file is missing). The same pattern gives missing media a one-day cache: `nginx.conf:117-128`, `Caddyfile:49-53`.
- **Problem:** `always` (nginx) and the unconditional `header` (Caddy) put the year-long immutable cache header on error answers too. Chrome stores the 404.
- **Evidence:** `server-checks-nginx.log` and `server-checks-caddy.log`, check 3: `HTTP/1.1 404 Not Found … Cache-Control: public, max-age=31536000, immutable`. `update-rollback.log` (nginx, config unchanged, releases switched by the documented symlink): release A open on the phone → release B goes live → the tab asks for A's lessons chunk: 404 → roll back to A → reload: the chunk is "404 (from the browser cache)"; a fresh visit and a hard reload give the same; `fetch()` of the chunk still says 404. The lesson screen stays "This page did not open" on that phone.
- **Impact:** After an update followed by a roll-back (the procedure ARCHITECTURE section 12 documents), or any deploy where `index.html` is visible before every asset is, each phone that had the app open and tapped into a not-yet-loaded feature loses that feature until someone clears the browser's data. "Try again", the reach check and the automatic reload from fix round 1 all reload into the cached 404. On a bag with no technician nearby this is not recoverable by a facilitator.
- **Recommendation:** Cache only successful answers.
  - nginx: remove `always` from the three `Cache-Control` lines in `/assets/`, `/illustrations/` and `/media/` (without `always`, nginx adds the header to 200, 206 and 304 only), and give errors an explicit `no-store`, for example `error_page 404 = @gone;` with `location @gone { include snippets/sensebod-security-headers.conf; add_header Cache-Control "no-store" always; return 404; }`.
  - Caddy: match only existing files, `@immutable { path /assets/* /illustrations/*  file }`, and add `handle_errors { header Cache-Control "no-store" }`.
- **Validation:** `server-checks.sh` check 3 shows `no-store` (or no `Cache-Control`); `node cdp-update-rollback.mjs http://127.0.0.1:48082 <www>` shows the lesson at step 3.

### B-03 — Files under `/media/` are served in the app's own origin with the app's CSP

- **Severity:** Medium (confirmed in the config; whether it can be reached depends on how the backend, not yet written, names and stores uploads). **Owner:** stream 1, with the backend contract. **Category:** security.
- **Location:** `app/deploy/nginx.conf:117-128`, `app/deploy/Caddyfile:49-53`; `security-headers.conf` (`script-src 'self'`).
- **Problem:** Only `/media/tryit/` is boxed. Anything else under `/media/` is served with its natural type and the app policy, in which `script-src 'self'` allows any script file on the bag. An uploaded `x.html` that loads an uploaded `x.js` (or an SVG that does) is then a page of the app: it can read `localStorage` and call the admin API with the cookie.
- **Evidence:** `content-types-nginx.log` / `content-types-caddy.log`: `/media/types/file.html` → `text/html`, `file.js` → JavaScript, `file.svg` → `image/svg+xml`, each with the app CSP (`server-checks-*.log`, check 10). The admin upload input accepts `image/*` (which includes SVG) and documents (`walk-admin-nginx.log`, the `accept=` list).
- **Impact:** Uploads come from signed-in staff, so this needs a careless or hostile file rather than an outsider; the effect would be stored script in every learner's and admin's browser.
- **Recommendation:** Give `/media/` its own restrictive policy, for example `Content-Security-Policy "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"` (video, audio, pictures and captions still load from app pages, because the policy of a media file does not govern the page that embeds it), and state in API-CONTRACT that the backend stores uploads under generated names with an allow-list of extensions.
- **Validation:** open `/media/types/file.html` containing `<script src="file.js">` directly: the script must not run; rerun `journeys.sh` to confirm players still work.

### B-04 — nginx: the `types` block replaces the system list instead of adding to it

- **Severity:** Low. **Owner:** stream 1. **Category:** deployment.
- **Location:** `app/deploy/nginx.conf:33-50`.
- **Problem:** The comment says "make sure these are known whatever the distribution's mime.types says", but a `types { }` block at server level replaces the inherited map. Every extension not in the 14 listed is `application/octet-stream`, sent with `nosniff`.
- **Evidence:** `content-types-nginx.log`: `.gif .webm .3gp .ogg .opus .wav .aac .mov .htm .mjs .woff .ttf .ico .txt` → `application/octet-stream` (Caddy gives each its type: `content-types-caddy.log`).
- **Impact:** Current Chrome still showed a GIF and played a WAV in the package probe; module scripts (`.mjs`) are refused, `.htm` downloads instead of opening. Old WebViews are stricter about media types than current Chrome: Not Tested. Matters as soon as media arrives in a format other than MP4/M4A/MP3.
- **Recommendation:** Add the missing lines (at least `gif`, `webm`, `3gp`, `ogg oga opus`, `wav`, `aac`, `htm`, `mjs`, `woff`, `ttf otf`, `ico`, `txt`) or put `include /etc/nginx/mime.types;` first inside the block.
- **Validation:** `sh content-types.sh http://127.0.0.1:48080`.

### B-05 — The package sandbox blocks what ordinary packages do (own data, fonts, modules)

- **Severity:** Low (a limit to decide and document, not a hole). **Owner:** stream 1; stream 4 for the admin-side check text.
- **Location:** `app/deploy/nginx.conf:133-139` (`connect-src 'none'`; the opaque origin created by `sandbox allow-scripts`).
- **Evidence:** `sandbox-probe-nginx.log`, section B: "fetch own data.json BLOCKED", "XHR own data.json BLOCKED", "own font (font.woff2) BLOCKED/failed", "module script (module.mjs) BLOCKED/failed"; inline and external scripts, styles, pictures and sound work.
- **Impact:** A package that loads its own JSON, a web font or ES modules (most exported HTML5 and H5P-style content) shows a broken or empty animation with no message. HANDOFF already notes that H5P needs its own player.
- **Recommendation:** Keep the policy; write the rule into the admin "What you can upload" text and API-CONTRACT ("one HTML file or classic scripts; no fetch of its own files, no web fonts, no modules"), or deliberately relax it (`connect-src 'self'` plus `Access-Control-Allow-Origin: *` on `/media/tryit/` only) after weighing that a package could then send requests to `/api/`.
- **Validation:** the probe, plus one real package from the content team.

### B-06 — The typed-lesson draft stays on the phone after Sign out

- **Severity:** Low. **Owner:** stream 4. **Category:** privacy on shared phones.
- **Location:** `app/src/features/admin/lib/typedLesson.ts:82,144-155` (kept in `localStorage`), `app/src/features/admin/frame/AdminFrame.tsx:103` (sign-out does not clear it).
- **Evidence:** `walk-admin-nginx.log`: after "Sign out", `localStorage` still holds `sensebod.admin.typed-draft.v1={"title":"Draft title typed by admin A",…}` and `sensebod.admin.recent-published.v1`.
- **Impact:** The next person who signs in on that phone gets the previous person's unfinished text in the editor; the words are also readable in the browser's storage without signing in. Lesson text, not personal data; the design reason (surviving an expired session) is sound.
- **Recommendation:** Clear the draft on an explicit Sign out (keep it on a 401 / expired session), or ask "Keep your unfinished lesson on this phone?" at sign-out.
- **Validation:** repeat the last six steps of the admin journey in `journeys.sh`.

### B-07 — Polyfill chunk grew from 36.4 to 40.2 KB gzip; part of it is avoidable

- **Severity:** Low. **Owner:** streams 2 and 4 for the call sites, stream 1 for the policy.
- **Location:** `app/src/features/admin/lib/files.ts:77,79` and `screens/Home.tsx:114-115` (`toFixed` → `es.number.to-fixed`); `app/src/features/admin/adminPaths.ts:72` and `app/src/features/learner/lib.ts:12` (`split(/…/)` → `es.string.split` + `regexp-exec`); `URLSearchParams` at `app/src/shared/router/router.tsx:162,164`, `features/learner/lib.ts:41`, `features/admin/screens/Library.tsx:182`, `Picture.tsx:290` (→ `web.url.constructor`, `web.url-search-params.*`, punycode: about 22 KB raw, the largest item in the chunk).
- **Evidence:** `bundle-attribution.log` (analysis build with source maps, written outside the repo): 44 core-js modules, 76.5 KB raw of the 107 KB chunk; SystemJS is 7.7 KB. Stream 3 measured the same two built-ins at +1.8 KB gzip and wrote them by hand; streams 2 and 4 brought them back. The list also contains ES2025 iterator helpers, `Set.difference/intersection` and `Map.getOrInsertComputed`, which no source line calls (the detector matches `.filter`, `.map`, `.find` on any object).
- **Impact:** About 4 KB gzip on every phone's first load now; the chunk is 40% of start JavaScript and grows silently with ordinary code. Chrome 58 has native `toFixed`, `split`, `URL` and `URLSearchParams`; core-js replaces them for edge-case correctness the app does not depend on.
- **Recommendation:** Smallest step: apply stream 3's hand-written forms at the four call sites. Better: give `@vitejs/plugin-legacy` an explicit `polyfills` list (the modules Chrome 58 really lacks for this code) and let `npm run size` print the chunk on its own line with a budget. That needs a Chrome 58 run to confirm nothing breaks, so it is a recommendation requiring verification.
- **Reviewer A's note on ESLint against ARCHITECTURE:** both statements are true. The build does polyfill library features by usage (`es.string.at-alternative`, `es.array.includes` and others are in the chunk), so `replaceAll`, `.at()` and `Object.fromEntries` would work. The lint ban is a size rule, not a correctness rule. `docs/ARCHITECTURE.md:203` should say so, since it currently invites "standard library features are fine", which is how the 4 KB arrived.
- **Validation:** `npm run build && npm run size`; polyfills line back to about 36 KB.

### B-08 — Caddyfile is not at parity with nginx.conf in three smaller ways

- **Severity:** Low. **Owner:** stream 1.
- **Location:** `app/deploy/Caddyfile:29-38` and `:49-53`.
- **Evidence:** `api-down-and-reach.log`: with the backend down Caddy answers `502`, empty body, `Server: Caddy` (the `-Server` line does not cover Caddy's own error answers); nginx answers `503` with the contract's JSON error. `server-checks-caddy.log` check 12: API JSON is not compressed (no `encode gzip` in the `/api/*` handler; nginx compresses it). No per-connection rate limit on media (nginx: `limit_rate 190k` after 2 MB).
- **Impact:** The app copes: `api-down-caddy-app.log` shows the same "did not open … Try again" screen as nginx. Larger API answers travel uncompressed, and one phone can take the whole link while streaming.
- **Recommendation:** `encode gzip` inside `handle /api/*`; `handle_errors` that writes the contract's 503 JSON for 502/503/504 on `/api/*`; note in the file that Caddy has no built-in rate limit.
- **Validation:** `sh server-checks.sh http://127.0.0.1:48081`; `curl -i` with the backend stopped.

### B-09 — Numbers in the documents are behind the build

- **Severity:** Low. **Owner:** stream 1.
- **Location:** `docs/ARCHITECTURE.md:478` (99.0 KB start JavaScript, 37.6 KB polyfills); `docs/reports/stream-1-foundation.md:101` (17 requests for a cold Home).
- **Evidence:** this build: 101.5 KB, 40.2 KB, 20 requests (`walk-learner-nginx.log`, first block).
- **Recommendation:** update after B-07, and name the three small chunks the learner feature now pulls on Home (`api`, `learner`, `icons`).

### Suspected risks and observations (not confirmed defects)

- **`style-src 'unsafe-inline'`**: confirmed as the consequence of the single SystemJS build (CSS arrives inside the scripts; 1 `<style>` per chunk). With `script-src` limited to `'self'` plus one hash, no `innerHTML` / `dangerouslySetInnerHTML` / `eval` anywhere in `app/src` (grep: none) and all lesson and admin text rendered as React text, the remaining exposure is CSS injection, which needs an HTML injection first. Acceptable trade-off; no finding.
- **Request chain on a cold Home**: entry → `feature-learner` → `api` + `learner` + `icons` → `GET /portals` → pictures: four round trips before content. 12.1 KB in four files could be one, and the 58 icons (11 KB raw) sit in the entry. Worth measuring on a real phone before changing anything.
- **nginx's "The bag is starting…" message is never shown**: the app prints its own generic sentence for a 503. One line for Reviewer A / stream 1: either use `error.message` for `unavailable` or drop the custom text.
- **Characters outside the font subset**: `→`, `−` (U+2212, `ReadPlayer.tsx`, the "A−" button) and `◆` fall back to the device font (`font-coverage.log`). The report mentions `→` and `◆` only.
- **Logos are revalidated on every full page load** (2 × 304, about 0.7 KB each). By design (`no-cache` for unhashed files); harmless.
- **`index.html.gz` and other `.gz` twins can be fetched by name.** Harmless.
- **Docker note:** all containers on this machine, mine and others', were stopped once during the pass by a Docker engine restart I did not cause. I restarted only the `sensebod-review-b-*` ones.

## D. Performance results

Device and conditions for every row: development Mac, headless Chrome 157, phone viewport 390×760 unless stated, production build behind the committed nginx config in a container, mock API (150 ms delay per answer). Not a phone, not a Pi.

| Metric | Engineers' claim | Measured here | Target | Status |
|---|---|---|---|---|
| Start JavaScript, gzip (2 files) | 101.5 KB (coordinator); 99.0 KB (ARCHITECTURE) | **101.5 KB** (polyfills 40.2 + entry 65.1 by Vite's gzip; 39.6 + 63.5 on the wire) | 200 KB | Pass |
| Critical resources, first screen, gzip | 122.6 KB | **122.6 KB** (`npm run size`) | 350 KB | Pass |
| Largest lazy chunk, gzip | 20.6 KB (`feature-lessons`) | **20.6 KB** | 60 KB | Pass |
| Polyfills + SystemJS, gzip | 36.4 KB foundation, "about 40" now | **40.2 KB**; cause in B-07 | none set | Note |
| Cold Home: requests / bytes on the wire incl. headers | 17 requests (stub build) | **20 requests, 162.0 KB** | none set | Pass |
| Warm Home (reload) | not stated | 20 requests, **7.1 KB** (hashed files from cache, shell and logos 304) | — | Pass |
| Cold deep link to a Watch lesson | "chunk + api + 1 call + pictures" | **15 requests, 180.8 KB**, 0 from `/media/` | — | Pass |
| Lesson → next lesson in the app | API call and pictures only | **2 requests, 8.5 KB** | — | Pass |
| Heaviest learner screens | not stated | Climate portal 6 requests / 28.5 KB; Child protection lesson list (cold, 1440 px) 26 requests / 32.4 KB warm; 27-lesson Agriculture list 3 requests / 9.2 KB | — | Pass |
| Illustrations loaded per screen | lazy, by URL | at most **9** on any screen walked (the Child protection lesson list at 1440 px; 6 on the Agriculture portal at 800 px; 3 to 5 on phone screens); 37 illustration requests in the whole learner journey of 150 | — | Pass |
| Media before Play | none | **0 requests**; `<video>`/`<audio>` has no `src`, `preload="none"`, `autoplay` false on Watch, Listen, Read, Watch-and-answer | none | Pass |
| Media after Play | 206 | `206`, `Range: bytes=0-` → `Content-Range: bytes 0-61335/61336`; captions fetched after Play only; `curl` range, suffix range and 416 correct on both servers | — | Pass |
| Media released on leaving | element released | 0 media elements and 0 frames after leaving; listeners back to baseline | — | Pass (small sample file; see Not Tested) |
| Admin chunks reaching a learner | none | **0** in 202 learner and lesson requests; `/admin` loads `feature-admin` + `SignIn` + `admin` only until sign-in | 0 | Pass |
| Admin: sign-in to first screen | "about 25 KB" for frame, Home, Upload, Place | sign-in step 9 requests / 24.6 KB | — | Pass |
| Upload memory, 120 MB + 18.6 MB through nginx | "handed over as a reference" | JS heap **2.27 → 2.69 MB** during, 2.60 MB after; one `POST` per file, raw body; `xhr.send(file)` at `client.ts:372` | flat | Pass |
| Upload status polling | "every few seconds", bounded | 1 `GET /uploads/{id}` per upload seen in 6 s; capped at 60 polls (`uploadQueue.ts:248`) | bounded | Pass |
| Timers / continuous animation at rest | none | no `setInterval`, no `requestAnimationFrame` in `app/src` or in `dist` | none | Pass |
| Long tasks (> 50 ms) | not stated | **none** recorded in any journey on this Mac | — | Not meaningful for a phone |
| Memory over repeated navigation | 2.35 → 2.61 MB over 30 trips (stream 3) | 300 cycles of Home → lesson → admin → unknown URL → Home (1180 screen changes, forced GC before each reading): DOM nodes 409 → 409, listeners 160 → 160, 0 intervals, 0 exceptions; JS heap 2.45 → 2.81 (50) → 2.97 (100) → 3.14 (200) → 3.28 MB (300) | no growth in nodes or listeners | Pass for nodes and listeners. Heap rises about 0.7 KB per screen change and had not levelled off at 300 cycles: small, cause not isolated, worth one look by Reviewer A / stream 1 (router history, submission-key map, API cache) |
| First paint / time to usable on an Android 8 phone | none | **Not Tested** | — | Not Tested |
| Anything on a Raspberry Pi | none | **Not Tested** | — | Not Tested |

## E. Dependency and asset inventory

**Runtime dependencies (2):** `react` 18.3.1, `react-dom` 18.3.1. `npm ls --omit=dev` shows nothing else; `npm ls --all` reports 0 invalid, missing or extraneous packages. In the entry chunk (205.5 KB raw): react-dom 125.9 KB, react 6.9, scheduler 3.7, shared components 14.5, icons 11.0, API 6.6, shell 3.6, router 3.3, session 1.6 (`bundle-attribution.log`). No duplicated package, no dev, kitchen-sink, mock or test source in any of the 37 chunks (source maps of 33 chunks checked; the 4 without a map are under 2.5 KB each and contain none of the scanned markers).

**Dev dependencies (17):** build, lint and test tools only. `terser` and `@vitejs/plugin-legacy` are required by the legacy build. None unused that I could show.

**Audit:** `npm audit --omit=dev`: 0. `npm audit`: 10 (2 critical, 8 moderate), all under `vitest` 3 (`tinypool`, `@vitest/mocker`) and `typescript-eslint` (`minimatch`): confirmed as claimed, none reach `dist/` (`npm-audit.log`).

**Lockfile:** version 3, 469 packages, all resolved from `registry.npmjs.org`, all with integrity hashes; `npm ci` completes.

**Build reproducibility:** two builds of the same tree give byte-identical scripts, fonts and assets with the same hashed names (`diff -rq`; only `index.html` differed, because the comparison build skipped the postbuild step that edits it).

**`dist/`:** 4.4 MB on disk including `.gz` twins. 1 HTML, 37 JS, 8 WOFF2, 3 PNG, 114 SVG (109 illustrations + 5 portal pictures). No source maps, no service worker, no manifest.

**Fonts:** Poppins 400/600/700/800, 7.0–7.2 KB each, 199 characters, exactly the declared `unicode-range`; four Krio supplements of 1.2 KB each cut from Montserrat with Ɛ ɛ Ɔ ɔ Ŋ ŋ at each weight (`font-coverage.log`). Confirmed: Poppins has none of the six. Two weights are preloaded (800, 400); 700 and the Krio 700 file also load on Home (Home prints a word with `ɛ`), 600 on first use. No duplicates. `font-display: swap` on all eight.

**External references:** none at run time. In `dist/`: `http://www.w3.org` namespaces (126), and 6 strings inside React and core-js (`reactjs.org`, `github.com`, `https://a`, `https://x`) that are never requested.

**Candidates, not defects:** the ten `-Tab-` scene duplicates noted by stream 1; SVGO not applied (stream 1's reasoning accepted, not re-measured).

## F. Testing results

| What | How | Result |
|---|---|---|
| Install, typecheck, lint, unit tests, build, size | `npm ci`, `npm run typecheck`, `lint`, `test`, `build`, `size` | All pass: 22 files / 347 tests; CSS check 89 files; postbuild checks ok; three budgets met |
| nginx config | Debian 12 `nginx-light` 1.22.1 container, config and snippet copied as the file's header says | `nginx -t` ok; 40 header / routing / cache / range checks in `server-checks-nginx.log`: SPA fallback, 404 for missing assets, `.gz` twins served, shell `no-cache` with 304, ranges 206 / 416, traversal refused, API proxied, 503 JSON when the backend is down. Defects: B-02, B-04 |
| Caddyfile (never executed before) | `caddy:2` (2.11.9), file mounted unchanged | `caddy validate`: valid. Same 40 checks in `server-checks-caddy.log`: fallback, pre-compressed files, cache classes, ranges all correct. Defects: B-01, B-02, B-08 |
| Reach check used by recovery (`GET /?reach=…`) | `curl`, and in the browser | 200 with the shell on both servers, also with the backend down (`api-down-and-reach.log`) |
| Runtime network inspection | `journeys.sh` → `cdp-walk.mjs`, Chrome with loopback-only DNS, both servers | Learner 150 requests, lessons 52, admin 83, per server: **0 other origins, 0 CSP violations, 0 exceptions** (`walk-*-nginx.log`, `walk-*-caddy.log`) |
| Lesson types | same, real mouse events for Play | Watch, Listen, Try it (hotspots), Watch and answer (pauses for the question at 6.1 s), Check quiz, Read with reading audio, Climate picture lesson, Agriculture video, a lesson that does not exist, the finished screen: all behave as reported |
| Admin | same | Guard redirects with `next`; wrong password 401 with message; sign-in; two-file upload with one `Idempotency-Key` per created lesson; animation package upload, test frame with `sandbox="allow-scripts"`, placement, publish; the published package opened as a learner; sign-out; guarded route refuses again |
| Failed chunk recovery (A-03, SystemJS) | `recovery-nginx.log`: network cut, open a lesson, restore | Error screen; "Try again" while cut: one reach request fails, the screen stays with "cannot reach the bag"; restored: "Go to Home" does a checked page load; second in-app visit to the same lesson reloads once by itself and shows the lesson. **Confirmed in the production build** |
| Update then roll back | `cdp-update-rollback.mjs`, two releases, symlink switch | **Fails**: B-02 |
| Animation package isolation | `cdp-sandbox-probe.mjs`, 20 capabilities × 3 ways of opening | nginx: isolated in all three. Caddy: **fails**: B-01 |
| Static compatibility | `dist-syntax.cjs` (acorn), `dist-scan.cjs` | 37 scripts: 22 parse as ES2015, 16 need ES2017 at most (Chrome 58 has it), 0 beyond. Embedded CSS: no `inset`, `aspect-ratio`, `clamp`, `:is/:where/:has`, logical properties, `#rrggbbaa`; every `gap` is paired with `grid-gap`; `position: sticky` always with `-webkit-sticky` |
| Memory | `cdp-memory.mjs`, 300 navigation cycles | No growth in DOM nodes or listeners; heap +848 KB over 1180 screen changes (section D) |

**Engineer claims confirmed:** sizes and budgets; two runtime dependencies; audit counts; no external requests; fonts and Krio coverage; no media before Play, `preload="none"`, 206 ranges, release on leaving; uploads not read into memory; nothing of the admin session in storage; packages framed with `sandbox="allow-scripts"`; nginx behaviour as listed; SystemJS keeps a failed load and the checked reload recovers; no dev or mock code in `dist`; a learner never downloads admin chunks.

**Claims I could not reproduce or that are out of date:** "Same behaviour as nginx.conf" in the Caddyfile header (B-01, B-08); "17 requests" for a cold Home (now 20); "99.0 KB" (now 101.5). The Chromium 58 run of the foundation was not repeated.

**Not Tested (do not assume):**

- Chrome / WebView 58 or any old Chromium, for any feature. Streams 2–4 have never been run on the floor engine by anyone. First things to check there: the styled range input, `cuechange` captions, prefixed full screen, `position: sticky` in the admin bar, the upload `accept` and `capture` inputs.
- Any Android phone or tablet; any Raspberry Pi; SD-card I/O; the Wi-Fi access point; 20+ phones at once; the 190 kB/s media limit under real load.
- Real media: a 30 MB+ H.264 lesson played and sought on a phone, and whether leaving the lesson mid-download cancels the transfer (the sample files are 61 KB and 28 KB and arrive in one range; I generated an 18 MB test video but did not get to wiring it into a lesson).
- Timing (first paint, time to usable) under CPU and network throttling; I recorded request counts and bytes only.
- A real backend: cookie flags (`HttpOnly`, `SameSite`), idempotency on the server, processing states, how uploads are named on disk (B-03 depends on it).
- Firefox, Safari, old Edge. Service worker or disconnected-tablet mode (not specified, not built).
- Screen-level XSS probes with hostile content through the mock (static reading and grep only: no HTML sinks in `app/src`).

## G. Prioritised remediation plan

1. **Release blockers:** none Critical.
2. **Security and data integrity:** B-01 (Caddy sandbox header; or withdraw the Caddyfile until fixed), then B-03 (policy for `/media/` and the backend naming rule).
3. **Offline and recovery:** B-02 (do not cache 404s; both configs).
4. **Legacy compatibility:** run the full journeys (`journeys.sh` is browser-agnostic through the DevTools port) in an archived Chromium 58 for all three features, then on one real Android 8 phone through a real Pi. This is the largest open item and decides the release.
5. **Performance:** nothing required. Optional: B-07.
6. **Maintainability and deployment hygiene:** B-04, B-08, B-05 (document the package rules), B-09.
7. **Minor:** B-06; show or drop the 503 message text; add `−` to the known fallback characters.

Re-verification after fixes: `sh containers.sh up <repo> <work dir>`, `sh server-checks.sh`, `node cdp-sandbox-probe.mjs`, `node cdp-update-rollback.mjs`, `sh journeys.sh` for each server; expected outputs are the logs in this folder with the differences named under each finding.

## Release decision (section 23)

**INSUFFICIENT EVIDENCE.** The code and the nginx deployment did everything they claim in every test that could be run here, and offline compliance is demonstrated. But the required behaviour has not been shown under the intended conditions: no feature beyond the foundation stubs has run on the Chrome 58 engine, and nothing has run on Android or a Pi. Independently of that, B-01 and B-02 are High and must be fixed and re-verified before any bag is prepared. With those two fixed, a clean Chromium 58 run of the three journeys and one real phone-and-Pi session, the findings in this report would support PASS WITH CONDITIONS.
