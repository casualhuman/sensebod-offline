# Implementation handoff packages (deliverable I)

Version 0.6 · 13 Nov 2026 (revision 5: V-030…V-036; revision 4: OWNER-2…6; revision 3; incl. OWNER-1: backend runtime Node.js/Express, tooling-agnostic requirements) · System Architecture Agent · status: **not to be started until the architecture passes independent verification (Stage 6)**, except the proofs of concept in §0, which exist to inform that verification.

Packages: **BE** backend engineer · **FE** frontend (streams 1 and 4) · **DEV** edge deployment/DevOps · **SYNC** office import tool (small; justified because restore and collection need a decrypting tool outside the bag) · **QA** testing. Each lists dependencies, tasks, acceptance criteria and the documents to read. Test ids refer to SYSTEM-ARCHITECTURE §14 and DATA-EXPORT-AND-BACKUP §18.

---

## 0. Proofs of concept to run on a real Pi first (owner of each in brackets)

**Status at revision 1: none of P-1…P-7 has been run** (no Pi, phone or stick was used). The verifier requires P-1, P-3, P-4 and P-6 before approval.

These retire the largest unverified assumptions. Results go into `docs/system/poc/pi-results.md` and may change the design.

| Id | What | Pass/fail | Owner |
|---|---|---|---|
| P-1 | `cat /etc/os-release`, `uname -m` (must be `aarch64`), `free -m` idle, `df -h` on the kit Pi; **run the release self-check** (`bin/sensebod-offline-selfcheck`, R-11): the pinned Node.js runtime starts, **every native module in the release loads** against the image's glibc and the runtime's ABI, both databases open through the chosen driver, one write and one `VACUUM INTO` succeed on the card; it records runtime, SQLite (as reported by the driver) and module versions, and the effective `UV_THREADPOOL_SIZE` (V-028) | Recorded; arm64; all modules load; SQLite ≥ 3.35 | DEV |
| P-2 | **Implementation spike (V-027)**: the chosen AE-1/AE-2 writer (R-8) produces a learner-data zip on the Pi (≥ 2 members, ≥ 5 MB); acceptance: it opens with the password in **7-Zip (Windows)**, **ZArchiver (Android)** and Keka (macOS) and fails without it; the writer's variant (AE-1 or AE-2) and how the password reached it are recorded; during the job, `/proc/<pid>/cmdline` and `/proc/<pid>/environ` of every process show no password; `.tmp/` is empty afterwards. Starting point: `poc/poc_ae2.mjs` (Mac: node:crypto-only writer interoperates with libarchive) | All acceptance points pass | BE |
| P-3 | `poc/poc_sqlite.py` on the Pi's microSD (DB-1 commit rate with `synchronous=FULL`; snapshot time for 10 MB and 100 MB) | ≥ 50 commits/s; snapshot of 100 MB < 30 s | BE |
| P-4 | Relay power-cut rig: 50 cuts during `poc_sqlite`-style acknowledged writes | 0 integrity failures; 0 acknowledged writes lost | QA + DEV |
| P-5 | `ffmpeg` smaller copy of a 10-min 720p video, 2 threads, nice 19, fan on | Time and peak temperature recorded | BE |
| P-6 | Oldest real phone: `<a download>` of a `Blob` built from XHR ranges; ticket URL download via the system download manager | Both work, or the fallback is chosen per phone | FE |
| P-7 | Oldest real phone: does `easystem.local` resolve? Does the phone stay on "Offline Library" with mobile data on? | Recorded | DEV |

## BE — Backend engineer

**Read:** SYSTEM-ARCHITECTURE §3–5, §9, §10.2; DATABASE (all); `openapi.yaml`; API-DECISIONS; DATA-EXPORT-AND-BACKUP (all); ADR-001…009, 012, 014, 016.

**Depends on:** P-1 (runtime and SQLite version on the Pi), P-2, P-3.

