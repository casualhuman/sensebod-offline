# Sensebod Offline backend review, round 3

Reviewer: Senior Backend Best Practices, Code Quality and Architecture Compliance Reviewer (independent quality gate, read-only)
Date: 14 Nov 2026
Runtime under review: Node.js + Express 5 + TypeScript, SQLite through the built-in `node:sqlite` driver
Previous rounds: `BACKEND-REVIEW-1.md` (FAIL), `BACKEND-REVIEW-2.md` (FAIL, 2 High, 11 Medium, 12 Low)

**Numbering note.** The brief asked for new findings "from BR-049". Round 2 already used BR-049 to BR-060 for its Low findings. To keep every id unique, new findings in this report start at **BR-061**.

---

## 1. Scope reviewed

1. The thirteen round-2 findings the builder reports as fixed (BR-036 to BR-048): code read in full, regression tests in `backend/test/regress.test.ts` read and run.
2. Every source file that changed in size since round 2, read in full: `src/system/maint.ts`, `src/system/bootstrap.ts`, `src/system/restore.ts`, `src/core/replace.ts`, `src/core/db.ts`, `src/core/idempotency.ts`, `src/media/jobs.ts`, `src/media/store.ts`, `src/media/attach.ts`, `src/exports/jobs.ts`, `src/exports/archive.ts`, `src/exports/usb.ts`, `src/worker/supervisor.ts`, `src/worker/runner.ts`, `src/system/start.ts`, `bin/*.ts`; `src/catalog/routes.ts` lines 395–700, `src/learners/routes.ts` lines 1–150, `src/catalog/validate.ts`, `src/media/zip.ts` lines 1–110.
3. The rename from "sensebod" to "sensebod-offline": searched across `backend/` (source, tests, scripts, seed, `dist/`), `docs/system/` (current documents, ADRs, `openapi.yaml`, POC scripts), `docs/DESIGN-DECISIONS.md`, `app/src`, `app/mock`, `app/deploy`.
4. Not re-read this round: files unchanged in size since round 2 other than those listed (identity, most of catalog, media routes, exports routes, system routes were only searched).

### 1.1 Baseline checks

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | 91 of 91 pass, 0 skipped, about 16 s |
| Machine | Mac, Node 23; nothing run on a Pi, with a stick, with `age`, or behind nginx |

### 1.2 Probes

All in the scratch folder `/private/tmp/claude-501/-Users-abdulrahimjalloh-Desktop-EasySTEM-easystemoffline/f08098b0-2c24-43cb-a374-808b46242f2e/scratchpad/r3/`. They import the backend sources unchanged and write only there.

| Probe | What it showed |
|---|---|
| `p10.ts` part A | An upload in `processing` whose `.part` exists: after `bootRecover` the `.part` is gone, and the retried `inspect` job fails `file_lost` (BR-061) |
| `p10.ts` part B | `restore/state.json` at `prepared`, old database already moved to `replaced-r-1/`, new one at `.staged`: `bootRecover` finishes the swap, drops the journal and opens the bag, `maintenance: false` (BR-063) |
| `wal.mjs` | A rollback-mode database renamed in beside a leftover `-wal` of the old database: SQLite replays the old WAL; the "restored" row is gone, the old 51 rows and an old-only table are back, `quick_check` says `ok` (BR-062) |
| `leak.mjs` | The exact stream wiring of `verifySignature` with a tool that exits early, and with one that hits the timeout: the read stream stays open (`destroyed: false`, `closed: false`, file descriptor held) (BR-064) |

---

## 2. Executive summary

**Verdict: FAIL — corrections required.** One new High finding, and it sits in the fix for BR-038.

**Round-2 fixes.** Of 13 claimed fixes: 9 are fixed (BR-036, 037, 039, 040, 041, 043, 045, 047, 048; BR-040 and BR-045 each opened a new Medium defect), 4 are partly fixed (BR-038, 042, 044, 046). None is unfixed. Both round-2 High findings (BR-036, BR-037) are closed and have real regression tests.

