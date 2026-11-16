# Architecture verification 2: re-verification of revision 1

13 Nov 2026 · Independent System Architecture Best Practices Verification Agent · Stage 5 of §30

**Scope.** The revised documents in `docs/system/` (SYSTEM-ARCHITECTURE v0.2, DATABASE v0.2, DATA-EXPORT-AND-BACKUP v0.2, `openapi.yaml` 0.2.0, API-DECISIONS v0.2, SYNC v0.2, HANDOFF-PACKAGES v0.2, the revised ADRs and ARCHITECT-NOTES), and the new PoCs, checked against `ARCHITECTURE-VERIFICATION-1.md`. I checked each finding against the documents themselves. `REVISION-1-RESPONSE.md` was used only as a map. A finding is **Closed** only when the fix is present and consistent in every place it touches (ADRs, `openapi.yaml`, DATABASE, the tests).

**Evidence** (`docs/system/reviews/evidence/v2/`). Everything was measured on the Mac; nothing ran on a Pi, a phone, a stick or the AP.

| File | What it shows |
|---|---|
| `architect-poc-rerun-v2.out` | `poc_export_v2.py` (90 trials), `poc_sync_epoch.py` and `ddl_check.py`, re-run unchanged from a copy. All reproduced: the invariants held, 0/91 passwords were found, the epoch control behaved as stated, the 25-table DDL ran and the new probes passed |
| `verify_epoch_restore.py/.out` | V-008 on the **technician-restore** path, using the architect's own `Bag`/`Office` model. The documented rule fails when the backup is restored onto a fresh card |
| `verify_cp_seq_link.py/.out` | The global `change_seq` stamped on the Child protection count row links an anonymous open to the named learner whose progress writes surround it (new V-019) |
| `doc-greps-v2.txt` | The exact lines cited below |

The `openapi.yaml` file was re-parsed with Ruby's YAML loader: 48 paths, 61 operations, 90 schemas. The new operations and schemas were inspected.

---

## A. Executive assessment

Revision 1 is substantial and mostly correct. The High finding V-001 is fixed at all three layers: no learner id in Child protection requests, no on-disk request logs carrying ids or IPs, and diagnostics without raw logs plus a privacy scan. The fixes are reflected consistently in ADR-009, SYSTEM-ARCHITECTURE §8.2/§12.3, DATA-EXPORT §3.4 and §7.2, `openapi.yaml`, HANDOFF and the tests (SEC-7, SEC-8, SEC-E2).

The job model is now sound on paper: worker-start recovery, one child process per job, three lanes with stall timeouts, and maintenance outside the queue. I re-ran `poc_export_v2` and it reproduces. Scenario A covers the case my first report raised, where the worker crashes but the Pi stays up.

The one-time password no longer touches SQLite. Downloads now claim "Downloaded and checked" only after the saved file is checked. USB handling now has a dirty-bit policy, two-stick rotation, retention on the stick and a hash file beside each learner-data zip.

**Of 18 findings: 13 Closed, 5 Partially closed, 0 Open.** The partial ones are:
- **V-008 (Medium).** The epoch fix fails on a fresh-card restore, the main restore case. Measured in the architect's own model.
- **V-004.** The new password path is not writable under the unit hardening the documents still specify.
- **V-010, V-014, V-016.** Leftover sentences that contradict the fix.

The changes introduced **six new findings: 2 Medium, 4 Low.**
- **V-019 (Medium).** The anonymous Child protection count is stamped with the global change sequence, so on a stolen card it sits between the named learner's own writes.
- **V-020 (Medium).** The new "Format this stick" action has no privileged unit and no rule that the target must be the USB device. The root privilege map (polkit list, writable paths) is out of date.
- **V-021 to V-024 (Low).** Orphan password files, re-sign-in during a resumed download, inflation of the anonymous counter, and an unkillable USB child at shutdown.

**Declined options:** all three are acceptable (C.2).

**Recommendation: REVISIONS REQUIRED.** This is a short, document-only revision 2. No Critical or High finding remains. Once these items are fixed, the remaining blocker is evidence, not design: P-1, P-3, P-4 and P-6 still have not run (section H).

---

## B. Review matrix

