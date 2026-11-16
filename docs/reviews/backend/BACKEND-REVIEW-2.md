# Sensebod backend review, round 2

Reviewer: Senior Backend Best Practices, Code Quality and Architecture Compliance Reviewer (independent quality gate, read-only)
Date: 13 Nov 2026
Runtime under review: Node.js + Express 5 + TypeScript, SQLite through the built-in `node:sqlite` driver (owner decision)
Previous round: `docs/reviews/backend/BACKEND-REVIEW-1.md` (FAIL, 4 High, 11 Medium, 20 Low, on the first third of the code)

---

## 1. Scope reviewed

The whole backend as it stood at the start of this round: 73 source, script, test and configuration files, about 14,500 lines. Every file under `backend/src`, `backend/bin` and `backend/migrations` was read in full. The tests were read for what they prove (titles, harness, and the critical cases in detail). `backend/docs/BUILD-STATUS.md` was read as a claim and checked against the code.

### 1.1 Files reviewed

| Area | Files (lines) |
|---|---|
| Assembly and entry points | `src/app.ts` (65), `bin/sensebod-api.ts` (85), `bin/sensebod-worker.ts` (25), `bin/sensebod-maint.ts` (18), `bin/sensebod-boot-recover.ts` (17), `bin/sensebod-admin.ts` (244), `bin/sensebod-selfcheck.ts` (7), `src/version.ts` (27) |
| core | `config.ts` (278), `core/context.ts` (281), `core/db.ts` (194), `core/errors.ts` (52), `core/fsx.ts` (100), `core/http.ts` (324), `core/idempotency.ts` (157), `core/ids.ts` (66), `core/log.ts` (58), `core/migrate.ts` (106), `core/replace.ts` (182), `core/time.ts` (22), `core/writeGate.ts` (98) |
| identity | `identity/override.ts` (338), `identity/passwords.ts` (124), `identity/routes.ts` (362), `identity/sessions.ts` (184) |
| catalog | `catalog/model.ts` (486), `catalog/routes.ts` (695), `catalog/validate.ts` (144), `catalog/pack.ts` (256), `catalog/seed.ts` (187, skimmed) |
| learners | `learners/routes.ts` (280), `learners/retention.ts` (162) |
| media | `media/routes.ts` (384), `media/store.ts` (132), `media/jobs.ts` (489), `media/zip.ts` (180), `media/types.ts` (120), `media/attach.ts` (204) |
| exports | `exports/routes.ts` (439), `exports/jobs.ts` (942), `exports/archive.ts` (230), `exports/usb.ts` (178), `exports/snapshots.ts` (178), `exports/words.ts` (48) |
| system | `system/bootstrap.ts` (546), `system/maint.ts` (406), `system/restore.ts` (374), `system/routes.ts` (338), `system/privileged.ts` (68), `system/start.ts` (54), `system/selfcheck.ts` (109, skimmed), `system/devFiles.ts` (39) |
| worker | `worker/supervisor.ts` (302), `worker/runner.ts` (83), `worker/registry.ts` (47), `worker/queue.ts` (41), `worker/types.ts` (48) |
| Schema and settings | `migrations/main/0001_initial.sql` (391), `migrations/counts/0001_initial.sql` (18), `package.json` (28), `tsconfig.json`, `tsconfig.build.json`, `dev/sensebod.dev.toml` (26) |
| Tests | `test/harness.ts` (224), `test/core.test.ts` (324), `test/identity.test.ts` (358), `test/content.test.ts` (420), `test/pipeline.test.ts` (734), `test/pack.test.ts` (88), `test/restore.test.ts` (110) |

### 1.2 Not built (checked against BUILD-STATUS §7; these are not findings)

- BE-12, the update tool (`release_stage` jobs end `failed/not_built`), and with it boot-recovery step 2 for an interrupted update.
- The online password reset (`send-online` answers `503 offline`).
- Unpublishing lessons whose files are missing at boot (done at restore only).
- Provisioning from the encrypted bundle.
- All deployment files: systemd units, nginx additions, udev and polkit rules, root helpers (package DEV).

### 1.3 Baseline checks

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | 85 of 85 pass, 0 skipped, about 12 s |
| `npm run build` | Pass. Run with `--outDir` pointing at the scratch folder so nothing in the repository changed |
| `npm audit --omit=dev` | `found 0 vulnerabilities` |
| Migration vs DATABASE §6 | Unchanged since round 1 (identical apart from one header comment line each); a conformance test now exists (`test/core.test.ts:58`) |
| Machine | Mac, Node v23.10.0, SQLite 3.49.1; `ffmpeg` present; `pdftoppm` and `age` not installed |

### 1.4 Probes

All probes ran in the scratch folder only: `/private/tmp/claude-501/-Users-abdulrahimjalloh-Desktop-EasySTEM-easystemoffline/f08098b0-2c24-43cb-a374-808b46242f2e/scratchpad/probe/` (round-1 probes `p2.ts`–`p5.ts`, re-run) and `/private/tmp/claude-501/-Users-abdulrahimjalloh-Desktop-EasySTEM-easystemoffline/f08098b0-2c24-43cb-a374-808b46242f2e/scratchpad/probe2/` (new: `p6.ts` garbage collection, Try it, learner name, inspect retry; `p7.ts` boot recovery; `p8.ts` `[dev]` switches; `p9.ts` contract shapes and tickets; a copy of `src/core` plus migrations with an added rebuild migration for BR-006). They import the backend sources unchanged, use the repository's own test harness with the temp folder redirected to the scratch folder, and run the real API, the real worker supervisor and real job child processes. Nothing was run on a Pi, with a stick, with `age`, or behind nginx.

---

## 2. Executive summary

**The build is complete for what package BE asked on a laptop, and it is good work.** The structure is clear, the code is consistent with round 1's quality, there are still only two runtime dependencies, nothing touches the network, every external command is started with an argument array and no shell, and no secret is ever placed on a command line. The 85 tests use real SQLite files, real HTTP and real forked job processes.

**Round-1 fixes: 16 of 17 claimed fixes are verified.** Three of the four High findings are closed (BR-001, BR-002, BR-003). BR-004 is closed for every path that starts with a live database, with one residual case (BR-040) and one new power-cut window that the fix opened (BR-039).