**The blocking finding (BR-061).** Boot recovery deletes the `.part` file of every upload that is not in state `receiving`. Since the BR-038 fix, that `.part` is deliberately the only recorded copy of an upload until the `inspect` job's row is committed, and for `.mov`, `.3gp`, `.wav`, `.aac`, `.docx` and `.zip` it is the only copy until the last conversion ends. The media lane runs one job at a time, so several uploads queue in `processing`. A power cut at any point in that time loses all of them: each ends `failed`, "Upload it again". The BR-038 regression test passes because it retries the job without a boot in between.

**Five new Medium findings.** A stale `-wal` can be replayed onto a replacement database finished at boot (BR-062). A restore cut between the database swap and the `swapped` journal entry reopens the bag half-restored, and a refused second run does the same (BR-063). The streamed signature check leaves a file on the stick open when the verifier ends early or times out (BR-064). Restore never brings animation packages back and leaves their lessons published (BR-065). The rename did not reach `app/deploy/nginx.conf`, which still serves `/media/` from `/var/lib/sensebod/media/` while the backend writes to `/var/lib/sensebod-offline/media/` (BR-066).

**The rename inside the backend is clean.** No doubled or mangled identifier was found in code, tests, `dist/` or `openapi.yaml`. Code and `openapi.yaml` agree on the header names, `sensebodOfflineLabel`, format strings, signing namespaces and the HMAC label. Nothing exceeds a length limit. The damage is at the edges: the frontend deploy files (BR-066) and small document leftovers (BR-069).

**No Critical finding. No new security or child-privacy defect of Medium or higher.**

---

## 3. Round 2 findings re-verified

