# Games verification 2: Tower Blocks, Snake, Dino Runner, Clumsy Bird

Date: 2026-11-16. Read-only review of `app/public/games/{tower-blocks,snake,dino-runner,clumsy-bird}`.
Nothing under `app/` or `backend/` was changed. Harness, scripts and screenshots are in
`/private/tmp/claude-501/-Users-abdulrahimjalloh-Desktop-EasySTEM-easystemoffline/f08098b0-2c24-43cb-a374-808b46242f2e/scratchpad/verify2/` (called `verify2/` below).

## How it was tested

- Browser: headless **Chrome 157** (`/Applications/Google Chrome.app`), driven over the DevTools protocol from Node 23. **This is not Chrome 58.** Nothing here proves behaviour on Chrome/WebView 58 or on a real phone.
- Viewport 320x568, touch emulation, Android 8 / Chrome 58 user-agent string. Each game was embedded in `<iframe sandbox="allow-scripts">` on a harness page served from `http://127.0.0.1:8790`. Frame 320x409 and 284x409 (284px is what the real game screen gives at 320px: measured in the app, frame rect `[18,0,284,409]`).
- Three servers for the game files:
  - **dev**: the running Vite server on 5173.
  - **Pi-like**: my own Node static server (`verify2/pi-server.js`, port 8791) sending exactly `Content-Security-Policy: sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:` and `Access-Control-Allow-Origin: *`, and 404 for missing files.
  - **bare**: the same server with no headers (port 8792), for the "header missing" case.
- Also run through the real app screen (`http://127.0.0.1:5173/games/<id>`, tap Play) for Snake and Tower Blocks.
- In every run the frame reported `self.origin === "null"`, and the shim was active (`localStorage.getItem` is a function, `document.cookie` is a string).
- My servers and browsers are stopped. Ports 5173 and 8000 were not touched.

**The dev server changed during this review.** At 14:20 a `HEAD` on a game file had no CSP and no CORS header. `app/vite.config.ts` was modified at 14:22 (lines 38-53) and now sends `Content-Security-Policy: sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; form-action 'none'; base-uri 'none'` and `Access-Control-Allow-Origin: *` on `/games/<id>/...`. So "dev" and "Pi" no longer differ in these two headers, and my dev runs after 14:22 also cover the longer policy from `GAMES.md` section 5. Differences that remain: dev answers a missing game file with the app shell and status 200 (`curl /games/clumsy-bird/nope.js` → 200 `text/html`), the Pi answers 404; the Pi adds `X-Content-Type-Options: nosniff` (not simulated).

## Verdicts

| Game | Verdict | Based on |
|---|---|---|
| Tower Blocks | **WORKS WITH PROBLEMS** | Read; diffed; run in sandbox on dev and with Pi headers (start, drop, game over, Replay, second game, sound button, keyboard); run in the real app. Start-up fails some of the time on current Chrome (GV-101). |
| Snake | **WORKS WITH PROBLEMS** | Read; diffed; run in sandbox on dev and with Pi headers at 284 and 320px (start, buttons, swipe, pause, resume, death, play again, keyboard); run in the real app. Start-up fails some of the time on current Chrome (GV-102). |
| Dino Runner | **WORKS** | Read; diffed; run in sandbox on dev and with Pi headers (tap to start, jump, crash, restart by tap outside and on the strip, sound button, keyboard with a desktop user-agent). 0 start-up failures in 20 loads. |
| Clumsy Bird | **WORKS WITH PROBLEMS** | Read; diffed; run in sandbox on dev, with Pi headers and with no headers (title, start, round, game over, back to title, second round, sound button, Space key). 0 start-up failures in 20 loads. Music costs 43 MB of memory on the Pi (GV-103). |

No request to another host in any run (hosts seen: the harness, the game server, `data:`). No uncaught exception and no CSP violation in a run that started normally. No `eval` / `new Function` is executed (melonJS contains `eval(` for TMX "eval:" properties and `Function("return this")` in a fallback branch; neither is reached, and the game ran under a policy without `'unsafe-eval'`).

