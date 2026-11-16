# GAMES-VERIFY-1: Hextris and Tetris

Date: 2026-11-16. Verifier: independent, read-only for `app/` and `backend/`.

## How this was checked

- Read every file in both folders and diffed them against the pristine clones (Hextris 3f4847d, javascript-tetris e5c0c42).
- **Actually run** in headless Google Chrome **157** (not Chrome 58), driven over the DevTools protocol at 320x568, mobile emulation, Android 8 / Chrome 58 user-agent string, touch events:
  - **Pi-like harness**: a throw-away server on 127.0.0.1:8765 serving `app/public/games/` with the exact headers of `app/docs/GAMES.md` section 5 (`Content-Security-Policy: sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; form-action 'none'; base-uri 'none'`, `Access-Control-Allow-Origin: *`), game embedded in `<iframe sandbox="allow-scripts">` 320 wide, 72vh (409px) high.
  - **Dev harness**: same frame, pointing at `http://127.0.0.1:5173/games/<id>/index.html` (no CSP, no CORS header).
  - **Real app**: `http://127.0.0.1:5173/games/<id>`, tapped Play. The frame there is **284 x 409** at a 320x568 screen.
  - Direct loads of the game page at 320x409, 320x360 and other sizes for layout.
- A modern Chrome proves the sandbox, the policy and the offline behaviour. It does **not** prove the Chrome 58 floor.
- Harness, scripts and screenshots: `/private/tmp/claude-501/-Users-abdulrahimjalloh-Desktop-EasySTEM-easystemoffline/f08098b0-2c24-43cb-a374-808b46242f2e/scratchpad/verify/` (screenshots in `shots/`). The harness server was stopped; ports 5173 and 8000 were not touched.

## Verdicts

| Game | Verdict | Based on |
|---|---|---|
| Hextris | **BROKEN on the Pi** (works on the dev server) | Actually run. Starts, plays, pauses by touch. With the Pi's policy, the first game over after any block was cleared throws on every frame and the game's own restart button does nothing (GV-001). |
| Tetris | **WORKS WITH PROBLEMS** | Actually run. Starts, plays, ends and restarts by touch and by keyboard, no errors, no storage use. At phone width the Right button drops to a second row and is cut off (GV-007); the board is very small (GV-008). |

What passed for both (run, Pi-like harness and real app):

- No request to any host other than the serving host. Hextris: the score upload (`$.get('http://54.183.184.126/…')`), the `http://hextris.io/a.js` loader, Google Analytics (two places), Google ads, Google Fonts and all share / shop links are gone from the files and none appeared in the network log through start, play, pause, help, game over.
- In the sandbox `self.origin` is `null`; `localStorage`, `sessionStorage` and `document.cookie` work through the shim (set and read back); js.cookie's `Cookies.set("visited", true)` at game over produced `visited=true` in the stand-in.
- No `alert` / `confirm` / `prompt` / `window.open` / `window.top` / `parent` / fullscreen / vibration / `fetch` / XHR / WebSocket / `sendBeacon` / service worker / IndexedDB use in either game's own code. No anchors are left in Hextris (0 `a[href]` in the help screen); Tetris has one `href="#"` with `return false`.
- Every file `index.html` loads, transitively (scripts, CSS, `url()` in CSS, images set from JS), exists in the folder. Nothing that was removed is still needed: `#buttonCont` (measured at `js/main.js:37`, `:48`) was kept; `$("#socialShare").fadeIn()` (`js/view.js:158`), `$('.rrssb-email').remove()` (`js/initialization.js:52`) and the `#fork-ribbon` / `#devtools` calls are jQuery calls on empty sets and do nothing.
- `node --check` passes on every script. A grep for arrow functions, template strings, `?.`, `??`, `class`, `let` / `const`, spread, `async` / `await`, `Object.entries` / `values` / `fromEntries`, `.includes(`, `.flat(`, `padStart`, pointer events, observers found nothing in either game's code or in the shim.
- Touch targets: Hextris start area 80x102, pause / restart / help 60x60 (72x72 without the phone media query), game-over restart 66x57. Tetris buttons 62x56 in the real frame, Start 267x56.