| ID | R2 severity | Verdict | Evidence |
|---|---|---|---|
| BR-036 garbage collection stops for good | High | **FIXED** | `src/system/maint.ts:290–297`: inside the delete transaction the blob is re-checked against the "in use" set, `upload.blob_sha256` is cleared (`:294`), then the blob row is deleted. Every other foreign key to `blob` (`lesson_asset`, `picture`, three `listen_blob` columns) is in the "in use" set (`:271–277`). Test `regress.test.ts:23–52` runs three collections and checks `foreign_key_check`. Not adopted from the recommendation: the batch is still one transaction, and the package, orphan and corrupt-copy sweeps (`:303–327`) still sit behind the loop in the same step; an upload whose file is collected stays `ready` with no file |
| BR-037 Try it second save drops file records | High | **FIXED** | `src/catalog/routes.ts:562–584`: scene and spot sounds are tracked from the URL that will be stored (`track`, `:564–568`), whether it came as an upload id or as a saved URL. Test `regress.test.ts:54–82` saves twice and runs the collector. Notes: a `/media/` URL with no blob row is accepted silently (`:567`); portraits are not tracked but are gallery pictures, protected by their `picture` row (no route deletes a picture) |
| BR-038 upload lost between store and commit | Medium | **PARTLY FIXED** | Fixed for a retry within one boot: `src/media/jobs.ts:201–205` links instead of moving (`src/media/store.ts:99–106`), the `.part` goes only after the commit (`jobs.ts:137–144`); test `regress.test.ts:84–105`. **Not fixed for the power cut it was written for:** `src/system/bootstrap.ts:498–506` deletes the `.part` of every upload not in `receiving`. Probe A. See BR-061 |
| BR-039 sound database in rollback mode refused | Medium | **FIXED** | `src/system/bootstrap.ts:198–202` switches to WAL before the checks. Test `regress.test.ts:144–152` |
| BR-040 unchecked `.incoming` finished at boot | Medium | **FIXED** | `src/core/replace.ts:156–162`: the file is named `.staged` only after copy, migration, epoch lift, `fsync` and the epoch floor. `bootstrap.ts:251` always discards `.incoming`; `:252–259` finishes only `.staged`. Test `regress.test.ts:121–142`. New defect in the same path: BR-062 |
| BR-041 learner name in idempotency record | Medium | **FIXED** | `src/learners/routes.ts:100–107`: the stored replay body is `{replayOfLearner: id}`; a replay rebuilds the answer from the `learner` row, `404` when gone. Test `regress.test.ts:159–175`. Residual, Low: BR-070 |
| BR-042 stalled job leaves its tool running | Medium | **PARTLY FIXED** | `src/worker/supervisor.ts:211` starts each job in its own process group; `:66–76`, `:265`, `:321` signal the group. A tool that ends on `SIGTERM` is now stopped. The `SIGKILL` follow-up (`:252`) never reaches a tool that does not: the runner has no `SIGTERM` handler (`src/worker/runner.ts`), exits at once, and the `exit` handler drops the entry (`:231`), so `watch` is never called for it again. No test. See BR-067 |
| BR-043 job stays `running` when its ending cannot be written | Medium | **FIXED** | `supervisor.ts:295–307` keeps a failed settle and `:166–170` retries it on every tick; it only settles a row still `running` (`:299`). A failed `finalize` falls through to the same path (`:282–286`). No test. Not changed: the handler still listens to `exit`, not `close` (`:228`), so a `done` message delivered after `exit` is still recorded as a failure (round-2 side note, Low) |
| BR-044 restore cut after the swap | Medium | **PARTLY FIXED** | `bootstrap.ts:262–280`: a journal at `swapped` keeps the bag closed; `bin/sensebod-offline-boot-recover.ts:13` exits 1 and the API serves `503 maintenance`. Test `regress.test.ts:177–194`. Open: the window before `swapped` is written, a refused second run, the counts swap (`restore.ts:222–224`, no temp file, no `fsync`), media copies without `fsync` (`:243`), `db/replaced-<id>/` never swept (`maint.ts:327` matches `corrupt-` only). See BR-063 |
| BR-045 release file read into API memory | Medium | **FIXED** | `src/exports/usb.ts:93–110` pipes a read stream into `ssh-keygen`. New defect in the fix: BR-064. Still done inside a request, not a job |
| BR-046 package recorded before its files are safe | Medium | **PARTLY FIXED** | `src/media/jobs.ts:464–481`: every file and folder is `fsync`ed before the rename, then the parent. Not done: a retry after the rename still leaves a folder under `media/tryit/` that no row names, and nothing removes it (`maint.ts:304–308` only walks rows; boot recovery does not look at `tryit/`) |
| BR-047 long names left out of the package archive | Medium | **FIXED** | `src/exports/archive.ts:159–171` uses the ustar prefix field and throws when a name cannot be stored; `src/exports/jobs.ts:720–725` no longer skips. No test. Notes: BR-065 (the archive is never read back), BR-068 (one unsplittable name fails every full backup) |
| BR-048 `new-epoch` on a live bag | Medium | **FIXED** | `bin/sensebod-offline-admin.ts:173–184` sets the maintenance flag, stops worker and API, runs, starts them again. No test. Not adopted: rows are still selected before the transaction (`restore.ts:349–355`). Residual, Low: BR-071 |

No fix made an existing test fail.

---

## 4. Findings (new in round 3)

Type legend as before: **defect** (confirmed), **deviation**, **risk**, **improvement**.

### HIGH

