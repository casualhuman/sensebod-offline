# Sensebod Offline backend: build status

13 Nov 2026 · backend engineer · package **BE** of `docs/system/HANDOFF-PACKAGES.md`

Everything below was built and run on a **Mac (Apple silicon, Node 23.10, SQLite 3.49.1 through `node:sqlite`)**. **Nothing has run on a Raspberry Pi, on a real phone, or with a real USB stick.** Every acceptance criterion that says "on the Pi" is still open and is listed in section 7.

Checks at the time of writing: `npm run typecheck` clean · `npm test` 91 of 91 pass · `npm audit --omit=dev` 0 findings · `npm run build` produces `dist/`, and the self-check runs from it.

## 1. System audit before building

| Item | Finding |
|---|---|
| Existing backend | None. `app/` is the React frontend with an in-memory mock of the API (`app/mock/handler.ts`), used as the reference for field names and messages |
| Framework | **Node.js + Express** (owner decision OWNER-1). The pasted engineer brief prefers Django "where a new backend is being established"; the owner's decision and the approved architecture override it |
| Database | SQLite, WAL, `synchronous=FULL`, two files (ADR-002, DATABASE §1). PostgreSQL was evaluated and rejected in ADR-002 for this workload (rare, tiny writes; one owner process group; no server to recover after a power cut) |
| Features that need the internet | None in normal use. One optional endpoint (`send-online`, the online password reset) needs EasySTEM's reset service, which is phase 2 and not built: it answers `503 offline` and the offline code path never depends on it |
| Cloud dependencies, external APIs, telemetry | None. No DNS lookups, no remote configuration, no package download at start |
| ARM / native-module risk | **No native modules.** SQLite is the `node:sqlite` driver inside the pinned runtime; hashing, AES and HMAC are `node:crypto`; zip and deflate are `node:zlib`. Dependencies: `express` 5 and `smol-toml` (69 folders in `node_modules`, pure JavaScript) |
| External programs | `ffmpeg`/`ffprobe`, `pdftoppm`/`pdfinfo`, `age`, `ssh-keygen`, `systemctl`: already in the architecture's package list (§10.1). A missing tool fails that one job with a plain note; it never stops the API |
| Disk writes | One flush per commit. Reduced by: progress coalescing, `last_seen` at most every 5 min per session, job progress at most every 2 s, uptime every 5 min, no access log |
| Data-loss scenarios | Listed with their protection in DATA-EXPORT §15; each has a test here or is a Pi test (section 7) |
| Deployment files | systemd units, nginx additions, udev/polkit rules and the root helpers are package **DEV**, not built here. This backend states what it expects from them in section 8 |

## 2. Choices the architecture left to the backend engineer

| Choice | Decision | Why |
|---|---|---|
| SQLite driver | `node:sqlite` (`DatabaseSync`) behind `src/core/db.ts` | Meets R-2 (WAL, `busy_timeout`, `BEGIN IMMEDIATE`, `RETURNING`, `VACUUM INTO`, distinguishable BUSY/FULL/CORRUPT) with no native module, so R-11 has no ABI risk. It was the driver of `poc/poc_lock_wait.mjs`. The wrapper is the only file that names the driver. **Risk:** it is still marked experimental in Node 22 and a release candidate in Node 24; the release must pin one exact Node version and the self-check proves it on the Pi |
| Lock waits | R-3a: `busy_timeout=0` in the API and a single-flight write gate (`src/core/writeGate.ts`) | The binding default |
| Password KDF | scrypt, N=2^15, r=8, p=1 (32 MiB), `node:crypto`, at most 2 hashes at once | Built in, memory-hard, asynchronous. 74 ms per hash on this Mac; the Pi figure is PERF-1 |
| Config format | TOML (`smol-toml`), unknown tables and keys refused | R-7 |
| Language | TypeScript, erasable syntax only; Node runs it directly in development, `tsc` emits plain JavaScript for the release | Same language as the frontend; no build tool on the bag |
| AES zip | Own AE-2 writer on `node:crypto`/`node:zlib` (`src/exports/archive.ts`) | Proven approach of `poc/poc_ae2.mjs`; the password is a function argument, never argv or environment |
| Tests | `node:test`, real SQLite files, real HTTP on loopback, real forked job processes; nothing mocked | A mock would hide exactly the failures this system is about |

