# Architecture verification 4: re-verification of revision 3

13 Nov 2026 · Independent System Architecture Best Practices Verification Agent · Stage 5 of §30 (fourth round)

**Scope.** I checked V-025 to V-029 from `ARCHITECTURE-VERIFICATION-3.md` against the revised documents themselves: SYSTEM-ARCHITECTURE §4.1 (R-3, R-3L, R-3H, R-4, R-8, R-11, R-12), §8.1, §9.6, §10.2, §14; DATABASE v0.4 (§1, §3, §4, §9.4); DATA-EXPORT v0.4; SYNC v0.4 §3.2; HANDOFF v0.4; ADR-001, 002, 008, 011; and the new `poc/poc_lock_wait.mjs` and `poc/poc_ae2.mjs`. I also looked for new problems and for any return of Django-specific decisions. `REVISION-3-RESPONSE.md` was used only as a map.

**Evidence** (`docs/system/reviews/evidence/v4/`). Everything was measured on the Mac (Node v23.10 with the built-in synchronous `node:sqlite`, macOS bsdtar/libarchive). Nothing ran on a Pi, a phone, a stick or the AP.

| File | What it shows |
|---|---|
| `architect-poc-rerun-v4.out` | `poc_lock_wait.mjs` and `poc_ae2.mjs` re-run unchanged from a copy, plus `ddl_check.py`. Reproduced: A 1,507 ms frozen / B 28 ms / C 9 ms; with a 7 s hold, B gives up after 4,932 ms; other writers hold the lock ≤ 2.3 ms; TRUNCATE gives up after 114 ms; AE-1 read and AE-2 write both interoperate with libarchive; wrong password and tampering are refused |
| `verify_retry_storm.mjs/.out` | **New.** The R-3a default with **many requests waiting at once**. Every failed `BEGIN IMMEDIATE` still waits its 20 ms synchronously, and attempts that run in the same tick stack. Results during the 1.5 s hold that DB-6 injects:<br>• 200 writes arriving together froze the loop for **1,518 ms**; 60 writes at 40/s gave a **155 ms** maximum.<br>• `busy_timeout=0`, or a single-flight gate (one probe at a time), keeps the lag at **9–30 ms** |
| `verify_new_epoch_remedy.py/.out` | **New.** The V-029 `new-epoch` clash remedy, in the architect's own `Bag`/`Office` model. As documented (no re-stamping), **a learner who removed their name on the clashing card stays at the office and newer progress is lost there**. Re-stamping rows and tombstones written since the restore fixes it |
| `verify_ae2_ctr_speed.mjs/.out` | The PoC's WinZip-AES CTR routine (one AES call per 16-byte block) runs at **33 MB/s** on the Mac. A batched keystream gives the same output at **376 MB/s**. A performance note for the production writer, not a defect |
| `doc-greps-v4.txt` | Cited lines |

---

## A. Executive assessment

Revision 3 is good work and nearly complete.

**V-026 (lock waits).** R-3L makes "a lock wait never blocks a process that serves HTTP" binding, with a measurable outcome (event-loop delay p99 < 50 ms, max < 200 ms; `503 busy` after 5 s) and test DB-6. It gives a default (R-3a), an alternative (worker thread, R-3b) and a lock-hold budget for every other writer (R-3H). The architect's PoC reproduces. One gap remains in the default: when many requests wait at once, their 20 ms synchronous waits add up. With the long hold that DB-6 itself injects, I measured a 1,518 ms freeze for a burst of 200 writes. DB-6 would catch this, and a one-sentence change to the default removes it.

**V-025, V-027, V-028: closed.**
- `counts.sqlite3` now has a full lifecycle (DATABASE §9.4) that matches DATA-EXPORT §4, §9, §12 and §13.
- R-8 is correctly relaxed to AE-1 or AE-2 with no password on argv or in the environment. The `node:crypto`-only writer interoperates with libarchive in both directions. P-2 has proper acceptance criteria.
- R-11 has a release self-check, also used at update step 6 and in P-1, and R-4 sets `UV_THREADPOOL_SIZE=8`.

