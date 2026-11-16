# ADR-003 — Job table in SQLite + one worker with three lanes; no broker

**Status:** Proposed · 12 Nov 2026 · revised 13 Nov 2026 (revision 1)

**Decision.** Background work is a row in the `job` table. `sensebod-offline-worker` (one supervisor process with three lanes) claims jobs atomically with `UPDATE … RETURNING` and runs each job in its own child process with a stall timeout: a **media** lane (inspection, conversions; `nice 19`, idle I/O, `ffmpeg -threads 2`), a **data** lane (exports and backups to download) and a **usb** lane (anything that touches a stick, incl. content-pack installs). Local snapshots, retention and GC run in `sensebod-offline-maint` (systemd timer), not as jobs. On every start the worker recovers jobs left `running` (there is only one worker).

**Context.** Jobs arrive at most a few per minute; they must survive power loss (state on disk) and must not starve learners.

**Alternatives.** Redis-backed queues (e.g. BullMQ, or Celery/RQ in other runtimes) (a broker and a second persistent store to recover after power loss, RAM, ops burden); Huey with SQLite (another dependency with its own semantics); doing work inside requests (blocks the HTTP process, dies with the request); systemd transient units per job (hard to report progress and retry uniformly).

**Rationale.** The database is already durable and transactional; a job row commits in the same transaction as the upload or export that needs it (no lost or orphan jobs). Separate lanes keep a 20-minute video conversion from delaying an export, and a slow or hung USB stick from delaying a download export (three lanes: media, data, usb).

**Trade-offs.** Polling (every 2 s when idle; cheap single indexed query). Custom retry/backoff code (small).

**Consequences.** Every job is idempotent or not auto-retried (table in SYSTEM-ARCHITECTURE §5.8); boot recovery marks jobs of an older boot as interrupted.

**Revisit when.** More than one Pi shares work (never planned) or job volume exceeds hundreds per minute.

**Revision 1 (13 Nov 2026).** Findings V-002 (a worker crash within a boot left jobs `running` and blocked exports until a reboot) and V-003 (one serial data lane with no timeout let a hung stick block snapshots and exports) are answered by worker-start recovery, a child process per job with stall timeouts, a separate USB lane, one-export-per-destination, and moving snapshots/retention/GC out of the queue. Trade-off: one extra process start per job (for Node.js ≈ 0.1–1 s, unverified on the Pi) — negligible for jobs that take seconds to minutes. Tests PL-6, PL-7.

**Revision 2 (13 Nov 2026).** V-024: USB and data jobs close their database connection right after taking their snapshot and report progress through a pipe to the supervisor, so a child stuck in uninterruptible I/O holds no SQLite read transaction; power-off detaches the stick lazily and is bounded at 60 s.

**OWNER-1 (13 Nov 2026).** Runtime-agnostic wording: the worker is a separate process supervised by systemd that runs each job in its own child process (for Node.js e.g. `child_process.fork` with progress over IPC; example only).
