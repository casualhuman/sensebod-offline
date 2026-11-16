# Games in Sensebod Offline

The Games section is built, but **no game is in the bag yet**. This note says how the section works and how to add a game later.

Nothing in this note was tried on a Raspberry Pi or on a real Android 8 phone, and no game has been run through it yet. Points that still need a test are marked **not tested**.

## 1. What is there now

| Part | Where |
|---|---|
| The catalogue: the one place a game is registered | `app/src/features/games/catalogue.ts` |
| Screens: Games home (`/games`) and one game (`/games/<id>`) | `app/src/features/games/screens/` |
| The player (sandboxed frame) | `app/src/features/games/GamePlayer.tsx` |
| Styles, prefix `gam-` | `app/src/features/games/games.css` |
| Tests | `app/src/features/games/games.test.tsx` |
| The switch that turns the whole section on or off | `games` in `app/src/shared/switches.ts` |
| The "Games" entry in the header | `app/src/shared/shell/PageShell.tsx` |
| The folder for game files during development | `app/public/games/` |

The catalogue is static data inside the app. It needs no API call, and nothing in the mock or in `openapi.yaml`.

**Switch.** `features.games = false` removes the header entry, and `/games` then answers like any unknown page ("This page is not in this bag").

**Header entry.** "Games" is always in the header of Home. On inner screens it shows from tablet width only: a phone's header has room for Back and Home, so a phone reaches Games through Home. Child protection screens do not show it.

**No class levels.** Games are not tied to a class. The learner chooses a kind of game (a category) on `/games`, then a game on `/games?category=<id>`. Games is also a card under "Choose a portal" on Home.

**Categories.** Thinking games (coding, maths and strategy together, because each had one game) · Puzzles and patterns · Quick play.

## 2. How a game is shown: a sandboxed frame, not a page of its own

