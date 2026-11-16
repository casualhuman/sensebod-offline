# Architecture verification 3: re-verification of revision 2 and OWNER-1

13 Nov 2026 · Independent System Architecture Best Practices Verification Agent · Stage 5 of §30 (third round)

**Scope.** The revised `docs/system/` documents: SYSTEM-ARCHITECTURE v0.3 (new §4.1 and §9.8), DATABASE v0.3 (second DDL block), DATA-EXPORT-AND-BACKUP v0.3, SYNC v0.3, `openapi.yaml` 0.3.0, API-DECISIONS v0.3, HANDOFF v0.3, the ADRs (ADR-001 rewritten), and `poc/`. I checked them against `ARCHITECTURE-VERIFICATION-2.md` and against the owner's correction OWNER-1. I verified each item in the documents themselves; `REVISION-2-RESPONSE.md` was used only as a map.

**Evidence** (`docs/system/reviews/evidence/v3/`). Everything was measured on the Mac (Apple Silicon, macOS, Node v23.10, Python's SQLite 3.51.2). Nothing ran on a Pi, a phone, a stick or the AP.

| File | What it shows |
|---|---|
| `architect-poc-rerun-v3.out` | Re-ran unchanged from a copy: `poc_sync_epoch.py` (scenarios 1–4); my v2 fresh-card script `verify_epoch_restore.py` against the new PoC directory; `poc_cp_unlink.py`; `poc_export_v2.py` with 120 trials incl. scenario D (orphan password files); and `ddl_check.py` (both DDL blocks). All reproduce the architect's results |
| `verify_eventloop_busy.mjs/.out` | **New.** With a synchronous SQLite driver (Node's built-in `node:sqlite` as a stand-in for `better-sqlite3`), another process holds the write lock for 1.5 s. One API write with `busy_timeout=5000`, as DATABASE §3 specifies, **froze the Node event loop for 1,489 ms**. The same write with `busy_timeout=0` and an asynchronous retry gave a maximum lag of **4 ms** |
| `verify_node_rss.mjs/.out` | Order of magnitude only: an HTTP server with a SQLite connection, and a forked child, each about 46 MB RSS on the Mac (no Express; not linux-arm64) |
| `doc-greps-v3.txt` | The lines cited below |

---

## A. Executive assessment

Revision 2 closes everything that verification 2 left open, and the fixes are consistent across the documents.

**V-008 (fresh-card restore).** The new rule takes the office's highest epoch from a signed `bag-registry.json` and adds an epoch-nonce clash check at the office. My own v2 fresh-card case now passes under the documented rule (`poc_sync_epoch` scenario 3, re-run). Scenario 4 shows the clash check stops a bad import rather than merging it.

**V-019 (Child protection counts).** The counts have moved to a separate `counts.sqlite3` with no `seq`, no time of day and `WITHOUT ROWID` tables. Re-ran: a Child protection event adds 0 bytes to the main WAL, and no column of the count file can be ordered against personal data.

**V-020 (root entry points).** New §9.8 lists every root entry point. Each has instance patterns, target checks (the format unit must be the recorded USB disk and never the boot disk, `mmcblk*` or `nvme*`) and a one-time request file. The polkit rule and test SEC-9 are defined.

**V-004 and V-021 to V-024.** The hardened units now allow the password path (V-004). Orphan password files are removed, re-run 39/39 (V-021). A sign-in after a reboot no longer reloads the page (V-022). The Child protection activity limit is 10/min (V-023). USB jobs close their database connection before writing to the stick, and power-off is bounded (V-024).

**OWNER-1 is applied.** Django, gunicorn, `pyzipper`, PBKDF2-as-default and vendored wheels are gone. They remain only in sentences that record the supersession (ADR-001, ADR-000, ADR-008, ARCHITECT-NOTES, the response files). The backend is specified as twelve binding requirements, R-1 to R-12, each with a test. Node and Express libraries appear only as examples.

These requirements are good but not yet complete for Node. The most important gap is **V-026 (Medium)**:
- DATABASE §3 keeps `busy_timeout=5000`, and R-3 and R-12 rely on it.
- With a synchronous driver in a single-threaded Node API, every lock wait freezes all requests for its whole duration. I measured 1.5 s for a 1.5 s lock hold.
- The worker, the job children and `sensebod-maint` are separate writers, so such waits are designed in, not exceptional.
- A Node engineer would have to make this decision alone, which is exactly what OWNER-1 asked the architecture to prevent.

**Overall.** The design is complete, proportionate and internally consistent. No Critical or High finding is open. One new Medium finding and five new Low findings remain, all fixable in text.

**Recommendation.**
- **On paper: APPROVED WITH CONDITIONS.** The condition is that V-026 is written into R-2/R-3 and DATABASE §3 before the backend engineer starts BE-1/BE-3; the Low items may be closed alongside.
- **Formal status today: INSUFFICIENT EVIDENCE**, because P-1, P-3, P-4 and P-6 have not run.
- **When they pass** (and V-026 is in the text): **APPROVED WITH CONDITIONS**, the remaining conditions being implementation-phase tests. See H.

---

## B. Review matrix

| Category | Result | Basis |
|---|---|---|
| Requirements coverage | **Pass** | All DESIGN-DECISIONS asks and the owner requirement met in design; OWNER-1 applied |
| Offline independence | **Pass** | Unchanged; release carries its own runtime (R-11); O-13 owner action |
| Raspberry Pi feasibility | **Not Verified** | Budgets plausible (Node RSS order of magnitude matches §11.1 on the Mac); nothing on a Pi (P-1, P-3, P-5) |
| Backend architecture | **Partial** | R-1…R-12 tooling-agnostic and testable; V-026 (event-loop blocking by lock waits) missing; V-027, V-028 Low |
| Database architecture | **Pass** | Single-writer model, two files with clear separation, migrations; V-025 (Low) lifecycle of the second file |
| Data consistency | **Pass** | Epoch + lift + registry + nonce; counts merged by natural key |
| Synchronisation | **Pass** | Office import idempotent, regression-safe, clash-detecting; V-029 Low |
| API design | **Pass** | `openapi.yaml` 0.3.0 re-parsed (48 paths, 61 operations, 90 schemas); consistent with DATABASE and HANDOFF |
| Networking | **Partial** | Unchanged: AP path and start-at-boot are kit-open, PMF to check on phones |
| Security | **Pass** | V-001, V-019, V-020 closed; privileged entry points enumerated; residuals documented (T-2, T-7, WAL mtime) |
| Reliability and recovery | **Pass** (design) | Boot, worker-start and unclean-boot recovery specified and modelled; PL tests not run |
| Deployment and updates | **Pass** (design) | Pinned runtime in A/B release folders; no `.deb` in field bundles; DEP tests not run |
| Monitoring and diagnostics | **Pass** | Unchanged since v2 |
| Maintainability | **Pass** | Buttons for facilitators; single technician commands |
| Testing strategy | **Pass** | New SEC-9, SEC-10, EX-8, EX-9, DL-6; add the event-loop test of V-026 |

---

## C. Detailed findings

### C.1 Status of findings from verifications 1 and 2

Verification 1 found 18 findings; V-001 to V-003, V-005 to V-007, V-009, V-011 to V-013, V-015, V-017 and V-018 were closed in verification 2 and nothing in revision 2 reopens them. I re-checked their cross-references to the new counts file and the new maintenance trigger.

| ID | Sev. | v2 status | **v3 status** | Verified against | Notes |
|---|---|---|---|---|---|
| V-004 | Med | Partial | **Closed** | SYS §10.2 hardening row and `tmpfiles.d` row; T-12; DATA-EXPORT EX-9; ADR-008 | `ReadWritePaths` now include `/run/sensebod/export-secrets` and `/requests` (worker also `/run/sensebod/usb`). EX-9 (hardened units) must run on the Pi |
| V-008 | Med | Partial | **Closed** | SYNC §3.2 (replacement table, registry, nonce), §3.3 steps 1–7; DATA-EXPORT §3.2, §12; DATABASE `bag_meta.epoch_nonce`, §9.3; SYS §10.6 step 6; HANDOFF BE-10, SYNC-1; ADR-012 | Re-ran `poc_sync_epoch` (scenarios 2 control, 3 pass, 4 clash refused) and my `verify_epoch_restore.py` (same outcome). The false claim in DATA-EXPORT §12 is corrected. Residual items under V-029 |
| V-010 | Low | Partial | **Closed** | ADR-001 (rewritten), ADR-006, ARCHITECT-NOTES | No "8 MiB" left |
| V-014 | Low | Partial | **Closed** | SYS §10.3 (`child_protection.progress_mode`, boot audit, banner); ADR-009 Trade-offs (whole calendar months); HANDOFF FE-4 (neutral `document.title`) | All three remainders done |
| V-016 | Low | Partial | **Closed** | SYS §10.6 bundle sentence ("No `.deb` files"), step 6 via `replace_live_database()` with epoch + 1 | — |
| V-019 | Med | New | **Closed** | DATABASE §1, §4.6, §5, counts DDL block, §6.4, §7, §9.2; SYNC §2, §3.3 step 6; DATA-EXPORT §3.2; ADR-009; SEC-10; HANDOFF BE-6 | Re-ran `poc_cp_unlink` (v0.2 control links to Fatmata; v0.3 adds 0 bytes to the main WAL, no shared ordering column). The stated WAL-mtime residual (blurred to 15 minutes) is acceptable. Counts merged with `max` undercount increments made after a recovery; documented as a loss on the bag, acceptable for indicative counts. File lifecycle gaps: V-025 |
| V-020 | Med | New | **Closed** | SYS §9.2, T-12, **§9.8**, §10.2, SEC-9; DATA-EXPORT §10.1; `openapi.yaml` `formatUsb`; HANDOFF DEV-4 | Target checks are adequate: recorded kernel name, `ID_BUS=usb`, removable, not the parent of `/` or `/boot/firmware` (covers a Pi booting from USB), never `mmcblk*`/`nvme*`, other partitions unmounted, request file younger than 60 s with a nonce, confirmation in both API and unit. SEC-9 must run |
| V-021 | Low | New | **Closed** | DATA-EXPORT §6.1, EX-8; ADR-008; PoC scenario D | Re-ran: 39/39 orphan files removed in 120 trials; 0/121 passwords in data files |
| V-022 | Low | New | **Closed** | DATA-EXPORT §7.2, §7.3 step 2, DL-6; SYS §6; API-DECISIONS §12 item 7; ADR-007; FE-6 | In-place sign-in dialog |
| V-023 | Low | New | **Closed** | SYS §8.2 item 4, CON-1; DATABASE §6.4; DATA-EXPORT §3.1 README; `openapi.yaml`; D-4.5; ADR-009 | 10/min per IP; counts labelled indicative |
| V-024 | Low | New | **Closed** | DATA-EXPORT §5.1, §15, PL-7; SYS §9.8 power-off row, §10.2 `KillMode=mixed`; ADR-003 | Snapshot, then close the connection before stick I/O; bounded power-off |
| Editorial | — | — | **Done** | ADR-003 (three lanes), SYNC §3.3 numbering, `OnBootSec=1min` for V-017 | — |

**Totals:** all 24 findings of verifications 1 and 2 (V-001 to V-024) are **Closed**.

### C.2 OWNER-1: the runtime correction

| Check | Result | Evidence |
|---|---|---|
| Django, gunicorn and the Python backend are gone | **Pass** | `doc-greps-v3.txt`: outside `reviews/`, the instructions file and the response files, the only hits are sentences recording the supersession (ADR-000, ADR-001, ADR-003 "Celery/RQ in other runtimes", ADR-008, ARCHITECT-NOTES). `python3` appears only for the PoCs, explicitly justified in SYS §4.1. No `gthread`, `pyzipper`, PBKDF2 default, wheels or `manage.py` |
| The architecture is tooling-agnostic | **Pass** | §4 and §4.1 bind behaviours, not libraries; every Node library is in a column marked "examples (not binding)"; each requirement has a test that checks behaviour (R-1…R-12); systemd units say "(example)" for the entry point |
| R-1…R-12 are complete enough that a Node/Express engineer makes no architectural decision alone | **Partial** | Complete for streaming uploads, KDF, migrations, worker/IPC, config, logging, CSRF, release pinning and process model. **Missing:** how lock waits are handled without blocking the event loop (V-026); "no `await` inside a transaction" for asynchronous drivers (V-026); AE-1/AE-2 and CLI password handling for R-8 (V-027); native-module proof in P-1 and libuv thread-pool sizing (V-028) |
| Node feasibility: synchronous SQLite and the event loop | **Gap, measured** | V-026 |
| Node feasibility: native modules for arm64 | **Mostly covered** | R-11 (pinned runtime, build on arm64, ABI match) is right; P-1 should load every native module on the Pi (V-028). The memory-hard KDF can use `node:crypto.scrypt`, so a native Argon2 binding is optional |
| Node feasibility: streaming AES zip | **Open to P-2** | R-8 is right in intent; the named examples are unproven (V-027) |
| Node feasibility: memory budget | **Plausible, unverified** | §11.1 (API 60–150 MB, supervisor 40–80, job child 50–120, worst case ≈ 1.9 GB) is consistent with my Mac measurement of about 46 MB for a bare HTTP server with SQLite and for a forked child. `--max-old-space-size` plus `MemoryMax` bound it. PERF-1/PERF-3 on the Pi decide |

### C.3 New findings

#### V-025: The lifecycle of the second database file, `counts.sqlite3`, is only partly specified
- **Severity:** Low
- **Affected:** DATABASE §9.3 (corruption at start), DATA-EXPORT §4 (export snapshot), §9 (local snapshots), §12 (restore), §13 step 3 (boot checks)
- **Problem.** `counts.sqlite3` appears in the DDL, the backup manifest (`db/counts.sqlite3`), DATABASE §9.2 and the office import. It does not appear in the boot `quick_check` or the automatic recovery from corruption. The restore sequence does not swap it in or remove its `-wal`/`-shm`, so a fresh card would start with no counts. The learner-data export does not say from which snapshot the Child protection counts are read, and the local-snapshot rotation does not mention it.
- **Impact.** Low: the data is anonymous and indicative. But a corrupt counts file at start, or a stale `-wal` beside a restored one, would be handled by whatever the engineer improvises.
- **Correction.** One paragraph. The boot `quick_check` covers both files. If `counts.sqlite3` is corrupt, move it aside, restore it from the newest snapshot or recreate it empty, and record a note; this never blocks the API. The restore swaps both files with the same `-wal`/`-shm` rule. The export takes `VACUUM INTO` snapshots of both files. Local snapshots rotate as a pair.
- **Validation.** DB-5 extended to corrupt `counts.sqlite3`: the API starts and counts continue. BK-3 shows the counts restored.

#### V-026: Lock waits block the Node event loop; the write model needs a Node-specific rule
- **Severity:** Medium
- **Affected:** SYS §4.1 R-2, R-3, R-12; DATABASE §1, §3 (`busy_timeout=5000`), §4 rule 5; ADR-001 Trade-offs; ADR-002
- **Problem.** With a synchronous driver (the design's example, `better-sqlite3`), a statement that waits for the write lock blocks the Node process until SQLite returns. In a single API process that stops every other request: learner reads, progress saves, upload chunks, health. Other writers exist by design: the worker supervisor, up to three job children (progress and heartbeat at most every 2 s, final commits), `sensebod-maint` (retention batches of 500, snapshot bookkeeping, `wal_checkpoint(TRUNCATE)`), the restore and update CLIs. So the API will sometimes wait. ADR-001 notes only that a query blocks for its own length; R-3 and R-12 rely on `busy_timeout` for cross-process serialisation. Separately, with an *asynchronous* driver, two requests can interleave transactions on one connection unless awaits inside a transaction are forbidden.
- **Evidence.** `verify_eventloop_busy.out`, Mac, synchronous `node:sqlite`. A 1.5 s lock hold by another process gave a **1,489 ms event-loop freeze** with `busy_timeout=5000`, versus **4 ms** with `busy_timeout=0` and an asynchronous retry.
- **Impact.** NFR-4 (p95 < 300 ms) can be lost to rare but long stalls. Worst case is a 5 s freeze of the whole API per wait. It is an architectural decision the Node engineer would otherwise make alone, which OWNER-1 asked the architecture to prevent.
- **Correction** (binding text in R-3 and DATABASE §3; libraries remain examples).
  1. In the API process, a lock wait must never block the event loop. Either keep `busy_timeout` at most about 20–50 ms and retry asynchronously with backoff up to a total of 5 s, then `503 busy`; or run all database access in a worker thread or a dedicated writer process.
  2. Long or lock-heavy maintenance (TRUNCATE checkpoints, retention batches) runs only when no export or job holds the database, and each batch is kept to under ~50 ms.
  3. No `await`, timer or I/O inside a transaction. With an asynchronous driver, use one connection per transaction or a per-connection mutex.
  4. Job children and maintenance may keep `busy_timeout=5000`, because they are not serving requests.
- **Validation.** New test DB-6. Under CON-1, with a job child committing progress every 2 s and `sensebod-maint` running retention, the API's event-loop delay is p99 < 50 ms and max < 200 ms, measured with `perf_hooks.monitorEventLoopDelay` or an equivalent, and there are 0 `503 busy`.

#### V-027: R-8 (AES zip) is slightly over-specified, and its examples are unproven
- **Severity:** Low
- **Affected:** SYS §4.1 R-8; ADR-008; DATA-EXPORT §6.1, §7.4; HANDOFF P-2
- **Problem.** R-8 requires WinZip AES **AE-2** and offers two examples: a zip-library plug-in, or the Debian `7zip` CLI "fed the password through a pipe". Whether the 7-Zip CLI reads the password from a pipe rather than the terminal is unverified, and so is which AE variant each writer emits. AE-1 (with CRC) is equally acceptable for the purpose. The CLI route also needs the plaintext CSVs on disk in `.tmp/`; this is acceptable because the snapshot with names is already there, but it is not stated.
- **Correction.** R-8: "WinZip AES-256 (AE-1 or AE-2), opened by 7-Zip/ZArchiver/Keka; streaming or from files in `.tmp/` that are removed with it; never the password on argv or in the environment." P-2 records which writer and variant were used, and how the password reached it.
- **Validation.** P-2 as written, plus `ps`/`/proc/<pid>/cmdline` and `environ` show no password during the job.

#### V-028: The Node-specific proofs and thread-pool sizing are not stated
- **Severity:** Low
- **Affected:** HANDOFF P-1; SYS §4.1 R-4, R-11; §11.1
- **Problem.** P-1 checks that the pinned runtime starts and reports the SQLite version, but not that **every native module in the release loads** on the Pi's glibc and ABI. Node's libuv thread pool (default 4) is shared by `scrypt` (R-4), `fs` `fsync` (R-1) and hashing. Several sign-ins during an upload can delay chunk fsyncs.
- **Correction.** P-1 adds: run the release's self-check, which loads every native module and runs one write plus one `VACUUM INTO` through the chosen driver on the card. R-4/R-1 note: size `UV_THREADPOOL_SIZE` (e.g. 8) and keep the KDF cost measured on the Pi (PERF-1: < 1 s, memory per hash recorded).
- **Validation.** P-1 and PERF-1 records.

#### V-029: Bag-registry details: which key verifies it, clock-based freshness, and resolving a clash
- **Severity:** Low
- **Affected:** SYNC §3.2–3.3; DATA-EXPORT §12; SYS §8.1 (`allowed_signers`), §9.6
- **Problem.**
  1. The registry is signed with namespace `sensebod-registry`, but `/etc/sensebod/allowed_signers` is described as holding release and content-pack keys only. Which key, with which namespace restriction, verifies the registry is not stated.
  2. "Registry older than the newest backup on the stick" compares the office clock with the bag clock. The bag clock may be `unsure` (ADR-014), so a restore could be refused by mistake. The typed `--min-epoch` fallback exists, so this is an inconvenience, not a risk.
  3. An `epoch_clash` is resolved by "re-restore with the right epoch". If the bag has been in use since, that loses data. A small CLI action that moves the live bag to a new epoch and nonce through `replace_live_database()`, with no restore, resolves it without loss.
- **Correction.** Name the registry key in `allowed_signers` with `namespaces="sensebod-registry"`. Base freshness on the registry's `generated_at` against the **office import time** of the newest backup it lists, not on the bag's clock. Add `sensebod-admin new-epoch --min-epoch <n>` as the clash remedy.
- **Validation.** SYNC-1 extended: registry signed with the release key is refused; clash → `new-epoch` → next import accepted, nothing lost.

### C.4 New elements introduced by revision 2: assessment

| Element | Assessment |
|---|---|
| Signed `bag-registry.json` on the technician key stick | Sound and offline. It contains bag ids and epochs, no personal data. It is refuse-by-default, with an audited escape hatch and a second line of defence at the office (nonce). Details in V-029 |
| Separate `counts.sqlite3` | Sound; removes the ordering link measurably. The cost is a second file to manage (V-025). `WITHOUT ROWID` and day-only granularity are right |
| Root format helper | Sound as specified in §9.8: target checks inside the unit, not only in the API; nonce-bound request file; `wipefs` + one partition + exFAT; audited. SEC-9 must exercise the crafted instances |
| Per-job Node children and the pinned runtime | Proportionate; memory plausible (C.2) |

---

## D. Missing architectural decisions

1. Lock-wait handling in the Node API process and the transaction rule for asynchronous drivers (V-026). **This is the condition.**
2. Corruption, restore and export handling of `counts.sqlite3` (V-025).
3. Registry verification key and clash remedy (V-029).
4. Owner-, kit- and hardware-side items, unchanged: O-1 … O-14, AP model, start-at-boot network, Lite vs desktop, RTC battery and card model.

## E. Complexity assessment

Revision 2 adds a second SQLite file, a signed registry, a nonce and a privileged-unit table. Each removes a demonstrated failure (V-019, V-008, V-020), and none adds a daemon, broker or new technology. The move to a requirements-based backend description reduces coupling to tools. Still proportionate. The design would not be simpler without these pieces, only less safe.

## F. Resource and capacity assessment

Node processes:
- Mac: about 46 MB each for an HTTP server with SQLite and for a forked child.
- Pi budget §11.1: 60–150 MB for the API and 50–120 MB per job child, worst case ≈ 1.9 GB of 8 GB.

These are plausible, but every figure on the Pi is unverified (P-1, PERF-1, PERF-3). The event-loop stall of V-026 is a latency risk, not a capacity one. Wi-Fi remains the bottleneck (kit: about 55 Mbps on the hotspot, about 10 devices planned until the AP works). The durability promise still rests on the microSD honouring flushes (P-3, P-4).

## G. Required revisions

Before the backend engineer starts BE-1/BE-3 (condition):
1. **V-026:** add the event-loop rule to SYS §4.1 R-3/R-12, DATABASE §3–4 and ADR-001; add test DB-6.

May be done in the same pass or tracked into implementation:
2. **V-025:** `counts.sqlite3` in boot checks, recovery, restore, export snapshot and rotation.
3. **V-027:** R-8 wording; P-2 records the writer, the AE variant and the password path.
4. **V-028:** P-1 native-module self-check; thread-pool sizing note.
5. **V-029:** registry key in `allowed_signers`, freshness by office import time, `new-epoch` remedy.

Hardware evidence, owned by DEV/QA/BE/FE:
6. Run **P-1, P-3, P-4, P-6** and record the results in `poc/pi-results.md`. If P-4 shows acknowledged writes lost on the kit's card, ADR-013 (storage medium) must change before approval.

## H. Final decision

**On paper (design): APPROVED WITH CONDITIONS.** No Critical or High finding is open, and all 24 earlier findings are closed. The remaining issues are documented and non-blocking for the architecture, with one condition: V-026 must be written into R-3, DATABASE §3–4 and ADR-001, with test DB-6, before backend implementation of the database layer starts (BE-1, BE-3). V-025 and V-027 to V-029 (Low) may be closed alongside or during implementation.

**Formal status today: INSUFFICIENT EVIDENCE.** As stated in verifications 1 and 2, approval needs the hardware proofs P-1 (OS, arm64, pinned runtime, SQLite through the driver), P-3 (commit rate and snapshot time on the real card), P-4 (power-cut rig: 0 acknowledged writes lost) and P-6 (Blob save and ticket download on the oldest real phone). None has run.

**When they pass** (and the V-026 text is in): **APPROVED WITH CONDITIONS**. The remaining conditions are implementation-phase evidence: P-2, P-5, P-7, USB-3, and the bold tests of SYS §14 and DATA-EXPORT §18 (PL-1…7, BR-1/3, DL-1…6, SEC-1/7/8/9/10, EX-9, BK-3, DEP-1).
- If **P-4 fails**, durability (NFR-2) is not met and ADR-013 must change (high-endurance card or SSD) before approval.
- If **P-6 fails**, Mode 2 with "Check the saved file" becomes the default on those phones; the decision is unaffected.
- If **P-3** shows fewer than 50 commits/s, revisit coalescing and ADR-002 before approval.

**Not verified by me:** anything on a Pi, phone, stick or AP; `better-sqlite3` itself (I used Node's built-in synchronous driver as a stand-in); any AES zip writer; systemd hardening and polkit behaviour; `fsck` dirty-bit reporting; Mermaid rendering; an OpenAPI linter.
