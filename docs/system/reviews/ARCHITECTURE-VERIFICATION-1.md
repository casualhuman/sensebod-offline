# Architecture verification 1: Sensebod system architecture v0.1

12 Nov 2026 · Independent System Architecture Best Practices Verification Agent (instructions Part II, §24–§29) · Stage 3 of §30

**Scope reviewed.** Everything in `docs/system/` (SYSTEM-ARCHITECTURE, DATABASE, `openapi.yaml`, API-DECISIONS, DATA-EXPORT-AND-BACKUP, SYNC, HANDOFF-PACKAGES, ADR-000…016, `poc/`, ARCHITECT-NOTES-FOR-VERIFIER) against `docs/DESIGN-DECISIONS.md`, `docs/API-CONTRACT.md`, `app/src/shared/api/types.ts`, `app/src/features/lessons/progress/progress.ts`, `docs/ARCHITECTURE.md` §10/§12/§14, `docs/reviews/reviewer-b-edge-verification.md`, `HANDOFF.md`, the DLH-in-a-bag build guide and scripts, and the IIAB review.

**Evidence rule.** "Measured (Mac)" = run by me on the development Mac (Apple Silicon, macOS, Python's `sqlite3` with SQLite 3.51.2). "Not verified" = nothing was run on a Raspberry Pi, a phone, a USB stick, an AP or the real network. I did not touch the Pi. My scripts and their output are in `docs/system/reviews/evidence/v1/` (each script creates a `work_*` folder next to itself when run):

| File | What it shows |
|---|---|
| `architect-poc-rerun.out` | The architect's `poc_export.py` (60 × `kill -9`) and `ddl_check.py`, re-run unchanged from a copy: reproduced (8 ready / 52 interrupted, invariants held; DDL and all six constraint probes as reported) |
| `verify_export_powerloss_model.py/.out` | Deterministic crash-point **model** of the export protocol at all 8 step boundaries × 25, with lost unsynced data (truncation or zero-filled range) and undone renames; plus a control with the `.part` fsync removed |
| `verify_sqlite.py/.out` | `wal_checkpoint(TRUNCATE)` with an open reader; where the one-time export password survives; stale `-wal` next to a swapped-in database |
| `verify_wipe.py/.out` | `secure_delete` wipe of the job payload with and without a concurrent reader |
| `schema_diff.py/.out` | `openapi.yaml` (converted with Ruby's YAML loader) component schemas diffed field-by-field against `types.ts` interfaces |
| `doc-greps.txt` | The exact lines cited for V-001, V-004, V-008, V-009 |

---

## A. Executive assessment

**Overall quality.** High. This is a proportionate, well-reasoned design for the stated deployment: one Pi, nginx + one Django monolith + one worker, SQLite in WAL with `synchronous=FULL`, a job table instead of a broker, content-addressed media, plain HTTP with an honest threat model, USB-first data movement, signed journaled updates, and a test plan with pass/fail criteria. The ADRs give alternatives and reversal conditions. The architect states plainly what was measured on a Mac and what is unverified. I found no hidden internet dependency and no unnecessary component.

**Fit for last-mile deployment.** Good. Every learner and admin journey traces to components on the Pi; nothing waits for an uplink; service-worker and secure-context APIs are avoided; failure modes F-1…F-18 are concrete; restore, update and power-off are buttons or single technician commands.

**Owner requirement (DESIGN-DECISIONS §4).** The export protocol on the Pi is correct: snapshot by `VACUUM INTO`, build from the snapshot, fsync, rename, fsync directory, then commit the `ready` row; boot recovery deletes anything not committed. I reproduced the architect's 60-kill PoC and added a crash-point power-loss model (200 runs, 0 violations; the control with one fsync removed fails, so the harness can detect a broken order). The weaker points are on the edges: what happens when the **worker process** (not the Pi) dies, the life of the one-time password, the phone's "Downloaded and checked" claim, and USB sticks on FAT after a power cut. See C.1.

**Major risks.**
1. **Child protection activity is linked to learner ids in logs** (V-001, High). The design's own log format records `PUT /api/v1/learners/<learner id>/progress/<Child protection lesson id>` with IP and time, and the diagnostics report ships those log lines unencrypted. This contradicts ADR-009, SEC-7 and SEC-E2.
2. Job recovery happens only at boot; a worker crash within a boot leaves an export `preparing` forever and blocks every further export until a reboot (V-002).
3. The one-time export password is persisted in the idempotency record and can survive the wipe (V-004, measured).
4. Everything about the Pi, the microSD's flush behaviour, old phones and FAT sticks is still unverified (P-1…P-7, PL-1…5, BR-3). The design has fallbacks for each, so this is a gate for final approval, not a design defect.

**Recommendation: REVISIONS REQUIRED.** One High and eight Medium findings must be addressed in the documents (all are specification changes, none needs a redesign). Final approval at reverification also needs the results of P-1, P-3, P-4 and P-6 (section H).

---

## B. Review matrix

| Category | Result | Basis |
|---|---|---|
| Requirements coverage | **Partial** | Every DESIGN-DECISIONS "asks of the system" item is answered (C.3); Child protection handling has a leak (V-001) and a counting defect (V-009) |
| Offline independence | **Pass** | All journeys traced to the Pi; `no-resolv`, no forwarding, no CDN, self-hosted fonts, no sync in phase 1. One field check: public DNS of the site name with mobile data on (V-018) |
| Raspberry Pi feasibility | **Not Verified** | Budgets plausible on paper (F); nothing measured on a Pi; P-1/P-3/P-5 pending |
| Backend architecture | **Partial** | Modules, write rules and lanes well defined; worker crash recovery (V-002) and data-lane blocking (V-003) missing |
| Database architecture | **Partial** | Write-concurrency model defined; DDL executes and constraints hold (re-run); WAL and snapshot behaviour measured on Mac; durability depends on the card (PL-1); epoch rule not applied to automatic recovery (V-008) |
| Data consistency | **Partial** | `(epoch, seq)`, tombstones, single-writer ownership sound; V-008, V-009 |
| Synchronisation | **Partial** | USB-first is the right call; office import idempotent; V-008; stick handling V-007 |
| API design | **Partial** | Fair to the frontend and consistent with `types.ts` (only documented additions, C.4); V-009 changes the progress API for Child protection; minor inconsistencies V-011 |
| Networking | **Partial** | Kit network kept and specified; AP path not yet run (kit), start-at-boot not written (kit), AP isolation on the Pi's radio unverified, V-018 |
| Security | **Partial** | Threat model honest; HTTPS deferral correct and no feature depends on a secure context; V-001 (High), V-004, V-005 |
| Reliability and recovery | **Partial** | Boot recovery, snapshots, journaled update well specified; V-002, V-007; no power-cut test run |
| Deployment and updates | **Partial** | Signed, journaled A/B release folders; V-016; DEP tests not run |
| Monitoring and diagnostics | **Partial** | Status page, banners, health samples, diagnostics report proportionate; diagnostics carry V-001 |
| Maintainability | **Pass** | Facilitator actions are buttons; technician tasks are single commands; restore needing a technician is deliberate (ADR-008) |
| Testing strategy | **Pass** | Pass/fail tests for every category incl. real restore drills and relay power cuts; add tests listed under each finding |

---

## C. Detailed findings

### C.1 Owner requirement: safe download of user data by the admin, with power loss (DESIGN-DECISIONS §4)

Walkthrough of every power-loss and network-drop point. "Model" = `verify_export_powerloss_model` (Mac); "PoC" = architect's `poc_export` re-run (Mac). Nothing here was run on a Pi, phone or stick.

**On the Pi**

| # | Point of failure | What the design does | Verdict |
|---|---|---|---|
| P-a | Request accepted, job still `queued` | Boot step 4 only handles `running` jobs; step 5 then wipes the password of every job not `running`, so the queued job later runs with no password | **Gap** (V-004) |
| P-b | Mid-snapshot (`VACUUM INTO`) | Read transaction on the live DB; partial file in `.tmp/` deleted at boot; export `interrupted` | Correct (PoC, model) |
| P-c | Mid-zip / mid-tar→age | Built from the snapshot into `.tmp/<id>/…part`; deleted at boot | Correct (PoC, model) |
| P-d | After `.part` fsync, before rename | Deleted at boot | Correct (model) |
| P-e | Mid-rename / rename not yet durable | Same filesystem (`exports/.tmp` → `exports/`), ext4 rename atomic; file either in `.tmp` (deleted) or in `exports/` without a `ready` row (deleted) | Correct (model) |
| P-f | After directory fsync, before the row commits | File deleted at boot, export `interrupted` | Correct (model) |
| P-g | After commit, before `.tmp` cleanup | `ready`; `.tmp` cleared at boot | Correct (model) |
| P-h | Bag loses power while a phone downloads | Export stays `ready`; persistent ticket key; same ETag, so `Range` resumes | Correct by design; DL-1 unverified |
| P-i | Worker **process** crash or OOM kill, Pi stays up | Not handled until the next boot: export stays `preparing`, unique index blocks every export | **Gap** (V-002) |
| P-j | Live database | Never written by the export except the final short transactions | Correct |
| P-k | Boot check of `ready` files | Size only; SHA-256 later at low priority. The model's control shows a missing fsync would pass the size check | Acceptable; tighten (V-017) |

**On the phone or laptop**

| # | Point of failure | What the design does | Verdict |
|---|---|---|---|
| D-a | Wi-Fi drop during Mode 1 (in-page) | Backoff, resume from the last whole 1 MiB chunk with `If-Range`; new ticket if expired | Sound; DL-1/DL-3 unverified on a phone |
| D-b | Phone power loss or tab killed during Mode 1 | Chunks were in memory: restart from zero (export still `ready` for 24 h) | Acceptable (owner allows "restart"), not stated in §16 |
| D-c | Hash matched, then saving the `Blob` fails or is cut | `POST …/verified` is sent and "Downloaded and checked" shown **before/independently of** the save; the saved file is never checked | **Gap** (V-006) |
| D-d | Mode 2 (browser download manager) cut | Download manager may resume (unverified on Android); "Check the downloaded file" hashes the saved file | Sound |
| D-e | Truncated file used later | Zip central directory at the end + per-member authentication; `age` authenticates chunks and the final chunk; manifest SHA-256s | Sound (self-checking formats) |

**On a USB stick**

| # | Point of failure | What the design does | Verdict |
|---|---|---|---|
| U-a | Stick pulled mid-write | `EIO/ENODEV` → `failed/usb_removed`; `.partial` ignored and removed by the next backup | Sound, but see U-c |
| U-b | Pi loses power mid-write | Job `interrupted` at boot; `LATEST.json` written last; restore verifies hashes | Sound for the new backup; **not** a guarantee for earlier backups on the same FAT volume (V-007) |
| U-c | Next mount after U-a/U-b | `fsck.vfat -n` on a volume with the dirty bit set; design maps errors to read-only "This stick has errors" | **Unverified, likely to block remaking the copy** (V-007) |
| U-d | Learner-data zip to USB | Renamed on the stick before the row commits; no hash file beside it | Low risk (self-checking zip); add a `.sha256` (V-007) |

**Cross-cutting checks**

| Topic | Verdict |
|---|---|
| Snapshot consistency | **Pass.** `VACUUM INTO` is one read transaction; measured by the architect (33 ms, writer max 0.5 ms) and consistent with SQLite semantics; all reads after it use the snapshot `mode=ro` |
| Atomicity | **Pass** on ext4 (model). FAT is handled by hashes, not by rename (correctly stated) |
| Checksums | **Pass.** SHA-256 in DB, header, manifest; 12-hex check code for reading aloud. Wording: WinZip AE-2 stores no CRC-32 (authentication is by HMAC-SHA1), so "every member has a CRC-32 … 7-Zip Test verifies every CRC" should say "every member is authenticated" (V-011) |
| Cleanup on boot | **Pass** for `.tmp`, unready files, uploads, orphans; **gap** for queued data jobs (V-004) and for crashes within a boot (V-002) |
| Encryption | **Partial.** Backups: `age` to EasySTEM keys is sound. Learner data: AES zip at rest is sound; the password travels in the same plain-HTTP channel as the file (V-005); its storage on the bag outlives the wipe (V-004) |
| Audit log | **Pass.** Written in the same transaction as the change; covers create, ready/failed/interrupted, link, download, verified, delete/expire, USB, restore; no learner names; leads only |
| Retention | **Pass** on the bag (24 h / 7 d, 2 GiB cap, 90-day row history). Uptime-weighted ages work but are more code than needed (V-015). Sticks: **unspecified** (V-007). Phones: outside control, warned in the UI |
| Protection of children's data | **Partial.** Names off by default with re-auth; Child protection counts only; `<5` suppression; but V-001 (logs), V-005, V-013 |
| UI states (§4.8) | **Pass.** Every requested state exists in §16 with server or client data behind it; add "Saving to this phone…" (V-006) and "This copy was cut off, start again" for D-b |

**Conclusion for §4:** the Pi-side protocol meets the requirement and is the strongest part of the design. The requirement is **met with corrections** V-002, V-004, V-005, V-006 and V-007, and still needs P-6, BR-3, PL-3 and USB-1/USB-2 on real hardware.

### C.2 Are the Child protection rules sound?

The counts-only rule (ADR-009) is the right default: data that is not stored cannot leak, and counts still answer "is the programme used?". Exclusion of sensitive portals from `progress.csv`, `<5` suppression, and exclusion even in per-learner mode are sound. Problems:

1. **The rule is defeated by request logging** (V-001, High): the learner id and the Child protection lesson id travel together in the URL path and are logged, with IP and time, then shipped in diagnostics.
2. **Counting is wrong by construction** (V-009): only signed-in learners are counted; every pause and every retry adds to `opened`/`finished`.
3. **Who can switch the mode** (V-014): `cp.progress_mode` lives in the admin-changeable `setting` table, so a lead could turn on per-learner recording, although the ADR says only the owner decides.
4. **Small-cell differencing** (V-014): two exports whose periods differ by one day can reveal a single open (e.g. 7 and 6). Not linked to a person; acceptable if documented.
5. **Moving a lesson into Child protection** later leaves earlier per-learner rows of that lesson in the database and backups (V-014).
6. **Shared phones**: browser history keeps Child protection lesson URLs after "Leave this page" (frontend; V-014).

### C.3 DESIGN-DECISIONS "asks of the system": trace

| DD | Ask | Answered by | Status |
|---|---|---|---|
| §1 | Narration audio from the bag, no TTS; room for Krio | `listenUrl`/`listen_blob`, `language` fields | Met |
| §1 | Small JSON, paged lists, old-phone codec, smaller copy | `pageSize` ≤ 100 (default 25), smaller-copy job (H.264 ≤ 480p) | Met; codec/bitrate unverified (P-5, BR-1) |
| §1 | Everything from the Pi, HTTP only, no service worker | FR-1, ADR-004, FA §10 | Met |
| §1 | Writes survive power loss; resumable uploads; DB consistent | WAL + FULL, ADR-006, boot recovery | Met by design; PL-1/P-4 unverified |
| §2.1 | Learner records; unguessable ids; no list endpoint | ADR-016 (128-bit), no `GET /learners` | Met |
| §2.2 | Content tree, "Not in this bag yet" | DDL, `availability` | Met |
| §2.3 | Decide recording, visibility and export of Child protection | ADR-009 | Met in design; **broken by V-001**, V-009 |
| §2.4 | Upload inspection, type rule, byte ranges, sandboxed packages, H5P only with a player | §5.4, nginx §8.2, `415` for H5P | Met |
| §2.5 | Answers sent to the phone; results low-stakes | D-3.6 | Met |
| §2.6 | Monotonic progress; position saved occasionally | DATABASE §4.4, §6.3 | Met |
| §2.7 | Self-hosted Poppins; SVG from the Pi | Frontend build | Met |
| §3.1 | Offline admin sign-in; session survives a sleeping phone; protection from Wi-Fi users | §9.3–9.5 | Met; T-2 residual accepted |
| §3.2 | Streamed resumable uploads, no duplicates, no half file; background work without starving learners | ADR-006, lanes, `nice`/`ionice` | Met; V-002, V-010 |
| §3.3 | Drafts, insert with renumbering, quiz last, concurrent order edits safe | DATABASE §6.2 (DDL probes re-run) | Met |
| §3.4 | Storage and backup endpoints | `/admin/exports`, `/admin/usb`, `/admin/storage`, `/admin/status` | Met |
| §4 | Safe learner-data download with power loss | DATA-EXPORT | Met with corrections (C.1) |
| §5 | No internet; HTTP; minimise children's data; buttons not CLI; unknowns stay unknown | Throughout | Met except V-001; restore is a technician CLI by decision |

### C.4 Treatment of the frontend's API contract

`API-DECISIONS.md` reviews every item of `API-CONTRACT.md` §1–§9 and all nine open points; verdicts and reasons are given. The schema diff (`schema_diff.out`) shows `openapi.yaml` and `types.ts` agree field-for-field except for documented additions (`version`, `role`, `mustChangePassword`, `recorded`, `receivedBytes`, `state`, storage `availableBytes/reserveBytes/state`) and fields that `types.ts` keeps optional by its own comment (D-2.7). No field was renamed or removed. The costs to the existing frontend are justified: the CSRF header (one line, real risk on plain HTTP), resumable uploads (a 300 MB upload over a weak share of 2.4 GHz Wi-Fi must not restart), `recorded:false` (Child protection), bounded auto-retry for uploads and downloads. A transition flag keeps the current single-request upload working. **Fair and consistent.** Remaining items: V-009 (will change the progress call for Child protection), V-011 (small mismatches).

### C.5 Findings

Counts: **Critical 0 · High 1 · Medium 8 · Low 9.**

---

#### V-001 — Child protection activity is linked to learner ids in API logs and the diagnostics report
- **Severity:** High
- **Affected:** ADR-009; SYSTEM-ARCHITECTURE §8.2 item 6, §12.1, §12.3; DATA-EXPORT §2, §3.4; tests SEC-7, SEC-E2
- **Problem.** For every Child protection lesson a saved learner opens, pauses or finishes, the frontend sends `PUT /api/v1/learners/<lr-id>/progress/<lesson id>` (`progress.ts` lines 68, 105, 118). The nginx API log format `sensebod_noargs` records `$remote_addr`, time and `$uri`, and `$uri` contains both ids. §12.1 also keeps a gunicorn access log (path, no query string) in journald (persistent, 30 days), and the unencrypted diagnostics report, which any facilitator can make and which is meant to leave the bag, includes the last 2,000 lines of `sensebod-*` journal. Even with the PUT fixed, `GET /api/v1/lessons/<CP lesson>` and a later `PUT …/learners/<lr-id>/…` from the same IP within minutes link the two. Secondary: nginx error-log lines quote the full request line including the query string (`?ticket=`, `?search=`) when an upstream fails, which contradicts "tickets never reach logs".
- **Evidence.** `evidence/v1/doc-greps.txt`; `openapi.yaml` path `/learners/{learnerId}/progress/{lessonId}`. The design's own tests SEC-7 ("0 hits" for learner ids in all logs) and SEC-E2 would fail against the design as written.
- **Impact.** The one record ADR-009 promises never exists ("a named child opened *It is not my fault*") exists on the card for 7–30 days and can leave the bag in a file described as containing no personal data. Learner id → name is one lookup in the live database.
- **Correction.** (1) Child protection lessons never send a learner id (see V-009 for the replacement call). (2) Do not write per-request API access lines with IP and raw path to disk: log the route template (`PUT /learners/{id}/progress/{id}`), status and duration only, or aggregate counters; no IP for learner routes. (3) Gunicorn access log off (nginx is enough) or template-only. (4) Diagnostics: build `journal.txt` from a filtered source and run the name/id scan on the produced file, failing the export if it hits. (5) Error log: accept that error lines may hold request lines and exclude the nginx error log from diagnostics, or reduce `error_log` to `crit` for `/api/` locations.
- **Validation.** SEC-7 extended: run FN-1 including Child protection journeys with a saved learner, then grep nginx access and error logs, journald and a diagnostics report for every seeded learner id and Child protection lesson id: 0 co-occurrences on one line, 0 learner ids. Add a unit test on the nginx `log_format`.

#### V-002 — Interrupted jobs are recovered only at boot; a worker crash blocks exports until the bag is restarted
- **Severity:** Medium
- **Affected:** DATA-EXPORT §13 step 4; SYSTEM-ARCHITECTURE §5.8, F-6; DATABASE `export_one_preparing`; ADR-003
- **Problem.** Recovery of `running` jobs keys on `boot_id ≠ current`. If `sensebod-worker` dies within a boot (exception in native code such as `pycryptodomex`, cgroup OOM kill under `MemoryMax=1200M` which includes ffmpeg, `systemctl restart`), systemd restarts it but its jobs stay `running` with the current `boot_id` forever. The export stays `preparing`; the unique index then refuses every new export with `409 export_in_progress`; `.tmp/<id>` (a full copy of the database, with names) stays on disk; media jobs show "Making a smaller copy…" forever. The architect's PoC kills the process but then runs boot recovery, so it does not cover this case.
- **Impact.** Owner-required export unavailable until someone power-cycles the bag; F-6 claims "Auto" recovery.
- **Correction.** There is exactly one worker: at worker start, before claiming, apply the same rules as boot step 4/6 to every `running` job (data → `interrupted` with `worker_restart`; media → requeue) and clear their temp folders. Alternatively key jobs on a worker instance id (`boot_id` + worker start time). Add the API-side rule that a `preparing` export whose job is not `running`/`queued` is shown as interrupted.
- **Validation.** Test: `kill -9` the worker (not the Pi) during an export and during a conversion; within 30 s the export is `interrupted`, a new export can start, `.tmp` is empty, the conversion resumes.

#### V-003 — One data lane with no timeout: a long or hung USB job blocks snapshots, retention and every export
- **Severity:** Medium
- **Affected:** SYSTEM-ARCHITECTURE §5.8 job table (data jobs "Limits —"); DATA-EXPORT §5.1, §9, §10; weak spots 8
- **Problem.** All data work (learner export, backups, full USB backup, "Check the stick", diagnostics, local snapshots, retention, GC, content-pack install) runs serially in one thread with no time limit. A full backup copies gigabytes (3.3 GB of livestock video alone) and "Check the stick" re-reads all of it; a stick that hangs in uninterruptible I/O can block the thread until reboot. Meanwhile no local snapshot is taken (RPO "≤ 2 h" no longer holds), expired children's-data files are not deleted, and the learner-data export waits.
- **Correction.** Run USB copy and USB check as their own job lane (or a separate helper process with a watchdog), give every data job a stall timeout (no progress for N minutes → `failed/stalled`), let retention and snapshots run from the maintenance service outside the lane, and state the one-export-at-a-time rule per destination (USB jobs do not block a download export).
- **Validation.** Simulate a hung stick (e.g. a FUSE or `dm-delay` device on the test Pi) during a full backup: a snapshot is still taken on schedule; a learner export completes; the USB job ends `failed/stalled` within the timeout.

#### V-004 — The one-time export password outlives its "wipe" and can be shown again
- **Severity:** Medium
- **Affected:** DATA-EXPORT §6.1, §13 step 5; SYSTEM-ARCHITECTURE §5.1 (idempotency); API-DECISIONS D-1.9; `openapi.yaml` `createExport`
- **Problem.** (1) `POST /admin/exports` requires an `Idempotency-Key`, and the idempotency middleware stores the full response, which contains `password`, for 24 h; a replay returns it again, contradicting "The bag will not show it again", and no wipe touches that table. (2) `wal_checkpoint(TRUNCATE)` cannot complete while any reader is open (any API thread mid-request), so the wiped value stays in the `-wal` file. (3) A local snapshot or records backup taken while the job runs contains it. (4) Boot step 5 wipes the password of every export job not `running`; after a power cut a `queued` export job keeps state `queued` (step 4 handles only `running`), loses its password, and is then run by the worker, which must either fail or, if implemented naively, write an **unencrypted** zip.
- **Evidence.** Measured (Mac): `verify_sqlite.out` V-T1 `(busy=1, log=601, ckpt=301)` with a reader open; V-T2 password present in the snapshot and in `idempotency_record`; `verify_wipe.out` password present in `-wal` when a reader is open, absent when none is.
- **Impact.** Exposure is to someone holding the card or the admin session, where names are already readable (the architect's residual argument holds for at-rest), but the replay and the possible unencrypted output are real contract defects.
- **Correction.** Exclude `password` from stored idempotency responses (store a marker; a replay answers 200 with `password: null` and `passwordShown: true`); keep the password out of the database entirely: hold it in the worker's memory by passing it through a `0600` file under `/run/sensebod/` (tmpfs, gone at power loss) that the worker deletes after use; at boot, mark `queued` data jobs `interrupted` (consistent with "data jobs are not retried"); the worker refuses to build a learner-data zip with `encrypt: true` and no password.
- **Validation.** Unit tests: replay of `POST /admin/exports` never returns a password; grep of DB, WAL, snapshots and backups for the generated password after a job ends → 0 hits; power cut with a queued export → `interrupted`, no file produced.

#### V-005 — Learner-data encryption does not protect against the Wi-Fi sniffing it is listed against
- **Severity:** Medium
- **Affected:** DATA-EXPORT §2 (threats and controls), §6.1, §7; SYSTEM-ARCHITECTURE T-2, T-8, §9.7; ADR-008; weak spot 3
- **Problem.** §2 lists "sniffing the download on the Wi-Fi" and answers it with "encryption of every file that leaves the bag". The password is returned in the `202` JSON over the same plain-HTTP Wi-Fi (WPA2-PSK shared with every learner; the kit script sets `pmf=1`, which in NetworkManager disables management-frame protection), and the ticket URL is in the next response. A passive listener who can decrypt the Wi-Fi gets both. The zip password protects the file at rest (lost phone, T-8) only. A names-included export can be downloaded over Wi-Fi.
- **Impact.** Overstated control for children's names; proportionate otherwise, because the same listener can already take the admin session (T-2, accepted).
- **Correction.** Correct §2/§9.7 to say what the password protects. Make names-included learner-data exports USB-only by default (the stick never crosses the Wi-Fi); if download is allowed, show "Anyone on this Wi-Fi with the right tools could copy this file" and audit it. Optional stronger path (decide, do not leave to engineers): the admin page generates an X25519 key pair in JS and the bag returns the zip password sealed to it (TweetNaCl, roughly 10 KB gzip, to be measured against the 60 KB chunk budget), which defeats passive sniffing.
- **Validation.** SEC-E3: packet capture on the hotspot during a names-on export by Wi-Fi is refused (or shows the warning); a names-on USB export works; the capture of a names-off download contains no password in clear if the sealed option is chosen.

#### V-006 — "Downloaded and checked" verifies bytes in memory, not the file the phone saved
- **Severity:** Medium
- **Affected:** DATA-EXPORT §7.3 Mode 1 steps 3–5, §7.5, §16; ADR-007; weak spot 2
- **Problem.** Mode 1 hashes the bytes held in JavaScript, posts `…/verified`, then hands a `Blob` to `<a download>` (the sequence diagram posts `verified` before saving). The page cannot see whether the browser's download manager wrote the file (phone storage full is common on old phones; Chrome 58 Android `Blob` downloads are unverified). Up to 64 MiB of `ArrayBuffer` chunks plus the `Blob` copy can exceed what an Android 8 tab is allowed (≥ 128 MiB peak). A phone power loss mid-download loses everything (acceptable, but not described).
- **Impact.** The state the owner asked for ("Downloaded and checked") can be shown for a file that is missing or cut off; the admin may then delete the export from the bag. The self-checking zip limits harm to "file does not open later".
- **Correction.** Wording and order: "Received and checked" → save → "Saved as … — open it once to check" with a one-tap **Check the saved file** (the Mode 2 file-input check) as the normal final step; `verified` means "received and checked", rename the field or add `savedCheckedAt`. Keep chunks as `Blob` slices and hash incrementally on arrival; lower `export.inpage_max_bytes` to 16 MiB until P-6 measures memory. Document D-b in §16.
- **Validation.** P-6/BR-3 on the oldest phone with storage nearly full and with a 60 MiB file: no false "checked" state; tab memory recorded.

#### V-007 — USB sticks: FAT after a power cut, earlier backups, and no retention on the stick
- **Severity:** Medium
- **Affected:** DATA-EXPORT §3.3, §10, §11, §18 (USB-1, USB-2), A-6; SYSTEM-ARCHITECTURE PL-5; weak spot 14
- **Problem.** (1) After a pull or power cut the FAT dirty bit is set; the helper runs `fsck.vfat -n` and maps errors to `state: errors`, read-only ("Check it on a computer"). If dosfstools reports the dirty bit as an error (unverified), the facilitator cannot remake the copy on the same stick, and every stick last pulled from a Windows PC without ejecting is refused. (2) A power cut while FAT sectors are written can damage the allocation table and with it **earlier** files on the stick; "previous complete backup still restorable" (USB-2, PL-5) is not guaranteed by `LATEST.json` ordering. (3) Nothing says how many `.sbk` files, learner-data zips (children's data) or media blobs are kept on a stick, or how old ones are removed; the stick fills and keeps personal data indefinitely. (4) Learner-data zips on a stick have no `.sha256` beside them.
- **Correction.** Specify: dirty bit alone → mount read-write after `fsck -n` shows no other error (or run the repair only on a stick formatted by the bag); recommend **two sticks used alternately** ("Stick A / Stick B") so a cut never touches the only off-bag copy; stick retention (e.g. keep the newest 3 records backups, remove learner-data zips older than N days at the next plug-in, GC media not referenced by any kept backup); write `<file>.sha256` beside each learner-data zip; offer "Format this stick for Sensebod" (exFAT) as a lead action.
- **Validation.** USB-1/USB-2/PL-5 on two stick brands, FAT32 and exFAT: after 30 cuts the stick mounts read-write, the previous backup restores (BK-3), retention keeps the stated count.

#### V-008 — Automatic recovery from a local snapshot does not advance the epoch
- **Severity:** Medium
- **Affected:** DATABASE §9.3 step 3; ADR-012; SYNC §3.2–3.3
- **Problem.** SYNC says `bag_meta.epoch` is incremented by every restore so reused `seq` values sort after older ones. The technician restore does it (DATA-EXPORT §12); the automatic recovery in DATABASE §9.3 records `restored_from` only. After an automatic recovery to a snapshot older than a backup already imported, new changes reuse `seq` values the office has seen; with the "only if newer" rule the office keeps the stale row and **ignores tombstones** written after the recovery, so a learner who removed their name stays in the office database.
- **Correction.** Every replacement of the live database (automatic recovery, CLI restore, rollback to a pre-update snapshot after reopening) increments `epoch` in the same step; list these places in SYNC §3.2. Add the epoch to `BACKUP-MANIFEST.json`.
- **Validation.** SYNC-1 extended: backup B1 imported → DB-5 corruption recovery to an older snapshot → delete a learner → backup B2 imported → learner absent at the office; progress rows equal the bag's.

#### V-009 — Child protection counting is inaccurate and needs a learner id it should not have
- **Severity:** Medium
- **Affected:** DATABASE §6.3 step 2; API-DECISIONS D-4.5; ADR-009; `openapi.yaml` `saveLessonProgress`; frontend `progress.ts`
- **Problem.** Counts come from `PUT /learners/{id}/progress/{lessonId}`. Guests (most users: sign-up is optional) are never counted. The frontend sends `state: started` on open **and on every pause** (`savePosition`), and `finished` may be sent twice ("safe to call twice: idempotent PUT"); each call increments the counter, so an idempotent PUT drives a non-idempotent counter, and retries after network errors inflate it further.
- **Impact.** Programme reporting from these counts is not meaningful; and it forces the learner id onto the wire (V-001).
- **Correction.** Replace with an anonymous `POST /lessons/{lessonId}/activity {event: opened|finished, viewId}` for sensitive portals (no learner id, `viewId` random per page view, deduplicated per lesson/day in memory or a small table purged daily), counting guests and saved learners alike; the frontend calls it instead of the progress PUT for sensitive portals (it knows the portal). Define "opened" = one per page view.
- **Validation.** Contract test: 3 pauses + 2 finish retries on one view → `opened +1`, `finished +1`; a guest view is counted; no learner id in any Child protection request (log grep from V-001).

#### V-010 — Upload chunks hold gunicorn threads for their whole transfer
- **Severity:** Low
- **Affected:** ADR-006, SYSTEM-ARCHITECTURE §8.2 item 3, §10.2; weak spot 10
- **Problem.** With `proxy_request_buffering off`, an 8 MiB chunk at 1–2 Mbit/s holds one of 16 threads for 30–60 s; the 2 GiB single-request transition holds one for many minutes. A few concurrent uploaders reduce learner capacity.
- **Correction.** 2 MiB chunks by default (still one `fsync` per chunk, negligible); end the 2 GiB transition at a dated release; optionally a third gunicorn process bound to the upload locations.
- **Validation.** CON-1 with 4 simultaneous uploaders: learner p95 still < 300 ms.

#### V-011 — Small contract and wording inconsistencies
- **Severity:** Low
- **Affected:** `openapi.yaml`, API-DECISIONS, DATABASE, DATA-EXPORT §7.4
- **Problem.** (a) `LessonSource` lacks `content-pack`, which `lesson.source` allows; pack lessons would break the enum. (b) A-S1 (pack-owned fields read-only) has no documented `PATCH` error. (c) API-DECISIONS D-1.9 says `DELETE /learners/{id}` answers `404` if it never existed; `openapi.yaml` says always `204`. (d) Request field `encrypt` vs response `options.encrypted`. (e) AE-2 zips carry no CRC-32 (see C.1).
- **Correction.** Align the four contract points; fix the wording.
- **Validation.** FN-2 contract tests include a pack lesson and a never-existing learner delete.

#### V-012 — Tickets and sessions depend on the wall clock across reboots
- **Severity:** Low
- **Affected:** ADR-014 ("no security check depends on wall-clock time across boots"); DATA-EXPORT §7.2, §7.5; identity §5.2
- **Problem.** Ticket expiry, session idle/absolute expiry and lockout use wall-clock times; the ticket key survives reboots; after a power cut without an RTC battery the clock is restored to the last saved time, so a ticket or session lives longer in real time than stated.
- **Correction.** Put `boot_id` in the ticket MAC and reject tickets from another boot (the client already fetches a new link); expire sessions at boot or measure idle time with uptime; correct ADR-014's sentence.
- **Validation.** Unit test: a ticket issued before a reboot is refused after it; DL-3 still passes.

#### V-013 — A deleted learner's name stays in copies on the bag
- **Severity:** Low
- **Affected:** DATABASE §3 (`secure_delete OFF`), §7, §9.3; DATA-EXPORT §9
- **Problem.** After "Remove my name" the name remains in free database pages, local snapshots (≤ 7 days), `pre-update-*` snapshots (last two updates, possibly months) and `corrupt-*/` (never deleted).
- **Correction.** `secure_delete=ON` for the connection used by learner deletion (rare writes); bound `pre-update-*` and `corrupt-*` retention (e.g. 30/90 days, technician may keep longer); say in the product text that copies on the bag expire within N days.
- **Validation.** Delete a seeded learner, run retention clock forward: name absent from all files after N days.

#### V-014 — Child protection residual rules
- **Severity:** Low
- **Affected:** ADR-009; DATABASE `setting`; DATA-EXPORT §3.1
- **Problem.** (a) `cp.progress_mode` is an admin-changeable setting; (b) export period differencing can reveal single events; (c) lessons moved into a sensitive portal keep earlier per-learner rows; (d) browser history on shared phones keeps lesson URLs.
- **Correction.** (a) Make the mode a release/technician configuration (owner decision), audited, with a visible banner when per-learner; (b) round periods to whole months for `child_protection_counts.csv` or suppress differences; (c) delete per-learner rows of a lesson when it moves into a sensitive portal (or refuse the move); (d) frontend: Child protection navigation uses `location.replace`, document the limit.
- **Validation.** Unit tests for (a)–(c); manual check of (d) on a phone.

#### V-015 — Uptime-weighted retention is more code than the problem needs
- **Severity:** Low
- **Affected:** DATA-EXPORT §8; weak spot 6
- **Problem.** A per-export counter updated every 15 min to defend against clock jumps.
- **Correction.** Simpler equivalent: expire by wall clock **or** at the second boot after `ready_at`, **or** after 24 h of uptime counted from `CLOCK_BOOTTIME` within one boot, whichever is first; learner-data files never survive two boots.
- **Validation.** Unit test with clock set back 30 days: file removed after the second boot.

#### V-016 — Update step 5 and system packages sit outside the A/B scheme
- **Severity:** Low
- **Affected:** SYSTEM-ARCHITECTURE §10.6; ADR-011
- **Problem.** Step 5 installs nginx/systemd/udev/polkit files in place, and bundles may carry `.deb` files, which ADR-011 itself rejects as not atomic across power loss. Step 4's boot rule ("restores … or re-runs") leaves the choice to the engineer.
- **Correction.** Write each system file as temp + fsync + rename with the previous copy kept in the release folder for rollback; keep `.deb` installs technician-only (or out of field updates); pick one rule for an interrupted step 4 (re-run migrations, they are transactional).
- **Validation.** PL-4 includes cuts during step 5 with a changed nginx file: `nginx -t` passes after boot.

#### V-017 — Boot check of ready exports is size-only
- **Severity:** Low
- **Affected:** DATA-EXPORT §13 step 7
- **Problem.** The model's control shows that a missing fsync would leave a same-size, wrong-content file that passes the boot check and is offered until the deferred hash runs (the phone's hash would then fail).
- **Correction.** After an unclean boot, mark `ready` exports "checking" until the SHA-256 re-check passes (seconds for these sizes).
- **Validation.** PL-3 asserts no download is served between boot and the re-check.

#### V-018 — Phones with mobile data may resolve the site name on the internet
- **Severity:** Low (validation)
- **Affected:** SYSTEM-ARCHITECTURE §6, §7; ADR-015; NET-2
- **Problem.** `materials.sensebod.com` is a real public name. A phone whose default network is mobile data may resolve it publicly; if a public A record exists, the admin's password and learner names would be sent over the internet in clear. I did not look the name up.
- **Correction.** Ensure no public A/AAAA record for the name (DNS-01 needs only TXT), or that its public host never serves `/api/`; print the IP on the card as the fallback (already planned).
- **Validation.** NET-2 adds: with mobile data on, `materials.sensebod.com` either reaches the bag or fails; never another host.

---

## D. Missing architectural decisions

1. Job recovery on worker restart within a boot (V-002).
2. Lanes, timeouts and per-destination concurrency of data jobs (V-003).
3. Where the export password lives between request and job (V-004).
4. Whether names-included learner data may leave by Wi-Fi (V-005).
5. Stick rotation, stick retention, dirty-bit policy, stick format action (V-007).
6. Epoch on every database replacement (V-008).
7. Anonymous Child protection activity endpoint and what "opened" means (V-009).
8. API access-log policy for learner routes (V-001).
9. Who may change `cp.progress_mode` (V-014).
10. Open on the kit side and correctly marked as such in the design: AP model and start-at-boot network (DEV-3), Lite vs desktop (O-9), AP isolation on the Pi radio, RTC battery and card model (O-10).

## E. Complexity assessment

The component count is already minimal: nginx, one Django process group, one worker, timers, root helpers, SQLite, files. No broker, container, cache server or second database; sync phase 2 is design-only. Candidates to simplify:
- Uptime-weighted retention → boot-count rule (V-015).
- Two in-page download modes: keep both until P-6, then drop Mode 1 for any phone where it fails rather than maintaining per-phone switches.
- The `jobs.csv`/`exports.csv`/`journal.txt` diagnostics could be a single `status.json` + filtered log until a technician asks for more (also reduces V-001 surface).
- Do not remove: tickets (needed for download managers without cookies), `age` (removes all secrets from the bag), content-addressed media (makes incremental USB backup trivial), journaled updates.

## F. Resource and capacity assessment

On paper the design fits a Pi 5 with 8 GB comfortably: planning total 1–1.6 GB RAM with a transcode; SQLite database 1–100 MB (row size measured on the Mac, file format identical); exports capped at 2 GiB, snapshots at 2 GiB; 3.3 GB of known media on a 256 GB card. CPU for serving is negligible per the kit's measurement (≤ 3 % at 50 simulated users); conversions are software H.264 on two cores at `nice 19`, with the fan thermally acceptable (kit: 65 °C).

Caveats: (1) **None of these figures is measured on a Pi** (P-1, P-3, P-5, PERF-1…4). (2) NFR-4 and CON-1 assume 40 phones, but the kit's planning figure for the Pi hotspot is about 10 devices and the external AP is not working yet; the 40-phone target depends on the AP. (3) The SD card's commit rate with `synchronous=FULL` and whether it honours flushes is the single largest unknown (P-3, P-4); the design states the fallback (ADR-013). (4) A full USB backup of several GB on a cheap stick may take tens of minutes; the progress and V-003 matter more than throughput. (5) Pi 4 2 GB only with the Lite edition, as stated.

## G. Required revisions (in order)

1. **V-001**: remove learner ids from Child protection requests and from all on-disk API logs; filter diagnostics; extend SEC-7/SEC-E2.
2. **V-009**: anonymous, deduplicated Child protection activity endpoint; update ADR-009, DATABASE §6.3, `openapi.yaml`, API-DECISIONS D-4.5 and HANDOFF FE-4.
3. **V-004**: password out of idempotency storage and out of the database; queued data jobs interrupted at boot; refuse encrypt-without-password.
4. **V-002**: worker-start recovery of `running` jobs; add the kill-the-worker test.
5. **V-003**: separate USB lane or helper with a stall timeout; snapshots and retention not blocked by exports.
6. **V-007**: two-stick rotation, stick retention, dirty-bit policy, `.sha256` beside learner-data zips; update USB-1/USB-2/PL-5.
7. **V-006**: honest Mode 1 states and order, saved-file check as the normal last step, 16 MiB in-page cap until P-6.
8. **V-005**: correct the threat table; names-included exports USB-only by default (or sealed password delivery, decided).
9. **V-008**: epoch on every database replacement; manifest carries epoch.
10. Low findings V-010…V-018 (may be closed in the same revision or tracked).
11. Record in ARCHITECT-NOTES which findings were changed where, so reverification can check each against the text.

## H. Final decision

**REVISIONS REQUIRED.**

The architecture is sound in structure and proportionate for the deployment; nothing is Critical and no redesign is needed. One High finding (V-001) and eight Medium findings must be corrected in the documents before handoff. At reverification I will check each correction against the revised text and re-run the evidence scripts. Approval (with or without conditions) additionally requires the results of **P-1** (OS, Python, SQLite versions), **P-3** (commit rate and snapshot time on the real card), **P-4** (power-cut rig, 0 acknowledged writes lost) and **P-6** (Blob save and ticket download on the oldest real phone), because the durability promise and the owner's download states depend on them. P-2, P-5 and P-7 may remain conditions of the implementation phase.

**Not verified by me:** anything on a Raspberry Pi, a phone, an access point, a USB stick or the hotspot; Mermaid rendering; an OpenAPI linter run; nginx `X-Accel-Redirect` range behaviour on 1.26.3; `fsck.vfat` behaviour on a dirty volume; `pyzipper` output.
