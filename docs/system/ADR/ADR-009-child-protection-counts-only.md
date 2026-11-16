# ADR-009 — Child protection activity stored as counts only

**Status:** Proposed · 12 Nov 2026 · revised 13 Nov 2026 (revision 1) (conservative assumption pending owner question O-1)

**Decision.** For lessons in portals marked `sensitive` (Child protection), no learner id is ever sent, stored or logged together with the lesson. The frontend calls an anonymous `POST /lessons/{id}/activity {event: opened|finished, viewId}` (random per page view; guests counted; de-duplicated so pauses and retries count once); the server keeps per-lesson daily totals only. `PUT …/progress` on such a lesson answers `409 sensitive_lesson`. API request logs are route templates without IPs. Progress, continue and exports never contain Child protection per learner; exports carry whole-month totals with values below 5 shown as `<5`. Switching to per-learner recording is a **release/technician configuration** (`/etc/sensebod-offline/sensebod-offline.toml`, key `child_protection.progress_mode`, values `counts-only` (default) or `per-learner`), audited at boot and shown as a permanent admin banner — not an admin setting; even then learner-data exports exclude Child protection rows. Moving a lesson into a sensitive portal deletes its per-learner progress.

**Context.** "Knowing a named child opened 'It is not my fault' can put the child at risk" (DD §2.3); the design lead recommended counts only; the bag can be stolen, files can be lost, shared phones show names.

**Alternatives.** Store per learner, exclude from exports (still on the card and in backups); store per learner without names (the id links to the name on the bag); no recording at all (no programme reporting).

**Rationale.** Data that does not exist cannot leak. Counts still answer "is the programme being used?".

**Trade-offs.** No "2 of 5 done", no "continue where you stopped", no finished chips inside Child protection; the frontend must hide them (HANDOFF FE-4). Small bags may still have identifying counts on a given day; the export therefore counts **whole calendar months only** (the current month left out) and shows values below 5 as `<5`. The counts can be inflated by anyone on the Wi-Fi (at most 10 per minute per address) and are labelled indicative.

**Consequences.** Frontend change; one extra table; a test that no Child protection row ever appears in `lesson_progress` by default.

**Revisit when.** The owner answers O-1.

**Revision 1 (13 Nov 2026).** V-001 (High): the v0.1 design still sent the learner id in the progress URL for Child protection lessons, and that URL was written to the nginx and application-server access logs (with IP and time) and shipped in diagnostics — the record this ADR promised never to keep. Fixed at three layers: the request no longer carries a learner id; request logs are template-only with no IP on learner routes; diagnostics contain no raw logs and are scanned. V-009: counts were wrong by construction (guests not counted, every pause and retry counted). V-014: mode not admin-changeable; whole-month counts against differencing; progress removed when a lesson moves into the portal; `location.replace` navigation on shared phones (browser history may still keep addresses: documented limit).

**Revision 2 (13 Nov 2026).** V-019: the counts no longer share anything with personal data. They live in a separate SQLite file (`counts.sqlite3`) with no sequence number, no time of day and `WITHOUT ROWID` tables, so a Child protection event appends nothing to the main database or its WAL and the count row cannot be placed between a named learner's writes. Sync merges counts by natural key with `max`. Evidence `poc/poc_cp_unlink.out`: v0.2 design, the count row's neighbours by `seq` were both the same named learner and 12,360 bytes were added to the main WAL; v0.3 design, no shared ordering column and 0 bytes added to the main WAL. Residual: the file's modification time, blurred by maintenance writes every 15 minutes. V-023: rate limit 10/min. V-014: key name stated above; whole-month counting stated in Trade-offs. Browser history: Child protection screens use the neutral page title "Sensebod Offline" (history lists show titles; HANDOFF FE-4).

**Revision 4 (13 Nov 2026).** The owner chose option A (DESIGN-DECISIONS §7.1): Child protection lessons are never linked to a learner's name; the bag keeps only anonymous counts; no "Continue where you stopped" inside Child protection. This is exactly this ADR. The `per-learner` configuration value stays technically possible only by a release (owner decision required), and is not offered.