**V-029 (bag registry).** The registry key now has its own namespace in `allowed_signers`, and the freshness check never compares the bag's clock. The new `new-epoch` remedy is claimed to work "without data loss", but it does not: rows and tombstones written during the clash keep their old sequence numbers, so the office ignores them. Measured in the architect's model.

**OWNER-1** is intact. No Django, gunicorn or Python-backend decision has returned; mentions remain only where the supersession is recorded. The Python PoCs are justified as SQLite and filesystem tests.

**Status:** 29 findings in total. 27 Closed. 2 Partially closed (V-026, V-029), both now Low and text-only. No new findings beyond those two remainders.

**Decision:**
- **On paper: APPROVED WITH CONDITIONS.**
- **Formal status today: INSUFFICIENT EVIDENCE**, until P-1, P-3, P-4 and P-6 run.
- **After they pass: APPROVED WITH CONDITIONS**, the conditions being implementation-phase tests. See H.

---

## B. Review matrix

| Category | Result | Change since verification 3 |
|---|---|---|
| Requirements coverage | **Pass** | — |
| Offline independence | **Pass** | — |
| Raspberry Pi feasibility | **Not Verified** | Still no Pi measurement (P-1, P-3, P-5) |
| Backend architecture | **Pass** | R-3L/R-3H/R-11 self-check/thread-pool added; V-026 remainder is a Low wording fix guarded by DB-6 |
| Database architecture | **Pass** | `counts.sqlite3` lifecycle complete (V-025) |
| Data consistency | **Pass** | V-029 remainder concerns only the rare clash path |
| Synchronisation | **Pass** (with V-029 remainder) | Registry key and clock-free freshness specified |
| API design | **Pass** | — |
| Networking | **Partial** | Unchanged, kit-side items (AP, start-at-boot, PMF) |
| Security | **Pass** | Registry key namespaced; release/content keys namespaced too |
| Reliability and recovery | **Pass** (design) | — |
| Deployment and updates | **Pass** (design) | Self-check at update step 6 (rollback on failure) |
| Monitoring and diagnostics | **Pass** | — |
| Maintainability | **Pass** | `new-epoch` single command (fix V-029 remainder) |
| Testing strategy | **Pass** | DB-6, DB-5/BK-3 extended, P-2 spike criteria, SYNC-1 extended |

---

## C. Detailed findings

### C.1 Status of V-025 to V-029

