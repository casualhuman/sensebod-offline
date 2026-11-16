# Sensebod backend review, round 1

Reviewer: Senior Backend Best Practices, Code Quality and Architecture Compliance Reviewer (independent quality gate, read-only)
Date: 13 Nov 2026
Runtime under review: Node.js + Express 5 + TypeScript, SQLite through the built-in `node:sqlite` driver (owner decision)

---

## 1. Scope reviewed

The build was in progress while this review ran. The review covers the files below as they were when read. Files that appeared later are listed separately and are **not** reviewed.

### 1.1 Files reviewed (line counts at the time of reading)

| File | Lines |
|---|---|
| `backend/package.json` | 26 |
| `backend/tsconfig.json` | 20 |
| `backend/tsconfig.build.json` | 5 |
| `backend/migrations/main/0001_initial.sql` | 391 |
| `backend/migrations/counts/0001_initial.sql` | 18 |
| `backend/src/config.ts` | 273 |
| `backend/src/core/context.ts` | 281 |
| `backend/src/core/db.ts` | 194 |
| `backend/src/core/errors.ts` | 52 |
| `backend/src/core/fsx.ts` | 95 |
| `backend/src/core/http.ts` | 306 |
| `backend/src/core/idempotency.ts` | 157 |
| `backend/src/core/ids.ts` | 66 |
| `backend/src/core/log.ts` | 58 |
| `backend/src/core/migrate.ts` | 97 |
| `backend/src/core/replace.ts` | 121 |
| `backend/src/core/time.ts` | 22 |
| `backend/src/core/writeGate.ts` | 98 |
| `backend/src/exports/snapshots.ts` | 178 |
| `backend/src/identity/passwords.ts` | 124 |
| `backend/src/identity/sessions.ts` | 184 |
| `backend/src/identity/routes.ts` | 324 |
| `backend/src/identity/override.ts` | 337 |
| `backend/src/system/bootstrap.ts` | 526 |
| `backend/src/catalog/model.ts` | 486 |
| `backend/src/catalog/validate.ts` | 144 |
| `backend/src/media/attach.ts` | 204 |
| **Total** | **4,787** |

`package-lock.json` (1,002 lines) was checked only for the dependency list.

### 1.2 Present but not reviewed (appeared after the cut-off)

- `backend/src/catalog/routes.ts` (695 lines)
- `backend/src/learners/routes.ts` (266 lines)

These go to round 2.

### 1.3 Not yet built (not findings)

- The Express application assembly and the three entry points (`bin/sensebod-api.ts`, `bin/sensebod-worker.ts`, `bin/sensebod-admin.ts`); `bin/`, `dev/`, `scripts/`, `seed/`, `test/`, `docs/` are empty folders.
- Start-up assertions of the API (WAL, `quick_check`, migration head), graceful stop, clean-shutdown marker, `uptime_total_s` persistence.
- `media` (uploads, store, inspection, conversions), `worker` (lanes, child processes, stall timeouts), `sensebod-maint` tasks (retention, GC, checkpoints, health samples).
- `exports` beyond snapshots (zip, backups, tickets, USB), `system` routes (`/health`, `/admin/status`, audit, clock, power-off).
- Restore CLI, update tool, self-check (`bin/sensebod-selfcheck`), release build for `linux-arm64`.
- Boot-recovery step 2 (finish or roll back an interrupted update or restore) and the "blob row without a file" part of step 9.
- All tests, including the schema-conformance test (BE-2) and the R-1…R-12 checklist (BE-1).

### 1.4 Baseline checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Pass (exit 0), run twice during the review |
| `npm audit --omit=dev` | `found 0 vulnerabilities` |
| `npm test` | Runs, **0 tests** (no test files exist) |
| Migration vs DATABASE §6 | `diff` of the DDL block against `migrations/main/0001_initial.sql` and of the counts block against `migrations/counts/0001_initial.sql`: identical except one added header comment line in each file |
| Node used for the checks | v23.10.0 on macOS (not the Pi, not an LTS line); bundled SQLite 3.49.1 |

### 1.5 Probes

Throwaway probe scripts were written and run only in the reviewer's scratch folder (`/private/tmp/claude-501/-Users-abdulrahimjalloh-Desktop-EasySTEM-easystemoffline/f08098b0-2c24-43cb-a374-808b46242f2e/scratchpad/probe/`, files `harness.ts`, `p1_gate.ts`, `p2.ts`, `p3.ts`, `p4.ts`, `p5.ts`). They import the backend sources unchanged, build a temporary bag (two migrated SQLite files) and, where needed, a small Express app from the real middleware and routers. Nothing in the repository was modified. All timings are from a Mac, not a Pi.

---

## 2. Executive summary

**Overall code quality: good.** The code is small, readable and consistent. Modules have clear responsibilities, names are plain, comments explain why and cite the requirement. TypeScript is strict (`strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`). There are two runtime dependencies (`express`, `smol-toml`), both pure JavaScript, so there is no native-module risk on ARM. No code talks to the network.

**What works, with evidence.**
- The single-flight write gate does what R-3L asks. Probe: another connection held the write lock for 1.5 s while 200 writes were queued: all 200 committed, 212 lock attempts, the event loop's largest gap was 5 ms. With the lock held for 6 s, all 50 queued writes failed with `BusyError` at 5,002 ms and the loop's largest gap was 13 ms.
- `node:sqlite` reports `SQLITE_BUSY` with `code: 'ERR_SQLITE_ERROR'` and `errcode: 5`, and `classify()` maps it correctly.
- `Db.tx` is `BEGIN IMMEDIATE`, refuses a nested transaction and refuses an asynchronous callback. The cached statements are reset after `get()` (a `TRUNCATE` checkpoint from a second connection succeeded right after a cached multi-row `get()`).
- `next_seq()` gives a strict sequence (1…200 over 200 gated writes).
- The connection-open routine applies every pragma of DATABASE §3 and asserts WAL.
- The schema equals DATABASE §6.
- Idempotency: two concurrent requests with one key gave `201` and `409 in_progress` with `Retry-After: 2`; a replay returned the stored body; a different body gave `422 idempotency_mismatch`; one row was created.
- Identity flows: roles, re-authentication, the "only hub manager" guard, the override request → wrong code (attempt committed) → redeem → restricted session → new password flow all behaved as specified. The request log held route templates only; no IP, cookie or password appeared in any log line.
- Configuration refuses unknown tables, unknown keys and wrong types.

**What blocks.** Four High findings:
1. The backend takes the client address from `X-Real-IP`, but the existing nginx configuration does not set that header. Every phone looks like `127.0.0.1`, or any client can choose its own address.
2. The sign-in lockout counts parallel wrong passwords as one failure (20 parallel guesses → `failed_count = 1`).
3. Boot recovery treats **any** failure to open the database as corruption and rolls the bag back to a snapshot (a healthy file with a permission problem lost two of three learners in the probe).
4. `replaceLiveDatabase` removes the live database before the new file is safely in place, and lifts the epoch only after the swap, so a failed copy leaves no database and a power cut can leave a replaced database with the old epoch.

