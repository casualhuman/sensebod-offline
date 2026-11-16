# Sensebod Offline

Sensebod Offline, by EasySTEM, is a learning site that works with no internet. It runs on a Raspberry Pi 5 carried in a bag ("DLH in a bag"). The Pi makes its own Wi-Fi; phones, tablets and laptops join it and open the site in a browser. It is built for rural Sierra Leone: old Android phones, shared devices, unreliable power and no connectivity.

**Status: in development.** The app and the backend run together on a laptop and pass their tests. Nothing has been run on a Raspberry Pi or on a real Android 8 phone yet; see [What is not done](#what-is-not-done).

## What is in it

- **Five learning portals**: Primary school, Junior secondary, Child protection, Agriculture and Climate. Lessons are videos, audio, reading pages, questions and small interactive pieces.
- **Use without signing in.** Every lesson is open to a guest. A learner who wants their progress kept signs in with a name and a 4-digit secret number. No phone number, no email.
- **Games**: nine open-source games, adapted to work offline and by touch (see [Games](#games)).
- **An admin side for staff**: add and place lessons, upload media, publish, see storage, export learner data, back up to a USB stick.
- **Built for power cuts**: the database and uploads are written so that switching the Pi off at any moment loses at most the last action.

## Repository layout

| Path | What it is |
|---|---|
| `app/` | The website learners and staff use: React, TypeScript and Vite, compiled for Android 8 (Chrome 58) |
| `backend/` | The server on the Pi: Node.js, Express and SQLite |
| `docs/` | Architecture, the API contract, design decisions and review reports |
| `docs/system/` | The system architecture, database design and `openapi.yaml` (the contract between app and backend) |
| `design/`, `briefs/`, `illustrations/`, `brand/` | Design boards, the brief for each design round, pictures and logos |
| `content/` | A list mapping the agriculture videos to topics |

## Run it on a laptop

You need Node.js 23 or newer. The backend uses SQLite through Node's built-in `node:sqlite`, so there is nothing else to install.

**1. Backend** (port 8000):

```sh
cd backend
npm install
npm run dev:init      # creates a demo bag in backend/dev/data with sample lessons

# create a staff account for the laptop (choose your own password, 10 characters or more)
printf 'a-long-password' | SENSEBOD_OFFLINE_DEV=1 node bin/sensebod-offline-admin.ts create-hub-manager \
  --config dev/sensebod-offline.dev.toml --username admin --display-name "Me" --password-stdin

npm run dev           # the API
npm run dev:worker    # in a second terminal: processes uploads and exports
```

**2. App** (port 5173):

```sh
cd app
npm install
npm run dev:real      # the app, talking to the backend on port 8000
```

Open http://127.0.0.1:5173. Staff sign in from the "Staff sign in" link at the bottom of Home.

To work on the app without the backend, use `npm run dev` instead: it answers the API from an in-memory mock with the same sample content.

## Tests and checks

```sh
cd app
npm run lint          # ESLint and a check that the CSS stays within what Android 8 supports
npx tsc -b            # typecheck
npx vitest run        # 366 tests
npm run build         # production build, with checks for external addresses and dev code

cd backend
npm run typecheck
npm test              # 94 tests: real SQLite, real HTTP, real worker processes
```

## Games

Games live in `app/public/games/<id>/`, one folder per game, and are listed in `app/src/features/games/catalogue.ts`. Each one is another project's code, opened in a locked-down frame so it cannot reach learner names or a staff session. Every game was changed to work with no internet: adverts, analytics, web fonts and share buttons were removed, and touch controls were added where a game needed a keyboard. Each folder keeps the project's licence and a `SENSEBOD-OFFLINE-CHANGES.txt` that lists what was changed.

| Game | Source project | Licence |
|---|---|---|
| 2048 | gabrielecirulli/2048 | MIT |
| Open Chess | zeyu2001/chess-ai, with chess.js and chessboard.js | MIT, BSD-2-Clause |
| Blockly Games (tablet or computer only) | blockly-games/blockly-games | Apache-2.0 |
| Hextris | Hextris/hextris | GPL-3.0 |
| Tetris | jakesgordon/javascript-tetris | MIT |
| Tower Blocks | iamkun/tower_game | MIT |
| Snake | patorjk/JavaScript-Snake | MIT |
| Dino Runner | wayou/t-rex-runner | BSD-3-Clause |
| Clumsy Bird | ellisonleao/clumsy-bird | GPL-3.0 |

How to add a game, and the rules a game must meet, are in [app/docs/GAMES.md](app/docs/GAMES.md). The verification reports are in [docs/reviews/games/](docs/reviews/games/). Some pictures, sounds and fonts inside these games carry no licence statement of their own in their source projects; the reports list them.

## Where to read more

- [docs/system/SYSTEM-ARCHITECTURE.md](docs/system/SYSTEM-ARCHITECTURE.md): how the whole system works on the Pi
- [docs/system/openapi.yaml](docs/system/openapi.yaml): the API contract
- [docs/system/DATABASE.md](docs/system/DATABASE.md): the database
- [docs/DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md): product decisions and the reasons for them
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the app's architecture and browser target
- [backend/README.md](backend/README.md) and [backend/docs/BUILD-STATUS.md](backend/docs/BUILD-STATUS.md): the backend and what is built
- [HANDOFF.md](HANDOFF.md): the designer's handoff note for the design boards

## What is not done

- **No run on a Raspberry Pi.** Everything was verified on a Mac. The deployment files (systemd units, the nginx rule for games) are not finished.
- **No run on Android 8 / Chrome 58 or on a real phone.** The code is written for that floor and checked by reading and by tests in a current browser, not on the old one.
- **USB paths are untested**: backup to a stick, content packs and restore have only been exercised with files on a laptop.
- **The update tool is not built**, and password reset over the internet is left for a later phase.
- **A learner who forgets their secret number has no way back yet**; there is no staff screen to reset it.
- **Open review findings** are listed in `backend/docs/BUILD-STATUS.md` and `docs/reviews/`.

## Licence

A licence for the Sensebod Offline code itself has not been chosen yet. The games in `app/public/games/` keep the licences of their own projects, listed above.