| ID | Sev. | **v4 status** | Verified against | Notes |
|---|---|---|---|---|
| V-025 | Low | **Closed** | DATABASE §9.4 (boot, snapshots as a pair, export, backup, restore, retention); DATA-EXPORT §4 step 1, §9, §12 (both files swapped with the `-wal`/`-shm` rule), §13 step 3; SYS §14 DB-5, BK-3 | Consistent in every place. A corrupt counts file never blocks the API and does not change the epoch: correct, as it is not personal data |
| V-026 | Med → remainder Low | **Partially closed** | SYS §4.1 R-3, R-3L (outcome, R-3a default, R-3b alternative), R-3H, R-12, §14 DB-6; DATABASE §1, §3 (per-process `busy_timeout`), §4 rule 5; ADR-001 revision 3; ADR-002 revision 3; HANDOFF BE-1, QA-1 | The binding outcome, the alternative, the lock-hold budget and DB-6 are right, and the PoC reproduces. **Remaining (Low), two items:**<br>(1) **R-3a as written can fail R-3L when several requests wait at once.** A failed attempt blocks for its whole `busy_timeout` (≤ 20 ms), and attempts that run in the same tick stack. The stacking is bounded by the length of the hold, so under R-3H's ≤ 50 ms holds it stays ≤ ~50 ms. But under DB-6's injected 1.5 s hold, or a slow microSD fsync, it reaches the hold length: 1,518 ms for a burst of 200 writes, 155 ms at 40 writes/s (`verify_retry_storm.out`). Fix: R-3a uses `busy_timeout=0` (or ≤ 2 ms) **or** a single-flight gate, so only one request at a time probes the lock and the others await it in an in-process FIFO. Both measured at 9–30 ms. No retry storm or starvation was observed in any variant: all writes completed within the hold plus one backoff step. `busy_timeout=0` costs about 13 cheap attempts per write during a long hold; the gate about 1.05.<br>(2) **ADR-002's Decision line still says `busy_timeout=5000`.** Only the revision note at its end corrects it. Make the Decision line say "per process (DATABASE §3)" |
| V-027 | Low | **Closed** | SYS §4.1 R-8 (AE-1 or AE-2; streaming or from `.tmp/` CSVs removed with it; no password on argv or in the environment; a CLI only via pipe or fd; bsdtar `--passphrase` excluded); DATA-EXPORT §6.1; ADR-008; HANDOFF P-2 (7-Zip/ZArchiver/Keka, variant and password path recorded, `/proc/<pid>/cmdline` and `environ` clean, `.tmp/` empty) | `poc_ae2` reproduced: AE-1 read from libarchive, AE-2 written and read by libarchive, wrong password and tampering refused. **Notes for P-2 (non-blocking):**<br>(a) The PoC buffers whole members and calls AES once per block (33 MB/s on the Mac). A production writer should stream and batch the keystream (376 MB/s, same bytes) and run in the job child, not the API.<br>(b) Hand-written crypto must keep the libarchive cross-check as a unit test and add 7-Zip as P-2 requires |
| V-028 | Low | **Closed** | SYS §4.1 R-11 (`bin/sensebod-selfcheck`: every native module loads against the image's glibc and the runtime's ABI, both databases opened through the driver, one write and one `VACUUM INTO`, versions reported), R-4 (thread pool, async KDF, PERF-1 cost), §10.2 (`UV_THREADPOOL_SIZE=8`); ADR-011 (self-check at update step 6 → rollback); HANDOFF P-1 | — |
| V-029 | Low | **Partially closed** | SYNC §3.2 (dedicated Ed25519 registry key, `namespaces="sensebod-registry"`, release/content keys namespaced, rotation with `valid-after`/`valid-before`, freshness by listed `backup_id`s and `(epoch, change_seq)`, `new-epoch`); DATA-EXPORT §12; SYS §8.1, §9.6, §14 SYNC-1; ADR-011 | Key and freshness are closed. **Remaining (Low): the clash remedy is not lossless.** `new-epoch` moves the bag to a new epoch with the counter lift but leaves existing rows and tombstones with the `seq` they received in the clashing epoch. At the office those values are lower than the other lineage's, so they are ignored. In the architect's model, Mohamed's name removal on card 2 is ignored and Aminata's newer progress is lost (`verify_new_epoch_remedy.out`). Fix: `new-epoch` also **re-stamps every syncable row and tombstone with `seq` above the restore's lift base** (one batched transaction, API stopped), or simply all of them at bag sizes (≤ 1 M rows, DATABASE §8). Then the next import applies them, as shown by the same script's variant. Add this to SYNC-1 |

### C.2 Owner correction OWNER-1, re-checked

No Django, gunicorn, `pyzipper`, `gthread`, `manage.py` or Python-backend decision exists outside the supersession records (ADR-000, ADR-001, ADR-008, ARCHITECT-NOTES) and the response files (`doc-greps-v4.txt`). The new PoCs are in Node because they test Node behaviour; the Python PoCs remain because they test SQLite and the filesystem, as stated in SYS §4.1. The requirements stay tooling-agnostic: every library is in an "examples" column, and every binding item has a behavioural test.

### C.3 New problems introduced by revision 3

| Area | Result |
|---|---|
| Starvation or retry storm under the async retry | **None found** in any variant. The only defect is stacked synchronous waits in R-3a (V-026 remainder above) |
| R-3b (worker-thread alternative) | Acceptable. Note for the implementer: with `busy_timeout=5000` inside the thread, reads queued behind a waiting write also wait. R-3L's 5 s → `503` outcome bounds this; DB-6 decides |
| R-3H "TRUNCATE with `busy_timeout` ≤ 100 ms" | Correct; reproduced (gives up after 114 ms) |
| Self-check at update step 6 | Correct place: a failing native module rolls back before the bag reopens |
| Hand-written AE-2 | Acceptable with the P-2 criteria and the notes in C.1 |
| Registry rotation and compromise | The inherent offline limit is stated; the nonce check is the safety net |