**Architecture compliance: partial.** R-2, R-3, R-3L, R-5 (first migration), R-7, R-9, R-10 are implemented in the reviewed code. Deviations: the 5 s bound is not measured from arrival for requests with a body; a few file reads happen inside write transactions; reads are not retried on `SQLITE_BUSY`; the epoch rule can be broken by two recoveries in a row.

**Offline readiness: good for what exists.** Nothing reaches the internet. The only external command at boot is `timedatectl` with a 3 s limit. The online reset path answers `503 offline` by design.

**Security: not acceptable yet** (findings 1 and 2 above, plus a session check missing inside the password-change transaction and laptop-only `[dev]` switches that a bag's configuration file can turn on).

**Database reliability: mixed.** Day-to-day transaction handling is sound. The recovery paths (boot recovery, database replacement, the migration runner for table rebuilds) have real defects.

**Resource efficiency: good.** No unbounded buffers or queues were found on request paths; the in-flight cap bounds the gate queue and the password-hash queue; `last_seen` is throttled. Minor notes only.

**Production readiness: not ready.** No tests exist, no entry point exists, the Node version is not pinned, and the High findings are open.

---

## 3. Review matrix

| Area | Status | Notes |
|---|---|---|
| Node/TypeScript/Express practices | Partial | Clean and strict; issues: arrival time lost across the body reader (BR-007), swallowed errors in file helpers (BR-012), a few state reads used after an `await` (BR-002, BR-009) |
| Architecture compliance | Partial | Core rules implemented; deviations BR-005, BR-007, BR-014, BR-023 |
| Database and transactions | Partial | Gate, pragmas, `BEGIN IMMEDIATE`, sequence: pass (probed). Replacement, epoch and migration runner: BR-004, BR-005, BR-006 |
| API contract compliance | Not Verified | Error model, CSRF, Host list, idempotency and ETag helper match the documents for what exists; no contract tests exist, most routes not built or not reviewed |
| Offline independence | Pass | For the code reviewed: no network use, no package download, boot never waits on the network |
| Synchronisation | Partial | `change_seq`, epoch lift and nonce exist; epoch reuse (BR-005) and non-atomic lift (BR-004); the rest is not yet built |
| Authentication and security | Fail | BR-001, BR-002 (High); BR-008, BR-009, BR-010 (Medium) |
| CPU and memory efficiency | Pass | Bounded queues; minor notes BR-026, BR-031 |
| Storage efficiency | Pass | `last_seen` throttled, empty transactions do not flush; minor note BR-025 |
| Background processing | Not yet built | Worker, lanes, maint |
| Deployment configuration | Partial | Unknown keys refused; BR-010 (`[dev]` on a bag), BR-015 (Node not pinned), BR-029 (bounds) |
| Backup and recovery | Fail | BR-003, BR-004 (High); BR-017, BR-018, BR-019 |
| Test quality | Not yet built | No test file exists; see §7 for the tests that must exist before a pass |

---

## 4. Findings

Type legend: **defect** (implementation defect, confirmed), **deviation** (differs from the approved documents), **risk** (possible problem, not confirmed as a failure), **improvement** (optional).

### HIGH

#### BR-001 — The client address comes from a header the proxy does not set
- **Severity:** HIGH · **Category:** Authentication and security · **Type:** defect (security vulnerability; integration between backend and nginx)
- **Where:** `backend/src/core/http.ts` lines 45–53 (`clientIp`), used at line 59; `app/deploy/nginx.conf` lines 95–96; consumers: `backend/src/identity/sessions.ts` line 129 (IP binding), `backend/src/identity/override.ts` lines 191 and 221 (per-IP limits), every `clientIp` written to `audit_event`.
- **Problem:** when the connection comes from loopback and `server.trust_proxy` is true (the default), the backend uses the `X-Real-IP` request header as the client address. The current nginx configuration sends `Host` and `X-Forwarded-For` only. nginx passes client headers through unless told otherwise, so (a) a normal phone has no `X-Real-IP` and is seen as `127.0.0.1`, the same as every other phone, and (b) any client can send its own `X-Real-IP` and be seen as any address. The header value is not checked to be an IP address (only its length).
- **Evidence (probe `p3.ts`, real middleware and router):**
  - request with `X-Real-IP: 203.0.113.99` → stored `override_request.client_ip = 203.0.113.99`;
  - four override requests from four different usernames with no `X-Real-IP` → `201, 201, 201, 429` (all share `127.0.0.1`);
  - six more with a different spoofed `X-Real-IP` each → six times `201`.
- **Root cause:** the header contract between nginx and the backend is not written down anywhere (`X-Real-IP` and `X-Forwarded-For` do not appear in `docs/system/`), and the two sides chose different headers.
- **Impact on the bag:** session IP binding (`session.bind_ip`, D-5.1) does nothing: a stolen cookie works from any phone. The backend limits "3 override requests per hour per IP" and "3 presence tokens per hour per IP" (§9.9) become 3 per hour **for the whole bag**, so one phone can block the offline recovery path, including the USB-presence path that was designed so that it cannot be blocked; or an attacker who spoofs the header has no per-IP limit at all. Audit rows carry a useless or forged address.
- **Recommended correction:** decide one header and write it into SYSTEM-ARCHITECTURE §8.2. In nginx: `proxy_set_header X-Real-IP $remote_addr;` (this overwrites anything the client sent). In the backend: accept the header only from loopback (already done), require `net.isIP(value) !== 0`, and at API start refuse to trust it unless a start-up self-test or a health probe through nginx shows the header is being set (or simply fail closed: with `trust_proxy = true`, a request from loopback without the header gets `400`).
- **Verify:** test through the real nginx configuration: two clients on different addresses are stored with their own addresses; a client-sent `X-Real-IP` is ignored; a cookie replayed from a second address gets `401`.

#### BR-002 — Parallel wrong passwords are counted as one failure
- **Severity:** HIGH · **Category:** Authentication and security · **Type:** defect (race condition, security vulnerability)
- **Where:** `backend/src/identity/routes.ts` lines 76–81 (`recordFailure`), 88–98 (`checkOwnPassword`), 112–123 (sign-in).
- **Problem:** the account row is read (line 112), then the handler awaits the password hash (line 118, hundreds of milliseconds on the Pi), then `recordFailure` writes `row.failed_count + 1` from the **old** row. Requests that overlap all write the same number. The lock check (lines 113–116) is also done before the hash, so every request that entered before the lock was written is still verified.
- **Evidence (probe `p3.ts`):** 20 parallel wrong sign-ins → 20 × `401`, `failed_count = 1`, `locked_until = null`. A second wave of 20 → `failed_count = 2`. Seven sequential wrong sign-ins behave correctly (`401` × 5, then `429`).
- **Root cause:** read–await–write on state without re-reading inside the write transaction.
- **Impact on the bag:** the lockout (5 failures → 1 minute, doubling to 15 minutes; D-5.2, test SEC-1) can be bypassed by sending guesses in parallel. The in-flight cap allows 64 at once and the hash limiter runs 2 at a time, so the guess rate is bounded by the KDF speed (a few per second) instead of by the lockout (about a hundred per day). nginx's 5 per minute per IP does not close this on a Wi-Fi where an attacker can change address, and BR-001 weakens per-IP limits further. Admin passwords are chosen by people.
- **Recommended correction:** make the failure atomic and decide inside the transaction: `UPDATE admin_account SET failed_count = failed_count + 1 … WHERE id = ? RETURNING failed_count`, compute the lock from the returned value, and re-check `locked_until` inside the same transaction that would create the session (refuse with `429` if a lock appeared meanwhile). Optionally allow only one password verification per account at a time.
- **Verify:** a test that fires 20 parallel wrong sign-ins must end with `failed_count = 20` (or at least ≥ 5 and a lock), and a correct password sent in the same burst after the fifth failure must get `429`.

#### BR-003 — Boot recovery treats every open failure as corruption and rolls the bag back
- **Severity:** HIGH · **Category:** Backup and recovery / database · **Type:** defect (data loss on a wrong diagnosis)
- **Where:** `backend/src/system/bootstrap.ts` lines 185–199 (`openChecked`), 234–256 (main file), 257–281 (counts file).
- **Problem:** `openChecked` returns `null` for a missing file, for a failed `quick_check` or `foreign_key_check`, and — through a bare `catch` — for **any** exception: permission denied, `SQLITE_CANTOPEN`, `SQLITE_FULL` or `SQLITE_IOERR` while the WAL is recovered on a full card, `SQLITE_BUSY`, "not in WAL mode". Every one of these makes boot recovery move the live database aside and install the newest snapshot (up to 2 hours of use lost) with a new epoch. For the counts file the same catch resets the Child protection counts to a snapshot or to empty.
- **Evidence (probe `p5.ts`):** a healthy database with 3 learners, snapshot taken when it had 1; the file mode was set to `000` (a permission problem, for example after a technician ran a tool as root); `bootRecover` answered "The bag went back to its saved copy… Changes after that were lost."; the live database then had 1 learner and epoch 2.
- **Root cause:** a broad catch that hides the reason of the failure; R-2 requires BUSY, FULL and CORRUPT to be distinguishable, and `db.ts` already provides the classes.
- **Impact on the bag:** learner progress and admin work are thrown away although the database was intact. On a full card it is worse: the open fails, the file is moved aside, the snapshot copy then fails for lack of space (see BR-004), and the bag has no database at all.
- **Recommended correction:** replace the database only when the evidence is corruption: `SqliteCorruptError` (`SQLITE_CORRUPT`, `SQLITE_NOTADB`) or `quick_check` not `ok`. For every other error (permission, full, I/O, busy, not WAL) do **not** touch the file: write the maintenance flag, log the error class, record a plain note and exit non-zero so a technician looks. Treat a `foreign_key_check` failure as "needs a technician", not as corruption to roll back (the snapshot may hold the same rows, and then the bag would lose data and still not start). Do the same for the counts file.
- **Verify:** tests with (a) an unreadable file, (b) a full file system (small loop device or tmpfs), (c) a file not in WAL mode, (d) a truly corrupted file. Only (d) may trigger a replacement.

#### BR-004 — `replaceLiveDatabase` is neither failure-safe nor atomic with the epoch lift
- **Severity:** HIGH · **Category:** Database and transactions / synchronisation · **Type:** defect (data loss on a failure path; breaks SYNC §3.2 after a power cut)
- **Where:** `backend/src/core/replace.ts` lines 95–107 (`replaceLiveDatabase`), 36–46 (`removeDatabaseFiles`), 49–56 (`installDatabaseFile`), 62–79 (`liftEpoch`).
- **Problem, part 1 (order):** the old database, `-wal` and `-shm` are moved away or **deleted** (when `asideDir` is `null`) first; only then is the new file copied. If the copy fails (source unreadable on a failing card, no space, I/O error) there is no live database, and with `asideDir: null` the old one is gone for good.
- **Problem, part 2 (atomicity):** the new file is renamed into place with its **old** epoch; then the code sets WAL mode, runs migrations and only then commits the epoch lift. A power cut between the rename and that commit leaves a live database that passes every check at the next boot (it is in WAL mode once line 101 has run) but still carries the old epoch and the old `change_seq`. DATABASE §4 rule 6 and §9.3 step 3 require the epoch increment "in the same step… before the API starts". Recovery runs exactly when power is unstable, so a second cut in this window is plausible.
- **Evidence (probe `p2.ts`):** `replaceLiveDatabase({ source: <missing file>, asideDir: null, … })` threw `ENOENT`; afterwards `db/` held only `counts.sqlite3`: the live database had been deleted. Part 2 is established by reading the order of lines 96–103.
- **Root cause:** destroy-then-create order, and bookkeeping done after the point of no return.
- **Impact on the bag:** a bag without a database (maintenance mode, technician visit), or a replaced database whose new changes reuse sequence numbers of the lost lineage, which the office import can no longer order correctly (the case V-008 was written to prevent).
- **Recommended correction:** (1) copy the source to `<db>.incoming` and `fsync` it **before** touching the live files; (2) open `.incoming` itself (rollback-journal mode, `synchronous=FULL`), run the migrations and `liftEpoch` there, close it, `fsync`; (3) only then move the old files aside and rename `.incoming` into place, `fsync` the directory; (4) set `journal_mode=WAL` on the live file afterwards (if a cut happens before that, the next boot's WAL check must repair the mode rather than call it corruption — see BR-003). Never delete the old file before the new one is in place. Refuse to run when a lock file shows the API or worker is running.
- **Verify:** fault-injection tests: copy failure (old database still live and unchanged); kill at each step followed by a boot (either the old database is live, or the new one is live **with** the new epoch).

### MEDIUM

#### BR-005 — Two recoveries without a snapshot in between reuse the same epoch
- **Severity:** MEDIUM · **Category:** Synchronisation · **Type:** defect (deviation from SYNC §3.2, DATABASE §4 rule 6)
- **Where:** `backend/src/system/bootstrap.ts` line 249 (`minEpoch` from snapshot names only); `backend/src/core/replace.ts` line 68.
- **Problem:** the new epoch is `max(epoch in the installed snapshot, highest epoch among snapshot names) + 1`. The epoch of the database that is being replaced is not used (it may be unreadable) and is not kept anywhere else. After a first recovery the live database has epoch 2 while every snapshot still says 1; a second recovery before a new snapshot gives epoch 2 again.
- **Evidence (probe `p5.ts`):** after the first recovery: epoch 2, nonce `30b0a7aa`, `change_seq` 2199023255552. After a second recovery: epoch 2, nonce `32d8315b`, `change_seq` 2199023255552.
- **Impact:** two different lineages share one epoch number and one sequence range. The nonce lets the office detect the clash, but the import then stops (`epoch_clash`) instead of ordering the data.
- **Recommended correction:** keep the highest epoch ever used outside the database, written durably by `liftEpoch` (for example `keys/epoch` or `run/epoch.json` with `writeFileDurable`), and use it as a minimum; also try `epochOf()` on the file being replaced (the function exists in `replace.ts` lines 110–121 and is unused).
- **Verify:** test: recover twice in a row with no snapshot between; epochs must be 2 then 3.

#### BR-006 — The migration runner cannot do a table rebuild without deleting child rows
- **Severity:** MEDIUM (latent; becomes data loss with the first rebuild migration) · **Category:** Database and transactions · **Type:** defect in the runner's design
- **Where:** `backend/src/core/migrate.ts` lines 70–75; `backend/src/core/db.ts` line 65.
- **Problem:** every migration runs inside `db.tx()` on a connection with `foreign_keys=ON`, and the pragma cannot be changed inside a transaction. With foreign keys on, `DROP TABLE` first deletes the table's rows, and that delete fires `ON DELETE CASCADE` / `SET NULL` in child tables. DATABASE §10 expects the "12-step rebuild" inside the migration transaction; SQLite's procedure requires `foreign_keys=OFF` before `BEGIN`.
- **Evidence (probe `p2.ts`):** one learner with one `lesson_progress` row; a rebuild of `learner` (create new, copy, drop, rename) run exactly as `migrate()` runs a file: `foreign_key_check` returned 0 rows, the transaction committed, and `lesson_progress` had **0** rows.
- **Impact:** the first release that rebuilds `learner`, `lesson`, `admin_account`, `picture` or `job` would silently delete progress, lesson files, sessions or picture links on every bag, and the runner's own check would report success.
- **Recommended correction:** in `migrate()`, set `PRAGMA foreign_keys=OFF` on the connection before `BEGIN IMMEDIATE`, keep `foreign_key_check` inside the transaction as now, and set it back to `ON` after commit (in `finally`). Add a row-count guard for rebuild migrations.
- **Verify:** a runner test with a rebuild migration on a database that has child rows; child rows must survive.

#### BR-007 — The 5 s bound is not counted from arrival for requests with a body
- **Severity:** MEDIUM · **Category:** Architecture compliance (R-3L) · **Type:** defect (confirmed)
- **Where:** `backend/src/core/http.ts` line 74 (`requestStore.run`), lines 185–215 (`jsonBody` calls `next()` from stream events); `backend/src/core/context.ts` lines 165 and 175.
- **Problem:** the arrival time reaches the write gate through `AsyncLocalStorage`. `jsonBody` continues the chain from the request stream's `data`/`end` events, which run outside the store's context. After the body reader, `requestStore.getStore()` is `undefined`, and the gate silently falls back to "now".
- **Evidence (probes `p3.ts`, `p4.ts`):** a handler behind `requestState` + `jsonBody` returned `{"store":null}` for a POST (body in the same packet, and body sent 150 ms later). For a DELETE (no body) it returned the store.
- **Impact:** for every POST, PUT and PATCH (nearly all writes), the wait is bounded at 5 s from the moment `ctx.write` is called, not from arrival: body reading and password hashing (up to about 1 s on the Pi) are not counted. Fire-and-forget writes started in those requests are affected the same way. Small in effect, but it is the binding rule and the fallback hides the failure.
- **Recommended correction:** do not use ambient context for this. Pass `req.sb.arrivedAt` explicitly (`ctx.write(fn, { arrivedAt })`), or re-enter the store in `jsonBody` (`requestStore.run(store, next)` / `AsyncResource.bind`). Remove the silent fallback in the API role, or log when it is used.
- **Verify:** a test that the gate receives the request's `arrivedAt` for a POST with a delayed body; DB-6 with requests that carry bodies.

#### BR-008 — The override request cookie is a session cookie
- **Severity:** MEDIUM · **Category:** Authentication / mandatory offline function · **Type:** defect (reliability of the offline recovery path)
- **Where:** `backend/src/identity/override.ts` line 248.
- **Problem:** `sb_ovr` is set without `Max-Age`, so the browser may drop it when it is closed. The request it binds lives for 72 h of uptime (up to 18 calendar days per §9.9), and the code EasySTEM returns only works together with this cookie.
- **Evidence (probe `p3.ts`):** `Set-Cookie: sb_ovr=…; Path=/api/v1/admin/override; HttpOnly; SameSite=Strict` (no `Max-Age`).
- **Impact:** old Android phones close the browser often. An admin who asked for a code, waited a day for EasySTEM and comes back finds "This code request was made on another phone" and must call EasySTEM again. This is the only recovery path offline.
- **Recommended correction:** set `Max-Age` to at least the longest life of a request (for example 30 days). The server still decides expiry.
- **Verify:** the `Set-Cookie` header carries `Max-Age`; manual test on a kit phone: close the browser, reopen, redeem.

#### BR-009 — A password change does not re-check the session inside its transaction
- **Severity:** MEDIUM · **Category:** Authentication and security · **Type:** defect (time-of-check to time-of-use; established by reading, not probed)
- **Where:** `backend/src/identity/routes.ts` lines 157–188.
- **Problem:** the guard resolves the session, then the handler awaits `checkOwnPassword` and `hashPassword`, then the transaction updates the password with `WHERE id = ? AND is_active = 1`. It never checks that the session still exists. If the session was ended in between (a second override for the same account was redeemed, the role was changed, sign-out from that phone), the change still goes through; `endSessionsOf(tx, admin.id, admin.sessionKey)` then ends the **newer, legitimate** session and the update of the caller's own session row changes nothing.
- **Impact:** a revoked session can still set the account's password inside the hash window, and it signs the rightful holder out. The window is short, but this is the credential-setting step of the override flow.
- **Recommended correction:** inside the transaction, first `SELECT 1 FROM admin_session WHERE token_sha256 = ? AND admin_id = ?`; if missing, throw `401`. For the override case also check that `password_hash` still equals the marker of the same request.
- **Verify:** test: start a password change, delete the session row before the transaction, expect `401` and an unchanged hash.

#### BR-010 — Laptop-only `[dev]` switches are accepted from a bag's configuration file
- **Severity:** MEDIUM · **Category:** Deployment readiness / security · **Type:** risk
- **Where:** `backend/src/config.ts` lines 108–114 and 205–210; `backend/src/core/context.ts` line 202; `backend/src/system/bootstrap.ts` line 155.
- **Problem:** the comment says "A bag's file has no `[dev]` table", but nothing enforces it. `/etc/sensebod/sensebod.toml` with `[dev] assume_clock = "synced"` makes the clock trusted everywhere (retention, override expiry by wall clock, audit `clock_trust`); `fake_privileged`, `serve_files` and `self_recover` are accepted the same way.
- **Evidence (probe `p4.ts`):** `buildConfig({ dev: { fake_privileged: true, assume_clock: 'synced' } })` is accepted.
- **Impact:** a development file copied to a bag, or one stray line, silently turns off the clock-trust protections that guard the removal of learner data, with no sign on any screen.
- **Recommended correction:** refuse any non-default `[dev]` value unless the process was started with an explicit development flag (`--dev` or `SENSEBOD_DEV=1`, never set in the systemd units), and log one loud line when development switches are active. Do the same for the `dev-…` boot id fallback in `context.ts` lines 52–59, which on Linux should be an error, not a fallback.
- **Verify:** DEP-1 test: the production start refuses a file with a `[dev]` table.

#### BR-011 — Corruption and "disk full" errors at run time leave no trace
- **Severity:** MEDIUM · **Category:** Error handling / reliability · **Type:** defect
- **Where:** `backend/src/core/http.ts` lines 261–276.
- **Problem:** only errors mapped to `500` are logged. `SqliteCorruptError` becomes `503 maintenance`, `SqliteFullError` and `ENOSPC` become `507`, and none of them is written to the log. `storageFull(0, 0)` also reports "0 bytes needed, 0 available", which is not true. Fire-and-forget writes in `sessions.ts` lines 124 and 134–136 swallow the same errors.
- **Impact:** a database that starts returning `SQLITE_CORRUPT` on a failing card answers "The bag is being looked after" forever without a log line, a maintenance flag or anything `/admin/status` or a technician could see.
- **Recommended correction:** log the error class for corrupt, full and I/O errors (one line, rate-limited); on `SqliteCorruptError` set a flag that `/health` and `/admin/status` report; fill `availableBytes` from `diskSpace()`.
- **Verify:** unit test of `toApiError` + handler: a `SqliteCorruptError` produces a log event and the health flag.

#### BR-012 — Durable-write helpers hide failures
- **Severity:** MEDIUM · **Category:** Code quality (broad catch, unsafe filesystem operation) · **Type:** defect
- **Where:** `backend/src/core/fsx.ts` lines 6–16 (`fsyncDir`), 19–30 (`writeFileDurable`).
- **Problem:** `fsyncDir` swallows every error, including `EIO` from a failing card, so "fsync(directory)" can fail silently everywhere it is used (snapshots, database replacement, boot files, keys). `writeFileDurable` calls `writeSync` once and ignores its return value; a short write would be made durable and renamed over the good file. A failed write leaves `<path>.tmp-<pid>` behind, and an existing temp file keeps its old mode.
- **Impact:** the bag believes a file is durable when it is not, exactly on the hardware fault the design tries to survive.
- **Recommended correction:** in `fsyncDir`, ignore only the "not supported here" codes (`EINVAL`, `ENOTSUP`, `EPERM`/`EISDIR` on non-Linux) and rethrow the rest. In `writeFileDurable`, use `writeFileSync(fd, data)` (it loops), open with `wx` after removing a stale temp file, and remove the temp file on failure.
- **Verify:** unit tests with a mocked `fsyncSync` raising `EIO`; a test that a failure leaves the old file and no temp file.

#### BR-013 — The content ETag ignores the release and the database lineage
- **Severity:** MEDIUM · **Category:** API contract (D-1.7) · **Type:** risk (design-level; raise with the architect)
- **Where:** `backend/src/core/http.ts` lines 245–258.
- **Problem:** the tag is `content_rev` + a hash of the URL. After an automatic recovery or a restore, `content_rev` goes back to the snapshot's value and then counts up again, so a phone can hold a cached answer under a tag that the new lineage reuses for different content, and gets `304`. The same happens when a software update changes the shape of an answer without a content change.
- **Impact:** learners see old lists or lessons after a recovery or an update, with no way to refresh short of clearing the browser. Both events are rare, but they are the moments when content state is least certain.
- **Recommended correction:** include `ctx.version` and the `epoch_nonce` (or epoch) in the tag: `W/"c<rev>.<epoch nonce prefix>.<version>.<url hash>"`. Update API-DECISIONS D-1.7 with one line.
- **Verify:** test: same `content_rev`, different epoch nonce → `200`, not `304`.

#### BR-015 — The Node.js runtime is not pinned, and the scripts do not run on the declared minimum
- **Severity:** MEDIUM · **Category:** Deployment readiness (R-11) · **Type:** deviation / risk
- **Where:** `backend/package.json` lines 6–15.
- **Problem:** `engines.node` is `>=22.13.0`, a range, while R-11 and §4 require a pinned LTS build shipped inside the release. Development runs on v23.10.0, which is not an LTS line. The scripts run `.ts` files directly (`node bin/sensebod-api.ts`, `node --test "test/**/*.test.ts"`), which works without a flag only from Node 22.18 / 23.6. `node:sqlite` is still marked experimental in these lines and its API and bundled SQLite version change between releases; the whole database layer depends on it (`errcode`, `StatementSync` behaviour). `@types/node` is for 22 while the runtime is 23.
- **Impact:** "works on the laptop, differs on the Pi": a different bundled SQLite, a changed driver detail or a missing type-stripping default would only show at install time on a bag.
- **Recommended correction:** choose one LTS version now (the one that will be in `runtime/`), set `engines` to that exact version, add `.nvmrc`/`.node-version`, develop and test on it, and record `process.version` and `sqlite_version()` in the self-check (R-11). Keep all `node:sqlite` use inside `db.ts` (it already is) and add a small driver-contract test (BUSY/FULL/CORRUPT codes, `RETURNING`, `VACUUM INTO`) that runs on the Pi in P-1.
- **Verify:** CI and the Pi run the same Node build; the driver-contract test passes on the Pi.

#### BR-017 — Snapshot rotation trusts file dates, and "remove all automatic snapshots" leaves no recovery point
- **Severity:** MEDIUM · **Category:** Backup and recovery · **Type:** risk (the callers are not built yet)
- **Where:** `backend/src/exports/snapshots.ts` lines 132–170 (`rotateSnapshots`), 173–178 (`removeAutoSnapshots`).
- **Problem:** rotation compares file modification times with "now". Nothing in the function looks at clock trust. If the date is wrong by more than 7 days forward (a mistyped hand-set date), every automatic snapshot except the newest is deleted, and every `pre-update-*` and `pre-restore-*` snapshot older than "30 days" is deleted too — these are the rollback copies. `removeAutoSnapshots` deletes every automatic snapshot at once; until the next one is taken, boot recovery has nothing to fall back on.
- **Impact:** loss of recovery points caused by a wrong clock, on a device whose clock is known to be unreliable (ADR-014).
- **Recommended correction:** let the caller pass the clock trust and skip the time-based removals unless the clock is trusted (count-based rules can still run); never remove `pre-update-*`/`pre-restore-*` on an untrusted clock. In the "clean learner data" flow, take a fresh snapshot first and remove the older ones only after it is complete.
- **Verify:** unit tests of rotation with a clock 1 year ahead and trust `manual`/`unsure`; a test that after "clean" at least one sound snapshot exists.

### LOW

#### BR-014 — API reads are not retried on `SQLITE_BUSY`
- **Category:** Architecture compliance (R-3a) · **Type:** deviation
- **Where:** `backend/src/core/writeGate.ts` lines 86–98 (`readWithRetry`, never used); reads at `backend/src/identity/sessions.ts` line 114, `backend/src/core/http.ts` line 247, `backend/src/identity/routes.ts` lines 84, 89, 193, all of `backend/src/catalog/model.ts`.
- **Problem:** R-3a says reads retry asynchronously on the rare `SQLITE_BUSY`. Today a busy read becomes `503 busy` at once. In WAL mode this is rare (WAL reset, recovery), so the effect is an occasional needless "busy".
- **Correction:** wrap the read part of GET handlers (in `contentRoute` and in the session guard) with `readWithRetry`, or delete the helper and record the deviation. **Verify:** a test that injects one `SqliteBusyError` into a read and still gets `200`.

#### BR-016 — An idempotency slot that is neither completed nor aborted blocks its key
- **Category:** Maintainability / reliability · **Type:** risk
- **Where:** `backend/src/core/idempotency.ts` lines 36, 130–153.
- **Problem:** `beginIdempotent` relies on every caller to call `abort()` on every failure path. A caller that forgets leaves the key in the in-memory `running` set until the process restarts: retries get `409 in_progress` for good. The one current caller (`routes.ts` lines 211–244) does it correctly. The correctness of `running.add(mark)` after the `await` also depends on microtask order (it held in the probe).
- **Correction:** offer a wrapper `withIdempotency(ctx, req, options, async (slot) => …)` that aborts in `finally` unless completed, and add the mark inside the first transaction callback. Note R-12: this state must move to SQLite if a second API process is ever added. **Verify:** test: handler throws without calling `abort`; the retry runs again.

#### BR-018 — The counts snapshot is not checked, and the counts restore skips an `fsync`
- **Category:** Backup and recovery · **Type:** deviation (DATA-EXPORT §9, DATABASE §9.2)
- **Where:** `backend/src/exports/snapshots.ts` lines 110–114; `backend/src/system/bootstrap.ts` lines 262–271 and 276–279.
- **Problem:** the main snapshot gets `integrity_check` before its final name, the counts snapshot does not. The counts file is renamed before the main one, so a crash in between leaves a counts file that no listing or rotation ever removes. In boot recovery the counts file is rebuilt with `VACUUM INTO` and renamed without `fsync` of the file. A counts database recreated empty has no `counts_meta` rows (`bag_id`, `schema_version`), unlike one made by `initBag`. The snapshot `label` is not validated and may contain `/` or `..`.
- **Correction:** check both, rename main first (or clean orphans at boot), `fsync` before rename, write `counts_meta` when recreating, restrict `label` to `[0-9A-Za-z._-]+`. **Verify:** unit tests for each.

#### BR-019 — An export left in `checking` becomes `ready` after a clean boot without the re-hash
- **Category:** Backup and recovery (V-017) · **Type:** defect (confirmed)
- **Where:** `backend/src/system/bootstrap.ts` lines 397–401.
- **Evidence (probe `p5.ts`):** an export in state `checking`, a clean-shutdown marker, `bootRecover` → state `ready`.
- **Impact:** after a power cut, if the bag is switched off cleanly before `sensebod-maint` re-hashes the file, the next boot offers the file for download unchecked. The in-page SHA-256 check would still catch a damaged file.
- **Correction:** the clean-boot branch must set `ready` only for rows that are `ready`; `checking` stays until the re-hash. **Verify:** the probe as a test.

#### BR-020 — `dirBytes` follows symbolic links although its comment says it does not
- **Category:** Code quality (unsafe filesystem operation) · **Type:** defect (confirmed)
- **Where:** `backend/src/core/fsx.ts` lines 74–95 (line 86 uses `statSync`).
- **Evidence (probe `p2.ts`):** a folder with 10 bytes of files and a link to a folder with 100,000 bytes → `dirBytes` = 100,010.
- **Correction:** use `lstatSync` (or `readdirSync(dir, { withFileTypes: true })`). It is also synchronous and recursive; keep it out of the API process for large trees. **Verify:** unit test with a link.

#### BR-021 — A malformed URL becomes `500` and its text is written to the log
- **Category:** Error handling / logging (R-9) · **Type:** defect (confirmed)
- **Where:** `backend/src/core/http.ts` lines 261–276.
- **Evidence (probe `p3.ts`):** `GET /api/v1/item/%E0%A4%A` → `500 internal`, and the log holds `"message":"Failed to decode param '%E0%A4%A'"`.
- **Impact:** a client mistake is reported as a server fault, anyone can fill the journal with `error` events, and a piece of the request path reaches the log, which §12.3 forbids (the learner-id filter still applies).
- **Correction:** in `toApiError`, map errors that carry a numeric `status`/`statusCode` from 400 to 499 to the matching `ApiError` (`404 not_found` or `422 validation`) without logging the message. **Verify:** the probe as a test: `4xx`, no `error` event.

#### BR-022 — `Origin: null` is let through
- **Category:** API contract (R-10) · **Type:** deviation
- **Where:** `backend/src/core/http.ts` line 152.
- **Evidence:** POST with `Origin: null` → `200`; with `Origin: http://evil.example` → `403 csrf`.
- **Note:** R-10 says "when `Origin` is present it must match the Host". The custom header still blocks cross-origin forms, and some browsers send `null` for same-origin requests under a strict referrer policy, so the exemption may be deliberate. **Correction:** either remove it or record the reason in §9.5 and in a comment. **Verify:** SEC-2 covers the chosen rule.

#### BR-023 — Small file reads happen inside write transactions
- **Category:** Architecture compliance (R-3) · **Type:** deviation
- **Where:** `backend/src/core/context.ts` lines 101 and 201–207 (`Tx.audit` → `clockTrust()` → `readFileSync` of `clock.json` when the 5 s cache is stale); `backend/src/identity/override.ts` lines 151–158 and 174 (`usb.json`), 241; `backend/src/system/bootstrap.ts` lines 377–395 (`statSync`/`rmSync` of export files inside the boot transaction; a rollback would not bring the files back).
- **Impact:** tiny today (small files, page cache), but it breaks a binding rule that is checked by code review, and `clock.json` is on the SD card.
- **Correction:** read these values before entering the transaction (`Ctx.write` can resolve the clock trust first; the override routes can read `usb.json` first; boot recovery can collect file facts first and delete files after commit). **Verify:** code-review checklist; a lint rule that forbids `node:fs` calls in transaction callbacks.

#### BR-024 — The gate re-runs the callback when a busy error comes from inside it
- **Category:** Database and transactions · **Type:** defect (confirmed, low reach)
- **Where:** `backend/src/core/writeGate.ts` lines 63–71; `backend/src/core/db.ts` line 39.
- **Evidence (probe `p2.ts`):** a callback that throws `SqliteBusyError` ran 30 times in 5 s before `BusyError`.
- **Problem:** the comment says BUSY can only come from `BEGIN IMMEDIATE`. `classify` also maps `SQLITE_LOCKED` (6) to the same class, and a callback may touch the second database. Side effects outside SQLite inside the callback (the rate-limit counters in `override.ts` lines 179–183 and 221, `running.delete` in `idempotency.ts` line 146) are then repeated.
- **Correction:** let `Db.tx` mark a failure of `BEGIN` distinctly (for example a `BeginBusyError` subclass) and retry only that; keep `SQLITE_LOCKED` separate. **Verify:** the probe as a test: one run, error passed through.

#### BR-025 — Session bookkeeping: duplicate writes and a map that only grows
- **Category:** Resource efficiency · **Type:** risk
- **Where:** `backend/src/identity/sessions.ts` lines 92, 124, 132–137.
- **Problem:** the `last_seen` update is fire-and-forget; until it commits, every further request of that session queues another identical update (each a card flush), and failures are swallowed. `confirmedUntil` entries are removed only on sign-out or when an expired cookie is presented again, so entries of sessions removed by `sensebod-maint` stay until the process restarts (small, but unbounded).
- **Correction:** remember in memory when an update was queued per session key and skip repeats; sweep `confirmedUntil` for passed deadlines when inserting. **Verify:** test: 50 requests after the 5-minute mark produce one update.

#### BR-026 — The statement cache has no limit
- **Category:** Resource efficiency · **Type:** risk
- **Where:** `backend/src/core/db.ts` lines 56 and 82–89; dynamic SQL at `backend/src/media/attach.ts` lines 89, 188, 192 and `backend/src/catalog/model.ts` lines 270, 466–468.
- **Problem:** every distinct SQL text is prepared and kept for the life of the process. SQL built with a variable number of placeholders or caller-supplied `WHERE`/`ORDER` fragments creates a new entry per shape. Bounded today, easy to grow by accident.
- **Correction:** cap the map (a few hundred entries, drop the oldest) or add an uncached path for built SQL. **Verify:** unit test of the cap.

#### BR-027 — Nothing stops API code from writing outside the gate
- **Category:** Maintainability / architecture guard · **Type:** improvement
- **Where:** `backend/src/core/context.ts` lines 141, 170–172.
- **Problem:** `ctx.db.run(...)`, `ctx.db.tx(...)` and `ctx.writeSync(...)` are all reachable from a request handler. A write through them skips the gate and, with `busy_timeout=0`, fails at once when another process holds the lock. Only convention prevents it.
- **Correction:** keep the role in `Ctx` and make `writeSync` throw in the `api` role; expose a read-only view of the database to handlers; add a test that greps route files for `ctx.db.run`/`writeSync`. **Verify:** the guard test.

#### BR-028 — Password hashing: stored parameters are not capped by memory, and the limiter can exceed two
- **Category:** Authentication / resource efficiency · **Type:** risk
- **Where:** `backend/src/identity/passwords.ts` lines 28–37 and 61.
- **Problem:** `parse` accepts stored hashes up to `ln=20, r=32`, which is about 4 GiB for one verification (the documents say ≤ 64 MiB). Hashes come from the database, a provisioning bundle or a restored backup, so this needs a bad file, not a network attacker. In `slot`, a release decrements `active` and wakes one waiter; a new caller that arrives before the waiter resumes also enters, so three hashes can run briefly.
- **Correction:** reject parameters whose memory `128 · N · r` exceeds a fixed cap (for example 64 MiB); hand the slot to the waiter without decrementing. Set `UV_THREADPOOL_SIZE` in the unit as R-4 says (not yet built). **Verify:** unit tests for both.

#### BR-029 — Configuration values have no upper bounds or cross-checks
- **Category:** Deployment readiness (R-7) · **Type:** defect (confirmed, low)
- **Where:** `backend/src/config.ts` lines 119–134, 233–237.
- **Evidence (probe `p4.ts`):** accepted: `port = 70000`; `idle_minutes = 900` with `absolute_minutes = 5`; `chunk_bytes = 8 MiB` with `chunk_max_bytes = 4 MiB`. `--config` as the last argument silently falls back to the default path.
- **Correction:** add `max` to the schema (port ≤ 65535, percent ≤ 100), check `chunk_bytes ≤ chunk_max_bytes`, `idle ≤ absolute`, `single_max_bytes ≤ upload_max_bytes`; fail when `--config` has no value. **Verify:** DEP-1 unit tests.

#### BR-030 — Migration bookkeeping gaps
- **Category:** Database and transactions (R-5) · **Type:** risk
- **Where:** `backend/src/core/migrate.ts` lines 42 and 91–96; `backend/src/system/bootstrap.ts` lines 57–63 and 79–83.
- **Problem:** a file in `migrations/` whose name does not match the pattern (for example `0002-add.sql`) is ignored without a word; two files with the same number are both applied; `headState` compares ids only, so an applied migration whose file later changed still reads `equal` to the API; `initBag` on an existing database applies pending migrations without the pre-update snapshot that DATABASE §10 requires.
- **Correction:** fail on unexpected names and duplicate numbers; compare checksums in `headState`; let `initBag` migrate only a database it has just created. **Verify:** runner unit tests.

#### BR-031 — List queries read every lesson body; job results are found by scanning inside a write transaction
- **Category:** Resource efficiency · **Type:** improvement
- **Where:** `backend/src/catalog/model.ts` lines 101, 222–226, 245–247, 388; `backend/src/media/attach.ts` line 43.
- **Problem:** `LESSON_SELECT` is `l.*`, so portal, group and series answers load `body_json` (kilobytes each) for every published lesson only to build summaries. `uploadResults` scans the `job` table with `json_extract` for each upload, inside the caller's write transaction. Fine at today's sizes on a Pi 5; the ETag short-cut avoids most rebuilds.
- **Correction:** a summary select without `body_json` for list answers; store the upload id of a media job in a column or look jobs up by id. **Verify:** measure on the Pi (PERF tests) before changing.

#### BR-032 — Small defects in the override routes
- **Category:** Code quality · **Type:** defect / improvement
- **Where:** `backend/src/identity/override.ts`.
- Lines 184–185: an `UPDATE` of a row that the next statement deletes (dead write).
- Line 234: on a bag without `override.key`, requests are created with key version 0 and can never be redeemed; answer plainly that override codes are not set up on this bag.
- Line 102 with `ids.ts` line 45: a key version above 31 is shown as `0` in the request code.
- Lines 179–183 and 221: the in-memory limit counters are changed inside the transaction callback, so they count even when the transaction rolls back (see BR-024).
- Line 217: the 24 h ceiling query cannot use the existing index (`state, created_uptime_s`); it scans the table inside a write transaction (≤ about 60,000 rows at the retention limit).
- Line 111: `as never` type cast hides the type of `created_clock_trust`.
- **Verify:** unit tests per item.

#### BR-033 — Maintainability notes
- **Category:** Maintainability · **Type:** improvement
- Three copies of "fsync a path": `backend/src/core/fsx.ts` line 38, `backend/src/core/replace.ts` line 26, `backend/src/exports/snapshots.ts` line 14.
- `bootRecover` is one function of about 280 lines (`backend/src/system/bootstrap.ts` lines 214–493); split it by step so each step can be tested alone.
- `RELEASE_FLOOR_MS` is a hard-coded date (`bootstrap.ts` line 128); take it from the release manifest.
- `backend/src/core/ids.ts` line 36: `bits = 0n` does nothing; line 25 exports a global (`/g`) regular expression, which is stateful with `.test()`.
- `backend/src/core/log.ts` lines 17–19: an empty string in the sensitive-id list would turn every log line into `[redacted]` between each character; filter empty ids.
- `backend/src/identity/sessions.ts` lines 26–36: build the cookie map with `Object.create(null)`.
- `backend/src/core/replace.ts` lines 17 and 21: two imports from `node:fs`.

#### BR-034 — Lockout tells a caller that a username exists and lets anyone lock an admin out (architecture level)
- **Category:** Authentication · **Type:** architecture-level observation (not an implementation defect)
- **Where:** `backend/src/identity/routes.ts` lines 113–116, as specified in D-5.2.
- **Note:** a locked account answers `429` while an unknown name answers `401`, and any phone on the Wi-Fi can keep an admin locked (15 minutes at a time) by sending wrong passwords. Both follow from the approved design. If the owner wants this closed: answer `401` for locked accounts too, or lock per (account, address) once BR-001 is fixed. No change is asked of the backend engineer without a decision.

#### BR-035 — A background rebuild of a lesson's files does not change its `version`
- **Category:** API contract (optimistic concurrency) · **Type:** risk (routes not reviewed yet)
- **Where:** `backend/src/media/attach.ts` lines 154–163.
- **Problem:** `rebuildLessonMedia` rewrites `body_json` (blocks from a `.docx`, package link, media note) and stamps `seq`, but leaves `version`. An admin who opened the lesson before the job finished can save with the old `If-Match` and overwrite what the job wrote.
- **Correction:** bump `version` when `body_json` changes here, or make the PATCH merge. Check in round 2 against `catalog/routes.ts`. **Verify:** test: job finishes between GET and PATCH → `412`.

---

## 5. Remediation plan (priority order)

1. **Security and data integrity**
   1. BR-001: agree the client-address header with DevOps, set it in nginx, validate it in the backend.
   2. BR-002: atomic failure counter and lock re-check inside the transaction.
   3. BR-003: replace the database only on proven corruption; everything else → maintenance and a technician.
   4. BR-004: copy and lift the epoch in the incoming file before the swap; never delete before the new file is in place.
   5. BR-009: re-check the session inside the password-change transaction.
   6. BR-010: refuse `[dev]` values without an explicit development flag.
2. **Mandatory offline functions**
   7. BR-008: give `sb_ovr` a `Max-Age`.
3. **Architecture deviations**
   8. BR-005: keep the highest epoch outside the database.
   9. BR-007: pass the arrival time explicitly to the gate.
   10. BR-013: add version and epoch nonce to the ETag (with the architect).
   11. BR-014, BR-022, BR-023: retry reads, settle the `Origin: null` rule, move file reads out of transactions.
4. **Concurrency and transactions**
   12. BR-006: migration runner with `foreign_keys=OFF` around the transaction.
   13. BR-024, BR-016: retry only a busy `BEGIN`; safe idempotency wrapper.
5. **Reliability**
   14. BR-011, BR-012: log corrupt/full errors; stop swallowing `fsync` errors; safe durable write.
   15. BR-017, BR-018, BR-019: rotation with clock trust, counts snapshot checks, `checking` stays `checking`.
   16. BR-015: pin the Node LTS version; driver-contract test.
   17. BR-021, BR-029, BR-030.
6. **Resource efficiency**
   18. BR-025, BR-026, BR-028, BR-031.
7. **Maintainability**
   19. BR-020, BR-027, BR-032, BR-033, BR-035. BR-034 waits for an owner decision.

---

## 6. Could not be assessed

| Item | Why |
|---|---|
| Behaviour on the Pi (commit rate, lock-hold times, DB-6, KDF time PERF-1, event-loop delay) | All probes ran on a Mac with Node 23.10.0; no Pi was available |
| R-1 (streamed uploads, `fsync` per chunk), R-6 (worker), R-8 (encrypted zip), R-11 (release, self-check) | Code not built |
| Start-up assertions of the API, graceful stop, clean-shutdown marker, `uptime_total_s` every 5 minutes | No entry point exists |
| Whether `jsonBody` is kept off upload routes, Express settings (`x-powered-by`, `etag`, query parser), middleware order | The application assembly does not exist |
| Role matrix against `x-auth` in `openapi.yaml`, response shapes against the schemas (FN-2) | No contract tests; only spot checks of the identity routes were made |
| Idempotency record expiry (24 h), session/lockout/override clean-up by `sensebod-maint` | Maint tasks not built |
| nginx rate limits, body limits and the maintenance answer | DevOps package; only the header mismatch (BR-001) was checked against the existing `app/deploy/nginx.conf` |
| `backend/src/catalog/routes.ts`, `backend/src/learners/routes.ts` | Appeared after the cut-off; round 2 |
| BR-004 part 2 and BR-009 | Established by reading the code order; no fault-injection probe was run |
| Redaction of sensitive lesson ids end to end (SEC-7) | `setSensitiveLessonIds` has no caller yet |

---

## 7. Tests that must exist before a pass

None exist today. At minimum, for the code reviewed:

- Write gate: the two lock-hold scenarios of §2 (also on the Pi as DB-6), with requests that carry bodies.
- `Db`: pragma values after open, BUSY/FULL/CORRUPT classification, nested and asynchronous transaction refusal.
- Schema conformance (BE-2) and migration runner (re-run safety, checksum change, a table rebuild with child rows).
- Idempotency: replay, mismatch, in-progress, crash take-over, one-time secret not stored.
- CSRF, Host allow-list, error shape, no stack trace or path in any answer or log line (SEC-2, SEC-7).
- Sign-in: sequential and **parallel** lockout, timing for unknown users, session expiry, boot binding, IP binding through nginx, role matrix.
- Override: every expiry rule, attempt limit, cookie binding, ceiling, presence path, restricted session, notice.
- `replaceLiveDatabase` and `bootRecover` with fault injection at every step (PL-3, DB-5).
- Snapshot pair, rotation with a wrong clock.
- Configuration: unknown keys, bounds, `[dev]` refused in production (DEP-1).

---

## 8. Final assessment

**FAIL — CORRECTIONS REQUIRED** (assessment of the part reviewed: `core`, `identity`, `system/bootstrap`, `exports/snapshots`, `catalog/model`, `catalog/validate`, `media/attach`, migrations and configuration).

The foundation is sound and close to the architecture: the write gate, the connection routine, the schema, the error model, idempotency and the identity flows work as designed. The fail is for four High findings (BR-001 to BR-004) in security and recovery, eleven Medium findings, and the absence of any test. No Critical finding was found. Mandatory requirements that depend on code not yet built remain unverified and are listed in §6.

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 11 |
| LOW | 20 |
| **Total** | **35** |