## Findings

### Hextris

**GV-001 Blocker (on the Pi). Game over cannot be left: `eval` is refused by the policy.**
- Where: `app/public/games/hextris/vendor/jsonfn.min.js:1` (`JSONfn.parse` calls `eval("(" + value + ")")` for every string that starts with `function`); called at `js/main.js:255-256` (game over) and `js/main.js:116-117` (`init()`); the string is written at `js/Block.js:55` and `js/Block.js:151` each time a block is cleared (`localStorage.setItem("saveState", exportSaveState())`, and `exportSaveState` turns the hexagon's methods into text, `js/save-state.js:32`).
- The policy `default-src 'self' 'unsafe-inline' data: blob:` has no `'unsafe-eval'`.
- Seen: Pi-like harness, touch only. Game ran to game over with score 34. Console: `Uncaught EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script` at `jsonfn.min.js:1`, **337 times** (once per frame). `gameState` stayed 1 instead of 2, the pause button stayed on the game-over screen, `saveState` was never cleared (400,654 characters). Tapping the game's restart button: `init()` throws at `main.js:117` before it resets anything; score stayed 34, GAME OVER stayed on screen, the game went on underneath. Screenshots `hextris-pi-5-gameover.png`, `hextris-pi-6-after-restart.png`.
- Not seen on the dev server (no policy there): same steps, restart worked, no errors. So this will only show on the Pi.
- A game with no cleared block (score 0) is not affected; pause then restart (`init(1)`, which clears the state first) works. The app's own "Start again" button reloads the frame and gets out of it.
- Fix (not applied, not tested by me): the saved state can never survive in a sandboxed frame, so stop parsing it.
  - `js/main.js:116-117`: replace the two lines with `var saveState = {};`
  - `js/main.js:255-256`: delete both lines (the variable is not used there).
  - Better, also remove the writes at `js/Block.js:54-56`, `js/Block.js:150-152` and the `unload` handler at `js/initialization.js:155-159`, then drop `vendor/jsonfn.min.js` from `index.html:16` and `exportSaveState` from `js/save-state.js`. This also removes GV-004.
  - Do not add `'unsafe-eval'` to the policy.
  - Add the change to `SENSEBOD-OFFLINE-CHANGES.txt`.

**GV-002 Major (dev server today; the Pi only if the CORS header is missing). Fonts are refused, the Play triangle is drawn as an empty box.**
- Where: the Play icon is a Font Awesome glyph drawn on the canvas, `js/view.js:43`, `js/view.js:48` (also `js/render.js:103`, `:109`); fonts are declared at `style/style.css:446-461` and in `style/fa/css/font-awesome.min.css`.
- A sandboxed frame has no origin, so every web font is a cross-origin request. The dev server answers `Origin: null` with no `Access-Control-Allow-Origin` (checked with curl).
- Seen: dev harness and real app: `Access to font at 'http://127.0.0.1:5173/games/hextris/style/fonts/Exo2-Regular.otf' from origin 'null' has been blocked by CORS policy` for Exo2 (3 files) and Font Awesome (woff, then ttf). Screenshot `app-hextris.png`: a hollow square where the triangle should be, serif text. The game still starts and plays.
- With `Access-Control-Allow-Origin: *` (Pi-like harness) all fonts loaded and the screen is right (`hextris-pi-1-load.png`).
- Fix, either: (a) keep the header in the nginx location exactly as GAMES.md section 5 says and add the same header to the dev server for `/games/`; or (b) make the game independent of it: draw the triangle with canvas lines at `js/view.js:43` and `:48` (and the two places in `js/render.js`), and accept the fallback text font. With (b) the whole `style/fa/` folder (0.67 MB) can go.

**GV-003 Minor. About 0.84 MB of the 1.37 MB folder is never used.**
- Not referenced by anything: `style/fonts/QuattrocentoSans-Regular.ttf` (98 KB), `style/fa/fonts/FontAwesome.otf` (75 KB), `style/fonts/Lovelo.otf` (33 KB), `style/fa/css/font-awesome.css` (25 KB, the `.min.css` is the one loaded), `style/fonts/roboto.woff` (16 KB), `images/icon_arrows.svg` (1 KB).
- Downloaded on every start but never called (no `Hammer`, `swal` or `sweetAlert` anywhere in `js/`): `vendor/hammer.min.js` (`index.html:14`, 14 KB), `vendor/sweet-alert.min.js` (`index.html:33`, 10 KB).
- Listed in the CSS but Chrome never fetches them when the woff loads: `style/fa/fonts/fontawesome-webfont.svg` (253 KB), `.ttf` (142 KB), `.eot` (72 KB).
- `favicon.ico` (100 KB, `index.html:10`): a frame's icon is not shown.
- Fix: delete the files, remove `index.html:10`, `:14`, `:33`, and trim the `src` list in `font-awesome.min.css` to the woff.

**GV-004 Minor. A 190 to 400 KB string is built every time a block is cleared.**
- Where: `js/Block.js:55`, `:151` -> `js/save-state.js:1-33` (deep copies of the whole board, then `JSON.stringify`).
- Seen: `saveState` length 189,267 after the first clear and 400,654 at game over. It is the original behaviour, but it is useless in a frame that cannot keep it and will cost frames on a 1 GB phone. Not measured on a phone.
- Fix: as in GV-001 (remove the writes).

**GV-005 Minor. A shop tag is left.** `index.html:6` `<meta name="apple-itunes-app" content="app-id=903769553"/>` (asks iOS Safari to show an App Store banner when the page is opened directly). Fix: delete the line. `index.html:5` also describes the game as "inspired by Tetris" (see GV-012).

**GV-006 Minor. Licence paperwork is thin.**
- GPL-3.0: `LICENSE.md` is present, the changes file has the project, commit, date and list of changes, and the folder is the complete source of the game's own code. That meets section 5(a). Only `js/view.js:101` and `index.html:64` carry a note inside the file; `js/main.js` and `js/initialization.js` do not. Not required by version 3, but one comment line in each is cheap.
- The authors' copyright line lived only in the upstream `README.md` ("Copyright (C) 2018 Logan Engstrom", GPL version 3 or later), which was not copied. Fix: copy those lines into `SENSEBOD-OFFLINE-CHANGES.txt`.
- Third-party pieces, licence as written in the file itself:
  - `vendor/jquery.js`: jQuery 1.9.1, header says only "jquery.org/license" (MIT upstream). No licence text in the folder.
  - `vendor/hammer.min.js`: Hammer.JS 1.1.2, "Licensed under the MIT license". Unused.
  - `vendor/js.cookie.js`: JavaScript Cookie 2.0.0-pre, "Released under the MIT license".
  - `vendor/keypress.min.js`: Keypress 1.0.8, Apache License 2.0, only a web address to the licence (Apache-2.0 asks for a copy of the licence with the work).
  - `vendor/sweet-alert.min.js`: **no licence or author in the file.** Unused: remove it.
  - `vendor/jsonfn.min.js`: **no licence or author in the file.** Goes away with GV-001.
  - `style/fa/`: Font Awesome 4.1.0, "Font: SIL OFL 1.1, CSS: MIT License" (stated in the CSS).
  - `style/fonts/Exo2-*.otf`, `Lovelo.otf`, `QuattrocentoSans-Regular.ttf`, `roboto.woff`: **no licence statement anywhere in the folder or in the upstream repository.** Exo 2 is the only one used. Lovelo's terms are the least clear and it is unused: remove it.
  - jQuery, Hammer, Keypress, sweet-alert and JSONfn are minified only, as upstream ships them.
- Fix: add one `THIRD-PARTY-LICENSES.txt` with the MIT, Apache-2.0 and OFL texts for what is kept, after confirming Exo 2's licence at its source.

### Tetris

**GV-007 Major. At phone width the Right button falls to a second row and is cut off.**
- Where: `app/public/games/tetris/index.html:30` (`#touch button { width: 22%; min-width: 60px; margin: 0 1%; … }`) with the buttons written on separate lines at `index.html:52-55`. Four buttons of 24% plus the three spaces between inline blocks are wider than 100%.
- Seen: real app frame 284x409: left 38,304 / turn 111,305 / down 183,305 / **right 111,361** (62x56), page height 417 in a 409 frame, so the bottom 8px of Right is below the edge. Same at 320 wide and 288 wide. In a 360px-high frame (the frame's `min-height`) Right starts at y=361: entirely out of sight until the learner scrolls inside the frame. At 360 wide and above the four buttons fit on one row. Screenshots `tetris-pi-2-playing.png`, `app-tetris.png`.
- The buttons themselves work: Start, left, right, turn, down each did the right thing, six fast taps gave six moves, the keyboard still works, game over shows Start again and it restarts.
- Fix: `index.html:29` add `font-size: 0;` to `#touch` (the buttons set their own font sizes), and at `index.html:30` change `min-width: 60px` to `min-width: 0`. The page is then 361px high and fits. (Or `display: flex` on a wrapper around the four buttons; flex is fine on Chrome 58, `gap` is not.)

**GV-008 Minor. The board is 100 x 200 px (10px squares) on every phone.**
- Where: `index.html:19-20`. The larger sizes need `min-width: 400px` **and** `min-height: 400px` of the frame; the frame is the screen width minus 36px, so a 320px phone gives 284 and a 412px phone gives 376. Both stay on the smallest size; menu text is 12px.
- Seen: `canvas` 104x204 (with border) in the 284x409 frame; about 40% of the frame's width is empty or the side menu.
- Fix (a suggestion, needs trying): add after `index.html:19` a width-only step such as `@media screen and (min-width: 280px) and (max-width: 399px) { #tetris { width: 252px; } #menu { width: 100px; height: 280px; } #canvas { width: 140px; height: 280px; } }` and move the Start button into `#menu` so the page still fits in 409px.

**GV-009 Minor. A developer's frames-per-second meter is shown to learners.**
- Where: `index.html:59` (`stats.js`), `:91`, `:193`, `:201`, `:212-215`. Seen in every screenshot ("59 FPS" box under the score); it redraws its own canvas every frame.
- Fix: remove those lines and `stats.js` (4 KB), and the `#stats` rules at `index.html:10` and `:18`.

**GV-010 Minor. No pause, and no way to start again during a game, by touch.**
- Where: `index.html:262` hides Start while playing; the only way to end a game early is the Esc key (`index.html:247`). The original game has no pause at all. The app's "Start again" button under the frame does restart it.
- Down moves one row per tap (`index.html:221`); a keyboard repeats while the key is held, a button does not. Playable, slow.
- Fix (optional): keep the Start button visible as "Start again" (call `lose()` then `play()`), and repeat Down while the button is held (`touchstart` / `touchend` with a 100 ms timer).

**GV-011 Minor. On a tablet the bottom of the buttons is cut.** At 768x737 the page is 761px high (`index.html:23` picks the 300x600 board); the buttons end at y=760. The frame scrolls. Fix: with GV-008, size the board from the height left after the buttons.

**GV-012 Minor (risk, not a code defect). The name "Tetris" and unstated licences.**
- "Tetris" is a registered trademark whose owner acts against clones. It is the title shown to learners at `app/src/features/games/catalogue.ts:133` and in `app/public/games/tetris/index.html:6`; Hextris mentions it at `app/public/games/hextris/index.html:5`. Consider a neutral title such as "Falling Blocks" and keep the project name only in the credit line.
- `LICENSE` (MIT, Jake Gordon) is present. `stats.js` says only "stats.js r6 - http://github.com/mrdoob/stats.js": no licence in the file (goes away with GV-009). `texture.jpg` (45 KB, 626x800): nothing in the file or the upstream repository says where it comes from; it is covered only by the repository's general MIT statement.
- The changes file does not mention the added `<meta charset>` and the changed `#tetris` margin and padding (`index.html:4`, `:27-28`). Harmless; add a line.

## Sizes

- Hextris: 1,365,072 bytes in 45 files (about 0.84 MB removable, GV-003).
- Tetris: 72,767 bytes in 6 files (`texture.jpg` is 45 KB of it).

## Not verified

- **Chrome 58 / Android 8 WebView.** Nothing was run on it. In particular:
  - whether `Object.defineProperty(window, 'localStorage', …)` and `Object.defineProperty(document, 'cookie', …)` in `sensebod-offline-shim.js:57` and `:70` succeed there. In Chrome 157 `localStorage` is an own, configurable accessor on `window` and `cookie` a configurable accessor on `Document.prototype`, and the shim works. If the first call fails on Chrome 58 it fails silently (`catch` at `:58`) and Hextris stops at `js/initialization.js:38` with a blank board. Tetris does not use storage at all, so it does not depend on the shim.
  - whether `'self'` in the policy matches a sandboxed page's own files on Chrome 58 (GAMES.md already marks this). If it does not, every script and style of both games is blocked.
  - syntax was checked by grep and `node --check` only.
- Speed and memory on a 1 GB phone (Hextris runs jQuery fades and a full-screen canvas at device pixel ratio; GV-004).
- A real finger: taps were synthetic touch events. Multi-touch, scrolling the app page while touching the frame, and the 300 ms tap delay were not tried.
- How the arrow characters on the Tetris buttons (`&#9664;` `&#8635;` `&#9660;` `&#9654;`, `index.html:52-55`) look with Android 8's fonts (they may show as emoji or a small glyph; the turn arrow was small in Chrome 157).
- Hextris with the phone media queries inside the app's frame: device-width queries did not apply inside the emulated cross-process frame, so the 60px buttons and the help screen were checked by loading the game page directly at 320x409 and 320x360 (help text fits, 250px wide).
- The real nginx configuration: the Pi-like headers came from a local Python server that copies GAMES.md section 5.
- The production build (`dist/games/`), and sound: neither game has any audio.
- Licences of the fonts and of `texture.jpg` at their original sources (no internet look-up was done).

---

## Re-check (2026-11-16, after the fixes)

Run again in headless Chrome 157 (still not Chrome 58), 320x568, touch events, Android 8 user-agent string. This time through the **real app screen** on `http://127.0.0.1:5173/games/<id>` (tap Play; frame 284x409, `sandbox="allow-scripts"`, origin `null`), plus direct loads of the Tetris page at other sizes. The dev server now answers game files with `Content-Security-Policy: sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; form-action 'none'; base-uri 'none'` and `Access-Control-Allow-Origin: *` (checked with curl on `hextris/index.html`, `hextris/style/fonts/Exo2-Regular.otf`, `tetris/index.html`); the app route `/games/tetris` itself does not get them, as intended. `eval` inside the game frame now throws `EvalError` on the dev server too, so dev behaves like the Pi-header harness.

### Updated verdicts

| Game | Verdict | Based on |
|---|---|---|
| Hextris | **WORKS** (two small layout Minors at 284px, below) | Actually run in the real app screen under the policy: three games in a row, each ended and restarted with the game's own button. |
| Tetris | **WORKS** (one new Minor, GV-013) | Actually run in the real app screen and at five other sizes. |

### GV-001 Hextris, eval at game over: FIXED

- Read: `vendor/jsonfn.min.js` is deleted and not in `index.html`; no `eval(`, `new Function` or `JSONfn` call is left in reachable code (the only `JSONfn` text is inside the commented-out body, `js/save-state.js:36`). `js/main.js:117` is `var saveState = {};`, the two lines at game over are gone, `exportSaveState()` returns `"{}"` at `js/save-state.js:4`.
- Run: started by touch, rotated, paused and resumed. Game 1 ended at score 136 (blocks were cleared), `gameState` went to 2, pause button hidden, Game Over screen showed "1. 136". Tapped the game's restart button: new game, score 0. Game 2: 262, screen showed "1. 262  2. 136  3. 0", restart worked. Game 3 ended and restarted. Pause then the yellow restart button also worked.
- Console for the whole session: **no exception**. (11 policy notes in the log are my own 11 `eval` probes.) `saveState` stayed `"{}"` throughout, so the large string of GV-004 is gone too.
- Nothing else depends on the removed parts: `js/initialization.js:38-41` reads `null`, so `saveState` is `"{}"` there; `isStateSaved()` (`js/save-state.js:66-68`) is always false, so the start screen always begins a new game; `clearSaveState()` and the `unload` handler (`js/initialization.js:155-159`) only write `"{}"` into the stand-in.
- GV-005 (the `apple-itunes-app` tag): gone.

### GV-002 Hextris, fonts refused on the dev server: FIXED

- Run in the real app screen: `fontawesome-webfont.woff`, `Exo2-Regular.otf`, `Exo2-SemiBold.otf` answered 200 and loaded (`document.fonts`: FontAwesome loaded, Exo loaded), no CORS error, no failed request. Screenshot `re-hextris-1-load.png`: the Play triangle and the Exo text are drawn correctly.
- It still depends on the server sending `Access-Control-Allow-Origin`: the Pi's nginx must keep that line.

### GV-007 Tetris, Right button on a second row: FIXED

- Measured (left, top, width, height):

| Frame | Page height | Board | Buttons (left / turn / down / right) |
|---|---|---|---|
| 284x409 (the app) | 409, no scroll, content ends at 357 | 130x260, 13px squares | one row at y=300: x=9, 77, 145, 213, each 62x56 |
| 320x360 | 360, no scroll | 130x260 | one row at y=300, each 70x56 |
| 284x360 | 360, no scroll | 130x260 | one row, each 62x56 |
| 360x640 | 640, no scroll | 130x260 | one row, each 79x56 |
| 412x640 | 640, no scroll | 150x300 | one row at y=340, each 79x56 |
| 768x737 | 737, no scroll (GV-011 gone) | 300x600 | one row at y=640, each 79x56 |

- Nothing overlaps: menu ends 3px before the board, the board ends inside the frame box, the score and rows lines end 106px above the bottom of the menu, the buttons start 8px under the box.
- Start is the menu link drawn as a button, 100x50 at 284 wide. By touch: a tap on an arrow before starting does nothing; Start begins a game; left, right, turn, down each act; game over shows the Start button again (its label is "Start") and a tap starts a new game, twice in a row. A tap where the hidden Start button sits during play does nothing. Keyboard: arrow keys move, Space starts.
- The speed meter is hidden (`display: none`). `stats.js` is still downloaded and `stats.update()` still runs every frame (`index.html` script, the `stats` lines); harmless, 4 KB.
- Console clean, no request outside the dev server.

### New problems

**GV-013 Minor (introduced by the new board size). The "next piece" preview is cut off.**
- Where: `app/public/games/tetris/index.html:35` (the new `max-width: 399px` rule) makes the squares 13px but leaves `#upcoming` at 50x50 from `index.html:19`. The preview draws 5 x 13 = 65px into a 50px canvas, so the next piece is clipped on the right and bottom and the box has no right or bottom border. Seen in `re-tetris-app-go-1.png`.
- Fix: add `#upcoming { width: 65px; height: 65px; }` inside the rule at `index.html:35`. The menu has 106px of spare height, so it fits.

**GV-014 Minor (not caused by the fixes; seen now because this run used the app's 284px frame). Hextris Game Over screen at 284px wide.**
- Where: `app/public/games/hextris/style/style.css:403` (`#restart { left: calc(50% - 124px); … translate(-50%) }`). At 284px the 66px restart button starts about 15px left of the frame edge; about 51px of it is visible and it answered the tap in all three games. "HIGH SCORES" wraps onto two lines. Seen in `re-hextris-go-2.png`.
- Fix: after `style.css:409` add `@media only screen and (max-width: 310px) { #restart { left: 44px; } }`.

### Still open from the first report

- Minors GV-003 (unused Hextris files: `vendor/hammer.min.js` and `vendor/sweet-alert.min.js` are still loaded, the unused fonts and `favicon.ico` are still in the folder; 1.4 MB), GV-006 and GV-012 (licence texts, copyright line, the "Tetris" name), GV-010 (no pause or mid-game restart by touch in Tetris; the app's "Start again" does it).
- Everything under "Not verified" still stands: Chrome 58 itself (the shim's `Object.defineProperty`, `'self'` in a sandboxed page), speed on a 1 GB phone, a real finger, the arrow glyphs on Android 8, the real nginx, the production build.
