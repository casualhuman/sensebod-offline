# ADR-010 — USB/technician path first; cloud sync is phase 2 and optional

**Status:** Proposed · 12 Nov 2026

**Decision.** Phase 1 has no network sync. Data leaves the bag as encrypted backups and learner-data files (download or USB); content and software arrive as signed packs on USB. Phase 1 still stamps `(epoch, seq)`, tombstones and `bag_id` so a phase 2 outbound HTTPS sync can be added without schema changes (SYNC.md).

**Context.** Kit decision "one Pi per location, no link"; no central server exists; O-4 open; bags have no uplink in normal use.

**Alternatives.** Build sync now (code and credentials never exercised; TLS needs correct clocks; a central service to run); no collection at all (no reporting, no off-bag backup).

**Rationale.** Proportionate: USB covers backup and reporting today; the hooks for later cost almost nothing.

**Trade-offs.** Data reaches the office only with visits; the 14-day off-bag reminder relies on people.

**Consequences.** An office import tool (HANDOFF SYNC-1) that is idempotent and regression-safe.

**Revisit when.** O-4 = yes and bags get regular uplinks.