## Findings

### GV-101 · Blocker (intermittent; seen on current Chrome) · Tower Blocks shows a wall and no game when the frame has no size yet

- Where: `app/public/games/tower-blocks/index.html:110-117` (reads `window.innerWidth` / `innerHeight` once, as the page is parsed) and `:163-166`, `:181` (passes them to `TowerGame`). Nothing listens for `resize`.
- What I saw: in current Chrome a sandboxed frame runs in its own process, and for a moment after the page starts its `innerWidth` x `innerHeight` is `0x0` (probe at document start: `0x0`, then `320x409`). When the inline script runs in that moment, `.content` gets `width:0px`, the canvas is `0x0`, `dist/main.js` throws `TypeError: Cannot read properties of undefined (reading '0')`, and the learner sees the brick background with the title text squeezed into a column: no Start button, no game.
- How often: 6 of 20 loads through the Pi-like server; **1 of 12 loads in the real app screen** (screenshot `verify2/shots/app-tower-blocks-BAD.png`). "Start again" in the app usually recovers.
- Chrome 58: not verified. Frames are in-process there, so the size is probably known in time, but nobody has run it.
- Fix (tried on a scratch copy: 0 failures in 30 loads, 15 of 15 start-and-drop runs worked): wrap the inline script so it waits for a size.
  - Replace line 107-108 `<script>` / `var domReady, ...` with:
    ```js
    <script>
    (function boot() {
      // wait until the frame has a size (it can be 0 x 0 for a moment)
      if (!(window.innerWidth > 0 && window.innerHeight > 0)) { setTimeout(boot, 50); return }
      var domReady, loadFinish, canvasReady, loadError, gameStart, gameOver, game, score, successCount
    ```
  - Replace lines 265-268 (the `load` listener) with:
    ```js
      if (document.readyState === 'complete') { domReady = true; hideLoading() }
      else window.addEventListener('load', function () { domReady = true; hideLoading() }, false);
    })();
    ```

### GV-102 · Blocker (intermittent; seen on current Chrome, harness only) · Snake shows a board that never moves when the frame has no size yet

- Where: `app/public/games/snake/js/init.js:20-37` (measures `window.innerHeight` and creates the board at once) → `js/snake.js:1293-1294`, `:1398-1418` build a grid with no rows → `js/snake.js:729` throws `TypeError: Cannot read properties of undefined (reading 'length')` inside `new SNAKE.Board(...)`. `init.js` stops there, so no button, swipe or Resume is wired (`init.js:39-153` never runs). A later `resize` draws the board, so it looks normal: the welcome dialog opens and "Play Game" closes it, but the snake cannot be moved.
- Same cause as GV-101 (frame is `0x0` when the script runs).
- How often: 13 of 30 loads through the Pi-like server and 7 of 30 through dev, in the harness. **0 of 12 in the real app screen**, so the real rate is lower than in the harness; the mechanism is the same one that was seen in the app for Tower Blocks.
- Chrome 58: not verified (same remark as GV-101).
- Fix (the same wait was tried on a scratch copy, written with `arguments.callee` instead of a named function: 0 failures in 30 loads, 15 of 15 start-and-move runs worked; the form below was not itself run): in `js/init.js`, wait for a size before anything else. Replace lines 9-10 with:
  ```js
  (function start() {
    // wait until the frame has a size (it can be 0 x 0 for a moment)
    if (!(window.innerWidth > 0 && window.innerHeight > 0)) {
      setTimeout(start, 50);
      return;
    }
  ```
  (the `"use strict";` line can stay after the `if`; the last line `})();` is unchanged).

### GV-103 · Major · Clumsy Bird: on the Pi the 1.4 MB music is decoded into 43 MB of memory