#### BR-061 — Boot recovery deletes the only copy of every upload that is still being processed
- **Severity:** HIGH · **Category:** Data integrity / power loss · **Type:** defect (confirmed by probe)
- **Where:** `backend/src/system/bootstrap.ts` lines 498–506 (step 8, files); with `backend/src/media/jobs.ts` lines 32–52 (`loadUpload`) and 201–205.
- **Problem:** step 8 builds a map of uploads in state `receiving` and removes every other file in `uploads/partial/`. An upload that has all its bytes is in state `processing`, and its `.part` is still needed: until the `inspect` row is committed it is the only copy the database can find, and for file types the store does not keep (`.mov`, `.3gp`, `.wav`, `.aac`, `.docx`, `.zip`) it is the only copy until the last follow-up job ends. The same boot puts the cut media job back to `queued` (`bootstrap.ts:403–407`). The retry finds no `.part` and no `blob_sha256` and fails with `file_lost`, which is not retried (`supervisor.ts:35`), so the upload ends `failed`.
- **Evidence (probe A):** upload `processing`, `.part` present, `inspect.run` once, then `bootRecover` under a new boot id → `.part after boot: false`; second `inspect.run` → `file_lost: The uploaded file is no longer on the bag. Upload it again.` The file linked into the store has no row and is later moved aside as an orphan.
- **When it happens on a bag:** a facilitator uploads several videos in one sitting. The media lane handles one job at a time and a smaller copy takes minutes on a Pi, so the later uploads wait in `processing` with only a `.part`. The power fails. After the reboot every waiting upload, and the one being inspected, is lost.
- **Why it matters:** each file is up to 2 GiB sent over the bag's Wi-Fi from an old phone. Power cuts are the normal failure here, and the exposed time is the whole queue, not the few milliseconds round 2 assumed. This is the loss BR-038 set out to prevent; the comment at `jobs.ts:202–203` says so.
- **Why the test passes:** `regress.test.ts:84–105` runs the job twice without a boot in between.
- **Recommended fix:** in step 8 keep the `.part` of every upload in `receiving` **or `processing`**; remove a `.part` only when its upload row is missing, `failed`, `abandoned`, or `ready`.
- **Verify:** extend the BR-038 test: after the first `inspect.run`, close the context, run `bootRecover` under a new boot id, and expect the `.part` to exist and the second run to succeed. Add the same for a `.mov` upload cut during its conversion.

### MEDIUM

#### BR-062 — A leftover `-wal` of the old database is replayed onto the replacement that boot recovery finishes
- **Category:** Backup and recovery / synchronisation · **Type:** defect (mechanism confirmed by probe; the window is small)
- **Where:** `backend/src/system/bootstrap.ts` lines 252–258; `backend/src/core/replace.ts` lines 36–46 (`removeDatabaseFiles` moves the main file first, then `-wal`, then `-shm`) and 167–176 (`finishIncoming`).
- **Problem:** "a `.staged` file and no live file" is finished by renaming `.staged` into place. If the cut fell inside `removeDatabaseFiles`, after the main file was moved and before its `-wal` was, the old `-wal` is still there under the live name. `finishIncoming` does not remove it. SQLite then treats it as the write-ahead log of the new file. The module's own header (`replace.ts:7–8`) names this danger.
- **Evidence (`wal.mjs`):** new file in rollback mode holding one row "restored", old `-wal` beside it → on open, `journal_mode` reads `wal` before anything is set, the table holds the old 51 rows, an old-only table exists, and `quick_check` answers `ok`.
- **When it happens on a bag:** the bag is healing itself from a corrupt database after an unclean stop (the old file then has a `-wal`), and the power fails again between two renames.
- **Why it matters:** the bag comes up on a mix of the snapshot and pages of the damaged or older database, possibly with the old epoch in `bag_meta`, and the checks do not notice. That is silent corruption and a reused lineage toward the office.
- **Recommended fix:** in the boot path, when the live file is missing and `.staged` exists, delete `<db>-wal` and `<db>-shm` before `finishIncoming`; they are stale by definition. Do the same at the top of `finishIncoming`.
- **Verify:** test: live file absent, `.staged` present, a `-wal` from another database under the live name → after `bootRecover` the content is the staged file's.

