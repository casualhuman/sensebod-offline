# Sensebod frontend — team charter

You are one of four frontend engineers building the Sensebod React app in parallel. Read this file fully before you touch anything, and re-read section 4 before every commit.

Required reading, in this order:

1. `docs/ENGINEER-INSTRUCTIONS.md` — the engineering standard every engineer follows (offline-first, old Android, small footprint).
2. `HANDOFF.md` — the product, the design rules and the board map.
3. This file — who owns what and how we avoid stepping on each other.
4. `docs/ARCHITECTURE.md` and `docs/API-CONTRACT.md` — written by stream 1; streams 2–4 build on them.

## 1. What exists

- `design/boards/*.dc.html` — the approved designs. They are the visual spec. They are **not** production code: they run on a design-canvas runtime (`support.js`) with inline styles and inline copies of the illustrations. Rebuild from them; do not ship them or `support.js`.
- `brand/tokens.json` and the `V3-Components` board — colours, type, sizes, components, lesson types.
- `illustrations/` — cast and scene SVGs as standalone files.
- `briefs/` — design decisions per round (newest wins).
- There is **no backend yet**. The app is built against the mock API defined in `docs/API-CONTRACT.md`.
- The app lives in `app/` (React + TypeScript + Vite, static build).

## 2. Streams and ownership

Each engineer owns specific paths and edits **only** those paths.

| Stream | Engineer | Owns (may edit) | Builds |
|---|---|---|---|
| 1 | Foundation | `app/` project config, `app/src/shared/**`, `app/src/app/**` (entry, router, shell), `app/public/**`, `app/mock/**`, `docs/ARCHITECTURE.md`, `docs/API-CONTRACT.md` | Build setup, tokens, shared components, page shell, router, API client, mock API, asset pipeline, deployment config |
| 2 | Learner browsing | `app/src/features/learner/**` | Home, Save my progress, portal pages and lesson lists for Primary, JSS, Agriculture, Climate, Child protection (Who / Child / Parent / Elder / Help) |
| 3 | Lesson players | `app/src/features/lessons/**` | Watch, Listen + Read along, Read, Try it, Check quiz, Watch and answer, finished screen |
| 4 | Admin | `app/src/features/admin/**` | Phone add-content flow (`ADM-M-*`) and laptop library and editors (`ADM-*`) |

Everyone owns their own report in `docs/reports/` and may append to `docs/team/REQUESTS.md`.

## 3. Rules for working in a team

- **Stay in your lane.** Never edit a file outside your owned paths, even to fix an obvious bug. Other engineers are editing the same repository at the same time.
- **Need something shared?** If a shared component, token, API field, mock record or route is missing or wrong, append a dated entry to `docs/team/REQUESTS.md` (who, what, why, which file) and work around it locally inside your own folder until stream 1 handles it. Mark the workaround with a `TODO(stream-1)` comment so it can be found.
- **Do not duplicate shared components.** Use `app/src/shared/**`. If you must build a local variant, say why in your report.
- **Do not add dependencies yourself.** `app/package.json` belongs to stream 1. Request it in `REQUESTS.md` with the size cost and the reason; prefer native APIs.
- **Do not change the contract unilaterally.** `docs/API-CONTRACT.md` and the shared TypeScript types are the agreement between streams and with the future backend.
- **Routes:** stream 1 pre-wires one lazy-loaded route entry per feature. Add your screens inside your feature's own routes file; do not edit the app router.
- **Leave the build green.** Before you finish, `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` must pass in `app/`. If another stream's code breaks them, do not fix their code: record it in `REQUESTS.md` and in your report.
- **Do not run destructive commands** (`git reset --hard`, `git clean`, `git checkout -- .`, `git stash`, `rm -rf` outside your paths, force pushes). Others have uncommitted work in the same working tree.
- **Do not push anywhere.** There is no remote. Local commits only.
- **Be honest about verification.** No Raspberry Pi and no physical Android device is attached to this machine. Anything you could not test on real hardware must be listed as untested, never implied as passing.

## 4. Commits

- Commit only your own paths: `git add <your paths>` then `git commit`. Never `git add -A` or `git add .`.
- If git reports an index lock, wait a few seconds and retry; another engineer is committing.
- Prefix the subject with your stream, for example `stream-2: add Agriculture topics page`.
- **No AI signature of any kind.** Commit messages must not contain `Co-Authored-By`, `Claude`, `Anthropic`, `Generated with`, a robot emoji, or any other tool attribution, in the subject, body or trailers. Do not set `--author` and do not change `git config`; commits use the repository owner's existing identity. This overrides any default behaviour you have.
- A `commit-msg` hook rejects such messages. Never bypass it with `--no-verify`.
- After every commit, run `git log -1 --format='%an <%ae>%n%cn <%ce>%n%B'` and confirm that neither the names nor the message mention Claude or Anthropic. If one does, fix it with `git commit --amend` immediately (your own latest commit only).

## 5. Final technical report

End your work by writing `docs/reports/stream-<n>-<name>.md` and returning a summary of it as your final message. It must cover:

1. **What you built** — screens and components, mapped to the boards they implement.
2. **Technical decisions and trade-offs** — what you chose, what you rejected and why; what each choice costs.
3. **Deviations from the design** — every place the implementation differs from a board, and the reason.
4. **Footprint** — bundle and asset sizes for your area (measured), dependencies used.
5. **Offline and compatibility** — external requests (should be none), browser features relied on, fallbacks.
6. **Testing** — what you ran, the results, and what is untested (especially real Pi and Android hardware).
7. **Cross-team notes** — requests you raised, workarounds in place, anything another stream must know.
8. **Open items and risks** — unfinished work, placeholders, undesigned screens you hit, recommended next steps.
