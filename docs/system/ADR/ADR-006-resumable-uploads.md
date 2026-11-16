# ADR-006 — Resumable chunked uploads above 16 MiB

**Status:** Proposed · 12 Nov 2026 · revised 13 Nov 2026 (revision 1)

**Decision.** Files ≤ 16 MiB may be sent in one raw-body request (frontend contract as proposed). Larger files use `POST /admin/uploads/resumable` + `PUT /admin/uploads/{id}/bytes` with `Content-Range` chunks of 2 MiB recommended (max 4 MiB). The server appends each chunk to `uploads/.partial/<id>.part`, `fsync`s it, then commits `received_bytes`; the database value is authoritative and boot recovery truncates the file to it. A wrong offset gets `409 offset_mismatch` with the server's offset. Completion: SHA-256 computed, file renamed into the content store, `blob` + `upload` committed, inspection job queued. Max 2 GiB.

**Context.** "A 34 MB video is normal; hundreds of MB possible", weak Wi-Fi, phones that sleep, a Pi that may lose power (DD §3.2). The frontend's single-request design restarts from zero on any failure.

**Alternatives.** tus protocol (standard, but a client library adds weight to the 60 KB chunk budget and server support depends on a third-party library in any runtime); single request with `Idempotency-Key` only (safe but wasteful: a failure at 95 % repeats everything over a ~1–5 Mbps share of Wi-Fi); multipart (buffers, no resume).

**Rationale.** A tus-like minimum (offset query + ranged append) is ~100 lines on each side, works with `file.slice()` and XHR on Chrome 58, and keeps every confirmed byte across power loss.

**Trade-offs.** One `fsync` per 4 MiB chunk (cheap relative to Wi-Fi time). Frontend work (HANDOFF FE-3). A transition period with large single requests still allowed (config flag).

**Consequences.** Upload state `receiving` exists; abandoned partials are removed after 24 h; storage is checked against the declared size before the first byte.

**Revisit when.** Real-phone tests show chunk overhead matters (tune chunk size).

**Revision 1 (13 Nov 2026).** V-010: smaller chunks so a phone on a slow share of the Wi-Fi re-sends less after a drop and holds an upload slot for ≈ 10–20 s instead of up to a minute; the 2 GiB single-request transition ends in the first backend release after the frontend's resumable upload ships (before any field bag). A separate backend process for uploads was considered and not adopted until CON-1 (4 concurrent uploaders) shows learner p95 above 300 ms.

**OWNER-1 (13 Nov 2026).** With the owner's Node.js/Express runtime an upload chunk does not hold a server thread (asynchronous I/O); the backend must still stream each chunk to disk with back-pressure, `fsync` it before answering, and cap concurrent upload streams (SYSTEM-ARCHITECTURE §4.1 R-1).