| # | Work | Acceptance criteria |
|---|---|---|
| BE-1 | Backend skeleton in the owner's runtime (**Node.js with Express**), modules per SYSTEM-ARCHITECTURE §5, meeting every requirement R-1…R-12 **incl. R-3L (lock waits never block the event loop: `busy_timeout=0` + single-flight write gate with async retry, or all DB access off the event loop) and R-3H (lock-hold budget)** of SYSTEM-ARCHITECTURE §4.1 (libraries named there are examples, not requirements); configuration from `/etc/sensebod-offline/sensebod-offline.toml`; connection-open routine applying DATABASE §3 in every process; all write transactions `BEGIN IMMEDIATE`; release build for `linux-arm64` with the pinned runtime in `runtime/` and dependencies (incl. native modules) built for it | Start-up asserts of DATABASE §3; **DB-6 on the Pi**; a checklist mapping each R-n to code and test, reviewed |
| BE-2 | Numbered transactional SQL migrations for `sensebod-offline.sqlite3` and `counts.sqlite3` with `schema_migrations` (DATABASE §10) producing exactly DATABASE §6; schema-conformance test comparing the migrated DB to the DDL block (use `poc/ddl_check.py` as the extractor) | DB-3 passes; only documented deviations |
| BE-3 | `core`: ids (ADR-016), `next_seq()` and `replace_live_database()` (epoch + counter lift, SYNC §3.2), error model, CSRF header middleware, Host allow-list, idempotency (never storing one-time secrets), audit writer, **request event log by route template only, no IP on learner routes**, log filter that redacts learner ids and sensitive lesson ids (SYSTEM-ARCHITECTURE §12.3) | Unit tests; SEC-2, SEC-7 |
| BE-4 | `identity` (revision 4: roles `hub_manager`/`admin`; **override requests and redeem bound to the `sb_ovr` request cookie, 128-bit `requestId`, USB-presence path (tokens 3/hour per IP, insertion = USB block-device add event; revision 5a), override notices with hub-manager acknowledgement, no bag-wide pause, 2,000/24 h ceiling, attempts committed before answering, `boot_seq` (revision 5), restricted session, uptime counter `bag_meta.uptime_total_s`, limits and pause, online send** per SYSTEM-ARCHITECTURE §9.9 and ADR-017; no local password reset by another admin): accounts, memory-hard KDF (Argon2id or scrypt, parameters set after PERF-1), lockout, sessions (hash-only, idle/absolute, IP bind, `last_seen` throttled), confirm, password change, roles; CLI `create-hub-manager`, `reset-password` | SEC-1, SEC-3, **SEC-11, SEC-12**; role matrix test generated from `x-auth` in `openapi.yaml` |
| BE-5 | `catalog`: every learner content endpoint and admin content endpoint in `openapi.yaml`, ETag/304, placement/renumbering transactions, publish rules, questions, Try it | FN-2 for these operations; DB-4 property test |
| BE-6 | `learners`: create/get/delete (tombstones, `secure_delete`), progress with monotonic state, coalescing, `409 sensitive_lesson`; anonymous `POST /lessons/{id}/activity` with per-view de-duplication, written to the **separate file `counts.sqlite3`** with no `seq` and no time of day (DATABASE §6.4, V-019; module `sensebod-offline/counts.py` creates and migrates it with plain SQL); progress removal when a lesson moves into a sensitive portal; Child protection mode read from `sensebod-offline.toml` only | SEC-10; tests incl. "no `lesson_progress` row for a sensitive portal", 3 pauses + 2 finish retries → +1/+1, guest counted |
| BE-7 | `media`: single and resumable uploads (streamed, `fsync` per chunk, offsets, `409 offset_mismatch`), space checks, inspection, automatic type rule, content-addressed store, package checks and safe extraction, `.docx` text, PDF pages, smaller copy, voice conversion | PL-2; SEC-4; 300 MB upload with three forced disconnects completes with one upload id |
| BE-8 | Worker (three lanes, claim with `RETURNING`, **one child process per job**, heartbeat and stall timeouts, worker-start recovery, retries, shutdown handling, temperature pause) and `sensebod-offline-maint` tasks (retention by wall clock/uptime/boot count, snapshots, export re-check after an unclean boot, health samples, GC, weekly integrity check) | PL-6, PL-7; unit tests per job kind; DATA-EXPORT §13 |
| BE-9 | `exports`: learner-data zip (CSV rules incl. formula guard and BOM; whole-month Child protection counts), password via tmpfs file only, names → USB rule, records/full backups (tar → `age`, manifest with epoch), diagnostics with privacy scan, boot-bound tickets, `X-Accel-Redirect`, `checking` state, received/saved checks, delete, retention, USB status/eject/check/format, stick retention and `.sha256` files, rotation hint | DATA-EXPORT §18 EX-1…7, DL-4…6, USB-1…4, SEC-E1…E3 |
| BE-10 | `sensebod-offline-boot-recover` (DATA-EXPORT §13, DATABASE §9.3) and the restore CLI (DATA-EXPORT §12) with `--registry` / `--min-epoch` (signed `bag-registry.json`, refuse without it), new `epoch_nonce`, restore of both database files; `replace_live_database()` used by every replacement path | PL-3, DB-5, BK-3, SYNC-1 |
| BE-11 | `system`: `/health`, `/admin/status`, `/admin/audit`, accounts, clock (via helper unit), power-off (via helper unit), USB package listing/install trigger | FN-2 for these operations |
| BE-12 | Update tool `sensebod-offline-update` (journal, snapshot, migrate, switch, health, rollback; SYSTEM-ARCHITECTURE §10.6) | PL-4, DEP-3, DEP-4 |