#### BR-063 — A restore cut after the database swap can still reopen the bag half-restored
- **Category:** Backup and recovery · **Type:** defect (first case confirmed by probe; the rest by reading). Residual of BR-044.
- **Where:** `backend/src/system/restore.ts` lines 195 (`prepared`), 221–228 (swap of main and counts), 230 (`swapped`), 290–300 (clean-up on refusal), 222–224, 243; `backend/src/system/bootstrap.ts` lines 262–280; `backend/src/system/maint.ts` line 327.
- **Problem:**
  1. The journal says `prepared` while `replaceLiveDatabase`, the counts copy and the counts migration run. `swapped` is written only after all of that. A cut in between leaves the new main database live (or `.staged`, which boot recovery finishes) and a journal at `prepared`, which boot recovery reads as "nothing was changed", deletes, and opens the bag.
  2. After a boot that correctly stopped at `swapped`, the technician is told to run the restore again. If that run is refused before its own swap (wrong file, damaged backup, registry problem, confirmation not typed), the `catch` at lines 290–300 deletes `state.json` and the maintenance flag and starts the services: the bag opens on the half-restored database.
  3. Still open from round 2: the counts file is removed and copied straight to its final name without temp file or `fsync` (222–224); copied media files are not `fsync`ed (243); `db/replaced-<id>/`, which holds the previous database with learner names, is never removed.
- **Evidence (probe B):** journal `prepared`, old database in `replaced-r-1/`, new one at `.staged` → `maintenance: false`, note "A replacement of the database was finished after a power cut", journal gone.
- **Why it matters:** the bag shows published lessons whose files did not come back, keeps the old card's ticket key and session pepper, has no restore record in the audit, and may run on an empty or older counts file. A technician is present, but the bag looks healthy, so nobody knows to finish.
- **Recommended fix:** write `{step: 'swapping'}` durably just before `replaceLiveDatabase` and treat every step except `prepared` as "keep the bag closed". At the start of `restoreBackup`, read an existing journal; if it is at `swapping` or `swapped`, never clear it or the flag on refusal. Swap the counts file by temp + `fsync` + rename, `fsync` copied media, sweep `replaced-*` like `corrupt-*`.
- **Verify:** tests for both cases: journal `swapping` with a `.staged` file → `503 maintenance`; a refused second run leaves the journal and the flag.

#### BR-064 — The streamed signature check leaves a file on the stick open, and caches a time-out as "bad signature"
- **Category:** USB / resources · **Type:** defect (confirmed by probe; opened by the BR-045 fix)
- **Where:** `backend/src/exports/usb.ts` lines 93–110 (`verifySignature`), 134–139 (cache).
- **Problem:** the file is piped into `ssh-keygen`. When the tool ends before it has read everything (an unreadable `.sig`, or the 20 s limit at line 98), the pipe is cut but the read stream is not destroyed: its file descriptor on the stick stays open in the API process until the API restarts. Files small enough to be read in the first chunks close by themselves; a release bundle does not. The result `false` is then cached under the file's name, size and date (line 138), so a release that merely took longer than 20 s to read is shown as "signature not valid" until the cache is cleared or the API restarts.
- **Evidence (`leak.mjs`):** 40 MB file; tool exits early → `destroyed: false, closed: false, fd: 13`; tool killed by the timeout → the same with `fd: 14`.
- **When it happens on a bag:** a stick with an update bundle is in the bag and someone opens the USB screen; the stick is slow, or the `.sig` is damaged.
- **Why it matters:** an open file keeps the stick's filesystem busy, so the eject helper cannot unmount it cleanly, and the stick is pulled with the filesystem still mounted. FAT damage from that is the reason the design uses two sticks. The cached wrong answer blocks an update that is in fact signed.
- **Recommended fix:** use `stream.pipeline(input, child.stdin, …)`, or call `input.destroy()` in the `execFile` callback and on `stdin` error. Do not cache a result that came from a timeout or a kill. Size the limit from the file size, or move release verification to a job as round 2 recommended.
- **Verify:** test with a stand-in tool that exits at once on a 10 MB file: the stream is closed afterwards and nothing is cached.

