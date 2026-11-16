# Notes for the verification agent

12 Nov 2026, updated 13 Nov 2026 for revision 1 · System Architecture Agent. A map from the Definition of Done (instructions §32) to where each item is answered, what evidence exists, and the weak spots I want challenged. Nothing in this design has run on a Raspberry Pi or a phone; all measurements are from the development Mac (`poc/`).

## 0. Revision 1 (13 Nov 2026)

All 18 findings of `reviews/ARCHITECTURE-VERIFICATION-1.md` are answered in `REVISION-1-RESPONSE.md`. That file has one row per finding with the change, the file and section, and the evidence. It also lists the three optional parts I did not adopt, with reasons (V-005 sealed password, V-010 third backend process, V-014(d) browser history). New Mac evidence: `poc/poc_export_v2.out` and `poc/poc_sync_epoch.out`, plus a re-run of `poc/ddl_check.out`. **P-1, P-3, P-4 and P-6 are still not done** (no Pi, phone or stick was used). Weak spots 2, 6 and 8 below were changed by V-006, V-015 and V-003; their new form is noted inline.

## 0b. Revision 2 (13 Nov 2026)

`REVISION-2-RESPONSE.md` maps every finding of `reviews/ARCHITECTURE-VERIFICATION-2.md`. It covers the five partial ones (V-004, V-008, V-010, V-014, V-016) and the six new ones (V-019 to V-024), plus the editorial items. New evidence (Mac only): `poc/poc_sync_epoch.out` (fresh-card restore, with a failing control) and `poc/poc_cp_unlink.out` (separate counts file, 0 bytes added to the main WAL). `poc/poc_export_v2.out` and `poc/ddl_check.out` were extended. **P-1, P-3, P-4 and P-6 are still not done.** New points I want challenged: (a) the signed bag registry is a new artefact the office must keep current, and a technician who uses a stale registry is stopped only by the nonce clash check at the office; (b) the modification time of `counts.sqlite3-wal` is an accepted residual; (c) the format helper's target checks rely on `lsblk`/`findmnt`/udev properties, which SEC-9 must exercise on the real image.

