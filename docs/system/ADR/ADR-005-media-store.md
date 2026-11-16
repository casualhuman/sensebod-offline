# ADR-005 — Content-addressed media files on the filesystem, served by nginx

**Status:** Proposed · 12 Nov 2026

**Decision.** Every media file is stored once at `/var/lib/sensebod-offline/media/c/<first 2 hex>/<sha256>.<ext>` (derived files under `d/`, unpacked animation packages under `tryit/<id>/`), immutable after creation, with metadata in the `blob` table. nginx serves `/media/` directly with byte ranges and a restrictive CSP; the database never holds file contents. Conversions use `ffmpeg`, `pdftoppm`; `.docx` is converted to Read text by the backend (unzip + XML parsing); no LibreOffice.

**Context.** Videos of tens to hundreds of MB; 3.3 GB of livestock videos already; Reviewer B's B-03 (uploads in the app origin under their own names); incremental USB backups; power loss during writes.

**Alternatives.** Files under original names (name collisions, script-capable extensions, B-03); BLOBs in SQLite (bloats the DB, slow backups, no `sendfile`); per-lesson folders (duplicates when a file is reused, renames on edits).

**Rationale.** A hash name is safe, unique, deduplicating, and lets backups copy only new files. Immutability means a file is either fully present under its final name or not at all (temp + fsync + rename). nginx `sendfile` is the cheapest way to stream video on the Pi.

**Trade-offs.** Hashing every upload (SHA-256 of 200 MB took 91 ms on the Mac; Pi unverified) and a GC pass for unreferenced files (24 h grace).

**Consequences.** API returns opaque `/media/c/…` URLs. Deleting a lesson does not delete files immediately. `.doc` (binary Word) is refused.

**Revisit when.** Media exceeds the card (move `media/` to an SSD; paths unchanged).