#### BR-065 — Restore does not bring animation packages back, and leaves their lessons published
- **Category:** Backup and recovery · **Type:** defect (by reading)
- **Where:** `backend/src/exports/jobs.ts` lines 714–734 (the full backup writes `tryit/<package>.tar` to the stick); `backend/src/system/restore.ts` lines 232–261 (media step: blobs only); `bin/sensebod-offline-admin.ts` (no option for packages).
- **Problem:** nothing in the restore reads `tryit/*.tar`. The step that unpublishes lessons whose files did not come back looks only at `blob` rows through `lesson_asset` (`restore.ts:250–257`). A "Try it" package lesson has no blob: its `packageUrl` points into `media/tryit/<id>/`.
- **When it happens on a bag:** a card dies; the technician restores the newest full backup onto a new card.
- **Why it matters:** every package lesson stays published and opens to a missing page for learners, with nothing in the restore summary or report. The work done for BR-047 writes an archive that no code reads.
- **Recommended fix:** with `--media-dir`, unpack `tryit/<dir_name>.tar` for each `tryit_package` row whose folder is missing (same name and size checks as the zip reader, files `fsync`ed, staged then renamed). Unpublish, with the existing note, every lesson whose `packageUrl` folder is missing afterwards, and count them in the report.
- **Verify:** restore test with a package lesson: with the stick folder the page exists; without it the lesson is a draft with the note.

#### BR-066 — The rename did not reach the web-server files: `/media/` is served from the old folder
- **Category:** Rename / deployment · **Type:** defect (by reading)
- **Where:** `app/deploy/nginx.conf` lines 28, 118, 134 and `app/deploy/Caddyfile` lines 17, 42, 50 (`/var/www/sensebod/current`, `/var/lib/sensebod/media/`, `/var/lib/sensebod/media/tryit/`); against `backend/src/config.ts` line 59 (`/var/lib/sensebod-offline`) and `docs/system/SYSTEM-ARCHITECTURE.md` lines 438 ("keeps the frontend's nginx root unchanged") and 460 ("served from `/var/lib/sensebod-offline/media/` as today"). `docs/ARCHITECTURE.md` line 505 also still has the old path.
- **Problem:** the backend stores media under the new data folder; the only nginx file in the repository, which the backend already relies on for `X-Forwarded-For` (line 96), aliases `/media/` to the old one. The architecture document now describes the new paths as what nginx does "today", which is no longer true.
- **Why it matters:** a bag assembled from these files serves `404` for every uploaded video, sound, picture and animation package, while the API reports the lessons as published and healthy.
- **Recommended fix:** rename the three paths in `nginx.conf` and `Caddyfile` (and the comment block at lines 11–13), or correct the architecture text; add the paths to the DevOps list in BUILD-STATUS §8.
- **Verify:** SEC-7 / first Pi bring-up: a published upload plays through nginx.

### LOW

#### BR-067 — The forced stop after a stall never reaches the tool
- **Where:** `backend/src/worker/supervisor.ts` lines 228–233, 249–259; `backend/src/worker/runner.ts`. **Type:** defect (by reading). Residual of BR-042.
- The runner dies on the first `SIGTERM`; the entry leaves `running`; the `SIGKILL` at line 252 is never sent. An `ffmpeg` that is truly hung and does not act on one `SIGTERM` keeps running beside its retry. **Fix:** after the runner exits from a stall or stop, send `SIGKILL` to the group once after a few seconds (a timer that does not depend on the lane entry).