**OWNER-1 (owner's runtime correction):** the backend is Node.js with Express, and the design is tooling-agnostic. Django/gunicorn/Python backend choices are withdrawn everywhere. SYSTEM-ARCHITECTURE §4.1 now states binding requirements (R-1…R-12) with Node.js examples only, and ADR-001 is rewritten. Please challenge: (d) whether R-1…R-12 are complete enough that a backend engineer makes no architectural decision alone; (e) the Node.js memory figures in §11.1, which are all unverified.

## 0c. Revision 3 (13 Nov 2026)

`REVISION-3-RESPONSE.md` answers V-025 to V-029. The condition V-026 is now binding text: SYSTEM-ARCHITECTURE §4.1 R-3L and R-3H, DATABASE §3–4, ADR-001 and ADR-002, and test DB-6. It is backed by `poc/poc_lock_wait.out` (Node and `node:sqlite` on the Mac). V-027 is backed by `poc/poc_ae2.out` (a `node:crypto`-only AE-2 writer that interoperates with libarchive). **P-1, P-3, P-4 and P-6 are still not done.** Revision 3a: R-3a is now `busy_timeout=0` with a single-flight write gate (200-concurrent case measured), and `new-epoch` re-stamps rows changed since `epoch_base_seq`. Please challenge whether R-3b (off-loop DB access) should become the default once DB-6 runs on the Pi.

## 1. Definition of Done map

| §32 item | Where | Evidence / status |
|---|---|---|
| Functional and nonfunctional requirements documented | SYSTEM-ARCHITECTURE §2 | Traced to DD/AC/FA/KIT |
| Target hardware and deployment assumptions | SYSTEM-ARCHITECTURE §2.3, §10.1, §11 | Kit facts cited; assumptions marked |
| Complete logical architecture | SYSTEM-ARCHITECTURE §3.2, §5 | Mermaid |
| Physical Pi deployment | SYSTEM-ARCHITECTURE §3.3, §8.1, §10 | Mermaid, paths, units |
| Networking, DHCP, DNS, addressing | SYSTEM-ARCHITECTURE §3.4, §7; ADR-015 | Kit scripts; AP path not yet run (kit) |
| Backend components and responsibilities | SYSTEM-ARCHITECTURE §5 | Per module: responsibilities, data, rules, failures, tests |
| Database technology justified | ADR-002; DATABASE §1–2 | Mac PoC (`poc/poc_sqlite.out`) |
| Schema and transaction strategy | DATABASE §4, §6 | DDL executed; constraint probes (`poc/ddl_check.out`) |
| Data ownership and consistency rules | SYNC §2–3 | Matrix; `(epoch, seq)` rule |
| Offline behaviour | SYSTEM-ARCHITECTURE §3, §6, §13 (F-13); test OFF-1 | Design only |
| Synchronisation protocol (where required) | SYNC (phase 1 USB; phase 2 design only) | — |
| API contracts | `openapi.yaml`; API-DECISIONS | Parsed (Ruby YAML), all `$ref`s resolve; **not** validated by an OpenAPI linter |
| Authentication and authorisation | SYSTEM-ARCHITECTURE §3.6, §9.3–9.5; identity module §5.2 | — |
| Security threats and controls | SYSTEM-ARCHITECTURE §9 | Threat table T-1…T-14 |
| Storage and media handling | ADR-005, SYSTEM-ARCHITECTURE §5.4, §8 | — |
| Resource budgets | SYSTEM-ARCHITECTURE §11 | **All Pi figures are assumptions**; PERF-1 and HANDOFF P-1…P-5 verify |
| Power-loss and failure recovery | SYSTEM-ARCHITECTURE §13; DATA-EXPORT §13, §15; ADR-012 | Export protocol: 60/60 kill -9 trials (`poc/poc_export.out`); power cuts not tested |
| Backup and restoration | DATA-EXPORT §3, §9–12; ADR-008 | Restore drill is test BK-3 (not run) |
| Deployment, provisioning, updates | SYSTEM-ARCHITECTURE §10; ADR-011 | — |
| Monitoring and diagnostics | SYSTEM-ARCHITECTURE §12; DATA-EXPORT §3.4 | — |
| Testing and validation criteria | SYSTEM-ARCHITECTURE §14; DATA-EXPORT §18 | Pass/fail per test |
| Architecture diagrams | SYSTEM-ARCHITECTURE §3.1–3.8 (8 required diagrams); DATA-EXPORT §5, §7.5, §11, §12, §16; SYNC §6.3; DATABASE §4–5 | Mermaid (not rendered here; please check syntax) |
| ADRs complete | `ADR/ADR-000-index.md` (16 records) | — |
| Independent review performed | — | Your task |
| Critical/High findings resolved | — | After your review |
| Backend and infrastructure handoffs | HANDOFF-PACKAGES BE, DEV (+ FE, SYNC, QA) | — |

Owner requirement ("download user data safely … power loss"): DATA-EXPORT-AND-BACKUP.md covers scope (§3), Child protection (§2, ADR-009), consistent snapshot (§4), atomic creation + manifest/checksum (§5, §7.4), power loss on the Pi and boot cleanup (§13, §15), resumable/verifiable download (§7), USB (§10–11), encryption (§6), audit (§14), retention and limits (§8), UI states (§16), learner data vs backup (§1), restore (§12).

## 2. Weak spots I want challenged

1. **Durability rests on the microSD honouring flush requests.** `synchronous=FULL` and the fsync/rename protocols are only as good as the card. Not tested (P-4, PL-1). If the card lies, "a confirmed save survives" is false and ADR-013 must change.
2. **In-page download and `Blob` saving on Chrome 58 Android are unverified** (P-6, BR-3). *Revision 1:* "Downloaded and checked" now requires a check of the **saved** file, so a failed save can no longer show a false state. The cost is one extra tap. The in-page limit is 16 MiB until P-6.
3. **Plain HTTP admin credentials (T-2).** I accepted this as the main residual risk. Is the mitigation set (IP-bound sessions, short idle, audit, encrypted exports) proportionate, or should admin access be restricted further (e.g. admin only over the Ethernet/AP segment, or a second Wi-Fi network)?
4. **Child protection counts-only (ADR-009)** changes the learner UX (no chips/continue in that portal). It is a product assumption pending O-1, taken as the conservative default.
5. **Automatic restore from a local snapshot** (ADR-012) can lose up to ~2 h of changes with only a banner. Alternative: stop and wait for a technician. I chose availability.
6. *Revision 1:* the uptime-weighted counter was replaced by "first of wall clock, uptime within the boot, boot count" (V-015).
7. **The AE-2 zip writer** (SYSTEM-ARCHITECTURE §4.1 R-8) must be proven on the Pi (P-2). *OWNER-1:* the Python library named earlier is withdrawn; any writer meeting R-8 is acceptable (a CLI must take the password through a pipe, not argv).
8. *Revision 1:* one export per destination, a separate USB lane and stall timeouts (V-003). Remaining weak spot: a child process stuck in uninterruptible I/O on a dead stick cannot be killed, so the USB lane stays blocked until the stick is removed or the bag reboots.
17. **New in revision 1, please challenge:** (a) the `change_seq` lift to `epoch × 2^40` (SYNC §3.2) instead of a per-row epoch column; (b) one child process per job (start-up cost on the Pi is unmeasured); (c) the dirty-bit classification depends on `fsck` output, which USB-3 has not yet pinned; (d) the diagnostics privacy scan fails the export on any hit, which could block diagnostics when a learner's name is a common word (names under 3 characters are not scanned; a false positive only stops the report, it never leaks); (e) all admin sessions end at every reboot, so a facilitator must sign in again after each power cut.
9. **Restore needs a technician** (backups unreadable by the bag). Facilitators cannot recover from card loss alone. Deliberate (ADR-008); challenge if field reality makes visits too rare.
10. **Uploads and the API process**: *revision 1:* chunks ≤ 4 MiB (2 MiB recommended); CON-1 tests 4 throttled uploaders. *OWNER-1:* with Node.js asynchronous I/O a chunk holds an upload slot, not a thread; the remaining risk is synchronous SQLite calls blocking the event loop (R-3).
11. **Desktop edition + udev `UDISKS_IGNORE`** to suppress automount: unverified on this image (O-9).
12. **Content-pack lessons read-only on the bag (A-S1)**: removes the only two-writer case but limits admins; product confirmation needed.
13. **Progress coalescing** loses up to 10 s of video position by design; check it does not violate DD §2.6 expectations.
14. **FAT `rename` is not crash-atomic**; correctness of USB backups relies on manifest hashes and `LATEST.json` written last.
15. **Resource budget** (SYSTEM-ARCHITECTURE §11) is entirely assumption; please flag any figure you consider implausible.
16. **Conflicting facts across documents:** frontend `ARCHITECTURE.md` speaks of Raspberry Pi OS 12 / nginx 1.22 (container tests) and `sensebod.local`; the kit says nginx 1.26.3 on a 2026-10-06 image (brief: Debian 13) and `materials.sensebod.com`. I followed the kit. The nginx config was verified by Reviewer B only on 1.22 in a container.

## 3. How to reproduce the evidence

```bash
cd docs/system/poc
python3 -I poc_sqlite.py      # SQLite WAL behaviour (Mac numbers differ from a Pi)
TRIALS=60 python3 -I poc_export.py   # export protocol with kill -9 injection
TRIALS=90 python3 -I poc_export_v2.py   # revision 1: password outside the DB, worker restart, queued at boot, re-check
python3 -I poc_sync_epoch.py              # revision 1: epoch + counter lift (V-008), with a failing control
python3 -I ddl_check.py ../DATABASE.md   # executes the normative DDL, probes constraints
```

The scripts create `work/`, `work_export/` and `work_export_v2/` next to themselves; delete them afterwards.

## 4. Things I did not do
No Pi, phone, network or AP was touched. No frontend file was changed. No OpenAPI linter or Mermaid renderer was run. No capacity figure was measured on target hardware.