**What works, with evidence from this round.**
- Upload chunks: bytes are written, the file is `fsync`ed, and only then is `received_bytes` committed with a compare-and-set on the old value. One writer per upload. Wrong offsets and cut connections were exercised by the tests; boot recovery cuts a `.part` back to the committed value.
- Export publication: file `fsync` → rename → directory `fsync` → result to the supervisor → row. A file without a `ready` row is never served and is removed at boot.
- The one-time export password is only in a tmpfs file and in the single `202` answer. It is not in SQLite, not in the idempotency record, not in the job payload, not in any log line, not on any command line.
- Child protection: `PUT` progress on a sensitive lesson writes nothing; the anonymous counter writes only to `counts.sqlite3`; exports leave sensitive portals out whatever the mode; counts are whole past months with small numbers masked.
- Every one of the 66 operations of `openapi.yaml` is routed, and the route list in the code equals the contract's list exactly. The role-matrix test is generated from `x-auth` and really checks `401` and `403` for each one.
- Tickets: a forged ticket and a ticket for another export are refused (`403`); a valid ticket works without a cookie, as designed.
- Contract samples (Upload, Export, AdminStatus, StorageInfo, LearnerDataSummary, UsbState, AdminLesson, LibraryPage, Portal, PortalDetail, Lesson, Learner, LessonProgress, AdminSession): required fields present, no wrong nulls, no wrong types.
- The zip reader refuses unsafe names, links, encrypted and zip64 archives, and bounds entries, ratio and bytes written.
- No API code writes to SQLite outside `ctx.write` / `ctx.writeCounts`.

**What blocks.** Two new High findings, both in the area the coordinator asked about first:
1. **Garbage collection stops for good** the first time it meets a file that an upload row still points at. The delete breaks a foreign key, the batch rolls back, the task is reported `failed`, and the same happens on every later run. Storage is never reclaimed, and the clean-up steps that follow in the same task (unused animation packages, orphan files, copies of corrupt databases) never run.
2. **Saving a "picture with spots" Try it lesson a second time removes the records that tie its scene picture and spot sounds to the lesson.** The files then count as unused. Today they survive only because of finding 1; as soon as that is fixed, the collector would delete files that a published lesson shows.

**Medium findings (11)** are mostly power-cut and failure windows: an upload is lost if power fails between "file moved into the store" and "row committed"; a cut at one exact step of a database replacement leaves a sound database that boot recovery refuses; a stalled conversion's `ffmpeg` keeps running; a learner's name stays in the idempotency record after "Remove my name".

**Architecture compliance: good.** R-1 to R-12 are implemented as BUILD-STATUS says, with the deviations it lists. Open from round 1: reads are not retried on BUSY (BR-014), file reads inside transactions (BR-023).

**Offline readiness: pass.** No network use anywhere; start-up waits at most 3 s on a local command.

**Security: acceptable with fixes.** No Critical or High security defect was found this round. Open items are Medium or Low (BR-041 privacy, BR-045 memory in the API, BR-048 operator safety).

**Database reliability: mostly sound.** Normal operation is solid. Recovery paths are much better than in round 1 and have two remaining windows (BR-039, BR-040) and an unfinished restore case (BR-044).

**Production readiness: not yet.** The two High findings must be fixed, and nothing has run on the Pi, with a stick, with `age` or behind nginx.

---

## 3. Review matrix

| Area | Status | Notes |
|---|---|---|
| Node/TypeScript/Express practices | Pass | Strict, small, consistent; body parser kept off upload routes; async handlers; remaining notes are Low |
| Architecture compliance | Partial | R-1…R-12 implemented; BR-014, BR-023 open; restore continuation deviates (BR-044) |
| Database and transactions | Partial | Gate, transactions, migrations pass; BR-039, BR-040, BR-043 |
| API contract compliance | Pass (sampled) | All 66 operations routed; 14 schemas sampled; small notes in BR-059 |
| Offline independence | Pass | |
| Synchronisation | Partial | Epoch, nonce, floor, re-stamp work (probed); BR-040, BR-048 |
| Authentication and security | Partial | Round-1 Highs closed; BR-041, BR-045 Medium |
| CPU and memory efficiency | Partial | BR-042 (orphan tools), BR-045, BR-050, BR-054 |
| Storage efficiency | Fail | BR-036: nothing is ever reclaimed |
| Background processing | Partial | Supervisor state machine has no double settle; BR-038, BR-042, BR-043 |
| Deployment configuration | Partial | `[dev]` guarded; Node still not pinned (BR-015); deployment files not built |
| Backup and recovery | Partial | Download path verified on a laptop; BR-039, BR-040, BR-044, BR-047; every stick path and `age` unverified |
| Test quality | Partial | Real components, good breadth; gaps in §8 let both High findings through |

---

## 4. Round 1 findings re-verified

