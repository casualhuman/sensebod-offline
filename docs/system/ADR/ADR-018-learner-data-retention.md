# ADR-018 — Learner data kept two months, then removed; cleaning on demand

**Status:** Proposed · 13 Nov 2026 (revision 4, OWNER-5). The two-month rule was decided by the owner. **Holding back unexported data is still open (O-16).**

**Decision.**
- **Automatic removal:** a learner and their progress are removed 61 days after the learner's last activity. `sensebod-offline-maint` does this daily, only while the clock is trusted, with `secure_delete`, tombstones and an audit event.
- **Cleaning on demand:** a hub manager can remove learner data at any time. The screen first shows the last export date and warns about unexported data.
- **Unexported data:** recommended **option B**. Data that has not reached EasySTEM is held up to 30 more days with warnings, then removed. This is set by `retention.unexported_hold_days` (0 = A, 30 = B, −1 = C); the owner chooses.

**Context.** The owner said "Learner data is kept for two months" and that the admin or hub manager can also clean it (DESIGN-DECISIONS §7.5). Data is meant to go to EasySTEM (§7.4). Bags may meet EasySTEM rarely, and the bag's clock can be wrong (ADR-014).

**Alternatives.**
- *Two months from creation.* An active learner would lose current progress.
- *Per-row removal of progress older than two months.* Finished lessons would revert to "Not started".
- *Never remove.* Contradicts the owner.

"Since last activity" keeps active learners intact and removes people who stopped using the bag, which matches "kept for two months" for data that is no longer in use. **This interpretation is an assumption** for the owner to confirm in O-16's discussion.

**Rationale.** It is bounded storage of children's data, consistent with exporting to EasySTEM first. Clock-safe (revision 5): removal never runs on an untrusted clock. Forward jumps of more than 7 days are recorded and never count for unexported data, and count for exported data only after confirmation, with a 10 % per-run cap. A jump back cannot keep data forever unnoticed (the "set the clock" banner).

**Trade-offs.**
- A bag with a permanently wrong clock never auto-removes. It shows a banner instead.
- Option B can keep unexported data up to about 3 months.

**Consequences.** New pieces: `export.snapshot_seq`, the summary fields (`lastExportAt`, `unexportedLearners`, `nextAutomaticRemoval`, `retentionHeldBack`), `POST /admin/learner-data/clean` and the screens of DATA-EXPORT §16.1. Tests: SEC-12 and DB retention unit tests.

**Revisit when.** The owner answers O-16, or decides to clarify "since last activity".

**Revision 5 (13 Nov 2026).** V-033: retention is the one destructive action that depends on the wall clock, so it is guarded. Phone-set time is `manual`; every clock change is logged and shown. A forward jump of more than 7 days never counts for unexported data, and counts for exported data only after a hub manager confirms the date. Each run removes at most 10 % of learners without confirmation. Control: under the revision-4 rule a phone date one year ahead removed 100 of 100 learners, 50 of them unexported; under this rule, 0 (`poc/poc_retention_clock.out`).

**Revision 5a (13 Nov 2026).** V-033 remainder: only **untrusted** forward steps are guarded: a manual set, or a boot step no trusted clock explains. A step read from a battery-backed RTC after the bag was off, or made by NTP, is real elapsed time and counts. For a bag used one week a month this removes data on day 61 / 91 instead of 245 / 390. A one-year manual jump still removes 0 learners (`poc/poc_retention_clock.out` C4, C1).