No further new findings.

---

## D. Missing architectural decisions

1. R-3a: `busy_timeout=0` or a single-flight gate (V-026 remainder).
2. `new-epoch` re-stamping rule (V-029 remainder).
3. Owner-, kit- and hardware-side items, unchanged (O-1 … O-14, AP, start-at-boot, Lite vs desktop, RTC battery, card model).

## E. Complexity assessment

Unchanged and proportionate. Revision 3 adds rules and tests, not components. The hand-written AE-2 writer, about 100 lines of `node:crypto`, removes a third-party native dependency. The trade-off is owning a small piece of crypto code, kept honest by the libarchive and 7-Zip cross-checks.

## F. Resource and capacity assessment

Unchanged from verification 3. Lock holds measured on the Mac are ≤ 2.3 ms (`synchronous=FULL`, but a macOS `fsync` is not a full flush). On the Pi's microSD a commit may take tens to hundreds of milliseconds; that is exactly when the V-026 remainder matters, and P-3 and DB-6 will show it. AE-2 writing at Mac speed takes seconds for the planned export sizes; the Pi is slower but within reason, if the keystream is batched. All Pi figures remain unmeasured.

## G. Required revisions

Text only, and may be done before or alongside BE-1/BE-3 and SYNC-1:
1. **V-026 remainder:** in R-3a, use `busy_timeout=0` (or ≤ 2 ms) or a single-flight write gate; add "N concurrent writers during the hold" to DB-6. Make ADR-002's Decision line per-process.
2. **V-029 remainder:** `new-epoch` re-stamps rows and tombstones written since the restore (or all); add the case to SYNC-1.

Hardware evidence:
3. Run **P-1, P-3, P-4, P-6** and record the results in `poc/pi-results.md`.

## H. Final decision

**On paper (design): APPROVED WITH CONDITIONS.** No Critical, High or Medium finding is open; 27 of 29 findings are closed. The two remainders (V-026, V-029) are Low, text-only, and guarded by binding tests (DB-6, SYNC-1). They should be fixed before the backend engineer starts BE-1/BE-3 and the office tool SYNC-1.

**Formal status today: INSUFFICIENT EVIDENCE.** P-1 (OS, arm64, pinned runtime, self-check), P-3 (commit rate and snapshot time on the real card), P-4 (power-cut rig, 0 acknowledged writes lost) and P-6 (Blob save and ticket download on the oldest real phone) have not run.

**When P-1, P-3, P-4 and P-6 pass** (with the two text fixes in): **APPROVED WITH CONDITIONS**. The remaining conditions are implementation-phase evidence: P-2, P-5, P-7, USB-3, and the bold tests of SYS §14 and DATA-EXPORT §18, including DB-6, PL-1…7, BR-1/3, DL-1…6, SEC-1/7/8/9/10, EX-9 and BK-3.
- If **P-4 fails**, durability (NFR-2) is not met and ADR-013 must change before approval.
- If **P-3** shows fewer than 50 commits/s, or very slow commits, revisit coalescing, ADR-002 and the R-3a choice before approval.
- If **P-6 fails**, Mode 2 becomes the default on those phones; the decision is unaffected.

**Not verified by me:** anything on a Pi, phone, stick or AP; `better-sqlite3` (I used `node:sqlite` as a stand-in); 7-Zip, ZArchiver and Keka; systemd and polkit behaviour; Mermaid rendering; an OpenAPI linter.

---

## Round 5 (revision 3a)

13 Nov 2026 · re-verification of V-026 and V-029 only, against the documents themselves (the "Revision 3a" section of `REVISION-3-RESPONSE.md` was used as a map). Evidence: `evidence/v5/architect-poc-rerun-v5.out`: `poc_lock_wait.mjs` and `poc_sync_epoch.py` re-run unchanged from a copy, plus my `evidence/v4/verify_new_epoch_remedy.py` against the new PoC. Mac only (Node v23 `node:sqlite`); nothing on a Pi.

