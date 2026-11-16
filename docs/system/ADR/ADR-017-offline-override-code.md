# ADR-017 — Offline override code by challenge-response (not TOTP)

**Status:** Proposed · 13 Nov 2026 (revision 4, OWNER-3 and OWNER-4). The owner's request is in DESIGN-DECISIONS §7.3.

**Decision.** A locked-out admin gets back in with a **one-time override code** from EasySTEM, with no technician visit, using **challenge-response**:
- The bag shows a request code: key version, bag tag and a 40-bit random nonce.
- EasySTEM's offline tool computes a 50-bit code: an HMAC with the bag's secret over the bag id, the nonce and the username.
- The admin enters it, the bag checks it, and the admin must set a new password at once.

The rules:
- **Secret:** the per-bag secret is derived one-way from an EasySTEM office master key and provisioned onto the bag.
- **Expiry:** a request expires at the first of 72 h of accumulated bag uptime, 20 boots, or 72 h of trusted wall clock.
- **Use limits:** single use; 5 tries per request; each request bound to the browser that created it; no bag-wide pause; a ceiling of 2,000 network requests per 24 h of uptime with an unblockable USB-presence path (revision 5, V-030).
- **Audit:** every request, use and refusal is audited.

The same mechanism is the transport for the **online reset** (the normal path when the bag has internet): the bag sends the request to EasySTEM's reset service and receives the code itself. Full specification: SYSTEM-ARCHITECTURE §9.9; endpoints `/admin/override/*` in `openapi.yaml`.

**Context.** The owner wants "an override password that we can send to them, same how an authenticator app works … but with longer ttl". Bags are offline, their clocks can be wrong after power cuts (ADR-014), admins are on phones, and there is no technician nearby. Passwords are set by EasySTEM, and a normal reset happens only when the bag is online (DESIGN-DECISIONS §7.2).

**Alternatives.**
- *TOTP or HOTP (an authenticator app at EasySTEM).* TOTP needs agreed time. With a bag clock that can be days off, the window would have to be huge, and a code would be valid for every login in it, so it could be replayed. HOTP needs a counter that can drift on both sides. Neither binds a code to a request or makes it single-use.
- *A static master override password per bag.* It can be reused forever once told to anyone.
- *Codes signed with Ed25519 by EasySTEM.* Signatures are 64 bytes, far too long to read over a phone.
- *Technician-only reset.* The owner explicitly wants to avoid this.

**Rationale.** Challenge-response gives what the owner asked for: a code EasySTEM can send, valid "longer" (about 3 days), and no visit. It also adds single use, binding to one bag and one account, and independence from the bag's clock. 50 bits with at most about 10,005 guesses per day of uptime (revision-5 limits) gives about 8.9 × 10^-12 chance of a successful guess per day. Deriving the per-bag secret from a master means EasySTEM keeps no per-bag secret database, and a stolen card cannot mint codes for other bags.

**Trade-offs.**
- **Clock:** "72 h" is bag uptime, not calendar time. A bag that is on 4 h a day keeps a request open for up to about 18 calendar days, bounded at 20 boots.
- **Stolen card:** the thief can mint codes for that one bag, but already holds its data.
- **Social engineering:** the remaining risk is someone tricking EasySTEM into minting a code. EasySTEM's caller-verification procedure (O-17) and its mint log address it.
- **Master key:** the master is a high-value key; it is kept offline and in two places (O-11), and rotation needs rekeying of the bags.

**Consequences.**
- New items: the `override_request` table, `bag_meta.uptime_total_s`, `/var/lib/sensebod-offline/keys/override.key`, a provisioning bundle from `sensebod-offline-office provision-bag`, the `sensebod-offline-office override` command, the reset service (phase 2) and the screens in SYSTEM-ARCHITECTURE §9.9.
- Removed: local password reset by another admin. `updateAccount` no longer resets passwords.
- Tests: SEC-11, and `poc/poc_override.out`, whose control cases show that a reused code and expired codes are rejected.

**Revisit when.** Bags get regular connectivity (the online path becomes the norm), or the owner prefers a different code life.

**Revision 5 (13 Nov 2026).** V-030: the revision-4 bag-wide quotas let one phone on the Wi-Fi block recovery on 30 of 30 days (`poc/poc_override_dos.out`, control). Now each request is bound to the creating browser by an HttpOnly request-secret cookie, so nobody else can spend its tries. There is no bag-wide failure pause. A ceiling of 2,000 network requests per 24 h of uptime applies, and a **USB-presence path** (tap "I am at the bag", plug any stick) cannot be blocked from the Wi-Fi. Recovery succeeds on 30 of 30 days under attack; guessing stays ≈ 8.9 × 10^-12 per day at worst. V-031: EasySTEM's identity check is specified as a proposed procedure (per-hub enrolment record, call-back to registered numbers, two-person approval in defined cases, append-only office log; O-17), and every admin sees a banner after an override until a hub manager acknowledges it. V-032: the online reset service is store-and-forward. It holds no `M_v` and no `K_bag`, staff mint offline, the bag authenticates with its Ed25519 sync key, and the session goes only to the browser holding the request cookie. Every step is idempotent, so dropped connections are safe. V-034: attempts are committed before answering; `boot_seq` is a monotonic counter; the uptime counter is persisted at least every 5 minutes. V-036: a 128-bit `requestId` bound to the cookie; declined, send-failed and offline states; an optional "Choose your own password".

**Revision 5a (13 Nov 2026).** V-038: presence tokens are limited to 3 per hour per IP with no bag-wide cap, and an insertion is a USB block-device add event recorded by the root helper. Guessing bound: (2,000 + insertions × live tokens) × 5 per day, ≈ 6.2 × 10^-11 per day at 20 insertions and 600 live tokens. V-032: the bag's Ed25519 sync key is created at provisioning (private half on the bag only, public half registered at EasySTEM), and `openapi.yaml` describes the store-and-forward flow.
