# ADR-012 — Local automatic snapshots and automatic recovery from a corrupted database

**Status:** Proposed · 12 Nov 2026 · revised 13 Nov 2026 (revision 1)

**Decision.** The bag snapshots its database with `VACUUM INTO` every 2 h of uptime with changes, before updates/restores, and after an unclean boot; keeps a bounded rotation (DATA-EXPORT §9). At boot, a database that fails `quick_check` is moved aside (kept) and the newest snapshot that passes `integrity_check` is put in its place automatically, with an admin banner; if none passes, the API starts in maintenance mode.

**Context.** Edge autonomy (no technician for weeks); SD cards and power cuts; most corruption cases leave the card readable.

**Alternatives.** Do nothing automatically (bag unusable until a visit); attempt `.recover` automatically (may silently produce partial data); restore from off-bag backups only (needs a technician).

**Rationale.** A known-good recent state is better for learners than a dead bag; the corrupt file is kept for a technician to salvage newer rows.

**Trade-offs.** Silent-ish loss of up to ~2 h of changes (shown in a banner); snapshots use space on the same card (bounded) and do not protect against card death (off-bag backups do).

**Consequences.** Boot-recovery service; `boot.recovery_note`; `/admin/status.recovery`.

**Revisit when.** Field data shows corruption never happens (reduce frequency) or happens often (storage hardware change, ADR-013).

**Revision 1 (13 Nov 2026).** V-008: the automatic recovery now increments `bag_meta.epoch` and lifts `change_seq` to `epoch × 2^40` in the same step, like every other replacement of the live database, so changes after a recovery (e.g. a tombstone) always sort after what the office has seen. Evidence: `poc/poc_sync_epoch.out` (control without the lift reproduces the defect). V-013: corrupt copies kept 90 days, pre-update/pre-restore snapshots 30 days.

**Revision 2 (13 Nov 2026).** V-008 remainder concerns the technician restore, not this automatic path (which stays `bag epoch + 1`, correct per the verifier); every replacement now also sets a new random `epoch_nonce`, so the office can detect two lineages with the same epoch number.