### What was checked

**V-026.**
- **Documents.** R-3L (SYS §4.1) now makes `busy_timeout=0` plus one in-process single-flight write gate the binding default. Only the head of the queue touches SQLite and it retries asynchronously; each request may wait at most 5 s from arrival, queue time included, then gets `503 busy`. A per-request retry with a non-zero timeout is forbidden, and R-3b remains the alternative. The rest is consistent: DB-6 now includes (a) 200 concurrent writes during a 1.5 s hold, plus steady arrivals; DATABASE §1, §3 and §4 rule 5 match; ADR-002's Decision line is now per-process; ADR-001 and HANDOFF BE-1 match.
- **Re-run.** Default: burst of 200 gave **5 ms** lag with 212 attempts; steady arrivals gave **11 ms**. The control (`busy_timeout=20`, per-request) gave 1,514 ms. These match the architect's figures within noise.
- **Starvation and pile-up.** The queue is FIFO and only the head probes, so no request is overtaken. The pile-up is bounded by the 5 s budget: at most about 5 s of arrivals, and these are already capped per IP by nginx. Once the lock frees, the queue drains in about 1 ms per write.
- **Process stop.** A queued write has committed nothing, so an interrupted request is never acknowledged. Retries are safe because writes are idempotent PUTs or carry an `Idempotency-Key`. The API's graceful stop (≤ 20 s) exceeds the 5 s budget, so queued writes finish or answer 503 before exit.
- **Non-blocking notes for BE-1:**
  - (i) Answer `503` from a per-request timer at 5 s, even if the request is not yet at the head.
  - (ii) `counts.sqlite3` has its own lock, so give it its own gate (or a second gate instance), so that a hold on the main file never delays Child protection counts.

**V-029.**
- **Documents.** SYNC §3.2: `new-epoch` re-stamps every syncable row and tombstone with `seq > bag_meta.epoch_base_seq`, in the original order, in one transaction. The new `bag_meta` key is defined (DATABASE §6), and SYNC-1 covers the case.
- **Re-run.** `poc_sync_epoch` 5a (control, no re-stamp): the removal is lost at the office. 5b (re-stamp): Mohamed's removal and Aminata's newer progress reach the office. My v4 script gives the same two results.
- **Non-blocking note (edge case).** If an automatic recovery happened on the clashing card between the restore and `new-epoch`, rows written after the restore but kept in the recovered snapshot sit below the new `epoch_base_seq` and are not re-stamped. Simpler and complete: re-stamp every row and tombstone with `seq ≥ (lowest clashing epoch × 2^40)` reported by the office, or simply all rows (≤ 1 M, DATABASE §8). Add it to SYNC-1 when convenient.

### Updated status

| ID | Sev. | Round 4 | **Round 5** |
|---|---|---|---|
| V-025 | Low | Closed | Closed |
| V-026 | Med → Low | Partially closed | **Closed** (notes i–ii for BE-1) |
| V-027 | Low | Closed | Closed |
| V-028 | Low | Closed | Closed |
| V-029 | Low | Partially closed | **Closed** (edge-case note for SYNC-1) |

**All 29 findings (V-001 … V-029) are Closed.** No new findings; three non-blocking implementation notes. OWNER-1 is unaffected: no Django or Python-backend decision was reintroduced.

### Final decision (round 5)

**On paper (design): APPROVED WITH CONDITIONS.** The design is complete, consistent and verified as far as a Mac allows. The conditions are evidence, not design.

**Formal status today: INSUFFICIENT EVIDENCE**, until P-1, P-3, P-4 and P-6 run on the kit Pi and the oldest real phone.

**When they pass: APPROVED WITH CONDITIONS.** The remaining conditions are implementation-phase tests: P-2, P-5, P-7, USB-3, DB-6, PL-1…7, BR-1/3, DL-1…6, SEC-1/7/8/9/10, EX-9, BK-3.
- If **P-4 fails**, ADR-013 must change before approval.
- If **P-3** shows fewer than 50 commits/s or very slow commits, revisit ADR-002 and coalescing first.