## 3. Package BE, item by item

| # | Status | Where | Tests (laptop) |
|---|---|---|---|
| BE-1 skeleton, config, connection routine, `BEGIN IMMEDIATE`, release build | **Built.** Release build is `npm run build`; the `linux-arm64` bundle with the pinned runtime is DEV-5 | `src/config.ts`, `src/core/db.ts`, `src/core/writeGate.ts`, `src/app.ts`, `bin/` | `core.test.ts`; **DB-6 on the Pi is open** |
| BE-2 migrations, conformance | **Built** | `migrations/`, `src/core/migrate.ts` | Migrated schema compared statement by statement with the DDL in DATABASE.md (DB-3) |
| BE-3 core | **Built** | `src/core/` | Idempotency, CSRF, Origin, Host, ETag, log filter, epoch lift (SEC-2, SEC-7) |
| BE-4 identity | **Built**, except the online send (phase 2) | `src/identity/` | Role matrix generated from `x-auth` in `openapi.yaml` for all 66 operations; lockout incl. parallel attempts; sessions; accounts; override flow, binding, expiry, presence (SEC-1, SEC-3, SEC-11, SEC-12 on a laptop) |
| BE-5 catalog | **Built** | `src/catalog/` | Renumbering property test (DB-4), publish rules, questions, `pack_owned`, `If-Match` |
| BE-6 learners | **Built** | `src/learners/` | Monotonic, coalescing, `409 sensitive_lesson`, "3 pauses + 2 finish retries → +1/+1", guest counted, no write to the main database or its WAL (SEC-10) |
| BE-7 media | **Built.** PDF pages are untested here (no `pdftoppm` on this Mac) | `src/media/` | Single and resumable upload with wrong offsets and three forced disconnects, one upload id; sniffing; zip-slip; package checks; `.docx` text; voice conversion with real `ffmpeg`. The 300 MB run is a Pi test (PL-2) |
| BE-8 worker and maint | **Built** | `src/worker/`, `src/system/maint.ts` | Real supervisor and child processes; worker-start recovery; expiry by uptime; retention run; secrets sweep (PL-6 on a laptop). Stall timeout and the temperature pause are not exercised by a test |
| BE-9 exports | **Built.** Download path tested end to end; **every USB path is untested** (no stick, no root helper) | `src/exports/` | EX-2…EX-7 on a laptop, tickets, Range, checks, stick retention on a folder, privacy scan (SEC-E2 part). `age` is replaced by a pass-through in tests |
| BE-10 boot recovery, restore | **Built.** Update-journal handling waits for BE-12 | `src/system/bootstrap.ts`, `src/system/restore.ts`, `src/core/replace.ts` | Unclean boot, `checking` → re-hash, corrupt database → snapshot + new epoch, a non-corruption failure is not rolled back, restore with `--min-epoch`, `new-epoch` re-stamp (DB-5, SYNC-1 logic) |
| BE-11 system | **Built** | `src/system/routes.ts`, `src/exports/routes.ts`, `src/catalog/pack.ts` | Status, audit, accounts, clock (with fake helper), content-pack install with real OpenSSH signatures |
| BE-12 update tool `sensebod-offline-update` | **Not built.** `release_stage` jobs end `failed/not_built` and change nothing | — | — |

## 4. Requirements R-1…R-12 (SYSTEM-ARCHITECTURE §4.1)