| Category | Result | Change since verification 1 |
|---|---|---|
| Requirements coverage | **Pass** | Child protection traced end to end (V-001, V-009 closed); V-019 is a residual of the same requirement, rated Medium |
| Offline independence | **Pass** | Unchanged; O-13 (public DNS) is an owner action with test NET-2 |
| Raspberry Pi feasibility | **Not Verified** | No Pi measurement yet (P-1, P-3, P-5) |
| Backend architecture | **Pass** | Worker-start recovery, per-job children, three lanes, stall timeouts (V-002, V-003 closed); minor V-024 |
| Database architecture | **Partial** | Sound; V-008 partial (restore epoch), V-019 (seq on Child protection counts) |
| Data consistency | **Partial** | V-008 partial |
| Synchronisation | **Partial** | Office import improved (`lost_on_bag`); V-008 partial |
| API design | **Pass** | New endpoints consistent with DATABASE and HANDOFF; contract items of V-011 aligned |
| Networking | **Partial** | Unchanged: AP path and start-at-boot still kit-open; PMF noted |
| Security | **Partial** | V-001 closed; V-020 (format, privilege map), V-004 path vs hardening |
| Reliability and recovery | **Partial** | Much improved; V-022, V-024 Low; no power-cut test run |
| Deployment and updates | **Partial** | V-016 partial (`.deb` sentence) |
| Monitoring and diagnostics | **Pass** | Diagnostics without raw logs, privacy scan before publication |
| Maintainability | **Pass** | Stick format/rotation are buttons; restore still technician (deliberate) |
| Testing strategy | **Pass** | New PL-6, PL-7, SEC-8, SEC-E3, EX-5..7, DL-5/6, USB-3/4; additions listed per finding |

---

## C. Detailed findings

### C.1 Status of findings V-001 … V-018