| ID | Round-1 severity | Claimed | Status now | Evidence |
|---|---|---|---|---|
| BR-001 client address | High | Fixed | **Verified** | The address now comes from the last `X-Forwarded-For` value, which the existing `app/deploy/nginx.conf` line 96 sets and overwrites. Probe: a session cookie replayed with another `X-Forwarded-For` → `401`; a client-sent `X-Real-IP` is ignored. Note: without the header every phone is still `127.0.0.1`, so the nginx line is now a hard requirement (it is listed in BUILD-STATUS §8) |
| BR-002 parallel lockout | High | Fixed | **Verified** | Probe: 20 parallel wrong sign-ins → 5 × `401`, 15 × `429`, `failed_count = 5`, lock set |
| BR-003 any open failure = corruption | High | Fixed | **Verified** | Probe: unreadable file → boot recovery stops with the error and changes nothing; a truly damaged file → rolled back to the snapshot. Side effect: BR-039 |
| BR-004 replacement order and atomicity | High | Fixed | **Partly** | Probe: a failed copy leaves the live database in place. The epoch is lifted in the staged file before the swap. Residual: BR-040 (a staged file is finished blindly when no live file exists); new window: BR-039 |
| BR-005 epoch reuse | Medium | Fixed | **Verified** | Probe: two recoveries from one snapshot → epochs 2 then 3 (`epoch.floor`) |
| BR-006 migration rebuild | Medium | Fixed | **Verified** | Probe through the real runner (scratch copy with an added rebuild migration): child rows survive, `foreign_keys` back on. No test in the repository covers it |
| BR-007 arrival time | Medium | Fixed | **Verified** | Probe: the store is present after the body reader, with the body in the same packet and 150 ms later |
| BR-008 request cookie | Medium | Fixed | **Verified** | `Set-Cookie: sb_ovr=…; Max-Age=2592000` |
| BR-009 session re-check | Medium | Fixed | **Verified (by reading)** | `identity/routes.ts` re-checks the session row inside the transaction; no race probe was run |
| BR-010 `[dev]` switches | Medium | Fixed | **Verified** | Without `SENSEBOD_DEV=1` any used `[dev]` value is refused |
| BR-011 storage errors | Medium | Fixed | **Partly** | Corrupt and full errors are now logged (`core/http.ts`). Still open: `storageFull(0, 0)` reports no real figures, and nothing sets a flag that `/health` or `/admin/status` shows |
| BR-012 durable-write helpers | Medium | Fixed | **Verified (by reading)** | `fsyncDir` rethrows real errors; `writeFileDurable` loops. A failed write still leaves its temp file |
| BR-013 ETag | Medium | Fixed | **Verified (by reading)** | The tag now holds the version and the epoch nonce |
| BR-014 reads not retried | Low | Open | **Open** | `readWithRetry` still unused |
| BR-015 Node not pinned | Medium | Open | **Open** | `engines` is still `>=22.13.0`; development is on v23.10.0 |
| BR-016 idempotency slot | Low | — | **Open** | Unchanged; all five callers abort correctly |
| BR-017 snapshot rotation and clock | Medium | Open | **Open** | `rotateSnapshots` is called without clock trust (`system/maint.ts:176`). The "clean" route now asks for a new snapshot at once, which shortens the gap to one maintenance interval |
| BR-018 counts snapshot | Low | — | **Open** | `exports/snapshots.ts` unchanged; counts restore in boot recovery still has no `fsync` before rename |
| BR-019 `checking` → `ready` | Low | Fixed | **Verified** | Probe: stays `checking` after a clean boot |
| BR-020 `dirBytes` links | Low | Fixed | **Verified** | Probe: 10 bytes, the link is not followed |
| BR-021 malformed URL | Low | Fixed | **Verified** | Probe: `400 bad_request`, the parameter text is no longer logged (see BR-059 for two small notes) |
| BR-022 `Origin: null` | Low | Fixed | **Verified** | Probe: `403`. To check on old phones: the app's `Referrer-Policy: no-referrer, same-origin` could make a browser that only knows `no-referrer` send `Origin: null` on same-origin saves |
| BR-023 file reads in transactions | Low | — | **Open** | Unchanged; new instance in the boot transaction |
| BR-024 gate re-runs callback | Low | — | **Open** | Probe: still 30 runs |
| BR-025, BR-026, BR-028, BR-029, BR-031, BR-032, BR-033 | Low | — | **Open** | Unchanged (`port = 70000` still accepted) |
| BR-027 writes outside the gate | Low | — | **Open, no violation found** | No guard exists, but a search of all API code found no write outside `ctx.write` / `ctx.writeCounts` |
| BR-030 migration bookkeeping | Low | — | **Not re-checked** | |
| BR-034 lockout side effects | Low (architecture) | — | **Owner decision pending** | |
| BR-035 job changes without `version` | Low | — | **Open, lower risk** | `PATCH` now merges into the stored body inside the transaction, so a job's changes are kept unless the admin sends the same part |

Nothing that a fix changed made an existing test fail. The one regression found is BR-039.

---

## 5. Findings (new in round 2)

Type legend as in round 1: **defect** (confirmed), **deviation**, **risk** (not confirmed as a failure), **improvement**.

### HIGH

#### BR-036 — Garbage collection fails for good on the first file an upload row still points at
- **Severity:** HIGH · **Category:** Storage / maintenance · **Type:** defect (confirmed)
- **Where:** `backend/src/system/maint.ts` lines 286–294 (delete loop), 296–320 (the steps that never run); schema: `upload.blob_sha256 REFERENCES blob(sha256)` (`backend/migrations/main/0001_initial.sql`, table `upload`).
- **Problem:** the collector's idea of "in use" covers an upload only for 7 days. After that the stored file may be marked unused and, 24 hours later, its `blob` row is deleted. But the `upload` row keeps its `blob_sha256` for ever (upload rows are never removed, also not when the upload is deleted), and that column is a foreign key. The `DELETE FROM blob` therefore fails with a constraint error. The error is thrown inside the batch transaction, so the whole batch rolls back and the task ends as `failed`. The same row is picked again at every run.
- **Evidence (probe `p6.ts`, real API and worker):** a photo was uploaded, became `ready`, was deleted by the admin, and the rows were aged. First run: `{"marked":1,"deleted":0}`. Second run: `SqliteConstraintError: FOREIGN KEY constraint failed`; the row and the file are still there; `runMaintenance` reports `"garbage":"failed"`. After clearing `upload.blob_sha256` by hand: `{"deleted":1}`.
- **When it happens on a bag:** always, in ordinary use: a lesson made from an uploaded file is deleted (or an upload is never used) → 7 days + 24 hours later every maintenance run fails at this step.
- **Impact:** files of deleted lessons, replaced videos and their smaller copies are never removed, so the card only fills. When free space reaches the reserve, uploads answer `507` and exports and snapshots stop. In the same task, and after the failing loop: unused animation packages are never removed, orphan files moved aside at boot are never removed (7-day rule), and copies of corrupt databases, which hold learner names, are never removed (the 90-day promise of DATABASE §7).
- **Root cause:** the reference from `upload` to `blob` was not counted when deciding what can be deleted, and one failing row aborts everything after it.
- **Recommended correction:** fix together with BR-037. In the delete transaction, first set `upload.blob_sha256 = NULL` (and state `abandoned` for uploads that are `ready` but now have no file) for the blob being removed, then delete the blob. Delete row by row so one failure cannot stop the others, and give the package, orphan and corrupt-copy sweeps their own `step` in `runMaintenance` so they run even when blob collection fails.
- **Verify:** a test that uploads a file, makes and deletes a lesson, ages the rows, runs maintenance twice and expects the file gone, the task not `failed`, and an old orphan removed in the same run.