- Where: `app/public/games/clumsy-bird/js/game.js:101` (`me.audio.load(res, false, ...)`: `false` = Web Audio), `:16` (`music: true`), `:43` (theme).
- What I saw: with `Access-Control-Allow-Origin: *` (Pi-like server, and dev since 14:22) Howler fetches every sound with `XMLHttpRequest` and decodes it. `data/bgm/theme.mp3` is 117.3 s of stereo; the decoded buffer measured in the frame is **43 MB** (48 kHz x 2 channels x 4 bytes) and stays for as long as the game is open. On a 1 GB Android 8 phone that is a real risk of the tab being killed, and the decode itself is heavy on a slow processor. Without the header (bare server) the XHR is refused and Howler falls back to an `<audio>` element, which streams: so the cheap path is the one the Pi does **not** take.
- Fix (tried on a scratch copy: theme plays through an `<audio>` element, request type "Media", no decoded buffer, short sounds unchanged): `game.js:101` → `me.audio.load(res, res.name === "theme", function () {`. Or leave the music out: `game.js:16` → `music: false` (then `data/bgm/theme.mp3` need not ship: 1.41 MB of the game's 1.78 MB).

### GV-104 · Major (licence) · Tower Blocks: the music is a third-party track with no credit

- Where: `app/public/games/tower-blocks/assets/bgm.mp3` (345 KB), loaded by `dist/main.js` (`addAudio("bgm", "./assets/bgm.mp3")`).
- What I saw: the file's ID3 tags say title **"Caketown"**, artist **"Matthew Pablo"**, year 2012. The repository's MIT licence is "Copyright (c) 2018 BMQB, Inc" and neither the README nor `SENSEBOD-OFFLINE-CHANGES.txt` mentions the track or its terms. The track's licence could not be checked here (no internet used); tracks by this composer are commonly published under Creative Commons Attribution, which requires a visible credit.
- Fix: confirm the track's licence at its source; if it is an attribution licence, add "Music: Caketown by Matthew Pablo" with the licence name to `SENSEBOD-OFFLINE-CHANGES.txt` and to the game's credit text. If it cannot be confirmed, replace `assets/bgm.mp3` with a short silent MP3 of the same name (deleting the file makes the loading screen say "Some files did not load").

### GV-105 · Minor (licence) · Clumsy Bird: GPL source is complete for the game, but the engine is only there minified

- Where: `app/public/games/clumsy-bird/js/melonJS-min.js` (melonJS 4.0.0, MIT, header kept, byte-identical to upstream; contains howler.js 2.0.1 and an ES6 Promise polyfill).
- The changes notice is adequate for GPL-3.0 section 5: modified-copy statement, date, list of changes, licence text (`LICENSE.md`, identical to upstream), upstream URL and commit; `index.html` and `js/game.js` carry a dated notice. The game scripts shipped are the readable sources, not `build/clumsy-min.js`. The one gap against section 6 ("preferred form for making modifications") is the engine, which upstream itself only ships minified.
- Fix: add the unminified `melonJS.js` of release 4.0.0 beside the game on the build machine or in the source bundle (it need not be loaded), or state in `SENSEBOD-OFFLINE-CHANGES.txt` where the 4.0.0 source is and that it is available on request.

### GV-106 · Minor (licence) · Clumsy Bird: font, music, sounds and pictures have no stated licence

- `index.css:57` embeds `data/css/gamefont.woff`. The upstream `gamefont.ttf` name table says "04b_19", "1999 yuji oshimoto, 04@jp.org, www.04.jp.org": a freeware font whose terms are not in the repository and are not GPL.
- `data/bgm/theme.mp3`, `data/sfx/*.mp3` and `data/img/*.png` carry no author or licence tags, and `README.md`, `CUSTOMIZING.md` and `humans.txt` name none. They are covered only by the repository's blanket GPL-3.0.
- Fix: record this in `SENSEBOD-OFFLINE-CHANGES.txt` ("font: 04b_19 by Yuji Oshimoto, freeware; music and sounds: origin not stated upstream"), and decide whether to keep the music (see GV-103).

### GV-107 · Minor (licence) · Dino Runner: the Chromium licence text is not in the folder

- Where: `app/public/games/dino-runner/index.js:1-3` and `index.css:1-3` say "governed by a BSD-style license that can be found in the LICENSE file", but `LICENSE` is the wrapper project's ("Copyright (c) 2022, 牛さん"). The code, sprites and sounds are Chromium's ("Copyright (c) 2014 The Chromium Authors"); its licence names a different holder in clause 3.
- Fix: add Chromium's `LICENSE` text as `LICENSE.chromium` and name it in `SENSEBOD-OFFLINE-CHANGES.txt`.

### GV-108 · Minor (licence) · Tower Blocks: Zepto's MIT text is not in the folder

- Where: `app/public/games/tower-blocks/assets/zepto-1.1.6.min.js:1` has only "zeptojs.com/license". `SENSEBOD-OFFLINE-CHANGES.txt` gives the copyright line but not the permission notice the MIT licence asks to keep.
- Fix: add `LICENSE.zepto` (MIT text, "Copyright (c) 2010-2014 Thomas Fuchs").

### GV-109 · Minor · Clumsy Bird: only the top 46% of the frame is the game, and taps below it do nothing

- Where: `js/game.js:46-50` (`900x600`, `scaleMethod: "fit"`), `index.css:20-23`.
- What I saw: in a 284x409 frame the canvas is 284x189 at the top; the rest is plain blue. A tap on the blue area does not start the game (state stayed `MENU`) and does not flap; only taps on the canvas count. Text is drawn at 0.316 scale: "Steps" / "Higher Step" (`js/screens/gameover.js:69`, 40px) come out at about 13px; the start text at about 14px. Nothing is cut off; the sound button (112x48) does not cover the canvas.
- Fix (not tried): forward touches outside the canvas, at the end of the inline script in `index.html`:
  `document.addEventListener("touchstart", function (e) { if (e.target.tagName !== "CANVAS" && e.target.id !== "sound-toggle") { me.input.triggerKeyEvent(me.input.KEY.SPACE, true); setTimeout(function () { me.input.triggerKeyEvent(me.input.KEY.SPACE, false); }, 60); } }, false);`
  and raise the font in `gameover.js:69` to 56.

### GV-110 · Minor · Clumsy Bird: without the CORS header every sound is requested twice and logs an error

- Where: `js/game.js:101` (Web Audio load = `XMLHttpRequest`).
- What I saw on the bare server: 4 x "blocked by CORS policy: No 'Access-Control-Allow-Origin' header", then Howler loads the same 4 files again through `<audio>`. The game starts and plays with sound. This is what happens on any server that has not got the games location yet (`app/deploy/nginx.conf` has no games location today).
- Fix: none needed once the Pi sends the header; `me.audio.load(res, true, ...)` for all sounds removes the dependency altogether.

### GV-111 · Minor · Tower Blocks: on a touch-screen laptop the mouse does not drop blocks

- Where: `dist/main.js` (engine constructor): `this.isTouchDevice ? addEventListener("touchstart"...) : addEventListener("mousedown"...)`, with `isTouchDevice = "ontouchstart" in window`.
- What I saw: with touch reported and a mouse click, no block dropped; Space / Enter (`index.html:248-262`) and touch work. Upstream behaviour. Phones are not affected.
- Fix: none needed for phones; for laptops, add in `index.html` after line 262: `document.addEventListener('mousedown', function () { if (game.isTouchDevice && gameStart && !gameOver) game.touchStartListener() }, false)`.

## Per game: what was checked

### 1. Diff against the pristine clone

- **Tower Blocks** (commit `c6fa84a`, matches the changes file). `dist/main.js`: exactly two string literals differ (`"wenxue"` → `"Arial,Helvetica,sans-serif"`, `"normal"` → `"bold"`), +18 bytes; the resulting canvas font string is valid and the numbers draw (screenshots). All 36 assets and `LICENSE` are byte-identical. `index.html` matches the listed changes: GTM removed, share/WeChat removed, `alert` replaced, `location.reload()` for Replay, sound button, keyboard. Nothing removed is still referenced: `main-index-title.png`, `main-modal-invite-b.png`, `main-share-icon.png`, `wenxue.*` have no remaining reference. Files loaded (all seen answering 200 in the network log, 39 requests): `index.html`, shim, `dist/main.js`, `assets/zepto-1.1.6.min.js`, `main-bg.png` (CSS), `main-loading.gif`, `main-index-start.png`, `main-modal-bg.png`, `main-modal-over.png`, `main-modal-again-b.png`, and from `main.js`: `background, hook, block-rope, block, block-perfect, c1-c8, f1-f7, tutorial, tutorial-arrow, heart, score` (.png), `drop-perfect, drop, game-over, rotate, bgm` (.mp3).
- **Snake** (commit `3243086`). `js/snake.js` diff is as described: storage in `try/catch` with a memory copy, `??` replaced, trailing commas removed, 16px blocks under 480px, links removed, Resume button. `common-snake.css`, `main-snake.css`, the two pictures, `LICENSE`, `tuicss/LICENSE.md` identical. `tuicss.min.css`: the `@font-face` rule and 22 picture rules removed, nothing else. `dos-snake.css`: font rule removed, flex `gap` → margin. Files loaded (9 requests, all 200): `index.html`, 4 style sheets, shim, `js/snake.js`, `js/init.js`, `css/images/snakeblock.png`; `deadblock.png` is loaded on death.
- **Dino Runner** (commit `5455bfa`). `index.js`, `index.css`, `index.html` diffs are exactly the listed ones; sprites and `LICENSE` identical. Files loaded (8 requests): `index.html`, `index.css`, shim, `index.js`, both sprite sheets, `sensebod-offline-ui.js`, `100-error-offline.png` (or the 200% one). The three sounds are `data:` addresses inside a `<template>`, decoded with `atob`, never fetched.
- **Clumsy Bird** (commit `fae3d48`). 18 files listed as unchanged are byte-identical. `game.js`, `play.js`, `title.js`, `HUD.js`, `index.css`, `index.html` diffs match the notice. `share.png` / `tweet.png` are no longer in the preload list and nothing else names them. Files loaded: `index.html`, `index.css` (font inside as `data:`; `document.fonts` reports `gamefont: loaded`), shim, `melonJS-min.js`, 6 game scripts, 10 pictures, 3 short sounds at start, `theme.mp3` on the first round.

### 2. Network

No address of another host is requested or navigated to in any of the four. Remaining `http(s)://` strings are comments (`snake.js:4,196,772`, `main-snake.css:4`, `dos-snake.css:3`, `game.js:2`, `index.js:946`) and an error-message string inside melonJS. No `<a>`, no `window.open`, no share code, no analytics, no service worker, no manifest.

### 3. Sandbox

| Use | Where | Result in the sandbox |
|---|---|---|
| `localStorage` | `snake.js:59,72` (in `try/catch`); melonJS `me.save` (Clumsy Bird best score) | Safe. The shim supplies a memory store; scores last until the frame is closed. |
| `location.reload()` | `tower-blocks/index.html:205` | Works: after Replay the page is fresh, origin still `null`, a second game starts (dev and Pi headers). Every Replay re-requests all 39 files (304s on the Pi). |
| `alert` | `clumsy-bird/js/game.js:51`, `tower-blocks/dist/main.js` (both only when canvas is missing); melonJS console fallback | Ignored silently in the sandbox; not reached. |
| `navigator.vibrate` | `dino-runner/index.js:1001-1003`, `clumsy-bird/js/entities/entities.js:87` | No error in the runs. |
| `XMLHttpRequest` | Howler inside melonJS (sounds) | Needs `Access-Control-Allow-Origin` (GV-103, GV-110). Falls back by itself. |
| Web Audio | Dino (`index.js:314-341`), Clumsy Bird | Context starts "suspended" and became "running" after the first taps in Chrome 157. |
| fullscreen, `window.top`, `parent`, `window.open`, cookies, IndexedDB, `confirm`, `prompt` | none used by the games' own code | n/a (melonJS has fullscreen and pointer-lock helpers that the game never calls). |
| canvas pixel reads (`getImageData`, `toDataURL`) | none in Tower, Snake, Dino; one helper in melonJS, not called | No tainted-canvas error. |

Under the Pi policy nothing was blocked: inline scripts and styles are allowed by `'unsafe-inline'`, the embedded font and sounds by `data:`.

Blur: when the learner touches the app page outside the frame, Dino Runner pauses (`playing:false`) and continues at the next tap in the game. Upstream behaviour, works.

### 4. Chrome 58 syntax and APIs (by reading and pattern search, not by running)

No optional chaining, `??`, object spread, async iteration, `catch {}`, `flat`, `fromEntries`, `import`/`export` or class fields in any shipped script. Newest features used: classes, destructuring, default parameters and call spread in `dist/main.js`; `let`/`const`/arrow functions in `snake.js` (all Chrome 49+); `{ passive: false }` listener options and `Element.closest` in `init.js` (51+, 41+); CSS grid with `grid-gap` for the Snake buttons (57+). No flex `gap`, `inset`, `aspect-ratio`, `env()` or `min()/max()` in any CSS file.

### 5. Touch and layout (320px viewport; frame 284x409 and 320x409)

- Tower Blocks: Start 164x50, Replay 162x49, Sound 49x48. Game is 273px wide, centred. Nothing cut off.
- Snake: Play Game / Play Again / Resume 140x48; arrows and pause 52x52; Mode list 44px high (under 48). At 284px the board is 224x240 (14x15 squares), labels and buttons do not overlap. Buttons, swipe, pause, resume, restart all worked by touch.
- Dino Runner: whole frame is the tap area; Sound 140x48. Restart by tap anywhere after 0.75 s worked.
- Clumsy Bird: see GV-109. Sound 112x48.

### 8. Size and unused files

| Game | Files | Bytes | Note |
|---|---|---|---|
| Tower Blocks | 41 | 895,845 | `main-loading.gif` (279 KB) and `bgm.mp3` (345 KB) are 70% of it |
| Snake | 13 | 110,328 | |
| Dino Runner | 11 | 139,717 | both sprite sheets are always fetched (upstream) |
| Clumsy Bird | 26 | 1,780,767 | `theme.mp3` is 1,408,418 |

No file in the four folders is unreferenced (the `c1-c8` and `f1-f7` pictures are loaded by a loop in `main.js`; confirmed in the network log).

## Not verified

- **Chrome / WebView 58 and a real phone**: nothing. In particular: whether `'self'` in the Pi policy matches inside a sandboxed page on Chrome 58 (if it does not, every script and picture is blocked); whether GV-101 / GV-102 can happen there; whether sounds play (Tower Blocks plays effect sounds outside a tap, and Dino creates its audio context in `touchstart`: old Android Chrome may keep both silent; neither can stop the game); speed and memory.
- Headed Chrome and a real laptop or tablet: the start-up race (GV-101, GV-102) was measured in headless Chrome only.
- The real nginx on a Pi, including `X-Content-Type-Options: nosniff` and file types; `app/deploy/nginx.conf` has no games location yet.
- The licence of "Caketown" (GV-104) and of the 04b_19 font (GV-106): not looked up.
- Clumsy Bird: a round that passes a pipe (score above 0) was not reached by the script; flapping, pipes, ground hit, game over and restart were.
- The Mode list in Snake on Android (native picker inside a sandboxed frame).
- A production build (`npm run build`) with these folders in `public/`.

## Re-check (2026-11-16, after the fixes for GV-101, GV-102, GV-103)

Same method: headless Chrome 157 (not Chrome 58), 320x568, touch emulation, sandboxed frame 284x409, game files from my Pi-like server (the two headers, fresh copy of the four folders) and from the dev server (which now sends the Pi headers itself), plus the real app screen. My servers and browsers are stopped again.

| Finding | Result | Measured |
|---|---|---|
| GV-101 Tower Blocks start-up | **FIXED** | Loaded with a canvas and Start button, and started on tap: 30 of 30 (Pi-like), 30 of 30 (dev), 15 of 15 in the real app screen. Before: 6 of 20 and 1 of 12 failed. No exception in any load. |
| GV-102 Snake start-up | **FIXED** | Board built, Play Game tapped, snake moved on the Right button: 30 of 30 (Pi-like), 30 of 30 (dev), 15 of 15 in the real app screen. Before: 13 of 30 and 7 of 30 failed in the harness. No exception in any load. |
| GV-103 Clumsy Bird music memory | **FIXED** | `theme.mp3` is now requested as "Media" (an `<audio>` element), not XHR; no decoded buffer exists for it (before: 43 MB). The only decoded buffers are the short sounds (largest seen 0.05 MB). |

What was changed, as read: `tower-blocks/index.html:108-111` and `:273-275` (wait, then `domReady` if the page is already complete); `snake/js/init.js:9-18`; `clumsy-bird/js/game.js:101-103`. Each changes file was updated. All other files are identical to the copies I checked before.

Played after the fixes (no uncaught exception, no request to another host):

- **Tower Blocks** (Pi-like and dev): sound button before Start (all five sounds muted, then unmuted), Start, music playing and looping, sound off and on during play without dropping a block, drops to game over (score 50), Replay (`location.reload()`: page fresh, origin still `null`), second game with music. Keyboard: Space starts and drops, Enter replays.
  - Globals: the script's variables are now local (`typeof gameStart`, `game`, `startGame` are `undefined` from outside). Nothing else needs them: `dist/main.js` only gets the `option` object passed in and defines `TowerGame`; Zepto's `$` is still global; the HTML has no inline event attributes; the sound button and key handler are inside the same function.
- **Snake** (Pi-like, 284px): Play Game, Right and Down buttons, swipe left, pause, Resume, death at the wall, Play Again, second game, arrow key.
- **Clumsy Bird** (Pi-like and dev): title, tap, round starts; music is playing 2.5 s into the first round (`currentTime` advancing, volume 0.25); the wing sound plays on a flap; the sound button mutes the `<audio>` element (`muted` true) and restores it; game over; back to title; music plays again in the second round.
  - Audio cannot play: with the sound files missing (404), and with no `Audio` / `AudioContext` in the browser, the game still starts, plays a round, reaches game over and returns to the title, and the button shows "Sound: off". With `play()` refused by the browser the game also runs through; the button stays on "Sound: on" and one unhandled `NotAllowedError` is logged.

### New, from the changes

- **GV-112 · Minor · Clumsy Bird: the music may stay silent in the first round on a browser that only lets `<audio>` play inside a tap.** `clumsy-bird/js/game.js:101-108`: the theme is first requested at the start of round one, and `startTheme(false)` runs later, from the load callback, outside the tap. When I made `play()` refuse, the game ran normally but logged one unhandled `NotAllowedError` (Howler does not catch it) and the button stayed on "Sound: on". Whether Chrome 58 on Android refuses here is not verified; current Chrome played it. Sound only, the game is not affected. Fix if it shows on a real phone: nothing is needed for play; to make the music start reliably, call `game.wantTheme()` from the first tap on the title screen (`js/screens/title.js:19-23`) so the load begins inside a tap, and accept that music starts with round two otherwise.

No other new problem found.

### Verdicts after the re-check

| Game | Verdict |
|---|---|
| Tower Blocks | **WORKS** (GV-104 music licence still open: noted in its changes file, not resolved; GV-108, GV-111 open) |
| Snake | **WORKS** |
| Dino Runner | **WORKS** (unchanged; GV-107 open) |
| Clumsy Bird | **WORKS** (GV-105, GV-106, GV-109, GV-110, GV-112 open, all Minor) |

Still not verified: everything on Chrome / WebView 58 and a real phone, headed Chrome, real nginx. See "Not verified" above.
