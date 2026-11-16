# ADR-004 — Plain HTTP (Mode A); no HTTPS in phase 1

**Status:** Proposed · 12 Nov 2026

**Decision.** The bag serves everything over `http://` on port 80. No service worker, no secure-context APIs, no `Secure` cookies. Security controls are designed for an unencrypted LAN (SYSTEM-ARCHITECTURE §9).

**Context.** Learners' own old Android phones; bags offline for months; the kit's HTTPS plan needs DNS-01 at Hostinger and internet to renew Let's Encrypt certificates (KIT App. H; validity ~90 days today and announced to shorten further — check current CA/Browser Forum rules); identical certificate keys on every cloned bag; phones with wrong clocks reject certificates; old phones may not trust newer roots.

**Alternatives.**
- *Public certificate for `materials.sensebod.com` (DNS-01):* expires while the bag is offline → a hard browser error, worse than HTTP; the private key on every bag.
- *Private CA installed on phones:* not realistic for learners' own devices; Android 7+ apps ignore user CAs by default and Chrome shows warnings for some setups.
- *Self-signed certificate:* warnings every time; teaches users to click through warnings.
- *HTTPS only for admin:* same certificate problem for the admin's phone.

**Rationale.** A certificate that cannot be renewed offline makes the site fail closed; HTTP keeps every phone working. The real risks of HTTP (T-2 sniffing, CSRF) are reduced by design: per-bag strong passwords, IP-bound short sessions, CSRF header, rate limits, audit, encryption of every file that leaves the bag.

**Trade-offs.** A determined person on the Wi-Fi who captures the WPA2 handshake can read admin passwords and session cookies (the PSK is shared with all learners). Accepted and documented as the main residual security risk.

**Consequences.** Web Crypto is unavailable → a pure-JS SHA-256 in the admin chunk; uploads use `<input capture>`; no Mode B.

**Revisit when.** Bags get regular uplinks (phase 2) *and* a renewal process is staffed, or admins move to a managed device where a private CA can be installed.