#### BR-037 — Saving a "picture with spots" Try it lesson again drops the records of its files
- **Severity:** HIGH (data loss once BR-036 is fixed; today the files are only marked) · **Category:** Media / data integrity · **Type:** defect (confirmed)
- **Where:** `backend/src/catalog/routes.ts` lines 560–578.
- **Problem:** every save in `hotspots` mode first deletes the lesson's `scene` and `spot_audio` rows in `lesson_asset`, and writes them again **only** when the request carries an upload id (`sceneUploadId`, `audioUploadId`). The second time an admin saves the same lesson (to move a spot or change a label), the page sends back what it was given: the scene as a URL and each spot's `audioUrl`. No upload id, so no row is written. The lesson still shows the picture and plays the sounds, but nothing in the database says it uses those files. The questions route next to it does this correctly: it looks the URL up in `blob` and writes the row (`routes.ts` lines 486–491).
- **Evidence (probe `p6.ts`):** first save with `sceneUploadId` → `lesson_asset: [{"role":"scene", …}]`. Second save with the returned scene URL and an edited label → `200`, the scene URL is kept, `lesson_asset: []`. After ageing the upload, the collector set `unreferenced_since` on the scene's blob while the lesson still pointed at it.
- **Impact:** a week after the upload, the scene picture and every spot sound of an edited Try it lesson count as garbage. With BR-036 fixed they are deleted a day later and learners get a broken picture and silent spots in a published lesson. It is exactly the "can it delete a file that is in use?" case.
- **Recommended correction:** resolve files from what will be stored, not from what the request happened to carry: for the scene URL, every `audioUrl` and every portrait under `/media/`, look up the blob by `rel_path` and insert the asset row (as the questions route does). Refuse a `/media/` URL that has no blob. As a safety net, let the collector also treat any blob whose `rel_path` appears in a lesson's `body_json` as in use.
- **Verify:** a test that saves a hotspots lesson twice (second time with URLs only), ages everything, runs maintenance and expects the files and the `lesson_asset` rows to be there.

### MEDIUM

#### BR-038 — An upload is lost if the job stops between "file moved into the store" and "row committed"
- **Category:** Data integrity / power loss · **Type:** defect (confirmed)
- **Where:** `backend/src/media/jobs.ts` lines 32–53 (`loadUpload`), 187–226 (`inspect`); `backend/src/worker/supervisor.ts` lines 249–268 (`finish`).
- **Problem:** the `inspect` job, in its child process, **renames** the upload's `.part` file into the media store. The `blob` row and `upload.blob_sha256` are written later by the supervisor. If anything stops in between (power cut, worker killed, the commit fails and the job is retried), the retry finds no `.part` file and no `blob_sha256`, and fails with `file_lost`: "Upload it again". The file is in the store, but nothing knows it, and boot recovery later moves it aside as an orphan. The module header says every media job "can simply be run again"; this one cannot.
- **Evidence (probe `p6.ts`):** `inspect.run` once → `.part` gone, file in the store, no blob row. `inspect.run` again → `JobFailure file_lost`.
- **Impact:** after a power cut at the wrong moment the admin must send a file of up to 2 GiB again over the bag's Wi-Fi. The window is short (the move, an `fsync`, one commit) but sits at the end of every upload, and power cuts are the normal failure here.
- **Recommended correction:** keep the `.part` until the row is committed: hard-link (or copy) it into the store and let the existing after-commit step remove the `.part`; or let a retry find the stored file by hashing the staging/destination name it would produce.
- **Verify:** a test that runs `inspect.run` twice without `finalize` and expects the second run to succeed.

#### BR-039 — A power cut at one step of a database replacement leaves a sound database that boot recovery refuses
- **Category:** Backup and recovery · **Type:** defect (confirmed; opened by the fixes of BR-003 and BR-004)
- **Where:** `backend/src/core/replace.ts` lines 159–168 (`finishIncoming`); `backend/src/system/bootstrap.ts` `openChecked` (lines 192–209); `backend/src/core/db.ts` lines 73–76 (WAL assertion).
- **Problem:** the staged database is kept in rollback-journal mode, renamed into place, and only then switched to WAL. If power fails after the rename and before the switch, the next boot finds a complete, lifted database that is not in WAL mode. Opening it throws "not in WAL mode", which is (rightly) no longer treated as corruption, so boot recovery exits with an error and the bag stays in maintenance until a technician comes.
- **Evidence (probe `p7.ts`):** a sound database set to `journal_mode=DELETE` → `bootRecover` throws "The database … is not in WAL mode (journal_mode=delete)"; no `boot.json` is written.
- **Impact:** a bag that was in the middle of healing itself after a power cut can be left unusable by a second cut. The window is a few milliseconds, but recovery runs exactly when power is unstable.
- **Recommended correction:** in boot recovery, when the file opens and passes `quick_check` but is not in WAL mode, set `journal_mode=WAL` and continue (the mode is a setting, not damage).
- **Verify:** the probe as a test: boot succeeds and the mode is `wal`.

#### BR-040 — Boot recovery finishes any staged `.incoming` file when no live database exists, without checking it
- **Category:** Synchronisation / recovery · **Type:** defect (confirmed; residual of BR-004)
- **Where:** `backend/src/system/bootstrap.ts` lines 243–251; `backend/src/core/replace.ts` lines 137–156.
- **Problem:** "a staged file and no live file" is taken to mean "the replacement was cut between moving the old file away and renaming the new one in". The same picture also arises when a replacement **started** without a live file (a restore onto a card that has no database yet, or onto a bag in maintenance because its file is missing) and was cut during the copy, the migration or the epoch lift. Boot recovery then renames a file that may be incomplete, half-migrated (its `-journal` is left behind under the old name) or not lifted.
- **Evidence (probe `p7.ts`):** a snapshot copied to `.incoming` (not lifted), no live file → boot note "A replacement of the database was finished after a power cut", the live database has epoch 1 and `change_seq` 0, the bag opens.
- **Impact:** the case round 1 described: a replaced database on the old epoch, whose new changes reuse sequence numbers the office may already hold.
- **Recommended correction:** write a small marker (for example `incoming.ready` with the new epoch) after the staged file is lifted and `fsync`ed, and finish a staged file at boot only when the marker exists and matches `epoch.floor`; otherwise remove the staged file and its `-journal` and stop for the technician.
- **Verify:** tests for both cases: marked and complete → finished; unmarked → not used.

