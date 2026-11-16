# ADR-002 — SQLite in WAL mode with `synchronous=FULL`, not PostgreSQL

**Status:** Proposed · 12 Nov 2026

**Decision.** One SQLite database file, WAL journal, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout` per process (**API: `0`** with a single-flight write gate and asynchronous retry, ≤ 5 s per request; processes that serve no HTTP: `5000`), write transactions `BEGIN IMMEDIATE`, configuration and write model as in DATABASE §3–4.

**Context.** Workload is read-heavy with < 5 writes/s at peak (DATABASE §2); one backend owns the file; storage is a microSD card; power is cut without warning; nobody on site can administer a database server; installs and upgrades happen offline.

**Alternatives.**
- *PostgreSQL:* real concurrent writers and richer SQL. Costs: a second server process and its memory, its own crash recovery and `fsync` behaviour on SD, `pg_dump`/major-version upgrades without internet, more to monitor. Its concurrency is not needed at this write rate. (The IIAB review reports MariaDB failing to start after power cuts on a Pi 5 — a different engine, but a reminder that every server daemon is one more thing to recover.)
- *SQLite with `synchronous=NORMAL`:* faster, still never corrupt, but may lose the last committed transactions on power loss, contradicting "nothing is presented as saved until the server confirms it".
- *Files/JSON per learner:* no transactions, no integrity checks.

**Rationale.** Many readers and one short writer is exactly SQLite's sweet spot; WAL lets readers and the writer proceed together; recovery after power loss is a WAL replay; online consistent snapshots are one statement (`VACUUM INTO`). Measured on a Mac (`poc/`): a snapshot of an 8.4 MB database took 33 ms while a writer committed every ~2 ms with max writer latency 0.5 ms; a `kill -9` mid-transaction left the database intact; durable commits with a real flush ran at 209/s. Pi figures are unverified (test DB-1).

**Trade-offs.** Single writer: a long write transaction would block all others, hence the strict rules (no I/O in write transactions, batching, snapshots for long reads). Durability depends on the card honouring flushes (test PL-1). One flush per commit costs card wear (mitigated by coalescing progress writes).

**Consequences.** Writes are serialised and short; `503 busy` exists as a designed outcome; exports and backups work from snapshots.

**Revisit when.** Sustained writes exceed 50/s on the Pi, write p95 exceeds 300 ms under CON-1, or a central multi-bag server is built (that server may well use PostgreSQL; the bag stays SQLite).

**Revision 3 (13 Nov 2026).** V-026: `busy_timeout` is now per process. Processes that serve HTTP use `0` with a single-flight write gate and asynchronous retry (revision 3a), so a lock wait never blocks the Node event loop. Processes that do not serve HTTP keep 5000 ms. Every writer holds the lock ≤ 50 ms (R-3H, DB-6). V-025: the anonymous counts file follows the same pragmas and has its own lifecycle (DATABASE §9.4).