| ID | Sev. | Status | Verified against | Notes |
|---|---|---|---|---|
| V-001 | High | **Closed** | ADR-009; SYS §8.2 item 6, §10.2 (no gunicorn access log), §12.3, T-15, SEC-7, SEC-8; DATA-EXPORT §3.4 (`events.txt`, privacy scan), §7.2 nginx fragment; DATABASE §6.3; `openapi.yaml` `saveLessonProgress` (409 `sensitive_lesson`), `recordSensitiveActivity`; HANDOFF BE-3, DEV-1, FE-4 | All three layers present and consistent. Residual on the card: V-019 |
| V-002 | Med | **Closed** | DATA-EXPORT §5.1, §13 "When the worker starts"; SYS §5.8, F-6b, PL-6; ADR-003; DATABASE `job.heartbeat_at` | PoC scenario A reproduced (no `running`/`preparing` left; new export accepted) |
| V-003 | Med | **Closed** | SYS §5.8; DATA-EXPORT §5.1, §9, §11; DATABASE `job.lane` CHECK incl. `usb`, `export_one_preparing ON export(destination)`; ADR-003; PL-7 | DDL probes reproduced. Editorial: ADR-003 Rationale still says "Two lanes keep…". Unkillable child: V-024 |
| V-004 | Med | **Partially closed** | DATA-EXPORT §5.2, §6.1, §13 steps 4–5, EX-5/6; SYS §8.1, §10.2 `tmpfiles.d`; `openapi.yaml` `passwordShown`; ADR-008; DATABASE §3 | Design correct and PoC reproduced (0/91; scenario C always `interrupted`). Note that I5 is true by construction in the PoC (the password is never written to the DB there); the value of the PoC is the replay, queued-job and missing-password logic. **Remaining:** T-12/§10.2 hardening still says `ProtectSystem=strict` with `ReadWritePaths=/var/lib/sensebod` only, so the API cannot create and the job cannot delete files in `/run/sensebod/export-secrets` (under `strict`, `/run` is read-only unless listed). Add the path to `ReadWritePaths` of api and worker (see V-020). Orphan files: V-021 |
| V-005 | Med | **Closed** | DATA-EXPORT §2, §6.1, §7.1, §10.5, §14, EX-7; SYS §7 (PMF), T-2, T-8, §9.7, SEC-E3, O-14; `openapi.yaml` `namesOverWifi`, `422 names_need_usb`; ADR-008 | Threat table now honest; names go to USB by default. Declined option accepted (C.2) |
| V-006 | Med | **Closed** | DATA-EXPORT §7.3, §7.5, §15, §16, DL-1, DL-5; DATABASE `received_checked_at`, `saved_checked_at`; `openapi.yaml` `/checks`, `Export`; ADR-007; HANDOFF FE-6 | No `/verified` or 64 MiB remnants. Interaction with V-012: V-022 |
| V-007 | Med | **Closed** (design; behaviour unverified) | DATA-EXPORT §3.3, §7.4, §10.1–10.5, §11, §16, §18 USB-1..4, PL-5; `openapi.yaml` `UsbState`, `/admin/usb/format`; O-12 | Dirty-bit classification pinned to tool versions by USB-3 (must run). Format action: V-020 |
| V-008 | Med | **Partially closed** | DATABASE §4.6, §9.3; SYNC §3.2–3.3; DATA-EXPORT §3, §12; SYS §10.6; `poc_sync_epoch` | Automatic recovery and update rollback are correct (reproduced). **The technician restore fails in the main use case** (C.3, V-008 residual): restoring onto a fresh card gives `epoch = max(backup, 1) + 1`, which can equal an epoch the office already imported from the dead card. Measured in the architect's model: the deleted learner stays at the office (`verify_epoch_restore.out`). DATA-EXPORT §12's claim "sorts after anything the office has seen" is false for that case. Editorial: SYNC §3.3 has two steps numbered 4 |
| V-009 | Med | **Closed** | DATABASE §6, §6.4, §7; `openapi.yaml` `/lessons/{lessonId}/activity`, `SensitiveActivity`; API-DECISIONS D-4.5; SYS §5.5, §8.2; ADR-009; HANDOFF BE-6, FE-4; DDL probe | Counting is now accurate and anonymous. `crypto.getRandomValues` works on plain HTTP. New issues created by the endpoint: V-019, V-023 |
| V-010 | Low | **Partially closed** | ADR-006, D-6.2b, SYS §8.2 item 3, CON-1, `openapi.yaml` | Fix present. ADR-001 Trade-offs still says "≤ 8 MiB per request". Declined option accepted (C.2) |
| V-011 | Low | **Closed** | `openapi.yaml` `LessonSource`, `updateLesson` (409 `pack_owned`), `deleteLearner` (404/204), `ExportRequest.encrypted`; DATA-EXPORT §7.4 | All five points aligned |
| V-012 | Low | **Closed** | DATA-EXPORT §7.2, §13 step 1, DL-6; SYS §5.2; DATABASE §7; ADR-014; `openapi.yaml` | Interaction with resumed downloads: V-022 |
| V-013 | Low | **Closed** | DATABASE §3, §7, §6.5; DATA-EXPORT §9; `openapi.yaml` `deleteLearner`; D-4.3 | Bounded at 90 days |
| V-014 | Low | **Partially closed** | ADR-009; DATABASE `setting` comment, §6.5; DATA-EXPORT §3.1, §14; FE-4 | (a)–(c) present. **Remaining:** the configuration key is never named, and SYS §10.3 (the list of what `sensebod.toml` holds) does not include it. The ADR-009 Trade-offs line still says "aggregates over the period" where the decision says whole months. (d) accepted (C.2) |
| V-015 | Low | **Closed** | DATA-EXPORT §8, §13 step 10; DATABASE `export.ready_boot_*`; ADR-014 | Simpler and clock-independent |
| V-016 | Low | **Partially closed** | SYS §10.6; ADR-011 | Step 4 and 5 rules fixed. The release-bundle sentence in §10.6 still lists "optional `.deb` files for new system packages", which the same section now forbids. Step 6's automatic rollback restores the pre-update snapshot without saying "epoch + 1", although SYNC §3.2 says every replacement increments it |
| V-017 | Low | **Closed** | DATA-EXPORT §13 step 7, §15, §16, PL-3; DATABASE `export.state`; `openapi.yaml` (409 `checking`) | PoC scenario B reproduced. Make sure `sensebod-maint` is actually triggered at boot (a 15-minute timer alone would leave exports in `checking` for up to 15 minutes; acceptable, but say which) |
| V-018 | Low | **Closed** (owner action O-13 open) | SYS §7, T-16, NET-2, O-13; HANDOFF DEV-3 | Design and test in place; the DNS check is the owner's |

### C.2 Declined stronger options

