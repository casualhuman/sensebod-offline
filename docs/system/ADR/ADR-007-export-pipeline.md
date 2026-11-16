# ADR-007 — Exports: snapshot → atomic file → nginx-served ranged download with tickets → client-side SHA-256

**Status:** Proposed · 12 Nov 2026 · revised 13 Nov 2026 (revision 1)

**Decision.** As specified in DATA-EXPORT-AND-BACKUP.md: a data-lane job takes a `VACUUM INTO` snapshot, builds the file from the snapshot into `exports/.tmp/`, `fsync`s it, renames it into `exports/`, `fsync`s the directory, and only then commits the `ready` row with size and SHA-256. Downloads are authorised by the API and served by nginx through `X-Accel-Redirect` (ranges, ETag), via a 30-minute HMAC ticket URL bound to the current boot that works without cookies. The admin screen downloads in 1 MiB ranges, resumes after drops, hashes incrementally in JavaScript ("Received and checked"), saves the file, and then asks the admin to **Check the saved file**; only a matching hash of the saved file gives "Downloaded and checked". A browser-download fallback uses the same saved-file check.

**Context.** Owner requirement (consistency while in use, no half-written export presented as complete after power loss, resumable and verifiable download to a phone over HTTP).

**Alternatives.** Streaming the export directly in the HTTP response (no resume, no checksum before download, holds a backend request handler for the whole transfer, half-sent file on power loss); copying the live DB file (inconsistent with WAL); generating synchronously in the request (timeouts on the Pi); trusting the browser's download manager alone (no check, behaviour unknown on old Android).

**Rationale.** The database row as the single "ready" switch, placed after durable rename, makes every crash point recoverable by a simple boot rule (PoC: 60/60 random kills kept the invariants). nginx is the right component to serve ranges efficiently. Web Crypto is unavailable over HTTP, so hashing must be pure JS.

**Trade-offs.** The in-page mode holds the file in phone memory (capped at 16 MiB by policy until P-6 measures phone memory); `Blob` saving on Chrome 58 Android is unverified (test BR-3). Tickets in URLs (never logged; one file; 30 min).

**Consequences.** An `export` table, a one-at-a-time rule, boot recovery steps, nginx internal location, JS SHA-256 in the admin chunk.

**Revisit when.** HTTPS exists (Web Crypto, service-worker-managed downloads) or exports exceed the in-page limit routinely.

**Revision 1 (13 Nov 2026).** V-006: the v0.1 flow showed "Downloaded and checked" for bytes in memory, before the browser had (or had not) written the file; the state now requires a check of the saved file, the in-page limit is 16 MiB until P-6 measures phone memory, and chunks are kept as `Blob`s. V-017: after an unclean boot `ready` exports are `checking` until re-hashed. V-012: tickets are bound to the boot. V-004: the password never enters SQLite (tmpfs file), and queued jobs are interrupted at boot. Evidence: `poc/poc_export_v2.out`.

**Revision 2 (13 Nov 2026).** V-022: because sessions end at every boot, a download resumed after a reboot first gets `401` for its new link; the page shows an in-place sign-in dialog and keeps the received chunks (no navigation), test DL-6.