| R | How it is met | Code | Test |
|---|---|---|---|
| R-1 streamed uploads, fsync before acknowledging | Upload routes are mounted before the JSON reader; the request is piped through a byte counter to the `.part` file; `handle.sync()` then the commit of `received_bytes`, then the answer | `src/media/routes.ts` (`receive`) | `pipeline.test.ts` "resumable…", "a photo…" |
| R-2 driver abilities | See section 2 | `src/core/db.ts` | `core.test.ts` "busy is a distinguishable error", self-check |
| R-3 serialized writes, nothing asynchronous inside | `Db.tx` takes a synchronous function and refuses a Promise; one connection per process | `src/core/db.ts` | `core.test.ts` "async work is refused inside it" |
| R-3L lock wait never blocks HTTP; 5 s from arrival; `503 busy` | `WriteGate`: promise queue, head retries `BEGIN IMMEDIATE` with timer backoff 5…200 ms ±20 %, deadline from the request's arrival | `src/core/writeGate.ts`, `Ctx.write` | `core.test.ts` write gate (100 writes behind a 400 ms lock, loop lag < 200 ms; refusal at the deadline). **DB-6 with p99 < 50 ms must be measured on the Pi** |
| R-3H lock-hold discipline | Small transactions; batches of 500 with 100 ms pauses; progress at most every 2 s; `TRUNCATE` only with no job running, on a 100 ms connection | `src/system/maint.ts`, `src/worker/supervisor.ts` | Not measured (P-3, DB-6) |
| R-4 memory-hard KDF | scrypt, self-describing string, constant-time compare, asynchronous, 2 at a time, one attempt per account at a time | `src/identity/passwords.ts`, `routes.ts` | `identity.test.ts` |
| R-5 migrations | Numbered, one transaction each with its `schema_migrations` row and checksum; never at API start (the API only asserts the head) | `src/core/migrate.ts`, `src/system/start.ts` | `core.test.ts` schema conformance |
| R-6 worker, one child per job, stall timeouts | `child_process.fork` of `runner.ts`; progress and results over IPC; the child never writes job state | `src/worker/` | `pipeline.test.ts` |
| R-7 config, unknown keys refuse | `buildConfig` | `src/config.ts` | `core.test.ts` |
| R-8 AES-256 zip, password never on argv/env | In-process writer; password read from the tmpfs file | `src/exports/archive.ts`, `jobs.ts` | Own reader + **libarchive (`bsdtar`) opens it and refuses a wrong password**. 7-Zip and ZArchiver are P-2 |
| R-9 route-template logging | `requestLog`, no access logger | `src/core/http.ts`, `src/core/log.ts` | `core.test.ts` "the request log holds route templates only" |
| R-10 CSRF header, Origin, Host | `csrf`, `hostAllowList` | `src/core/http.ts` | `core.test.ts` |
| R-11 self-contained release, self-check | No native modules; `bin/sensebod-offline-selfcheck`. The arm64 bundle and pinned runtime are DEV-5 | `src/system/selfcheck.ts` | Run from `dist/` on the Mac |
| R-12 one API process | In-memory state is limited to: re-authentication marks, per-IP override windows, honoured stick insertions, in-progress idempotency marks, upload writers. All of it fails safe when lost (asks again), but none of it would be shared by a second API process | — | — |

## 5. Owner decisions applied (they override the documents)

