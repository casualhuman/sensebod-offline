# Architecture verification 5: revision 4 (owner decisions OWNER-2 … OWNER-6)

13 Nov 2026 · Independent System Architecture Best Practices Verification Agent · Stage 5 of §30

**Scope.** Revision 4 (`REVISION-4-RESPONSE.md`, used only as a map), checked against the owner's answers in `docs/DESIGN-DECISIONS.md` §7.

New and changed material reviewed:
- SYSTEM-ARCHITECTURE §9.4 and **§9.9**, T-17, §14 (SEC-11, SEC-12);
- **ADR-017** (offline override code), **ADR-018** (learner-data retention), **ADR-019** (two roles), and ADR-009/014;
- DATABASE `override_request`, `bag_meta.uptime_total_s`, §7;
- DATA-EXPORT **§8.1** and §16.1, §14, §12;
- SYNC §3.2 and **§6.3b**;
- `openapi.yaml` 0.4.0 and `poc/poc_override.py`.

I also checked for regressions of V-001 … V-029.

**Evidence** (`docs/system/reviews/evidence/v6/`). Everything was measured on the Mac; nothing ran on a Pi, a phone or the network. Nothing was looked up about EasySTEM's real infrastructure.

| File | What it shows |
|---|---|
| `architect-poc-rerun-v6.out` | Re-ran from a copy: `poc_override.py` (all cases as stated), `ddl_check.py` (24 + 3 tables), and the regression PoCs: `poc_export_v2` (60 trials, invariants held, 0/61 passwords), `poc_cp_unlink`, `poc_sync_epoch` (5a/5b), `poc_lock_wait` default (7 ms / 6 ms) |
| `verify_override_attacks.py/.out` | **New**, built on the architect's classes:<br>**A1** short boots that never persist uptime: the 20-boot cap still ends the request (bound = 72 h + 20 × 5 min).<br>**A2** an attempt counter not committed before the reply allows unlimited guesses on one request.<br>**A3** with the documented **global** quotas, one phone on the Wi-Fi denied the real hub manager on **30/30 days**.<br>**A4** with per-request limits and no global pause the hub manager recovers on 30/30 days, and the guessing bound stays negligible |
| `roles.out` | `x-auth` of every admin and override operation in `openapi.yaml` 0.4.0 (53 paths, 66 operations) |
| `doc-greps-v6.txt` | The lines cited below |

---

## A. Executive assessment