A game with `installed: true` is opened inside the game screen, in `<iframe sandbox="allow-scripts" src="/games/<id>/index.html">`, as soon as the game screen opens (the learner already tapped Play on the game's card, so there is no second Play button). This is the same pattern as the Try it animation packages.

Why:

- **Back and Home stay on screen.** A game on a page of its own has no way back except the phone's Back key.
- **A game is somebody else's code.** The sandbox gives it a throw-away origin. It cannot read the learner names kept on the phone, cannot use an admin's sign-in to call the API, cannot move the app to another page and cannot open windows.
- **Old phones.** Nothing is downloaded until Play is tapped. Leaving the screen removes the frame, so the game's memory, timers and sound stop with it.

What it costs:

- **A game cannot keep anything on the phone.** Without an origin, `localStorage`, `sessionStorage`, IndexedDB and cookies are refused. A best score is forgotten when the game is closed, and Scratch projects cannot be kept in the browser. A game that crashes when storage is refused must be patched (wrap its storage calls in `try` / `catch`) before it goes into the bag. **Not tested** with any of the listed games.
- **A game that reads its own files with `fetch` or `XMLHttpRequest`** (levels, sounds, JSON) is treated as a stranger by the browser and needs the header in section 5. Files loaded with `<script>`, `<img>`, `<audio>` or `<link>` are not affected.
- There is no full-screen button yet. The frame is 72% of the screen height.

If a game cannot live with this (Scratch is the likely one), the choice to revisit is `sandbox="allow-scripts"` in `GamePlayer.tsx`. Do not add `allow-same-origin` while games are served from the app's own address: together with `allow-scripts` it removes all of the protection.

## 3. Adding a game

1. **Choose the project and read its licence.** Open the `LICENSE` file of the exact copy you will use. Check that it may be copied and given to others, and what it asks for (keep the licence text, name the authors, offer the source code for GPL games). Pictures and sounds can have a different licence from the code: check them too.
2. **Clone and build it on a machine with internet**, never on the Pi. Many of these games need no build: the repository is the game. If there is a build step, the result is usually a `dist/` or `build/` folder.
3. **Make it work with no internet.** Search the built files for `http://`, `https://` and `//` at the start of an address. Remove or bring inside the folder every font, script, style sheet, picture, sound, counter and advert that comes from outside. Remove analytics, share buttons, "more games" links and service workers. The start page must be `index.html` at the top of the folder, and every address inside the game must be relative (`js/game.js`, not `/js/game.js`): the game lives at `/games/<id>/`, not at the root.
4. **Make it work by touch.** No keyboard, no mouse, no hover. A game that needs arrow keys needs on-screen buttons or swipes first.
5. **Copy it into the games folder** under the id from the catalogue, with the project's licence file beside it:
   ```
   games/2048/index.html
   games/2048/LICENSE
   games/2048/js/…
   ```
   On a development machine: `app/public/games/<id>/` (the dev server serves it at once). On the Pi: section 5.
6. **Register it** in `app/src/features/games/catalogue.ts`: set `installed: true`, and write the real `sourceProject` and `licence` (the name from the licence file, for example `MIT`). For a new game, add one entry: `id` (small letters, digits and `-`; the same as the folder name), `title`, a one-line `description` in plain words, `category`. A test fails if a game is marked installed while its licence or source project still says "to be confirmed".
7. **Run** `npm run typecheck`, `npm test` and `npm run lint` in `app/`, then try the game on the oldest phone you have.

No other code changes: the game screen opens `/games/<id>/index.html` by itself once `installed` is `true`.

### Licences in the catalogue today

Source projects and licences were looked up on GitHub, chosen for an open-source licence and a small size. **Check each against the licence file of the copy you clone.** Repository size includes history; the files copied into the bag are smaller.

**Removed from the catalogue (owner decision, 2026-11-16): a game stays only if an open-source version exists and it is not too costly for the bag.**

- Scratch: open source (AGPL-3.0) but 2.7 GB of source, needs a large build and is heavy for old phones.
- Sandboxels: not open source ("R74n Content License", all rights reserved).
- Code Quest, Escape Run, GameSpace: no open-source project of that name was found.
- The categories "Science and making" and "Early learning" went with them, because they had no game left.

| Game | Project | Licence | Repository size | Note |
|---|---|---|---|---|
| 2048 | gabrielecirulli/2048 | MIT | 0.6 MB | |
| Tetris | jakesgordon/javascript-tetris | MIT | under 0.1 MB | |
| Open Chess | zeyu2001/chess-ai | MIT | under 0.1 MB | loads chess.js and chessboard.js from the internet: copy those libraries in |
| Tower Blocks | iamkun/tower_game | MIT | 1.9 MB | |
| Dino Runner | wayou/t-rex-runner | BSD-3-Clause | 3 MB | |
| Clumsy Bird | ellisonleao/clumsy-bird | GPL-3.0 | 4.5 MB | project is archived |
| Hextris | Hextris/hextris | GPL-3.0 | 27 MB | |
| Snake | patorjk/JavaScript-Snake | MIT | 121 MB with history | the game files are a small part |
| Blockly Games | blockly-games/blockly-games | Apache-2.0 | 836 MB with history | must be built; copy only the built, English output |

## 4. Size and speed: advice for a Pi and old phones

None of this is measured. Treat the figures as a starting point and replace them with numbers from a real phone.

- **The floor is Android 8 with Chrome / WebView 58**, about 1 GB of memory, a slow processor and a screen as narrow as 320px. A game written with newer JavaScript (`<script type="module">` and `import`, optional chaining `?.`, `??`, class fields) will show a blank frame there unless it is compiled down. Open the game on Chrome 58, or the oldest phone, before anything else.
- **WebGL and WebAssembly** may be missing or very slow on these phones. Prefer plain canvas or DOM games.
- **Download size.** Twenty phones share one Wi-Fi access point. Aim for a game that starts in under about 2 MB of downloads and is under about 10 MB in all. Compress pictures and sounds; remove source maps, tests, documentation and unused languages.
- **Large games.** Scratch and Sandboxels are much larger and heavier than the others. Measure them on a real phone before promising them; they may be right for tablets and laptops only. If so, say it in the game's description.
- **Disk.** The SD card also holds the videos. Write down the size of each game when it is added.
- **Sound** must start only after a tap, and there must be a way to play without sound.

## 5. On the Pi: what DevOps must add to nginx

This section describes the change. `app/deploy/nginx.conf` has **not** been edited.

**The folder.** Keep the games outside the app release, beside the media, for example `/var/lib/sensebod-offline/games/<id>/`. They then stay in place when the app is updated, and a release archive stays small. (Files put in `app/public/games/` are copied into `dist/games/` by the build and would travel with every release. A build with a game in that folder is **not tested**.)

**The location.** The app and the game files share the `/games` address:

| Address | What it is | Who answers |
|---|---|---|
| `/games`, `/games/2048` | app screens | the app shell (`index.html`), as for any app path: the existing `location /` already does this |
| `/games/2048/index.html`, `/games/2048/js/game.js` (anything *below* a game's folder) | static game files | the new location |

So the new location must match only addresses with something after `/games/<id>/`. A plain `location /games/ { … }` would also catch `/games/2048` and break refresh and direct links to a game screen.

```nginx
# ---- games: other people's HTML, kept in a box ----
location ~ ^/games/[^/]+/. {
    root /var/lib/sensebod-offline;            # /games/2048/x  ->  /var/lib/sensebod-offline/games/2048/x
    try_files $uri =404;                       # a missing file is a 404, never the app shell
    add_header Content-Security-Policy "sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; form-action 'none'; base-uri 'none'" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Cache-Control "no-cache" always;
}
```

What each line is for:

- **`try_files $uri =404`**: the game screen asks for the headers of `index.html` before it shows the frame. A 404 gives the learner "This game is not in this bag yet". If a missing file were answered with the app shell (as the dev server does), the learner would see the app inside the frame.
- **Its own `Content-Security-Policy`**, instead of the app's (`snippets/sensebod-offline-security-headers.conf` must *not* be included here: the app's policy allows no inline script, and most of these games have some). `sandbox allow-scripts` keeps the game in its box even when somebody opens the file's address directly, outside the app's frame. `default-src 'self' …` lets the game load its own files and nothing from outside the bag. Whether `'self'` is accepted inside a sandboxed page on Chrome 58 is **not tested**; if a game's files are blocked there, that is the line to look at.
- **`Access-Control-Allow-Origin "*"`**: a sandboxed game has no origin, so its `fetch` / `XMLHttpRequest` calls for its own data files and its web fonts are refused without this header. It is safe here: these are public static files with no cookies involved. Do not add it to `/api/`.
- **`Cache-Control "no-cache"`**: game files have no hash in their names. Phones keep them and ask "has it changed?" (a small 304 answer), so a replaced game is picked up.
- **No `X-Frame-Options: DENY`** on this location: the app must be able to frame it.
- Optional: `gzip_static on;` with `.gz` twins made on the build machine, as for the app's own files, so the Pi spends no processor time compressing.

The app's own policy already allows the frame (`frame-src 'self'`); it does not change.

The `Caddyfile` needs the same rule if it is used.

## 6. Checks before a game goes to the field

- With the uplink unplugged: the game starts, plays and restarts. The browser's network log shows no request outside the bag.
- On the oldest phone: it opens, the text can be read at 320px, every control answers to a finger, sound waits for a tap.
- Start again works. Back and Home leave the game and its sound stops.
- The licence file is in the game's folder, and the catalogue names the project and the licence.
- A phone that opens `/games/<id>/missing.js` gets a 404.