| Decision | In the build |
|---|---|
| Child protection option A: counts only | `counts.sqlite3`; `409 sensitive_lesson`; never in exports per learner |
| Password set by EasySTEM; no local reset | `create-hub-manager` sets no forced change; `PATCH /admin/accounts` refuses passwords |
| Override code | Built as ADR-017. **O-17: no identity procedure** is an office-tool matter; on the bag the banner, audit and binding are unchanged |
| Data goes to EasySTEM; two months | `backup-records` counts as "exported"; `retention.learner_days = 61` |
| **O-16: hold unexported data 60 extra days, then remove** | `retention.unexported_hold_days = 60` (default), hard stop at 121 days; tests in `content.test.ts`. DATA-EXPORT §8.1 and DATABASE §7 still say 30 days and option B "recommended": **those two texts and `poc_retention_clock.py` were not edited** (they are the architect's documents; say if I should) |
| O-15: two roles | `hub_manager` everything; `admin` content and export |
| **V-039** (deferred to the build) | The clock change is written to `run/clock.json` as *pending, hand-set* and audited **before** the root unit applies it; boot recovery keeps a hand-set date `manual` (never `rtc`) until NTP confirms it; `manual` never counts as trusted for override expiry |
| **V-038** (deferred to the build) | At most 20 stick insertions are honoured for presence per 24 h of uptime (`MAX_HONOURED_INSERTIONS`); tokens 3 per hour per address. Guessing bound restated: (2,000 + 20 × live tokens) × 5 per 24 h, live tokens ≤ 3 × addresses in the two /24 pools (≈ 400) = 1,200 → ≤ 130,000 guesses × 2^-50 ≈ 1.2 × 10^-10 per day |

## 6. Deviations from the documents, stated

1. **Export password**: five words from a 500-word list plus two digits (≥ 51 bits), not four from 2,048. Same strength; the list is short enough to keep in the source.
2. **Restricted override session**: the schema has no "restricted" column. Accepting a code replaces the account's password hash with a marker no password matches and sets `must_change_password`; a session of such an account may only set a new password, and needs no current password. The forgotten password is void from that moment.
3. **`encrypted: false` for learner data is refused** (422). The document allows it "only if the owner allows it"; the owner has not.
4. **Job results** (which smaller copy, which pages belong to an upload) are kept in `job.payload_json.result`; a lesson remembers its uploads in `body_json.uploadIds`. No schema change.
5. **Originals the store cannot hold** (`.mov`, `.3gp`, `.wav`, `.aac`, `.docx`, `.zip`; `blob.ext` has a fixed list) are converted or unpacked and not kept.
6. **`epoch.floor`**, a small file beside the database, remembers the highest epoch given out, so two recoveries from one snapshot never reuse an epoch (reviewer BR-005).
7. **Content pack manifest** (`sensebod-offline-pack/1`) is defined in `src/catalog/pack.ts`; the architecture names the file but not its fields. DEV-5's pack builder must write this shape.
8. **Stick media retention** reads a plain `<backup>.sbk.media.json` beside each backup (hashes of lesson files), because the bag cannot read its own encrypted manifests.
9. **Restore after the swap**: if the power fails between the swap and the end, boot recovery does not continue the restore by itself; it keeps the bag in maintenance mode until the technician runs the restore again. The document asks for automatic continuation.

## 7. Not built, and not verified

**Not built**
- BE-12 `sensebod-offline-update` (journaled A/B update, rollback) and the `release_stage` job.
- Online password reset (`send-online`): phase 2 by the architecture.
- Unpublishing lessons whose files are missing at boot (DATA-EXPORT §13 step 9, second half); done at restore only.
- Provisioning from the `age`-encrypted bundle (`sensebod-offline-admin provision`, DEV-2); `init` takes the override secret as an argument of the function only.
- Deployment files (systemd, nginx, udev, polkit, root helpers): package DEV.

**Built but never run for real**
- Anything on a USB stick: learner data, records and full backup to a stick, stick check, format, eject, presence by insertion. The code paths exist; `usb.json`'s shape (section 8) is my assumption of what the root helper will write.
- `age` encryption (a pass-through stand-in in tests), `pdftoppm`, `systemctl`.
- Stall timeouts, the unkillable-child path, the temperature pause.

**Open acceptance tests (Pi, phones, rig):** P-1 self-check on the kit Pi; P-2 zip in 7-Zip and ZArchiver, `/proc` shows no password; P-3 commit rate and snapshot time; DB-6 event-loop delay under an injected lock holder; PERF-1 scrypt time; PL-1…PL-7 power cuts; BK-1…BK-3 restore drill with real `age`; USB-1…USB-4; DL-1…DL-6 on phones; CON-1 40 phones; SEC-7 with nginx in front.

## 8. What this backend expects from the other packages

**Frontend (FE-1, not done yet): every non-GET request must carry `X-Sensebod-Offline-Client: 1`.** The current `app/src/shared/api/client.ts` does not send it, so against this backend every save, sign-in and upload from the app answers `403 csrf`. It is a one-line change there plus the upload XHR. FE-3 (resumable uploads), FE-4 (Child protection activity endpoint), FE-5 and FE-6 are also needed for the new behaviour.

**DevOps**
- nginx: `proxy_set_header X-Forwarded-For $remote_addr` (as today) and nothing else setting it; `/_protected/exports/` internal location; `proxy_request_buffering off` on the upload locations; no access log for `/api/`.
- systemd: `UV_THREADPOOL_SIZE=8`; the units and hardening of §10.2; `sensebod-offline-boot-recover` before worker and API.
- Root helper `sensebod-offline-usb@` writes `/run/sensebod-offline/usb.json`: `{ state, kernelName, label, filesystem, totalBytes, freeBytes, dirtyNote, repaired, stick: { label, formattedBy } | null, lastAddAtBootS }` where `lastAddAtBootS` is the time of the last USB block-device add event in seconds since boot (`/proc/uptime`).
- Request files in `/run/sensebod-offline/requests/<nonce>.json`: clock `{ unixSeconds, nonce, at }`, format `{ label, confirm, kernelName, nonce, at }`.
- `run/clock.json` (data directory): boot recovery writes `{ trust, handSetUnconfirmed, pending, lastSeenWall }`; the clock unit only sets the time.

## 9. Independent review

Round 1 (`docs/reviews/backend/BACKEND-REVIEW-1.md`, on the first third of the code): FAIL, 4 High, 11 Medium, 20 Low. **Fixed since:** BR-001 (client address from `X-Forwarded-For`), BR-002 (parallel wrong passwords), BR-003 (only corruption triggers a rollback), BR-004 (replacement staged, lifted, then swapped; cut-safe), BR-005 (epoch floor), BR-006 (migrations with foreign keys off and a check), BR-007 (arrival time kept through the body reader), BR-008 (request cookie lifetime), BR-009 (session re-checked in the password transaction), BR-010 (`[dev]` needs `SENSEBOD_OFFLINE_DEV=1`), BR-011 (storage errors logged), BR-012 (durable-write helpers), BR-013 (ETag includes version and lineage), BR-019, BR-020, BR-021, BR-022. **Open:** BR-014 (reads are not retried on BUSY; they answer 503), BR-015 (pin Node in the release), BR-017 (snapshot rotation trusts file dates), and the remaining Low findings.

Round 2 (`docs/reviews/backend/BACKEND-REVIEW-2.md`, on the whole build): FAIL, 0 Critical, 2 High, 11 Medium, 12 Low; the four round-1 High findings verified fixed (BR-004 partly). **Fixed since, each with a regression test in `test/regress.test.ts` where marked †:** BR-036† (garbage collection stopped for good on a file an old upload still named), BR-037† (a Try it lesson saved twice lost track of its files), BR-038† (the upload is kept until the row that stores it is committed), BR-039† and BR-040† (only a fully staged, lifted replacement is finished at boot; a sound database left in rollback mode is switched to WAL), BR-041† (no learner name in the idempotency record), BR-042 (a stalled job is stopped together with the tools it started), BR-043 (an ending that could not be written is retried, so a job never stays `running`), BR-044† (a restore cut after the swap keeps the bag closed), BR-045 (signatures are checked on a stream), BR-046 (unpacked packages are fsynced before their row), BR-047 (long names in the package archive), BR-048 (`new-epoch` stops the services first). **Not re-verified by the reviewer.** **Open:** BR-011 (partly), BR-014, BR-015, BR-017, and the Low findings of both rounds (27 in all); none of them is a data-loss or security finding in the reviewer's rating. The reviewer's standing remark holds: no test here would fail if every `fsync` were removed; that is what the power-cut rig (PL-1…PL-5) is for.

Round 3 (`docs/reviews/backend/BACKEND-REVIEW-3.md`, verification of the round-2 fixes and audit of the rename to sensebod-offline): FAIL, 0 Critical, 1 High, 5 Medium, 5 Low new (BR-061 to BR-071). Of the 13 round-2 fixes: 9 verified fixed, 4 partly (BR-038, BR-042, BR-044, BR-046). The rename was found clean in the backend, the tests and `openapi.yaml`. **Fixed since († = regression test):** BR-061† High (boot recovery deleted the raw file of an upload still being processed; this also completes BR-038), BR-062† (a log of the replaced database could be replayed onto the staged file finished at boot), BR-063† (the restore journal now says `swapping` before the swap, the bag stays closed from then on, and a refused second run no longer clears the journal), BR-064 (the stream on the stick is closed when the signature tool leaves early; a check that did not finish is not cached), BR-065 (restore unpacks `tryit/*.tar` from the stick and unpublishes lessons whose animation did not come back), BR-066 (`app/deploy/nginx.conf` and `Caddyfile` use the sensebod-offline paths). **Not re-verified by the reviewer; BR-064 and BR-065 have no test.** **Still open:** the rest of BR-042 (the `SIGKILL` follow-up does not reach a hung tool), BR-044 (counts swap, media `fsync`, `replaced-*` sweep), BR-046 (orphan `media/tryit/` folders are never removed); BR-011, BR-014, BR-015, BR-017; round-2 BR-060, which the reviewer recommends raising to Medium (`/admin/status` reports `lastQuickCheck: 'ok'` as fixed text); and the Low findings of all rounds.