#### BR-041 — A learner's name stays in the idempotency record after "Remove my name"
- **Category:** Privacy (V-013) · **Type:** defect (confirmed)
- **Where:** `backend/src/learners/routes.ts` lines 100–104 (create), 112–136 (delete); `backend/src/system/maint.ts` line 187; also `backend/src/learners/retention.ts` lines 115–128 and `backend/src/system/routes.ts` line 318.
- **Problem:** `POST /learners` stores its whole answer (`id`, `name`, `role`) in `idempotency_record`. Removing the learner (by the learner, by retention or by "clean") deletes the `learner` row with `secure_delete`, but not this copy. The copy is removed after 24 hours by a plain delete, without `secure_delete`, so the name also stays in freed database pages.
- **Evidence (probe `p6.ts`):** create "Fatmata Kamara", delete → `204`; the `learner` table has no such name; `idempotency_record.response_json` still holds `{"id":"lr-…","name":"Fatmata Kamara",…}`.
- **Impact:** the product says "Your name is removed now". For up to 24 hours it is still readable in the database, in every snapshot taken in that time and in any backup, next to the learner id; afterwards it may remain in free pages. The effort made for V-013 is undone by this one copy.
- **Recommended correction:** store only the id for replays of `POST /learners` (the `stored` option exists for this) and rebuild the answer from the `learner` row on replay (`404` if gone); or delete the matching idempotency rows inside the learner-delete transaction. Prune `idempotency_record` with `secure_delete`.
- **Verify:** the probe as a test: no row of the database file contains the name after deletion.

#### BR-042 — A stalled or stopped job leaves its external tool running
- **Category:** Background processing / resources · **Type:** defect (by reading; not probed)
- **Where:** `backend/src/worker/supervisor.ts` lines 239–245 (stall), 284–296 (stop); `backend/src/worker/runner.ts` (no signal handling); `backend/src/media/jobs.ts` lines 65–96 (`runTool`).
- **Problem:** on a stall the supervisor sends `SIGTERM` to the job's child process. The child is a Node process that started `ffmpeg` (or `pdftoppm`, `age`, `ssh-keygen`) as its own child without a process group, and it has no `SIGTERM` handler, so it dies at once and the tool lives on. The tool's own 2-hour limit died with the child. The job is then queued again and starts a second copy.
- **Impact:** the stall timeout exists to free the Pi from a hung conversion; today it frees the lane but not the CPU or memory. Three attempts can leave three hung `ffmpeg` processes inside the worker's memory limit. (At service stop systemd's `KillMode=mixed` cleans up; during normal running nothing does.)
- **Recommended correction:** start tools with `detached: true` and kill the process group, or handle `SIGTERM` in the runner and kill the running tool before exiting; in the supervisor, kill the group.
- **Verify:** a test with a stand-in tool that sleeps: after the stall, no such process is left.

#### BR-043 — A job whose ending cannot be written stays `running` until the worker restarts
- **Category:** Background processing · **Type:** risk (by reading)
- **Where:** `backend/src/worker/supervisor.ts` lines 270–281 (`fail`), 206–211 (`exit` handler).
- **Problem:** `fail` marks the entry settled, then tries to write the new job state. If that write throws (lock held for 5 s, disk full), the error is logged and nothing else happens: the row stays `running`, the lane goes on, and no later step looks for rows that are `running` without a process. An export in `preparing` then blocks every new export for that destination (`export_one_preparing`), and an upload stays "working" for ever. Related: the `exit` handler may see a child end before its last `done` message is delivered; it then records a failure for a job that finished.
- **Recommended correction:** keep unsettled failures in memory and retry them on the next tick; once per tick, treat any `running` row of the lane that is not the lane's current entry as an orphan (the same handling as at worker start). Use the `close` event, or a short grace period, before judging a child that exited without a message.
- **Verify:** a test that makes the failing write throw once and expects the job to end `failed` on the next tick.

#### BR-044 — A restore cut after the swap reopens the bag half-restored
- **Category:** Backup and recovery · **Type:** deviation (stated in BUILD-STATUS §6 item 9) with a cheap safe fix
- **Where:** `backend/src/system/restore.ts` lines 221–230 (swap), 232–288 (the steps after it); `backend/src/system/bootstrap.ts` (does not read `restore/state.json`).
- **Problem:** after `{step: swapped}` the restore still has to unpublish lessons whose files did not come back, close old jobs and exports, write new bag secrets and the audit event. If power fails in that part, the maintenance flag (in `/run`) is gone after the reboot, boot recovery does not look at `restore/state.json`, and the API opens on the restored database: published lessons with missing files are shown, the old ticket key and session pepper are still in use, and there is no restore record. Also in this file: the counts database is copied straight to its final name without temp file or `fsync` (lines 222–224), copied media files are not `fsync`ed (line 243), and the replaced database is moved to `db/replaced-<id>/`, which nothing ever removes (the 90-day sweep only matches `corrupt-`), so removed learners' names stay on the card.
- **Recommended correction:** in boot recovery, if `restore/state.json` says `swapped`, set the maintenance flag and stop with a plain note ("finish the restore"). Make the counts swap temp + `fsync` + rename. Sweep `replaced-*` like `corrupt-*`.
- **Verify:** a test that stops the restore after the swap and boots: the API must answer `503 maintenance`.

