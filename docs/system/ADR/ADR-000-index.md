# Architecture decision records — index

Status of all records: **Proposed** (12 Nov 2026); ADR-003, 006, 007, 008, 009, 011, 012 and 014 revised on 13 Nov 2026 (revision 1); ADR-001, 003, 007, 008, 009 and 012 again in revision 2; ADR-001, 002, 008 and 011 in revision 3; awaiting reverification. Format: Decision · Context · Alternatives · Rationale · Trade-offs · Consequences · Revisit when.

| ADR | Decision |
|---|---|
| [001](ADR-001-modular-monolith-runtime-agnostic.md) | Modular monolith, runtime-agnostic (owner runtime: Node.js/Express); supersedes the earlier Django proposal (OWNER-1) |
| [002](ADR-002-sqlite.md) | SQLite in WAL mode with `synchronous=FULL`, not PostgreSQL |
| [003](ADR-003-background-jobs.md) | Job table in SQLite + one worker with three lanes (child process per job, stall timeouts); no broker |
| [004](ADR-004-plain-http.md) | Plain HTTP (Mode A); no HTTPS in phase 1 |
| [005](ADR-005-media-store.md) | Content-addressed media files on the filesystem, served by nginx |
| [006](ADR-006-resumable-uploads.md) | Resumable chunked uploads above 16 MiB |
| [007](ADR-007-export-pipeline.md) | Exports: snapshot → atomic file → nginx-served ranged download with tickets → client-side SHA-256 |
| [008](ADR-008-encryption.md) | Backups encrypted with `age` to EasySTEM public keys; learner data as AES-256 zip with a one-time password |
| [009](ADR-009-child-protection-counts-only.md) | Child protection activity counted anonymously (no learner id on the wire, in the DB or in logs) — **accepted by the owner (OWNER-2)** |
| [010](ADR-010-usb-first-sync.md) | USB/technician path first; cloud sync phase 2 and optional |
| [011](ADR-011-signed-journaled-updates.md) | Signed release bundles, A/B release folders, pre-update snapshot, journaled update |
| [012](ADR-012-local-snapshots-auto-recovery.md) | Local automatic snapshots and automatic recovery from a corrupted database |
| [013](ADR-013-storage-medium.md) | microSD (high-endurance) + off-bag backups now; SSD as an upgrade path |
| [014](ADR-014-clock.md) | Do not trust the wall clock: `(epoch, seq)` ordering, clock-trust flag, RTC battery |
| [015](ADR-015-network.md) | Pi provides DHCP/DNS; external AP in bridge mode; site name `materials.sensebod.com` |
| [016](ADR-016-identifiers.md) | Prefixed 128-bit random ids for records created on a bag |
| [017](ADR-017-offline-override-code.md) | Offline override code by challenge-response (not TOTP); same mechanism for the online reset (OWNER-3/4) |
| [018](ADR-018-learner-data-retention.md) | Learner data kept two months after last activity; cleaning on demand; unexported hold-back option B recommended (OWNER-5) |
| [019](ADR-019-two-admin-roles.md) | Two admin roles, `hub_manager` and `admin` (OWNER-6, assumption) |
