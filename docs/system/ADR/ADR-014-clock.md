# ADR-014 — Do not trust the wall clock

**Status:** Proposed · 12 Nov 2026 · revised 13 Nov 2026 (revision 1)

**Decision.** No ordering, conflict rule or security check depends on wall-clock time **across boots**: admin sessions and sign-in lockouts end at every boot, and download tickets carry the `boot_id` in their MAC and are refused in another boot (within one boot the wall clock is used for their 30-minute/2-hour/12-hour limits, which is safe because it only moves forward unless a hub manager sets it). Ordering uses `(epoch, seq)` (SYNC §3.2). Each boot records `clock_trust`: `synced` (NTP, only with an uplink), `rtc` (RTC with battery: the RTC time is later than the last saved time), `restored` (time stepped forward to the last saved time from `/var/lib/sensebod-offline/run/clock.json`, written hourly), `unsure`. Dates shown to people carry the trust flag. Retention uses the first of wall-clock age, uptime within the boot of creation, and a boot count (DATA-EXPORT §8). A hub manager can set the clock from their phone (`POST /admin/clock`), audited. Recommend the Pi 5 RTC battery.

**Context.** The Pi 5 has a real-time clock but keeps time across power-off only with a battery fitted; the bag is offline (no NTP); power cuts are frequent; kit unknown whether a battery is fitted.

**Alternatives.** Trust the clock (exports and audit with wrong dates; retention never expiring if the clock goes back); require NTP (impossible offline); phone time automatically on every request (any phone could change the bag's time).

**Rationale.** Correctness does not need time; people do. Make time a labelled, best-effort attribute.

**Trade-offs.** Dates in exports may be wrong (labelled in the manifest and UI).

**Consequences.** `boot` table, clock helper (root, polkit-allowed unit) to step time, `clockTrust` fields in the API.

**Revisit when.** RTC batteries are fitted to every bag (then `unsure` should be rare).

**Revision 1 (13 Nov 2026).** V-012: v0.1 claimed this but used wall-clock expiry for tickets, sessions and lockouts with a persistent ticket key, so after a power cut without an RTC battery they could live longer in real time than stated. Retention of exports also no longer uses an uptime-weighted counter (V-015): the first of wall-clock age, uptime within the boot of creation, or a boot count (learner data never survives two boots).

**Revision 5 (13 Nov 2026).** V-033: **Exception, stated:** automatic removal of learner data (ADR-018) is the one destructive action that uses the wall clock. It is guarded: manual time is marked `manual`; every change is audited and shown; forward jumps of more than 7 days are recorded and never count for unexported data, and count for exported data only after a hub manager confirms; there is a 10 % per-run cap. A forward step of the clock never advances the override expiry, which uses uptime and boot counts (ADR-017).

**Revision 5a (13 Nov 2026).** V-033 remainder: retention trusts forward steps backed by a battery-backed RTC or NTP as real time, and guards only manual or unexplained steps (ADR-018).