#### BR-045 — Looking at the USB stick loads a whole release file into the API's memory
- **Category:** Memory / API · **Type:** defect (by reading)
- **Where:** `backend/src/exports/usb.ts` lines 92–108 (`verifySignature`), 126–137 (`listPackages`); called from `GET /admin/usb` and the install route (`backend/src/exports/routes.ts` lines 376–378, 425).
- **Problem:** to check a signature the file is read completely with `readFile` and written to `ssh-keygen`. For a content pack that is a small manifest. For a release (`sensebod-release-*.tar`, which carries the runtime and will be tens to hundreds of megabytes) the whole file is held in the API process each time the cache misses.
- **Impact:** a memory spike in the one process every phone depends on (the unit's limit is 800 MB), triggered by opening the USB screen with an update stick in the bag.
- **Recommended correction:** stream the file into the child (`createReadStream(file).pipe(child.stdin)`), and do release verification in a job, not in a request.
- **Verify:** measure the API's memory while listing a stick with a 300 MB release file.

#### BR-046 — An animation package is recorded before its files are safely on the card, and leftovers are never removed
- **Category:** Data integrity / power loss · **Type:** defect (by reading)
- **Where:** `backend/src/media/jobs.ts` lines 436–465; `backend/src/media/zip.ts` lines 160–174; `backend/src/system/maint.ts` lines 296–301.
- **Problem:** the unpacked files are written without `fsync`, the folder is renamed into `media/tryit/`, and the row is committed. After a power cut the row can say "ready" while files are empty or cut short. If the job is retried after the rename, a second folder with a new id is made and the first has no row; the clean-up only removes folders that have a row.
- **Recommended correction:** `fsync` each file (or the whole tree) before the rename; at boot or in maintenance remove `tryit/` folders that no row names and that are older than an hour.
- **Verify:** a test for the orphan folder; the durability part needs the power-cut rig (PL tests).

#### BR-047 — The full backup silently leaves out package files with long names
- **Category:** Backup · **Type:** defect (by reading)
- **Where:** `backend/src/exports/jobs.ts` line 725; `backend/src/exports/archive.ts` line 160.
- **Problem:** the tar writer handles names up to 99 bytes. When animation packages are copied to the stick, files whose path is longer are skipped without a word, while the zip reader accepts names up to 240 characters. The backup is reported as complete.
- **Impact:** a restored bag can have Try it lessons that are missing files, with no sign in the backup, the audit or the restore summary.
- **Recommended correction:** write long names with the ustar `prefix` field (up to 255) or a PAX header, and fail the backup if a file cannot be stored.
- **Verify:** a package with a 150-character path survives backup and restore.

#### BR-048 — `new-epoch` runs on a live bag after only printing a notice
- **Category:** Synchronisation / operator safety · **Type:** risk
- **Where:** `backend/bin/sensebod-admin.ts` lines 170–175; `backend/src/system/restore.ts` lines 333–372.
- **Problem:** the command prints "Stop sensebod-api and sensebod-worker before this" and goes on. It reads the rows to re-stamp outside the transaction; rows the running API changes in between keep old-lineage numbers under the new epoch. The `restore` command does stop the services itself.
- **Recommended correction:** stop and start the services as `restore` does (or refuse while the API answers on its port), and select the rows inside the transaction.
- **Verify:** test: a write between the read and the transaction is still re-stamped, or the command refuses.

### LOW

#### BR-049 — Conversion results are pruned after 30 days although lessons can still need them
- **Where:** `backend/src/system/maint.ts` line 188; `backend/src/media/attach.ts` lines 42–54, 89. **Type:** risk.
- Which smaller copy, converted sound or page images belong to an upload is kept only in `job.payload_json.result`. Jobs are deleted after 30 days. Any later rebuild of a lesson's files (`rebuildLessonMedia` deletes the rebuilt roles first) then finds nothing and removes pages, the smaller copy or the converted sound. Today only lesson creation and the Try it package route call it, so this needs an old upload; it becomes real with any new caller. **Correction:** keep results in their own small table, or never rebuild from an empty result set.

#### BR-050 — The zip reader allocates whatever size the file states for its directory
- **Where:** `backend/src/media/zip.ts` lines 60–65. **Type:** defect (by reading).
- `cdSize` comes from the file and is only checked against the file size. A `.docx` may be up to 2 GiB, so a crafted file makes the job child allocate up to that. The child is separate, but it shares the worker's memory limit. **Correction:** refuse a central directory larger than a few megabytes (2,000 entries need far less).

#### BR-051 — One learner name can block every diagnostics export
- **Where:** `backend/src/exports/jobs.ts` lines 745–766, 826–829, 207–211. **Type:** defect (by reading).
- The privacy scan fails the export when any learner name appears as a word in the report. The report contains words such as `failed`, `ready`, `media`, `export`. Anyone can save progress under such a name; from then on diagnostics fail, and the admin only sees `internal`. **Correction:** scan only free-text fields (recovery notes), or mask the hit instead of failing; give the failure its own error code and words.

#### BR-052 — A clock change that fails still leaves its "jump" record
- **Where:** `backend/src/system/routes.ts` lines 205–225. **Type:** defect (by reading).
- The `clock_jump` row is written before the root unit is started and is not removed when the unit fails. Its days are then subtracted for every learner (unexported: always; exported: until confirmed), which delays retention for a change that never happened. **Correction:** delete the row in the failure path.

#### BR-053 — `/health` reads and hashes the migration files on every call
- **Where:** `backend/src/system/routes.ts` lines 121–135; `backend/src/core/migrate.ts` lines 39–48, 91–96. **Type:** improvement.
- Synchronous directory and file reads plus SHA-256 on each health request. **Correction:** compute the expected head once at start.

#### BR-054 — Synchronous file work on the API's event loop
- **Where:** `backend/src/system/routes.ts` line 323 (removing every automatic snapshot, files of up to the database size); `backend/bin/sensebod-api.ts` lines 40–48 (a durable file write with two `fsync`s every 5 minutes) and `system/routes.ts` lines 203, 221, 228; `backend/src/media/routes.ts` lines 238 and 284 (unlink of a `.part` of up to 2 GiB). **Type:** risk.
- Each is rare and short on a laptop; on a microSD card an `fsync` or a large unlink can hold every request for tens to hundreds of milliseconds. **Correction:** use the asynchronous file calls for these, and measure in DB-6.

#### BR-055 — An upload cannot continue if its `.part` file is shorter than the database says while the API runs
- **Where:** `backend/src/media/routes.ts` lines 153–160 and 259. **Type:** defect (by reading).
- The route answers `offset_mismatch` with the database value, the chunk handler answers `offset_mismatch` with the file size, and the phone bounces between the two until the next boot repairs the row. Needs a lost or cut file, so rare. **Correction:** when the file is shorter, set `received_bytes` to the file size in that request.

#### BR-056 — Stick retention orders backups by file name and trusts the bag's date
- **Where:** `backend/src/exports/jobs.ts` lines 595–603, 626–634. **Type:** risk (no stick test exists).
- The three newest backups are chosen by sorting names that start with the bag's name and a wall-clock stamp. After a rename of the bag or a clock that went backwards, newer backups sort as older and are removed (the one named in `LATEST.json` is always kept). Learner-data files of any bag on the stick are removed by comparing their name's date with this bag's clock. **Correction:** order by the `changeSeq`/epoch written beside each backup; skip date-based removal when the clock is not trusted.

#### BR-057 — A file being collected can be "found" by an identical upload at the same moment
- **Where:** `backend/src/media/store.ts` lines 87–95; `backend/src/system/maint.ts` lines 290–291. **Type:** risk.
- The API or a job sees the file present and skips the copy; maintenance (another process) deletes the row and then the file; the first then inserts a new row for a file that is gone. Needs the same bytes to be uploaded again in the seconds they are collected. Related: an unused upload stays `ready` after its file was collected. **Correction:** after the commit, check the file exists and store it again if not; mark such uploads `abandoned` when their blob goes (see BR-036).

#### BR-058 — Small gaps in audit, packs and the log filter
- **Type:** defect / deviation (by reading).
- `backend/src/exports/routes.ts` line 338: a download by ticket is recorded under the export's creator, not under the admin who asked for the link (the id is in the ticket).
- `backend/src/catalog/routes.ts` lines 403–425: a lesson from a content pack can be deleted; the contract only speaks of changing fields (`pack_owned`). Decide and say so.
- `backend/src/catalog/pack.ts` lines 173–180: lessons that an install renumbers get no new `seq`/`version`; a pack lesson that an update moves into a sensitive portal keeps its saved progress (DATABASE §6.5 says it is removed).
- `backend/src/catalog/routes.ts` line 150: the list of sensitive lesson ids for the log filter is refreshed only in the API and only after a placement or a delete; the worker and maintenance processes never load it, and a content pack install does not refresh it.

#### BR-059 — Contract and logging notes
- **Type:** deviation.
- `backend/src/core/http.ts`: `400 bad_request` is not among the error codes of the contract; `AdminStatus.childProtectionMode` is returned but not in the schema (harmless; add both to `openapi.yaml`).
- `http.ts` line 292: every malformed URL writes an `error.request` event with five stack lines; anyone can fill the journal's 64 MB with them. Log a counter or nothing.
- `backend/src/media/routes.ts` line 360: `mimeType` is required by `NewResumableUpload` but accepted when missing.

#### BR-060 — A failed integrity check is only a log line; a counts file that cannot be opened stops the boot
- **Where:** `backend/src/system/maint.ts` lines 365–376; `backend/src/system/bootstrap.ts` (counts handling after the main file). **Type:** deviation.
- When the weekly check fails on the snapshot and on the live file, nothing reaches `/admin/status`, and `lastQuickCheck` there is the fixed text `ok` (`system/routes.ts` line 89). A non-corruption error on `counts.sqlite3` (permissions, full card) now throws out of boot recovery, although DATABASE §9.4 says the counts file never blocks the API. **Correction:** store the result in `setting` and show it; for the counts file, log and carry on with an empty one moved in beside it.

---

## 6. Answers to the coordinator's specific questions

| Question | Answer |
|---|---|
| Upload chunk path: `fsync` before commit, truncation, offsets | Correct by reading and by the repository's tests. Order is write → `fsync` → compare-and-set commit → answer. Excess bytes are cut back before a chunk and at boot. One gap: BR-055 |
| Media store moves | Stage name → `fsync` → rename → directory `fsync`, then the row. Correct for pictures and derived files. The original upload is moved too early (BR-038) |
| Worker finalize ordering (file durable before row) | Holds for blobs, pages and exports. Does not hold for unpacked animation packages (BR-046) |
| Export publication | Correct: `.part` → `fsync` → hash → rename → directory `fsync` → row; cleaned at boot if the row never came |
| Boot recovery steps (DATA-EXPORT §13) | Steps 1, 3–11 are implemented; step 2 waits for BE-12; second half of step 9 not built. Defects: BR-039, BR-040, BR-044 |
| `replaceLiveDatabase` and restore | Much improved and probed; see BR-039, BR-040, BR-044 |
| `new-epoch` | One transaction, floor recorded, probed by the repository's test; BR-048 |
| Can garbage collection delete a file in use? | Today it deletes nothing that came from an upload (BR-036). Its "in use" test misses Try it scenes and spot sounds after a second save (BR-037), so with BR-036 fixed alone: yes |
| Can it race an upload or a lesson being created? | Uploads in progress have no blob yet. A ready upload is protected for 7 days; a lesson gets its asset rows in the same transaction that creates it. The only race found is BR-057 (identical bytes, same seconds) |
| Every admin route guarded with the role of `x-auth` | Yes: route list equals the contract; the generated test checks `401`/`403` for all; verified by reading each router |
| Ticket download route | Sound: HMAC, export id, boot id and uptime expiry; forged and cross-export tickets refused (probed). Audit attribution: BR-058 |
| Paths from request input | Upload ids and export ids are only used in SQL; file paths come from server-made ids and names; package names and stick names are matched by strict patterns; picture and sound URLs in JSON must match `/media|illustrations|pictures/…` without `..`. No path traversal found |
| Zip reader and extraction | Sound (names, links, counts, ratio, per-entry and total byte limits, exclusive create). One memory bound missing: BR-050 |
| Command execution | Argument arrays only, no shell, tool paths from configuration, nothing secret on argv |
| One-time export password | Only in tmpfs and in the one answer; verified by reading and by the repository's test |
| Child protection rules | Hold in routes, exports, diagnostics and logs. One note: after a change from `per-learner` to `counts-only`, old per-learner rows stay in the database (hidden, never exported per learner); the documents do not say to remove them |
| Writes outside `ctx.write` in the API | None found |
| Long synchronous work in the API | BR-053, BR-054; `dirBytes` is only used on the small snapshots folder, cached 60 s |
| Unbounded in-memory structures | None new; open Low items from round 1 (BR-025, BR-026) |
| Supervisor state machine | No double settle (the `settled` flag guards every path); stuck rows BR-043; orphan tools BR-042; retries as designed; a job that keeps killing the worker would be re-queued without using an attempt (start-limit of systemd is the only stop) |
| Two processes writing at once | Handled by `BEGIN IMMEDIATE`, the API gate and 5 s waits elsewhere; no lost-update pattern found across processes |

---

## 7. Remediation plan (priority order)

1. **Security and data integrity**
   1. BR-036 and BR-037 together: make the collector able to delete, and make its "in use" test complete, in one change with tests for both.
   2. BR-038: keep the `.part` until the row is committed.
   3. BR-041: no learner name in idempotency records; `secure_delete` on their removal.
   4. BR-039, BR-040: repair the journal mode at boot; finish a staged file only with a marker.
2. **Mandatory offline functions**
   5. BR-044: maintenance at boot while a restore is at `swapped`; atomic counts swap.
   6. BR-047: complete package files in the full backup.
3. **Architecture deviations**
   7. BR-014, BR-023 (round 1), BR-060.
4. **Concurrency and transactions**
   8. BR-043: retry unsettled job endings; reconcile `running` rows.
   9. BR-048: `new-epoch` stops the services and reads inside the transaction.
   10. BR-024, BR-016 (round 1).
5. **Reliability**
   11. BR-042: kill the tool with the job.
   12. BR-046: `fsync` packages; remove orphan folders.
   13. BR-015: pin the Node LTS version; BR-017: rotation with clock trust.
   14. BR-049, BR-052, BR-055, BR-056, BR-057.
6. **Resource efficiency**
   15. BR-045: stream signature checks; BR-050, BR-053, BR-054.
7. **Maintainability and contract**
   16. BR-051, BR-058, BR-059 and the open Low items of round 1.

---

## 8. Test quality

**What the 85 tests really prove.** They are integration tests on real parts: migrated SQLite files, the Express app on a loopback port, the real supervisor forking real job runners, real `ffmpeg` and `ssh-keygen`. The role matrix and "every operation is routed" tests are generated from `openapi.yaml`. The renumbering test is a property test. Lockout is tested in parallel. Restore, epoch lift, `new-epoch`, expiry by uptime and the unclean-boot path are exercised end to end. This is a sound base.

**Where a test would still pass with the behaviour broken.**
- Removing every `fsync` would fail no test (durability cannot be shown without a power-cut rig; PL-1…PL-7 remain Pi tests).
- `age` is a pass-through script, so "the bag cannot read its own backups" is not tested.
- The harness always sends `X-Forwarded-For`; the behaviour without it, and behind nginx, is untested.
- The write-gate test accepts an event-loop lag of up to 200 ms with a 400 ms lock; the binding figure (p99 < 50 ms, DB-6) is not asserted.
- The contract tests check that operations are routed and guarded, not that answers match the schemas (this round's probe did that for 14 schemas; it belongs in the suite).

**Most important missing tests** (each would have caught a finding of this round):
1. Maintenance garbage collection, end to end: upload → lesson → delete → aged rows → file gone, task not failed (BR-036).
2. Try it with spots saved twice, then garbage collection (BR-037).
3. `inspect` run twice without `finalize` (BR-038).
4. Boot with a database in rollback-journal mode; boot with an unmarked staged file (BR-039, BR-040).
5. Learner removed → the name is nowhere in the database file (BR-041).
6. Stall timeout with a sleeping stand-in tool; a failing settle write (BR-042, BR-043). BUILD-STATUS itself says the stall path is not exercised.
7. Restore stopped after the swap, then boot (BR-044).
8. A rebuild migration through the runner (BR-006 has no test in the repository).
9. Response shapes against `openapi.yaml` for every `200`/`201`/`202`.
10. Everything on a stick against a folder standing in for the mount (only stick retention has one).

---

## 9. Could not be assessed

| Item | Why |
|---|---|
| Anything on the Pi: commit rate, DB-6, PERF-1, lock-hold times, memory limits | No Pi; all runs on a Mac with Node 23.10.0 |
| Power-cut behaviour (PL-1…PL-7) | Needs the rig; ordering was checked by reading only |
| Every USB path: backups to a stick, check, format, eject, presence by insertion, the shape of `usb.json` | No stick, no root helper; code read only |
| `age` encryption and decryption, `pdftoppm` pages, `systemctl` units | Tools not installed here or replaced by stand-ins |
| nginx in front: `X-Forwarded-For`, body limits, `X-Accel-Redirect`, rate limits, no access log | Deployment files not built |
| Old Android browsers: `Origin` header under the app's referrer policy (BR-022 note), download managers, resumable uploads | No phones |
| The self-check from the release build | The build was run to the scratch folder only; the repository's `dist/` was not executed |
| BR-009, BR-042, BR-043, BR-045, BR-046, BR-047 | Established by reading; no probe was run |
| `src/catalog/seed.ts`, `src/system/selfcheck.ts`, `scripts/export-mock-seed.ts` | Skimmed only |
| The frontend against this backend | The app does not send `X-Sensebod-Client` yet (BUILD-STATUS §8); outside this review |

---

## 10. Final assessment

**FAIL — CORRECTIONS REQUIRED.**

The backend is complete, well built and far closer to release than in round 1: three of the four round-1 High findings are closed and the fourth is closed for the normal paths. It fails this gate on two new High findings that together decide whether stored lesson files are kept and reclaimed correctly (BR-036, BR-037), and on eleven Medium findings, most of them power-cut or failure windows in the paths this system exists to get right. No Critical finding. Mandatory requirements that need a Pi, a stick, `age`, nginx or phones remain unverified (§9).

| Severity | New in round 2 | Still open from round 1 |
|---|---|---|
| CRITICAL | 0 | 0 |
| HIGH | 2 | 0 (BR-004 partly: residual tracked as BR-040, Medium) |
| MEDIUM | 11 | 3 (BR-011 partly, BR-015, BR-017) |
| LOW | 12 | 15 |
| **Total** | **25** | **18** |