Revision 4 applies the owner's decisions faithfully and keeps the earlier design intact.
- Child protection option A is now Accepted.
- EasySTEM sets the admin password at deployment, and the normal reset is online.
- The "authenticator-like" override with a longer life is realised as challenge-response (a good translation of the owner's wish).
- Export goes to EasySTEM by default.
- Learner data is kept two months, and can be cleaned on demand with a last-export warning.
- The two roles are marked as an assumption.

**The cryptographic core of ADR-017 is sound.**
- 50-bit codes with at most 15 guesses per day of uptime: ≈ 1.3 × 10^-14 per day.
- The HMAC is bound to bag, nonce and username; the per-bag secret is derived one-way from the master.
- Expiry uses persisted uptime and a boot cap, never the bag's clock.
- I re-ran the PoC and added attack cases. The boot cap defeats a "never persist uptime" power-cycling attack (A1), and a stolen card cannot mint codes for other bags.

The weaknesses are around the crypto, not in it:
1. **The global quotas let anyone on the Wi-Fi deny recovery indefinitely** (V-030, measured 30/30 days).
2. **The only control on the main abuse path, EasySTEM minting a code for a caller, is left wholly to an undefined procedure** (V-031).
3. **The online reset service leaves open who approves, where the key lives, and who receives the restricted session** (V-032).
4. **Automatic removal of children's data now depends on the wall clock**, which a hub manager can set from a phone. One wrong tap forward can delete learners early, including unexported ones (V-033).

None of these needs a redesign. All are specification changes.

**The bag does not gain an internet dependency.** The online reset is optional, and the offline override plus the technician CLI remain. NFR-1 and OFF-1 still hold. **Role model:** `openapi.yaml` `x-auth` matches §9.4 and ADR-019. Leftovers in a test and the threat table are listed in V-035. **No regression** of V-001 … V-029 was found.

**Recommendation:**
- **On paper: REVISIONS REQUIRED.** This is limited to ADR-017/018 and their sections: four Medium findings, text-only. The rest of the architecture stays as approved with conditions in verification 4.
- **Formal status: INSUFFICIENT EVIDENCE** until P-1, P-3, P-4 and P-6 run.
- **After both: APPROVED WITH CONDITIONS.** See H.

---

## B. Review matrix

| Category | Result | Basis |
|---|---|---|
| Requirements coverage | **Partial** | Owner decisions §7.1–7.6 traced; §7.3 recovery can be denied (V-030); §7.5 removal timing depends on an unguarded clock (V-033) |
| Offline independence | **Pass** | Online reset optional; offline override and CLI remain; OFF-1 unaffected |
| Raspberry Pi feasibility | **Not Verified** | Unchanged (P-1, P-3, P-5) |
| Backend architecture | **Pass** | New module pieces fit the existing model |
| Database architecture | **Pass** | `override_request` and retention fields consistent; DDL re-runs; V-034 notes |
| Data consistency | **Pass** | Retention writes tombstones; exported defined by `snapshot_seq` |
| Synchronisation | **Partial** | §6.3b reset service under-specified (V-032) |
| API design | **Partial** | New endpoints consistent with DATABASE; request-to-session binding for the online path missing (V-032); UI/error gaps (V-036) |
| Networking | **Partial** | Unchanged kit-side items |
| Security | **Partial** | Override crypto sound; V-030, V-031, V-032; V-035 threat-table leftovers |
| Reliability and recovery | **Partial** | Recovery of a locked-out admin can be denied (V-030); A2 persistence rule (V-034) |
| Deployment and updates | **Pass** | Provisioning bundle specified |
| Monitoring and diagnostics | **Pass** | Override events audited; V-031 asks for a visible banner |
| Maintainability | **Pass** | Buttons and single commands; no command line for admins |
| Testing strategy | **Partial** | SEC-11/SEC-12 good; add the DoS, persistence, clock-jump and caller-verification cases; fix SEC-E1 (V-035) |

---

## C. Detailed findings

### C.1 Offline override code (ADR-017): verification walk-through

| Check | Result | Evidence |
|---|---|---|
| **Online guessing** | **Pass.** 50 bits; per request 5 tries; at most 15 failures per 24 h of uptime: ≈ 1.3 × 10^-14 per day. Even 1,000 guesses a day would be ≈ 9 × 10^-13 per day, so the quotas are much tighter than entropy needs, which is what makes V-030 avoidable | PoC case 7; A4 |
| **Replay** | **Pass.** A code is bound to a nonce, single-use, and marked `used` in the same transaction as the password change | PoC case 2 |
| **Expiry without a trusted clock** | **Pass, with a stated bound.** Expiry is the first of 72 h of persisted uptime or 20 boots; wall-clock expiry applies only if the clock was trusted at both ends. **A1:** 4-minute boots never persist uptime, yet the request dies at 20 boots. Real bound: 72 h + 20 × 5 min of uptime. This holds only if the boot is counted (committed) before the API serves, and if the boot count cannot go down (V-034). A power cut during a redemption commits all or nothing | PoC case 3; A1 |
| **Attempt counter under power cuts** | **Needs a rule (V-034).** If a wrong attempt is answered before it is committed, a physical attacker can cut power after each guess (A2). Low impact, because physical access already gives the card | A2 |
| **Stolen card** | **Pass.** `K_bag` lets the thief mint codes for that bag only (PoC case 6); `M_v` is not derivable; the office refuses revoked bags. Residual: someone who **copies** the card and returns it unnoticed keeps a way into that bag until it is rekeyed. Mitigated if override use is made visible (V-031) | PoC case 6 |
| **Master key custody and rotation** | **Partial.** Offline machine, passphrase, second copy, separate from the other keys, versioned, rekeying described. Two concerns: (a) the second copy is stored **with** the backup private keys, so one compromised safe yields both; prefer a separate place or split custody. (b) The online reset service contradicts "only on the offline machine" unless approval stays offline (V-032) | §9.9 table |
| **EasySTEM tool** | **Partial.** It checks the bag tag and revocation, logs every mint and refuses foreign request codes. **It records no verification of the caller** (V-031) | PoC case 4 |
| **Endpoints** | **Partial.** Four unauthenticated `/admin/override/*` operations with the CSRF header; `redeem` returns `401`/`410`/`423`/`429`; it never enumerates accounts. Gaps: the online path does not say **who** receives the restricted session (V-032); `requestId` entropy is not specified (V-036) | `roles.out`, openapi |
| **UI states** | **Partial.** Normal, wrong, expired, paused, too-many and new-password states exist. Missing: "EasySTEM declined", "Could not reach EasySTEM", "Offline: read the code instead" (the 503 `offline` case), and a banner for other admins after an override (V-031, V-036) | §9.9 UI table |
| **Social engineering** | **Not specified (V-031).** "Identity checks on the caller … are EasySTEM's procedure, outside the bag" (O-17). An impersonator on the bag's Wi-Fi who knows the username can become `hub_manager` with one phone call | §9.9 |

### C.2 Other owner decisions

| Item | Result |
|---|---|
| Online reset service (OWNER-3) | No essential journey depends on the internet (**Pass**). The service itself is under-specified (V-032) |
| Retention, 61 days after last activity (OWNER-5) | The rule, reminders from day 45, tombstones and `secure_delete` are sound. The clock dependency is unguarded (V-033). On bags without an RTC battery the `restored` clock lags real time, so removal comes **later** than two months (acceptable; state it). Interpreting "two months" as "after last activity" is correctly flagged to the owner |
| Manual cleaning with the last-export warning | **Pass.** Last export date and kind are shown; **Export first / Remove anyway**; password + `CLEAN` + `acknowledgeUnexported`; local `auto-*` snapshots dropped. `pre-update`/`pre-restore`/`corrupt` copies keep their 30/30/90-day limits, as stated |
| Option B recommendation (O-16) | **Reasonable.** It is bounded (≤ 91 days) and gives a visit a second chance; it is correctly left to the owner, with B as default |
| Roles (`hub_manager` / `admin`) | `openapi.yaml` `x-auth` is consistent with §9.4 and ADR-019 (`roles.out`): accounts, audit, clock, clean, USB format/check/install are `hub-manager`; exports, backups, eject and power-off are `admin`. Leftovers: V-035 |
| Regressions V-001 … V-029 | **None found.** Re-ran PoCs pass. The override audit holds usernames of admins, not learners. Override requests live in the main DB, which goes into encrypted backups only; `override.key` is excluded from backups, logs and diagnostics |

### C.3 New findings

#### V-030: Anyone on the Wi-Fi can deny the override indefinitely through the global quotas
- **Severity:** Medium
- **Affected:** SYS §9.9 (rate limits and lockout); ADR-017; `openapi.yaml` `createOverrideRequest`, `redeemOverride`; DATABASE `override_request`
- **Problem.** The quotas are bag-wide: 3 new requests per 24 h of uptime, 3 open at once, and 15 failures pause the override for 24 h of uptime. Request creation and redemption are unauthenticated by necessity, and nginx allows 3 requests per hour per IP. One phone can use all three requests and all 15 failures each day.
- **Evidence.** `verify_override_attacks.out` A3: the hub manager recovered on 0 of 30 days. A4: with per-request limits and no global pause, 30 of 30.
- **Impact.** The owner's offline recovery path (§7.3) can be switched off by a learner with a script. The bag then needs the online path or a technician, which is exactly what the owner wanted to avoid.
- **Correction.** Spend the entropy budget on availability.
  1. Keep 5 tries per request.
  2. Drop the bag-wide pause, or raise it to a value that keeps the bound negligible (e.g. 1,000 failures per 24 h uptime ≈ 9 × 10^-13 per day).
  3. Limit open requests **per username** generously (e.g. 20), and never let one client's new request void or displace another's.
  4. Keep the per-IP nginx limit.
- **Validation.** SEC-11 adds a DoS case: one client at the maximum rate for 7 days; the real user's request redeems every day; the guessing bound is recomputed from the final limits.

#### V-031: Caller verification before minting a code is not specified, and an override is not visible to other admins
- **Severity:** Medium
- **Affected:** SYS §9.9 (EasySTEM tool, stolen card), T-17; ADR-017 Trade-offs; O-17; HANDOFF SYNC-3
- **Problem.** A code makes its holder `hub_manager`: all learner data, exports, accounts, cleaning. The only control between a caller and a code is "EasySTEM's procedure, outside the bag". The owner question O-17 is right about the policy, but the **mechanism** belongs to the architecture: what the tool records, what it requires, and what the bag shows afterwards.
- **Correction.**
  1. **Registry:** each bag's hub-manager contact (phone number or channel) is recorded at provisioning.
  2. **Tool:** `sensebod-office override` refuses to print a code until the operator records the verification method, normally **calling back the registered contact** (never a number given by the caller); the code is read only on that call. The mint log carries the verification method and the staff member. A second staff confirmation is required when the registered contact cannot be reached.
  3. **Bag:** after an override, all admin screens show a banner for 14 days: "An EasySTEM override code was used for [username] on [date]. If this was not you, call EasySTEM." The next export manifest carries the audit event.
  4. Optional: show the bag-tag check result to the operator.
- **Validation.** SEC-11 adds: a code is not printed without a recorded verification; the banner is visible to a second admin account; the mint log has every field.

#### V-032: The online reset service: approval, key custody and session binding are undefined
- **Severity:** Medium
- **Affected:** SYNC §6.3b; SYS §9.9 (online row, master key row); `openapi.yaml` `sendOverrideRequestOnline`, `getOverrideRequest`, `redeemOverride`
- **Problem.**
  1. "EasySTEM approves, and the code comes back to the bag." If the service computes the code, it needs `K_bag`, and so `M_v`, online. That contradicts "M_v only on the offline office machine" and turns one internet-facing service into a mint for every bag. If staff mint offline and paste the code in, the service only carries a message, and the documents should say so.
  2. The bag "redeems it itself (the person is asked to set a new password)", but nothing binds the restricted session to the browser that created the request. Any client that knows or guesses the `requestId` could complete it.
  3. Approval needs the same caller verification as V-031.
- **Correction.**
  1. State that the service never holds `M_v` or any `K_bag`: approval is a staff action on the offline tool (V-031 rules), and the service only stores and forwards the code. If automation is ever wanted, that is a new ADR with its own custody rules (HSM, separate master).
  2. Request creation sets an HttpOnly, `SameSite=Strict` cookie holding a random request secret; completing a request (online or by code) requires it. `requestId` is ≥ 128 bits.
  3. The bag verifies the code locally, as now.
- **Validation.** SEC-11 adds: a different client with the `requestId` but not the cookie cannot complete; the service's deployment contains no master key (review checklist).

#### V-033: Automatic learner removal trusts a wall clock that a hub manager can set from a phone
- **Severity:** Medium
- **Affected:** DATA-EXPORT §8.1; DATABASE §7; ADR-018; ADR-014 (`POST /admin/clock`); `ClockTrust`
- **Problem.**
  - Removal runs whenever the clock is not `unsure`. `synced`, `rtc` and `restored` all count, and a phone-set time is not distinguished.
  - A hub manager who taps "Use this phone's time" on a phone whose date is months ahead, which happens on offline phones with wrong dates, makes every learner look inactive for more than 61 days. Removal starts that night.
  - Option B holds unexported data only 30 more days on the same wrong clock: a jump of more than 91 days deletes unexported children's data that EasySTEM never received.
  - ADR-014 says no security check depends on the wall clock across boots, but this destructive action now does, and the ADR does not mention it.
- **Correction.**
  1. Record a manual time as `clock_trust = manual`.
  2. After any forward step of more than 7 days (manual or detected at boot), suspend automatic removal for 7 days of uptime. Show the hub manager "[n] learners would be removed because the date moved forward by [d] days. Is the date right?" with **Yes, remove** / **Fix the date**.
  3. Bound each daily run, for example at most 10 % of learners per day without confirmation.
  4. State in ADR-014/ADR-018 that retention is the one wall-clock-dependent destructive action, and how it is guarded.
- **Validation.** Retention unit tests: setting the clock +1 year removes nothing without confirmation; a gradual real two months removes as specified; the `restored` lag delays removal but never advances it.

#### V-034: Override persistence rules needed for the expiry and attempt limits to hold
- **Severity:** Low
- **Affected:** SYS §9.9; DATABASE `override_request`, `bag_meta.uptime_total_s`, `boot`
- **Problem.**
  - (a) Each wrong attempt must be committed before the `401` is sent (A2).
  - (b) "Number of boot rows" can decrease if `boot` rows are ever pruned or come back from a snapshot. A snapshot restore changes the epoch and voids requests, but pruning does not.
  - (c) The boot row must be committed by boot-recover before the API serves (A1's bound depends on it).
  - (d) The PoC models none of these.
- **Correction.** A monotonic `bag_meta.boot_seq`, incremented and committed by boot-recover before the API starts, used instead of a row count. Attempts and state are committed before answering. State the uptime-persist interval as binding.
- **Validation.** SEC-11 on a Pi: a power cut right after a wrong code still counts it; 20 short boots expire a request.

#### V-035: Role-rename leftovers in tests and the threat table
- **Severity:** Low
- **Affected:** DATA-EXPORT §18 SEC-E1 ("as facilitator → 403"; under ADR-019 an `admin` may export, so the expected result is now 200 for `admin` and 403 only for anonymous clients or tickets); DATA-EXPORT §11 diagram ("Lead admin"); SYS T-10 ("`hub_manager` role, re-auth for names, audit readable by leads")
- **Problem.** Exports moved to the `admin` role, but the test and the threat control still assume the old split.
- **Correction.** Update SEC-E1 to the new matrix, including names: an `admin` may export names after re-auth, which follows the owner's "the admin exports". Rewrite T-10 as "re-auth for names, names to USB by default, audit readable by hub managers, override banner (V-031)".
- **Validation.** SEC-1 role matrix generated from `x-auth`.

#### V-036: Small gaps in the override UI and API
- **Severity:** Low
- **Affected:** SYS §9.9 UI table; `openapi.yaml` `OverrideRequest`, `getOverrideRequest`
- **Problem.**
  - No states for "EasySTEM declined", "Could not reach EasySTEM" or `503 offline`.
  - The `requestId` format is not specified, and `GET /admin/override/requests/{id}` is unauthenticated.
  - With no forced change, EasySTEM keeps knowing every bag's `hub_manager` password. That is the owner's choice, but it makes EasySTEM's password store as sensitive as `M_v`.
- **Correction.** Add the three states. Make `requestId` ≥ 128 random bits and bind it to the request cookie (V-032). Offer, but do not force, "Choose your own password" after the first sign-in, and record EasySTEM's password-store custody next to O-11.
- **Validation.** FE screen tests; contract test of `requestId` format.

---

## D. Missing architectural decisions

1. Availability-preserving override limits (V-030).
2. Caller-verification mechanism in the tool, and the override banner (V-031).
3. Custody and approval model of the reset service, and the request-to-session binding (V-032).
4. Guard on clock-driven removal (V-033).
5. Owner questions still open: O-15 (roles), O-16 (A/B/C), O-17 (EasySTEM's caller policy, which V-031 gives a mechanism to). Kit-side items are unchanged.

## E. Complexity assessment

Proportionate. Challenge-response is the smallest scheme that meets the owner's "send a code, longer life" without a clock. It needs one table, one key file, one office command, and an optional central endpoint. The two roles cost little, and collapsing them is configuration. The corrections above add rules, not components.

## F. Resource and capacity assessment

No material change. The override and retention add one small table and daily maintenance batches of ≤ 500 rows within the R-3H budget. All Pi figures remain unmeasured (P-1, P-3).

## G. Required revisions (text only)

1. **V-030:** per-request limits, no global pause (or a high cap), per-username open requests, no displacement; SEC-11 DoS case.
2. **V-031:** registered contact in the registry, verification recorded by the tool before printing, 14-day override banner, mint-log fields.
3. **V-032:** the reset service holds no keys; approval offline; a request-bound cookie; `requestId` ≥ 128 bits.
4. **V-033:** `clock_trust = manual`, suspend and confirm after a forward jump, a per-run cap; ADR-014/018 updated.
5. **V-034 … V-036:** monotonic `boot_seq` and commit-before-answer; SEC-E1/T-10/diagram leftovers; UI states, `requestId` format, password-store custody.

Hardware evidence, unchanged: **P-1, P-3, P-4, P-6**.

## H. Final decision

**On paper (design): REVISIONS REQUIRED.** This is limited to the revision-4 features (ADR-017 override and online reset, ADR-018 retention). Four Medium findings, V-030 to V-033, are text-only. Everything verified up to verification 4, V-001 to V-029, remains closed, and that part of the architecture remains approved with conditions on paper.

**When V-030 to V-033 are corrected:** APPROVED WITH CONDITIONS on paper. The Low findings V-034 to V-036 may be closed alongside.

**Formal status today: INSUFFICIENT EVIDENCE.** P-1, P-3, P-4 and P-6 have not run.

**When P-1, P-3, P-4 and P-6 pass, with the corrections above in place:** APPROVED WITH CONDITIONS. The remaining conditions are implementation-phase tests: P-2, P-5, P-7, USB-3, DB-6, PL-1…7, BR-1/3, DL-1…6, SEC-1/7/8/9/10/**11/12**, EX-9 and BK-3.
- If **P-4 fails**, ADR-013 changes first.
- If **P-3** is slow, revisit ADR-002 first.

**Not verified by me:** anything on a Pi, phone, stick, AP or the network; EasySTEM's office machine or the reset service (neither exists); the owner's procedures.

---

## Round 7 (revision 5)

13 Nov 2026 · Re-verification of V-030 … V-036 against the documents themselves (`REVISION-5-RESPONSE.md` used only as a map).

**Evidence** (`evidence/v7/`, Mac only):
- `architect-poc-rerun-v7.out`: re-ran from a copy `poc_override_dos.py`, `poc_retention_clock.py`, `poc_override.py`, `ddl_check.py` (26 + 3 tables) and the regression set: `poc_export_v2` (40 trials, 0/41 passwords), `poc_cp_unlink`, `poc_sync_epoch` 5a/5b, `poc_lock_wait` default (7/9 ms). All match the architect's figures.
- `verify_retention_intermittent.py/.out` (new; uses the architect's `run_day()` unchanged): a bag with a **trusted** clock, on 7 days and off 23 days each month.
- `doc-greps-v7.txt`: the cited lines.

### Questions asked

**V-030: the "I am at the bag" path**
- *Abuse from the Wi-Fi.* Anyone can tap it (`POST /admin/override/presence`), but it only yields the tapper's **own** cookie-bound presence request, and only if a stick is physically inserted while their token is live. It cannot touch the person's request.
- *Blocking it.* Not possible as specified: there is no cap on live tokens, so the person's token is always honoured, and an attacker cannot insert a stick.
- *Riding on someone else's insertion.* **Yes.** An attacker who keeps refreshing tokens gets presence requests whenever anyone inserts a stick for any reason (backup, content install), and these are exempt from the 2,000 ceiling. The odds stay negligible: each yields 5 guesses at 2^-50. But the presence endpoint has **no stated rate limit**, so "plus a few presence requests" is not a bound (V-038 below).
- *Exhausting storage.* Network requests are capped at 2,000 per 24 h of uptime, and rows are kept 30 days after they end: about 60,000 rows, a few MB. That is acceptable. Presence tokens and requests are unbounded until V-038 adds a per-IP limit.
- *The 8.9 × 10^-12 per day figure.* **Arithmetic checked:** 10,005 / 2^50 = 8.9 × 10^-12; × 365 = 3.2 × 10^-9 per year; one phone at 72 requests/day × 5 = 360 guesses → 3.2 × 10^-13. It holds only if presence requests are bounded too (V-038).
- **Re-run:** control 0/30, fix 30/30, in both attack scenarios.

**V-031: caller verification and the banner**
- **Office tool.** It refuses to print a code without a recorded verification. The procedure behind it is proposed and correctly left to the owner (O-17): enrolment record, call-back to a registered number only, two-person approval in the risky cases, append-only log.
- **Bag.** The banner is shown to every admin until a hub manager acknowledges it. The overridden account may acknowledge only if it is the only hub manager. Every "Export for EasySTEM" carries the audit, so EasySTEM sees each use even if the banner is cleared.
- **Residual (note only).** An attacker who became a hub manager could disable the other hub managers first and then acknowledge alone. The export backstop covers it. Optionally, keep the banner for at least 72 h regardless of acknowledgement.

**V-032: the online reset service**
- **Design: closed.** SYS §9.9, SYNC §6.3b and HANDOFF SYNC-4 agree:
  - the service stores and forwards only, with no `M_v`, `K_bag` or signing key;
  - approval is by staff, under the V-031 rules;
  - steps are idempotent by `requestId`, and a fetched but unacknowledged code is returned again;
  - completion is bound to the browser holding the request cookie.
- **No internet dependency.** The bag polls only while it has an uplink. Normal use and the offline path never need the internet (NFR-1/OFF-1 unchanged).
- **Remaining inconsistencies (Low):**
  - (a) `openapi.yaml` `sendOverrideRequestOnline` still describes the revision-4 flow ("an HMAC with its override secret", "redeems it itself") and has `x-auth: none` instead of `request-cookie`.
  - (b) The bag's **Ed25519 sync key**, now needed in phase 1 for the reset service, is defined only in the phase-2 sync section. Provisioning (§9.4, §10.5, `sensebod-office provision-bag`) does not create it or register its public key in the registry.

**V-033: retention under clock changes**
- **Re-run:** a phone date one year ahead removes 0 learners (control: 100, including 50 unexported); confirmation removes only exported learners, at most 10 % a day; normal aging is unchanged; a lagging clock delays removal.
- **Bypass.** No path to early deletion was found. Steps under 7 days are not recorded, but they also cannot advance removal by more than 7 days each, and repeated manual steps are audited and listed under `clockChanges`.
- **Kept too long? Yes, and much too long.** Guard 2 records **every** forward step over 7 days "from any source", including the boot step of a bag with a **trusted** RTC that was simply switched off. Guard 3 subtracts those days from unexported learners; guard 4 subtracts them from exported learners until each jump is confirmed. For a bag used 7 days a month with an RTC battery (`verify_retention_intermittent.out`):
  - an exported learner is removed on real day **245** instead of 61 (if nobody confirms each monthly jump);
  - an unexported learner is removed on real day **390** instead of 91, whatever is confirmed.
  - For a bag used one day a month this becomes years: effectively "kept forever".

  Intermittently used bags are exactly where data stays unexported. This contradicts the owner's "kept for two months" (DESIGN-DECISIONS §7.5). The bound is in the wrong direction for children's privacy.
- **Correction.** Subtract only jumps that are **not** explained by a trusted clock: `manual`, or detected with no RTC or NTP backing. A step where the boot reads the RTC (`rtc`) or NTP synchronises (`synced`) is real elapsed time and counts. Keep guards 3–5 for manual and unexplained steps. **Validation:** the variant "trusted-clock jumps not subtracted" in the same script removes on day 61 / 91 as intended, and the architect's C1 case still removes 0.

**V-034 … V-036.** Closed against the documents:
- monotonic `bag_meta.boot_seq`, committed before the API starts; attempts committed before the answer;
- SEC-E1, T-10 and the §11 diagram updated (no "as facilitator", "Lead admin" or "readable by leads" left);
- the declined, send-failed and offline UI states added; `requestId` is 128 bits and cookie-bound; O-18 added.

### New finding

#### V-038: The presence endpoint has no rate limit, so the guessing bound is not a bound
- **Severity:** Low
- **Affected:** SYS §9.9 (path the attacker cannot block; online guessing bound); `openapi.yaml` `startOverridePresence`
- **Problem.** Tokens are unlimited, and presence requests are exempt from the ceiling. Any stick insertion, including a routine backup, gives every token holder a presence request. Tokens must also be held somewhere to check "live at insertion", so their storage is unbounded too.
- **Correction.** Rate-limit token creation per IP (e.g. 3/hour, the same as request creation). Do **not** cap live tokens bag-wide, so the person cannot be crowded out. Define an "insertion" as a USB block-device *add* event recorded by the root helper (any filesystem, not only vfat/exfat), and record it. Restate the bound as 2,000 × 5 + (insertions per day × tokens live per 2 minutes × 5); it remains well below 10^-10 per day.
- **Validation.** SEC-11: 200 addresses requesting tokens continuously while a stick is inserted 5 times; count presence requests and guesses; the person's request redeems.

### Status table

| ID | Sev. | Round 6 (v5 report) | **Round 7** |
|---|---|---|---|
| V-030 | Med | Open | **Closed** (presence-path limits moved to V-038) |
| V-031 | Med | Open | **Closed** (procedure with the owner, O-17) |
| V-032 | Med | Open | **Partially closed**: Low remainder (openapi `send-online` stale; sync key not provisioned) |
| V-033 | Med | Open | **Partially closed**: **Medium remainder** (trusted-clock jumps subtracted, so data is kept for many months on intermittently used bags) |
| V-034 | Low | Open | **Closed** |
| V-035 | Low | Open | **Closed** |
| V-036 | Low | Open | **Closed** |
| V-038 | Low | — | **New, Open** |

V-001 … V-029: **no regression** (re-run PoCs unchanged; no Django or Python-backend decision returned).

### Final decision (round 7)

**On paper (design): APPROVED WITH CONDITIONS.** No Critical or High finding is open, and the override, the online reset and the role model are sound. One condition, as with V-026 in round 3:
- **The V-033 remainder (Medium) must be corrected** before the backend implements retention (BE-6/maint): count trusted RTC/NTP clock steps as real time.
- The Low items (V-032 remainder, V-038) may be closed alongside or during implementation.

**Formal status today: INSUFFICIENT EVIDENCE.** P-1, P-3, P-4 and P-6 have not run.

**When P-1, P-3, P-4 and P-6 pass** (with the V-033 condition met): **APPROVED WITH CONDITIONS**. The conditions are the implementation-phase tests: P-2, P-5, P-7, USB-3, DB-6, PL-1…7, BR-1/3, DL-1…6, SEC-1/7/8/9/10/11/12, SEC-E4, EX-9, BK-3.
- If **P-4 fails**, ADR-013 changes first.
- If **P-3** is slow, revisit ADR-002 first.

---

## Round 8 (revision 5a)

13 Nov 2026 · Re-verification of V-032, V-033 and V-038 against the documents themselves (the "Revision 5a" section of `REVISION-5-RESPONSE.md` was used only as a map).

**Evidence** (`evidence/v8/`, Mac only):
- `architect-poc-rerun-v8.out`: re-ran from a copy `poc_retention_clock.py`, including the new C4 case (control 245/390; revision 5a 61/91; hand-set steps still 245/390; a manual +1 year still removes 0), plus my v7 `verify_retention_intermittent.py`, `poc_override_dos.py` and `ddl_check.py` (27 tables). All reproduced.
- `verify_presence_bound.py/.out`: the V-038 bound recomputed with address rotation.
- `doc-greps-v8.txt`: the cited lines.

### V-033: can "RTC/NTP-backed" be faked?

- **From the hub-manager UI: not directly.** `POST /admin/clock` runs `sensebod-clock@`, which marks the time `manual` and records a forward step of more than 7 days as a `clock_jump`. There is no UI path that produces `rtc` or `synced`.
- **Residual (Low): the ordering between stepping the clock and recording the jump is not specified.** The helper writes the system time and `clock.json`; the API records the jump.
  - If power is lost after the helper steps the time but before the API commits the `clock_jump` row, the manual jump leaves no record.
  - If the implementation sets the time with `timedatectl set-time`, which also writes the RTC, the next boot reads that RTC and can classify the step as `rtc`, which is trusted.
  - Either way a hand-set date can be **laundered** into real time, after which removal proceeds at up to 10 % a day.
  - **Correction:** commit the jump row (`pending`) **before** invoking the helper and finalise it after; at boot a `pending` row counts as `manual`. `clock.json` records the source of the last set, and an RTC value that came from a manual set inherits `manual`. Say whether the helper writes the RTC.
- **A rogue NTP server on the bag's Wi-Fi: not feasible.** The Pi has static addresses, takes no DHCP or router advertisements on its own networks, has no default route offline and does not resolve upstream names (`no-resolv`). Its NTP queries never reach the Wi-Fi LAN.
- **Residual (Low): NTP over an uplink.** On the uplink network, plain NTP is unauthenticated, so an on-path attacker there could forge a `synced` step forward.
  - **Correction:** count a `synced` forward step of more than 7 days only if a battery-backed RTC agrees, or if NTS or at least two independent servers agree; otherwise record it as `unexplained`.
- **Status:** the condition from round 7 (trusted steps count as real time) is **met**. V-033 is **Closed**. The two residual paths need privileged or uplink-side access and are tracked as Low **V-039**.

### V-038: does the bound survive address rotation?

**No.** The stated bound assumes about 200 addresses (the DHCP pool). On the bag's networks a client can choose **any** address in either subnet:
- nginx keys `limit_req` on `$binary_remote_addr`;
- nothing ties an address to a lease or a MAC, and MACs are freely changeable too.

| Assumption | Live tokens | Success per day |
|---|---|---|
| Stated: about 200 addresses, 20 insertions | 600 | 6.2 × 10^-11 |
| Both /24s, 20 insertions | 1,515 | **1.4 × 10^-10** |
| Both /24s, insertions capped at 4/hour | 1,515 | 6.5 × 10^-10 |
| Both /24s, 1,000 insertions (someone at the bag) | 1,515 | 6.7 × 10^-9 |

All are still negligible. The figure is wrong, but the security conclusion is unchanged.

**What the bound should be keyed on:**
1. **The size of the reachable address space** (two /24s, about 505 addresses), never the DHCP pool or MACs.
2. **A bag-wide cap on the insertions it honours** for presence (e.g. 4 per hour). Without it, insertions are an assumption, not a limit.

A bag-wide cap on live tokens must **not** be added, as it would let an attacker crowd out the person.

**Status:** V-038 is **Partially closed** (Low). Required: restate the bound as (2,000 + honoured insertions × 3 × reachable addresses) × 5, and add the insertion cap. `poc_override_dos.out` also still prints the old "≤ 10,005 guesses" line.

### V-032

**Closed.** All documents agree:
- `openapi.yaml` 0.5.1 `sendOverrideRequestOnline` now has `x-auth: request-cookie` and describes the store-and-forward flow, signed with the Ed25519 sync key, minted offline, and completed only by the browser holding the cookie.
- The sync key is created on the bag by `sensebod-admin provision` (SYS §10.5, §9.6 secrets row, SYNC §6.2, HANDOFF DEV-2/SYNC-3). The private half stays at `keys/sync_ed25519`, `0600`; **EasySTEM holds only the public key**, registered with `sensebod-office register-bag-key`.
- A new card gets a new key, and a stolen bag's key is revoked.

### New finding

#### V-039: A hand-set date can be laundered into "trusted" time, and plain NTP over an uplink is trusted
- **Severity:** Low
- **Affected:** DATA-EXPORT §8.1 guard 2; SYS §9.8 `sensebod-clock@`; ADR-014
- **Problem and correction:** see the V-033 discussion above.
  - (a) Commit a `pending` jump row before stepping the clock; record the source in `clock.json`; an RTC value set by hand is `manual`.
  - (b) A `synced` forward step of more than 7 days counts only with RTC agreement, NTS, or at least two servers agreeing.
- **Validation:** SEC-E4 adds a power cut between the clock set and the API commit (the jump is still guarded after boot), and a forged NTP step on a test uplink (recorded as `unexplained`).

### Status table

| ID | Sev. | Round 7 | **Round 8** |
|---|---|---|---|
| V-032 | Low remainder | Partially closed | **Closed** |
| V-033 | Medium remainder (the condition) | Partially closed | **Closed** (residual paths moved to V-039, Low) |
| V-038 | Low | Open | **Partially closed** (bound must be keyed on address space plus an insertion cap) |
| V-039 | Low | — | **New, Open** |

All other findings V-001 … V-037 are closed; there was no regression in the re-run PoCs.

### Final decision (round 8)

**On paper (design): APPROVED WITH CONDITIONS.** No Critical, High or Medium finding is open, and the round-7 condition (V-033) is met. The remaining items, V-038 and V-039, are Low and text-only, and may be closed during implementation (BE-4 and the clock helper in DEV-4).

**Formal status today: INSUFFICIENT EVIDENCE.** P-1, P-3, P-4 and P-6 have not run.

**When P-1, P-3, P-4 and P-6 pass: APPROVED WITH CONDITIONS.** The conditions are the implementation-phase tests: P-2, P-5, P-7, USB-3, DB-6, PL-1…7, BR-1/3, DL-1…6, SEC-1/7/8/9/10/11/12, SEC-E4, EX-9, BK-3.
- If **P-4 fails**, ADR-013 changes first.
- If **P-3** is slow, revisit ADR-002 first.