#### BR-068 — One file name the tar format cannot hold makes every full backup fail with `internal`
- **Where:** `backend/src/exports/archive.ts` lines 163–168; `backend/src/media/zip.ts` line 45; `backend/src/exports/jobs.ts` line 207. **Type:** defect (by reading).
- The zip reader accepts names of 240 characters in any shape; ustar needs a `/` that leaves at most 100 bytes after it and 155 before. A package with a 120-character file name is accepted at upload and then stops every full backup of the bag, and the admin sees only `internal`. **Fix:** refuse such names in `package_check` with the package's own message, or write a PAX header; give the failure its own code.

#### BR-069 — Small leftovers of the rename
- **Type:** deviation (by reading). None breaks running code.
- Release bundle name: `docs/system/SYSTEM-ARCHITECTURE.md:656` says `sensebod-offline-<version>.tar`; `backend/src/exports/usb.ts:113` accepts only `sensebod-offline-release-<version>.tar`. A bundle named as the document says is not listed on the USB screen. (The two disagreed before the rename as well.) Settle one name before BE-12.
- `docs/system/DATA-EXPORT-AND-BACKUP.md:282`: `free_for_sensebod-offline` (a hyphen inside an identifier). `docs/system/HANDOFF-PACKAGES.md:38`: module `sensebod-offline/counts.py` (a Python path that never existed here).
- `backend/seed/content.json:1` says `"format":"sensebod-seed/1"`; `backend/scripts/export-mock-seed.ts:17` writes `sensebod-offline-seed/1`. The importer does not check the field.
- `docs/system/poc/poc_override.py` now uses the new HMAC labels, but `poc_override.out` was (rightly) not renamed, so the recorded output, and the example code `WB0DE-D5F56` in `openapi.yaml:1154`, no longer come from the script as it stands. Re-run the POC or say so in the file.
- `backend/docs/BUILD-STATUS.md:115` says the frontend does not send the client header; `app/src/shared/api/client.ts:144` now defines `X-Sensebod-Offline-Client`.
- Checked and found sound: no doubled or cut names; header names, `sensebodOfflineLabel`, `sensebod-offline-backup/1`, `-learner-data/1`, `-diagnostics/1`, `-pack/1`, namespaces `sensebod-offline-content` / `-release` / `-registry`, and the label `sensebod-offline-override/1` are the same in code, `openapi.yaml` and the architecture; volume labels `SENSEBOD-A` / `SENSEBOD-B` (10 characters, inside the 11-character limit) and cookie names are unchanged; the longest generated file name is about 90 characters; the three tar member names are under 100 bytes; unit names are far below systemd's 255. Databases and backups made before the rename (`db/sensebod.sqlite3`, `sensebod-backup/1`) are not recognised; none exist in the field.

#### BR-070 — The idempotency record of "Save my progress" still holds an unsalted hash of the name
- **Where:** `backend/src/learners/routes.ts` line 100; `backend/src/core/idempotency.ts` lines 95–97; `backend/src/system/maint.ts` line 187. **Type:** risk. Residual of BR-041.
- `request_sha256` is SHA-256 of `["<name>","<role>"]`, kept 24 hours beside the learner id and pruned without `secure_delete`. A person holding a copy of the database can confirm a guessed name. **Fix:** hash with a bag key (HMAC with `session.pepper`), or delete the record in the learner-delete transaction.

#### BR-071 — `new-epoch` and `restore` do not stop the maintenance timer
- **Where:** `backend/bin/sensebod-offline-admin.ts` lines 174–184, 208–210; `backend/src/system/restore.ts` lines 349–355. **Type:** risk. Residual of BR-048.
- Only the worker and the API are stopped. `sensebod-offline-maint` can start during the re-stamp or the swap; rows it writes between the read (349–352) and the transaction (355) keep old numbers, and during a swap it can find no database. If `systemctl stop` fails, the maintenance flag written at line 177 stays. **Fix:** stop `sensebod-offline-maint.timer` and `.service` as well, select the rows inside the transaction, put the flag inside the `try`.

---

## 5. Open items from earlier rounds