| Option | Verdict | Reason |
|---|---|---|
| V-005: seal the zip password to a key made by the page (TweetNaCl) | **Acceptable** | Names now leave by USB by default, so a Wi-Fi listener can get a password but not a names file without an audited override. The architect's argument holds: the same listener can take the admin session (T-2, accepted residual). Revisit with HTTPS, as recorded in ADR-008 |
| V-010: a third gunicorn process for uploads | **Acceptable** | Chunks are now ≤ 4 MiB (2 MiB recommended), CON-1 tests 4 throttled uploaders against a learner p95 criterion, and the fallback is named. Proportionate |
| V-014(d): stop browser history keeping Child protection addresses | **Acceptable** | A page cannot clear the history over plain HTTP; `location.replace` plus a documented limit is right. **Cheap addition recommended (non-blocking):** use a neutral `document.title` (e.g. "Sensebod") on Child protection screens, because the history list shows page titles, and a title such as "It is not my fault" is the revealing part. Lesson paths contain no learner id or name |

### C.3 Owner requirement (DESIGN-DECISIONS §4), re-walked

The power-loss and network-drop points of verification 1 (C.1) were re-checked against DATA-EXPORT v0.2.

| Point | v1 | Now |
|---|---|---|
| P-a: request accepted, job queued at power cut | Gap | **Fixed**: queued data/USB jobs → `interrupted`; no password → `failed/password_missing`, never unencrypted (PoC scenario C) |
| P-b…P-g: mid-snapshot, mid-zip, mid-rename, before/after commit | Correct | Unchanged and still correct (re-ran v2) |
| P-h: bag reboots during a download | Correct | Now `checking` → `ready`; new ticket per boot. **Note V-022:** the admin session is deleted at boot, so getting a new link needs a sign-in that must not reload the page |
| P-i: worker crash, Pi stays up | Gap | **Fixed** (worker-start recovery; per-job children) |
| P-k: boot check of ready files | Size only | **Fixed** (`checking` + re-hash after an unclean boot) |
| D-c: "Downloaded and checked" before the save | Gap | **Fixed** (received → saved → saved-file check) |
| U-b/U-c: power cut on FAT, dirty bit | Gap/unverified | **Fixed in design**: dirty-bit-only → read-write; repair only own sticks; A/B rotation; behaviour pinned by USB-3 (unverified) |
| Stick retention | Unspecified | **Fixed** (3 records backups, 7-day learner data, referenced media only) |
| Password lifecycle | Gap | **Fixed in design**; unit hardening must allow the path (V-004 remainder) |

The owner requirement is **met in design**. It still awaits P-6, BR-3, PL-3, USB-1…4 and DL-1…6 on real hardware.

### C.4 New findings introduced by revision 1

#### V-019: The anonymous Child protection count carries the global change sequence, which places it between a named learner's writes
- **Severity:** Medium
- **Affected:** DATABASE §6.4 step 2 (`sensitive_activity_count` "stamped with a new `seq`"), §4.6; ADR-009 ("Data that does not exist cannot leak"); SYNC §2
- **Problem.** `next_seq()` is one counter for the whole bag, and writes are serialised. When a saved learner opens a Child protection lesson between two of her own non-Child-protection progress writes, the count row gets the sequence number between them. `lesson_progress` keeps the learner id, and `updated_at` to the millisecond. On a small bag with few simultaneous users, anyone holding the card or a decrypted backup can read "probably Fatmata" off the neighbouring rows. The count row keeps only the last increment's seq, so each lesson-day leaks at most one adjacency, but that is the most recent and most specific one.
- **Evidence.** `verify_cp_seq_link.out`: count row seq 8; seq 7 and seq 9 are both Fatmata's own progress writes (14:07:58, 14:09:27).
- **Impact.** It re-creates, by inference, the link ADR-009 says does not exist. The likelihood is low (card theft plus analysis), but the impact is on children.
- **Correction.** Do not stamp the global `seq` on `sensitive_activity_count`. Sync it by its natural key `(lesson_id, day)` with a per-row version, or with a separate counter used only for these rows. Keep no timestamps in `sensitive_activity_seen`. Run its purge with `secure_delete=ON`, or simply accept its one-day life. State in ADR-009 that the counts carry no ordering shared with personal tables.
- **Validation.** Unit test: after interleaved progress and Child protection events, no column of `sensitive_activity_count` or `sensitive_activity_seen` is comparable with `lesson_progress.seq` or `updated_at`. Office import SYNC-1 still sums counts idempotently.