**Definition of done (BE):** all FN-2 contract tests green against `openapi.yaml`; the BE-specific tests above pass on the Pi (not only on a laptop); no upload route buffers the request body (no body parser on upload routes; streamed to disk, R-1); no write transaction contains file or network I/O (code review checklist).

## FE — Frontend (stream 1 for shared code and deploy, stream 4 for admin screens)

**Read:** API-DECISIONS §12; `openapi.yaml`; DATA-EXPORT-AND-BACKUP §7, §16; SYSTEM-ARCHITECTURE §6, §8.2.

**Depends on:** design boards for Storage and backup and Settings (designer, from DATA-EXPORT §16 and the new endpoints); P-6.

| # | Work | Acceptance criteria |
|---|---|---|
| FE-1 | `client.ts`: `X-Sensebod-Offline-Client: 1` on every non-GET (fetch and upload XHR); messages for `429`, `507`, `412`, `503 maintenance` (show the server's message) | Unit tests; mock returns these errors |
| FE-2 | Mock: every new endpoint and behaviour of `openapi.yaml` (resumable uploads with offsets, exports with states incl. `interrupted`, tickets, USB states, status, accounts, the Child protection activity endpoint, `409 sensitive_lesson`) | Contract tests of the mock against `openapi.yaml` |
| FE-3 | Resumable uploads > 16 MiB: `file.slice()` 2 MiB chunks, `GET /admin/uploads/{id}` to resume, automatic bounded retries, "Keep this page open", progress | BR-2; heap stays flat (as Reviewer B measured for single uploads) |
| FE-4 | Child protection: call `POST /lessons/{id}/activity` (opened once per page view, finished once) with a `crypto.getRandomValues` view id; **never** call `saveLessonProgress` or send a learner id from Child protection screens; no progress chips, counts or "continue" there; `location.replace` navigation inside the portal; **a neutral page title (`document.title = "Sensebod Offline"`) on every Child protection screen**, because the browser's history list shows page titles and a title such as "It is not my fault" is the revealing part (verification 2, C.2) | SEC-8 (packet capture: no learner id while a CP lesson is open); learner tests in CP portal |
| FE-5 | Admin: `role` gating, `mustChangePassword` flow, `If-Match` on lesson edits with the 412 message, clear typed draft on explicit sign-out (Reviewer B B-06) | SEC-1 UI part; tests |
| FE-9 | Revision 4 screens: "Forgot your password?" override flow and online send (SYSTEM-ARCHITECTURE §9.9 UI table); Storage and backup default **"Export for EasySTEM"**, partner spreadsheet under "Other downloads"; retention reminders and **Remove learner data** (DATA-EXPORT §16.1); role gating `hub_manager`/`admin` incl. revision 5 states (busy → "I am at the bag" + USB stick, code received, declined, could not reach EasySTEM, override banner for every admin with hub-manager acknowledgement, date-jump confirmation, clock-change list, optional "Choose your own password") | SEC-11, SEC-12, SEC-E4 UI parts |
| FE-6 | Storage and backup screens per DATA-EXPORT §16 (export options with names → USB and the override warning, password once and the replay message, preparing, ready, `checking`, in-page ranged download ≤ 16 MiB with retries and incremental pure-JS SHA-256 (≤ 3 KB gzip), "Received and checked" → Blob save → **Check the saved file** → "Downloaded and checked", new link after `ticket_invalid`, **in-place sign-in dialog (no navigation, chunks kept) on `401` during downloads, uploads and the saved-file check** (V-022), "cut off — start again", USB states incl. format, rotation hint and not-removed-safely note, backup screens, diagnostics) | BR-3, DL-1…3, DL-5, DL-6; admin chunk ≤ 60 KB gzip |
| FE-7 | Deploy config (stream 1 owns `app/deploy/`): fold in B-02, B-03 (`/media/` CSP), B-04, and hand the file to DEV for the backend additions of SYSTEM-ARCHITECTURE §8.2 | `server-checks.sh` from Reviewer B passes with the new checks |
| FE-8 | Never print `sensebod.local` for learners; site address `http://materials.sensebod.com` | Grep of `app/src` and docs |

## DEV — Edge deployment / DevOps

**Read:** SYSTEM-ARCHITECTURE §7, §8, §10–12; DATA-EXPORT §10; ADR-004, 011, 013, 014, 015; the DLH kit guide (`dlh-in-a-bag-docs/README.md`).

**Depends on:** P-1, P-4, P-7; AP purchase (kit "What's left" 1–2).

| # | Work | Acceptance criteria |
|---|---|---|
| DEV-1 | Master image recipe (kit Steps 1–14 + Sensebod Offline): packages of §10.1, users/permissions of §8.1, journald persistent 64 MB, nginx config (frontend base + §8.2 incl. **no access log and `crit` error log for `/api/`**), no framework access logger in the backend, `tmpfiles.d` for `/run/sensebod-offline/export-secrets`, nftables, systemd units and hardening, udev/polkit rules (incl. USB format unit), logrotate | DEP-1 by someone else from the written recipe; SEC-7 config unit test |
| DEV-2 | First-boot and `sensebod-offline-admin provision --bundle <age-encrypted provisioning bundle from sensebod-offline-office provision-bag>` (bag_id, EasySTEM-set hub manager password hash, override secret; OWNER-3/4); it also creates the bag's Ed25519 sync key and writes the public half to the key stick (revision 5a) (SSH host keys, secrets, Wi-Fi password, first hub manager, printed card) | SEC-6 |
| DEV-3 | Network final state: hotspot at boot, setup Wi-Fi removed, `dnsmasq`/`dnsmasq-eth` enabled (or merged), AP isolation, hotspot `pmf=2` (optional) after checking old phones still join, AP bridge settings documented per chosen model (kit "not written yet"); confirm with the owner that `materials.sensebod.com` has no public A/AAAA record (O-13) | NET-1, NET-4; phones join after a cold boot with no SSH session |
| DEV-4 | Root side of the privileged entry points, exactly as SYSTEM-ARCHITECTURE §9.8: `sensebod-offline-usb@` (mount/check/repair; also writes the insertion time to `/run/sensebod-offline/usb.json` for the override USB-presence path, V-030), `sensebod-offline-usb-eject`, **`sensebod-offline-usb-format@`** with all target checks, `sensebod-offline-clock@`, `sensebod-offline-poweroff` (bounded, lazy unmount), `sensebod-offline-update@` (root side of BE-12); the polkit rule that allows exactly these units; `tmpfiles.d` entries; `ReadWritePaths` of api/worker/maint incl. `/run/sensebod-offline/export-secrets` and `/run/sensebod-offline/requests` | SEC-9, EX-9, USB-1, DEP-6, PL-7 |
| DEV-5 | Release pipeline: build `web/` (frontend `npm run build`), backend with dependencies installed for `linux-arm64` (native modules built against the pinned runtime) and the pinned Node.js runtime in `runtime/`, `release.json`, `MANIFEST.sha256`, OpenSSH signature with the offline release key; content-pack builder with signature | DEP-3, DEP-4 |
| DEV-6 | Convert the 64 livestock videos into the first content pack (`content/agriculture-videos.csv` mapping) | Pack installs, lessons appear, interrupted install resumes |
| DEV-7 | Power-cut rig (relay or smart plug driven from a laptop) and the scripts for PL-1…5 | Rig cycles 200 times unattended and logs each boot |
| DEV-8 | Technician guide: provisioning, spare card, restore (DATA-EXPORT §12), update rollback, diagnostics, key handling (O-11) | Followed successfully by someone who did not write it |

## SYNC — Office import tool (phase 1)

**Read:** SYNC.md §2–4; DATA-EXPORT §3.2, §12.

| # | Work | Acceptance criteria |
|---|---|---|
| SYNC-1 | `sensebod-offline-office import <.sbk>`: decrypt with an `age` identity, verify, upsert by `(bag_id, entity, id)` only if `seq` is greater (SYNC §3.2–3.3), tombstones, imports table with `epoch_nonce`, `epoch_clash` refusal, Child protection counts merged with `max` by natural key, **`sensebod-offline-office bag-registry --out <key stick>`** (signed with the office key, namespace `sensebod-offline-registry`) for the restore CLI, `lost_on_bag` report when the epoch rises; report per bag | SYNC-1 test incl. the recovery case of V-008 (`poc/poc_sync_epoch.py` is the reference logic) |
| SYNC-2 | `sensebod-offline-office decrypt` for technicians preparing a restore (no plaintext left behind: output to a chosen path, warning) | Manual test |
| SYNC-3 | `sensebod-offline-office provision-bag` (bag_id, override secret derived from the versioned master, EasySTEM-chosen hub manager password → hash), `sensebod-offline-office override` (refuses to print a code without a recorded verification: call-back to a registered number, two-person approval in the defined cases; append-only mint log; refuses revoked bags; revision 5, V-031), **per-hub enrolment record** (hub, hub manager, two registered numbers, admin usernames) made at provisioning, `revoke-bag`, `register-bag-key` (public Ed25519 sync key into the registry, revision 5a), master-key versioning; registry gains `key_version` and `revoked` | `poc/poc_override.py` is the reference logic; SEC-11 |
| SYNC-4 | (phase 2, optional) EasySTEM **reset service**, store-and-forward only (no `M_v`, no `K_bag`, no code-signing key; bag requests signed with its Ed25519 sync key; idempotent by `requestId`; codes deleted after the bag acknowledges or after 72 h; staff logins with a second factor; SYNC §6.3b, V-032) | online reset end to end on a test bag, including a dropped connection at every step; deployment review shows no master key |

Phase 2 network sync: **do not build** until O-4 is answered.

## QA — Testing

**Read:** SYSTEM-ARCHITECTURE §14; DATA-EXPORT §18.

| # | Work | Acceptance criteria |
|---|---|---|
| QA-1 | Load generator for CON-1 (40 simulated phones, progress writes logged with ids for PL-1), plus the DB-6 harness: an injected lock holder (1.5 s `BEGIN IMMEDIATE` every minute) and event-loop delay measurement in the API (start from `poc/poc_lock_wait.mjs`) | Reproducible runs, results stored |
| QA-2 | Contract test harness from `openapi.yaml` (FN-2) usable against mock and backend | Runs in CI and against the Pi |
| QA-3 | Power-loss campaign PL-1…5 with DEV-7 | All **bold** PL tests pass |
| QA-4 | Real-device campaign BR-1…4, NET-2/3, CON-2 with the oldest phones | Results table with device, OS, browser |
| QA-5 | Restore drills BK-1…3 per release candidate | Pass recorded per release |
| QA-6 | Security tests SEC-1…7, SEC-E1/E2 | All pass |

**Release gate:** every **bold** test in SYSTEM-ARCHITECTURE §14 passes on Pi + real phones, and no Critical/High finding from verification remains open.

## Deferred to the backend build (owner decision, 13 Nov 2026)

The owner chose to leave the last two Low findings from verification round 8 to the backend implementation, not another design revision:

- **V-039 (Low):** a power cut while the clock is being set, or a hand-set date written to the RTC, can turn a hand-set date into "trusted" time; plain NTP over an uplink is also trusted. Build: record the source of each clock change durably before applying it, and keep a hand-set date untrusted for expiry until confirmed by a later independent source.
- **V-038 (Low, partial):** restate the "I am at the bag" guessing bound keyed on subnet size (rotating addresses across both subnets gives ~1.4 × 10^-10 per day, still negligible), and cap the number of honoured stick insertions per window.
- **O-16 decided by the owner:** unexported learner data is held **60 extra days** (not 30) after the two-month retention, then removed with a hard stop; escalating export reminder during the hold. Update the retention constants, DATA-EXPORT/DATABASE retention text and the retention PoC parameters accordingly.
- **O-15 decided:** two roles as designed (hub_manager: everything; admin: content and export only).
- **O-17 decided:** no identity-check procedure at EasySTEM before issuing an override code. Drop the call-back / two-person approval steps from the EasySTEM tool's required flow (keep its issuance log and the on-bag banner and audit log).