| ID | Severity | State | Raise? |
|---|---|---|---|
| BR-011 storage errors | Medium (partly fixed) | `src/core/http.ts:278, 281` still answer `storageFull(0, 0)`; nothing reaches `/health` or `/admin/status` | No |
| BR-015 Node not pinned | Medium | `package.json` `engines` is `>=22.13.0`; development on Node 23; `node:sqlite` prints "experimental" on every start | No change in severity, but it must be closed before the first release build |
| BR-017 snapshot rotation trusts file dates | Medium | `src/system/maint.ts:176` calls `rotateSnapshots` without clock trust; `src/exports/snapshots.ts:138–152` compares file dates with the wall clock | No. It matters more now that BR-062 and BR-040 depend on a sound local snapshot existing |
| BR-014 reads not retried on BUSY | Low | `readWithRetry` (`src/core/writeGate.ts:86`) is still unused | No |
| BR-016, 018, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035 (round 1) | Low | Not changed | No |
| BR-049 (round 2) conversion results pruned after 30 days | Low | Not changed | No, but note: with BR-036 fixed, a rebuild from an empty result set now leads to real deletion of page images and smaller copies a day later, not just a mark |
| BR-060 (round 2) failed integrity check is only a log line | Low | `src/system/routes.ts:89` still returns the fixed text `lastQuickCheck: 'ok'`; `maint.ts:381` only logs | **Yes, to Medium.** The status screen states the database is sound when the weekly check has failed. On a bag with no monitoring this is the only place anyone would see it |
| BR-050 to BR-059 (round 2) | Low | Not changed | No |
| BR-046 remainder | Low | Orphan folders under `media/tryit/` are never removed | Tracked here; no new id |

---

## 6. Remediation plan (priority order)

1. **BR-061**: keep `.part` files of `processing` uploads at boot; extend the test with a boot in between.
2. **BR-062**: remove stale `-wal` / `-shm` before finishing a `.staged` file.
3. **BR-063**: `swapping` step in the restore journal; never clear the journal on a refused second run; atomic counts swap; sweep `replaced-*`.
4. **BR-065**: restore animation packages or unpublish their lessons.
5. **BR-066**: rename the paths in `app/deploy/`.
6. **BR-064**: destroy the read stream; do not cache time-outs.
7. BR-060 (raised), BR-015, BR-017, BR-011.
8. BR-067, BR-068, BR-046 remainder, BR-071, BR-070, BR-069.

---

## 7. Could not be assessed

| Item | Why |
|---|---|
| Everything on the Pi, with a stick, with real `age`, behind nginx, on phones | As in round 2; nothing was available |
| BR-042, BR-043, BR-045, BR-047, BR-048 fixes in operation | No test exists for them; verified by reading (BR-045 wiring by probe) |
| Whether the eject helper fails or forces the unmount with a file open (BR-064) | The root helper is not built |
| The width of the window in BR-062 on ext4 | Needs the power-cut rig; the replay itself is shown |
| Files not changed in size since round 2 | Searched, not re-read |

---

## 8. Final assessment

**FAIL — CORRECTIONS REQUIRED.**

The two round-2 High findings are closed with tests, and nine of the thirteen fixes hold. The gate fails on BR-061: after any power cut, boot recovery removes the only copy of every upload that is waiting to be processed, which undoes the BR-038 fix in exactly the case it was made for. Five Medium findings follow, three of them in recovery paths that were changed this round. The rename is sound inside the backend and the contract; it stopped short of the web-server files.

| Severity | New in round 3 | Still open from rounds 1 and 2 |
|---|---|---|
| CRITICAL | 0 | 0 |
| HIGH | 1 | 0 |
| MEDIUM | 5 | 3 (BR-011 partly, BR-015, BR-017), plus BR-060 if raised; BR-038, BR-042, BR-044, BR-046 partly fixed |
| LOW | 5 | 27 |