#### V-020: The root privilege map is out of date, and "Format this stick" has no defined privileged path or target rule
- **Severity:** Medium
- **Affected:** SYS T-12, §9.2 diagram (TB4), §10.2 units table; DATA-EXPORT §10.1 (format), §10.1 (repair); `openapi.yaml` `/admin/usb/format`; HANDOFF DEV-4
- **Problem.** (1) T-12 says "polkit allows exactly two units". §10.2 lists three (eject, poweroff, update@), ADR-014 adds a clock helper, and the new format action needs root but has no unit at all. (2) Formatting is a root `mkfs` invoked from a web request. Nothing says which device it may touch: it must be the partition (or whole device) that the udev rule identified as USB, never `mmcblk0`/NVMe. Nothing says whether a partition table is rewritten, that the stick is unmounted first, or that the confirmation is checked server-side as well as on screen (`openapi.yaml` has `confirm: "FORMAT"`; that part is good). (3) Writable paths under `ProtectSystem=strict` do not include `/run/sensebod/export-secrets` (V-004 remainder).
- **Impact.** A bug in device selection in a root helper started from the admin UI could erase the bag's own card. The hardening as written would also break the password path.
- **Correction.** One table of privileged entry points: unit name, who may start it (polkit), arguments allowed (instance name = the udev kernel name recorded by `sensebod-usb@`), and target checks (`ID_BUS=usb`, not the root device's parent, not mounted elsewhere). Add `sensebod-usb-format@.service`. Update T-12 and §9.2. Add `/run/sensebod/export-secrets` to `ReadWritePaths` of api and worker.
- **Validation.** SEC-9: format with a crafted instance name (`mmcblk0p2`, `../`, a non-USB device) is refused by the unit; the polkit rules allow exactly the listed units; `systemd-analyze security` output recorded for api and worker; EX-5 passes under the hardened units.

#### V-021: Orphan password files can stay in tmpfs until the next reboot
- **Severity:** Low
- **Affected:** DATA-EXPORT §5.2, §6.1
- **Problem.** The API writes the password file before it commits the export row. If the commit fails (`503 busy`) or the API process dies between the two, a password file exists with no export. Nothing removes it within the boot; the worker-start sweep handles only `running` jobs. The PoC's I7 holds only because its commit never fails.
- **Correction.** `sensebod-maint` deletes secret files whose export is not `preparing` (or older than 10 minutes with no row); the API deletes the file when its transaction fails.
- **Validation.** Unit test with an injected commit failure: no secret file remains after the next maintenance run.

#### V-022: A resumed in-page download after a reboot needs a sign-in that must not reload the page
- **Severity:** Low
- **Affected:** DATA-EXPORT §7.2 ("After a reboot the page simply asks for a new link"), §7.3 step 2, §7.5, §13 step 1 (sessions deleted at boot)
- **Problem.** After a reboot the admin session no longer exists, so `POST …/download-link` answers 401. If the client handles 401 by navigating to the sign-in screen, the chunks in memory are lost, and "continues where it stopped" becomes "start again". Uploads document the sign-in; downloads do not.
- **Correction.** Specify an in-place sign-in (dialog, no navigation) during Mode 1 and Mode 2 checks, or state that a download in progress restarts after a reboot. Add the case to DL-6.
- **Validation.** DL-6 extended: reboot the bag during a Mode 1 download; after signing in again the download continues from the last chunk.

#### V-023: The anonymous count can be inflated, and each event is a durable write
- **Severity:** Low
- **Affected:** DATABASE §6.4; SYS §8.2 item 4; `openapi.yaml` `recordSensitiveActivity`
- **Problem.** `viewId` is chosen by the client, so a script can count 60 opens a minute per IP address. Each event is a `synchronous=FULL` commit plus an insert. This is the same order as existing anonymous writes, so it is not a new class of risk, but the counts reach partners as programme figures.
- **Correction.** Lower the limit for this route (e.g. 10/min per IP; a person opens far fewer lessons than that). Say in the export `README.txt` that the counts are page views on the bag and are indicative.
- **Validation.** CON-1 includes one abusive client; learner p95 holds and the counts rise by at most the limit.

#### V-024: A USB job child stuck in uninterruptible I/O can hold up shutdown and the WAL
- **Severity:** Low
- **Affected:** SYS §5.8 (stall timeouts); DATA-EXPORT §5.1, §11; `sensebod-poweroff`
- **Problem.** A child that cannot be killed survives `TimeoutStopSec=30`, so "Switch off the bag safely" can hang on the stuck stick. If the child still holds an SQLite read transaction (a full backup takes its snapshot inside the USB job), automatic checkpoints cannot reset the WAL until reboot.
- **Correction.** The USB job takes the snapshot, then closes its database connection before any stick I/O, and reports progress through the supervisor. Power-off detaches the stick (`umount -l`) and proceeds after a bounded wait.
- **Validation.** PL-7 extended: with the hung stick, "Switch off" completes within 60 s and the WAL is under `journal_size_limit` after a checkpoint.

---

## D. Missing architectural decisions

1. Epoch source for a restore onto a fresh card: the office's highest epoch for the bag must reach the restore CLI (V-008).
2. Ordering identity of Child protection counts, kept separate from `change_seq` (V-019).
3. Privileged entry points and target rules for the format action; writable paths under hardening (V-020, V-004).
4. Name of the Child protection mode key in `sensebod.toml` (V-014).
5. Unchanged and owner- or kit-side: O-1…O-14, AP model, start-at-boot network, Lite vs desktop.

## E. Complexity assessment

The revision added a third lane, per-job child processes, a de-duplication table, stick rotation and a `checking` state. Each answers a demonstrated failure, and none adds a new technology or daemon. The uptime-weighted retention was replaced by a simpler rule. Still proportionate. If simplification is wanted later, merge the data and USB lanes again behind one supervisor once PL-7 shows the stall timeout works. Do not merge them before then.

## F. Resource and capacity assessment

Unchanged in substance. Per-job children add one Python start (≈ 1–2 s, unmeasured) and 60–100 MB while a job runs, within the worker's `MemoryMax=1200M`, even with media, data and USB jobs running together. The planning sum of about 650 MB plus ffmpeg is an assumption. The in-page download cap fell to 16 MiB, which lowers phone memory risk. All Pi figures remain unmeasured (P-1, P-3, P-5, PERF-1…4).

## G. Required revisions (revision 2, document-only)

1. **V-008 remainder:** restore epoch = max(backup epoch, bag epoch, **highest epoch the office has imported for this bag**) + 1. The office tool prints it, and the restore CLI requires it (`--min-epoch`) or refuses. Fix the claim in DATA-EXPORT §12. Add the fresh-card case to SYNC-1.
2. **V-019:** remove the global `seq` from `sensitive_activity_count`; define how counts are synced; amend ADR-009.
3. **V-020 + V-004 remainder:** privileged entry-point table, `sensebod-usb-format@` with target checks, an updated T-12/§9.2, and `ReadWritePaths` for `/run/sensebod/export-secrets`.
4. **V-014 remainder:** name the configuration key in SYS §10.3; fix the ADR-009 Trade-offs line. Add the neutral `document.title` recommendation to FE-4 (optional).
5. **V-016 remainder:** delete "optional `.deb` files" from the bundle description; add "epoch + 1" to the step 6 rollback.
6. **V-010 remainder:** ADR-001 "≤ 8 MiB" → "≤ 4 MiB".
7. **V-021, V-022, V-023, V-024:** as specified above.
8. Editorial: ADR-003 "Two lanes" → three; SYNC §3.3 numbering; say how `sensebod-maint` is triggered at boot for `checking` (V-017).

## H. Final decision

**REVISIONS REQUIRED** (minor; documents only).

No Critical or High finding is open. V-001 is closed. The remaining work is three Medium items (V-008 remainder, V-019, V-020) and small consistency fixes. I will close them at verification 3 by reading the text and re-running `verify_epoch_restore.py` and `verify_cp_seq_link.py` against the revised rules.

After that, the decision depends on evidence, not design. The architecture cannot be **APPROVED** or **APPROVED WITH CONDITIONS** until **P-1, P-3, P-4 and P-6** have run on the kit Pi and the oldest real phone and their results are folded in. Until then the correct status is **INSUFFICIENT EVIDENCE**. P-2, P-5, P-7, USB-3 and the PL/BR/DL/USB test series may stay as conditions of implementation.

**Not verified by me:** anything on a Pi, phone, stick or AP; nginx 1.26.3 `X-Accel-Redirect` ranges; `fsck` dirty-bit reporting; `systemd` hardening behaviour; Mermaid rendering; an OpenAPI linter.
