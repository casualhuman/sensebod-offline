# API decisions: the frontend's proposed contract, item by item (deliverable D)

Version 0.4 · 13 Nov 2026 (revision 4: OWNER-2…6) · System Architecture Agent · status: **revision 2 (answers ARCHITECTURE-VERIFICATION-2; see REVISION-2-RESPONSE.md), awaiting reverification**

Input: `docs/API-CONTRACT.md` (proposed by frontend stream 1, built against the mock) and `app/src/shared/api/types.ts` (field-level source). Output: the confirmed contract `openapi.yaml` (OpenAPI 3.0.3, version 0.4.0; 53 paths, 66 operations, 91 schemas; parsed with Ruby's YAML loader, every `$ref` resolved, operationIds unique; not run through an OpenAPI linter, none was available offline).

Verdicts: **Adopted** (as proposed), **Amended** (kept, with changes listed), **Rejected** (replaced, with the replacement). Every amendment that needs frontend work is collected in §12 and in HANDOFF-PACKAGES FE-*.

Overall: the proposal is good and close to what the backend needs. It already gets the hard parts right for this deployment: same-origin relative paths, root-relative media URLs, raw-body uploads streamed to disk, `Idempotency-Key` on creates, whole-set `PUT` for questions and order with `409` on conflict, no learner list, `null` for unknowns, a single error shape. The amendments are about power loss, security on plain HTTP, Child protection, and the new export/backup requirement.

---

## 1. Rules for every endpoint (contract §1)

| # | Item | Verdict | Decision and reason |
|---|---|---|---|
| D-1.1 | Base path `/api/v1`, same origin, relative | **Adopted** | Works on any address the bag hands out (`10.10.0.1`, `10.20.0.1`, `materials.sensebod.com`). |
| D-1.2 | JSON UTF-8; raw body for uploads | **Adopted** | |
| D-1.3 | Ids: URL-safe strings, stable | **Amended** | Ids created on a bag are `<prefix>-<26 lowercase base32 chars>` = 128 random bits (`lr-` learner, `ls-` lesson, `se-` series, `up-` upload, `ex-` export, `pi-` picture, `ad-` admin). Shipped content keeps its slugs (`cp-child-staying-safe-1`). Unguessable and globally unique without coordination (ADR-016). The client treats ids as opaque. |
| D-1.4 | Root-relative URLs, never absolute | **Adopted** | Media URLs become content-addressed (`/media/c/ab/ab12…ef.mp4`); the client must not build media URLs itself (it does not today). |
| D-1.5 | `null` = not known | **Adopted** | The server never invents lengths or sizes. |
| D-1.6 | Durations in seconds, dates ISO 8601 UTC | **Amended** | Dates come from the bag's clock, which can be wrong after a power cut (ADR-014). Where a date matters to a person (exports, status) the answer also carries `clockTrust`. The client must not compare phone time with server time for any logic. |
| D-1.7 | `ETag` + `Cache-Control: no-cache` on content; `no-store` on learners/admin; 60 s client cache | **Adopted** | ETag is derived from `bag_meta.content_rev` (bumped by any change visible to learners) and the path; `If-None-Match` → `304` without touching JSON serialisation. |
| D-1.8 | gzip for JSON | **Adopted** | nginx `gzip on` for `application/json` (already in `app/deploy/nginx.conf`). |
| D-1.9 | `PUT`/`DELETE` idempotent; `Idempotency-Key` on creating `POST`s; server remembers keys ≥ 10 min | **Amended** | Keys kept **24 h** (a phone that lost power can retry the next morning); scoped by actor (admin id or `anon`) + method + path; the response is stored in the same transaction as the change, **except one-time secrets** (the export password is replaced by `null` and `passwordShown: true`; V-004); same key + different body → `422 idempotency_mismatch`; same key while the first is still running → `409 in_progress` + `Retry-After`. Required on `POST /learners`, `/admin/lessons`, `/admin/series`, `/admin/uploads/resumable`, `/admin/exports`; optional on single-request uploads and pictures. `DELETE` of something already deleted answers `204` when a tombstone exists (true idempotency), `404` if it never existed (now the same in `openapi.yaml`, V-011c). |
| D-1.10 | Paging `page`, `pageSize`, `total` | **Amended** | `pageSize` 1–100, default 25 (small answers for old phones; INS §13). |
| D-1.11 | Language codes | **Adopted** | |
| D-1.12 | Error body `ApiErrorBody`, status table | **Amended** | Adds: `403 forbidden` (role), `403 csrf`, `403 reauth_required`, `403 ticket_invalid`, `409 export_in_progress`/`offset_mismatch`/`in_progress`/`checking`/`sensitive_lesson`/`not_sensitive`/`pack_owned`, `422 names_need_usb`, `410 expired`, `412 precondition_failed`, `413 too_large`, `416`, `422 idempotency_mismatch`, `429 rate_limited`, `503 busy`/`maintenance` (with `Retry-After`), `507 storage_full` (with `details.neededBytes`, `details.availableBytes`). Every `message` stays a plain sentence safe to show. The frontend's generic handling covers most; `429`, `507`, `412` need specific words (§12). |
| D-1.13 | Client-side failures `network`/`timeout`/`aborted`; "never retries by itself" | **Amended** | Kept for ordinary calls. **Rejected for uploads and export downloads**: these must retry by themselves with backoff and resume (chunk offsets, `Range`), bounded (max 10 tries, ≤ 30 s apart), then show "Try again". Without it a phone that sleeps for a moment loses a 300 MB upload. |
| D-1.14 | (new) CSRF | **Added** | Every non-GET request carries `X-Sensebod-Offline-Client: 1`; one line in `client.ts` request headers and in the XHR upload. Reason: plain HTTP, cookie session, older browsers (§9.5 of SYSTEM-ARCHITECTURE). |

## 2. Content model (contract §2)

| # | Item | Verdict | Decision |
|---|---|---|---|
| D-2.1 | `Portal ─< Group ─< Series ─< Lesson`, quiz last with `position: null` | **Adopted** | Enforced in the database (DATABASE §6: one quiz per series, positions unique, published ⇒ placed). |
| D-2.2 | Five fixed portal ids, theme, `groupKind` | **Adopted** | A portal also has an internal `sensitive` flag (Child protection), not exposed. |
| D-2.3 | `availability: not-in-bag` | **Adopted** | |
| D-2.4 | Learner endpoints return only published, placed lessons | **Adopted** | Also: a lesson whose files are missing (after a restore) is unpublished automatically with an admin note. |
| D-2.5 | `icon` keys, unknown → portal icon | **Adopted** | `openapi.yaml` keeps `ContentIconKey` an open string so new keys never break an older app. |
| D-2.6 | `audience` | **Adopted** | |
| D-2.7 | Fix-round-1 fields optional in `types.ts` | **Amended** | The server always sends them; `openapi.yaml` marks them **required**. `types.ts` may keep them optional until streams 3–4 merge, as the contract says. |
| D-2.8 | Lesson data tag fields and the automatic type rule | **Adopted** | Implemented in `media` (SYSTEM-ARCHITECTURE §5.4). `.doc` (old binary Word) is refused with "Save it as PDF or .docx"; `.docx` becomes typed Read text; PDF becomes page images. |

## 3. Learner content endpoints (contract §3)

| # | Endpoint | Verdict | Notes |
|---|---|---|---|
| D-3.1 | `GET /portals` | **Adopted** | p95 < 100 ms target (unverified). |
| D-3.2 | `GET /portals/{id}` | **Adopted** | |
| D-3.3 | `GET /groups/{id}` | **Adopted** | |
| D-3.4 | `GET /series/{id}` incl. `group.seriesCount` | **Adopted** | One query per table, no N+1. |
| D-3.5 | `GET /lessons/{id}` with `content` by type, `next` | **Adopted** | |
| D-3.6 | Quiz `correct`/`feedback` sent to the client | **Adopted** | Deliberate (DD §2.5); no stakes. |
| D-3.7 | `listenUrl` recorded narration, never TTS | **Adopted** | |

## 4. Save my progress (contract §4)

| # | Endpoint / rule | Verdict | Decision |
|---|---|---|---|
| D-4.1 | `POST /learners` + `Idempotency-Key` | **Amended** | Id format of D-1.3; `Idempotency-Key` required; rate limit 30/min per IP; name trimmed 1–40 characters, control characters removed. |
| D-4.2 | `GET /learners/{id}` | **Adopted** | |
| D-4.3 | `DELETE /learners/{id}` removes learner and progress | **Amended** | Hard delete with a `tombstone` (id only) for later collection (SYNC.md), in a transaction with `secure_delete=ON` (V-013); `204` again if already deleted, `404` if it never existed. Open point 4 (anyone who knows the id can delete) is **accepted** as the product's trade-off: ids are unguessable, never listed, rate-limited. |
| D-4.4 | `GET /learners/{id}/progress` | **Amended** | Never returns lessons in Child protection while the bag records counts only. |
| D-4.5 | `PUT /learners/{id}/progress/{lessonId}` | **Amended** | **Revision 1 (V-001, V-009):** the frontend never calls it for a Child protection lesson; the server answers `409 sensitive_lesson` and writes nothing if it does. Child protection uses the new anonymous `POST /lessons/{lessonId}/activity {event: opened|finished, viewId}` (no learner id, works for guests, de-duplicated per page view so pauses and retries do not inflate counts, rate-limited to 10/min per address, stored in a separate file without any sequence number so it cannot be ordered against personal data; DATABASE §6.4, V-019, V-023). The v0.1 field `recorded` is **withdrawn** (it carried the learner id onto the wire). Position-only updates within 10 s of the stored position and < 60 s after the last write are coalesced (no write; stored row returned). `finished` never downgrades (as proposed). `correct ≤ total` validated. |
| D-4.6 | `GET /learners/{id}/continue` | **Amended** | Never offers a Child protection lesson in counts-only mode. |
| D-4.7 | No `GET /learners` | **Adopted** | Confirmed; the export works from the server side (hub manager only), never from a learner endpoint. |
| D-4.8 | Guests save nothing | **Adopted** | |

## 5. Admin session (contract §5)

| # | Item | Verdict | Decision |
|---|---|---|---|
| D-5.1 | Cookie session, `HttpOnly`, `SameSite=Strict`, `Path=/` | **Amended** | Cookie name `sb_admin`; no `Secure` flag (plain HTTP, ADR-004); random 256-bit token, only its SHA-256 stored; idle expiry 2 h, absolute 12 h, **and every session ends when the bag restarts** (V-012); bound to the client IP (setting `session.bind_ip`, default on; a phone that moves between hotspot and AP signs in again). |
| D-5.2 | `POST /admin/session` | **Amended** | Lockout after 5 failures (1 min, doubling to 15 min) and nginx 5/min per IP → `429 rate_limited`; generic "Wrong name or password". `AdminSession` gains `role` (`hub_manager`/`admin`) and `mustChangePassword`. |
| D-5.3 | `GET`/`DELETE /admin/session` | **Adopted** | |
| D-5.4 | Mock credentials `admin`/`sensebod-offline` | **Rejected for bags** | Never present on a bag: provisioning creates the first hub manager with a random temporary password that must be changed (SYSTEM-ARCHITECTURE §9.4). |
| D-5.5 | (new) `POST /admin/session/confirm`, `POST /admin/session/password` | **Added** | Re-authentication (5 minutes) for exports with names and account changes; own password change. |

## 6. Admin content (contract §6)

### 6.1 Library
| # | Item | Verdict | Decision |
|---|---|---|---|
| D-6.1a | `GET /admin/lessons` with filters, `unplaced`, `search` | **Adopted** | `search` is a case-insensitive `LIKE` over title, placement label and file names; at hundreds of lessons no full-text index is needed. |
| D-6.1b | `GET /admin/lessons/{id}`, `GET /admin/portals` | **Adopted** | |
| D-6.1c | `GET /admin/storage` | **Amended** | Adds `availableBytes`, `reserveBytes`, `state: ok | low | full`; `breakdown` labels: Lessons (media), Smaller copies, Uploads waiting, Database, Downloads waiting on the bag, Saved copies (snapshots). `null` values remain allowed until measured. |
| D-6.1d | `AdminLesson` | **Amended** | Adds `version` (integer) for optional optimistic concurrency (D-6.3c). |

### 6.2 Upload
| # | Item | Verdict | Decision |
|---|---|---|---|
| D-6.2a | One raw-body request per file, not multipart | **Adopted for small files** | Kept for files ≤ 16 MiB (`POST /admin/uploads`). Streaming the body to disk is right. |
| D-6.2b | The same single request for any size (`client_max_body_size 2g`) | **Rejected** (open point 2) | A 300 MB upload over the bag's Wi-Fi from a phone that may sleep, while the Pi may lose power, must not restart from zero. Replacement: **resumable chunked upload** (ADR-006): `POST /admin/uploads/resumable` `{fileName, sizeBytes, mimeType, smallerCopy}` → `Upload {state: receiving, receivedBytes: 0, chunkBytes}`; `PUT /admin/uploads/{id}/bytes` with `Content-Range: bytes a-b/total` and ≤ 4 MiB of raw body (2 MiB recommended, so a slow phone re-sends less after a drop and holds an upload slot for less time; V-010); the server `fsync`s, commits `receivedBytes`, answers; a wrong offset → `409 offset_mismatch` with the server's `receivedBytes`; `GET /admin/uploads/{id}` tells a returning phone where to continue. Max file size 2 GiB (policy). `file.slice()` + XHR progress works on the Chrome 58 floor. **Transition:** until the frontend ships it, the backend accepts single requests up to 2 GiB (config `uploads.single_max_bytes`), then drops to 16 MiB in the first backend release after FE-3 is merged and before any field bag gets it. |
| D-6.2c | `X-File-Name` header | **Amended** | Used for display and search only; files are stored under content-addressed generated names with an extension from an allow-list (closes Reviewer B's B-03 at the naming level). |
| D-6.2d | `Upload` shape, `kind`, `becomes`, `processing`, `checks` | **Amended** | Adds `state` (`receiving`/`processing`/`ready`/`failed`/`abandoned`) and `receivedBytes`; `processing` kept. Polling every few seconds kept; server sends no faster hint than 3 s. Unaccepted kinds → `415` as proposed. H5P → `415` with the board's message unless an H5P player is installed. |
| D-6.2e | `DELETE /admin/uploads/{id}` | **Adopted** | Also deletes a `.part` file of an unfinished upload. |
| D-6.2f | Space check | **Added** | Declared size + reserve vs free space before accepting → `507 storage_full`. |

### 6.3 Lessons
| # | Item | Verdict | Decision |
|---|---|---|---|
| D-6.3a | `POST /admin/lessons` by `source` → draft, `placement: null` | **Adopted** | |
| D-6.3b | Placement inserts and renumbers; quiz stays last | **Adopted** | One transaction (DATABASE §6.2). |
| D-6.3c | `PATCH /admin/lessons/{id}` any subset | **Amended** | Optional `If-Match: "v<version>"`; mismatch → `412 precondition_failed` ("Someone else changed this lesson. Look at it again."). Without the header the server applies the patch (backwards compatible); the frontend should send it from editing screens. Lessons with `source: content-pack` (now in the `LessonSource` enum, V-011a): only placement, picture and publish state may change; other fields → `409 pack_owned` (SYNC A-S1, V-011b). Placing a lesson into Child protection deletes learners' saved progress on it (V-014c). |
| D-6.3d | `publish` (409 `not_placed`) / `unpublish` | **Amended** | Publishing also refuses (`409 conflict`) a lesson whose files are missing or still `processing` with no playable source. |
| D-6.3e | `DELETE /admin/lessons/{id}` renumbers | **Amended** | Learners' progress on that lesson is deleted with it (cascade); files are removed by garbage collection after 24 h unreferenced. The confirmation text should say "Learners' progress on this lesson will be removed." |
| D-6.3f | Fields `type`/`interactive` override, `blocks`, `transcript` | **Adopted** | |

### 6.4 Pictures
| # | Item | Verdict | Decision |
|---|---|---|---|
| D-6.4a | `GET /admin/pictures` with suggestions | **Adopted** | "Suggested" = same portal's group + title word match; at most 3. |
| D-6.4b | `POST /admin/pictures?alt=` raw body | **Amended** | JPEG, PNG, WebP only, ≤ 10 MiB; **no SVG** (script risk, Reviewer B B-03); `alt` required (422). |
| D-6.4c | "Use a frame from the video" | **Deferred** | Feasible later as a worker job (`ffmpeg -ss`), needs a design (contract open point 6). |

### 6.5 Series and order
| # | Item | Verdict | Decision |
|---|---|---|---|
| D-6.5a | `GET /admin/series/{id}`, `POST /admin/series` | **Adopted** | |
| D-6.5b | `PUT /admin/series/{id}/order` with every id once; `409` on mismatch | **Adopted** | Exactly the transaction in DATABASE §6.2. |

### 6.6 Questions and Try it
| # | Item | Verdict | Decision |
|---|---|---|---|
| D-6.6a | Whole-set `PUT` of questions; validation; `wrong_type` | **Adopted** | Stored as one JSON column (DATABASE §6.1). |
| D-6.6b | Try it setup (package or hotspots), `sceneUploadId` | **Adopted** | The backend accepts `sceneUploadId` and `audioUploadId` (REQUESTS.md notes the mock refused a new scene sent this way; the backend must not). |
| D-6.6c | Package sandbox rules | **Adopted with a documented limit** | Packages run with `connect-src 'none'` (no fetch of their own files, no web fonts, no modules: Reviewer B B-05). The admin check text says so. |

## 7. The mock (contract §7)
**Adopted as a development tool**, not part of the contract. The mock must gain the new endpoints and behaviours of this document so the frontend can build the screens before the backend exists (HANDOFF FE-2).

## 8. Seed observations (contract §8)
Content questions for the owner and subject experts, not API decisions. No change.

## 9. The frontend's open points (contract §9), answered

| # | Open point | Answer |
|---|---|---|
| 1 | Confirm the whole contract | Confirmed with the amendments above; `openapi.yaml` is now the reference. Changes go through `docs/team/REQUESTS.md` as before, and `openapi.yaml` is updated with them. |
| 2 | Raw body vs multipart; max size; resumable | Raw body confirmed; max 2 GiB; resumable for > 16 MiB (D-6.2b). |
| 3 | Admin accounts, password rules, session lifetime, throttling, reset | Roles `hub_manager`/`admin`; ≥ 10 characters, common-password list; idle 2 h / absolute 12 h; 5 failures → lockout + nginx limit; reset by another hub manager or by the technician CLI (SYSTEM-ARCHITECTURE §9.4). The board's "[How to reset — confirm]" becomes: "Ask your hub manager, or EasySTEM." |
| 4 | Anyone can create/delete a learner | Accepted trade-off with unguessable ids, rate limits, no list (D-4.3). |
| 5 | Conversions, H5P | Worker media lane; codecs and bitrate to be tested on real phones (SYSTEM-ARCHITECTURE §5.4); H5P refused until a player is chosen. |
| 6 | Frame from video; Learners and progress; Storage and backup; Settings | Frame: deferred. Storage and backup: endpoints now exist (exports, USB, status, storage). Learners and progress: only `GET /admin/learner-data/summary` is defined; a learner list for admins waits for the screen design (no feature invented here). Settings: accounts, clock, power-off endpoints exist for the designer to draw. |
| 7 | Krio delivery | Out of scope (owner question O-5). |
| 8 | Content-change signal | ETag from `content_rev` (D-1.7). |

## 10. New endpoints (not in the frontend's proposal)

| Endpoint | Why | Who |
|---|---|---|
| `GET /health` | nginx, monitoring, reach checks | anyone |
| `POST /admin/session/confirm`, `POST /admin/session/password` | re-auth, own password | admin |
| `POST /admin/uploads/resumable`, `PUT /admin/uploads/{id}/bytes` | ADR-006 | admin |
| `POST /lessons/{lessonId}/activity` | anonymous, de-duplicated Child protection counts (V-009) | anyone |
| `GET /admin/learner-data/summary` | counts for the export screen | hub manager |
| `POST/GET /admin/exports`, `GET/DELETE /admin/exports/{id}`, `POST …/download-link`, `GET …/file`, `POST …/checks` (replaces v0.1 `…/verified`: `stage: received|saved`, V-006) | owner requirement (DATA-EXPORT-AND-BACKUP.md) | admin or hub manager (OWNER-6) |
| `GET /admin/usb`, `POST /admin/usb/eject`, `POST /admin/usb/check`, `POST /admin/usb/format`, `POST /admin/usb/packages/{name}/install` | USB export, backup, stick format (V-007), updates, content packs | admin / hub manager |
| `GET /admin/status` | monitoring, banners | admin |
| `POST /admin/override/requests`, `GET …/{id}`, `POST …/{id}/send-online`, `POST /admin/override/redeem` | offline override code and online reset (OWNER-3/4, ADR-017) | anyone (rate-limited); the redeem result is a restricted session |
| `POST /admin/learner-data/clean` | cleaning on demand after seeing the last export (OWNER-5, ADR-018) | hub manager |
| `GET /admin/audit` | "who exported what and when" | hub manager |
| `GET/POST /admin/accounts`, `PATCH /admin/accounts/{id}` | account provisioning, revocation | hub manager |
| `POST /admin/clock` | wrong clock after power loss (ADR-014) | hub manager |
| `POST /admin/power-off` | fewer hard power cuts | hub manager |

Restore is deliberately **not** an endpoint (technician CLI; DATA-EXPORT §12).

## 11. Rejected, in one list

1. One request for any upload size (→ resumable, D-6.2b).
2. Uploaded files served under their original names in the app's origin (→ content-addressed names + `/media/` sandbox CSP, D-6.2c).
3. "The client never retries by itself" for uploads and export downloads (→ bounded automatic resume, D-1.13).
4. Child protection progress stored per learner, or sent with a learner id at all (→ anonymous activity counts, D-4.5, ADR-009).
5. Mock credentials on a bag (D-5.4).

## 12. What the frontend must change (summary; details in HANDOFF-PACKAGES)

1. `X-Sensebod-Offline-Client: 1` on every non-GET (`client.ts`, upload XHR).
2. Resumable uploads for > 16 MiB with automatic resume; show "Keep this page open" (already on the boards).
3. Child protection: call `POST /lessons/{id}/activity {event, viewId}` (view id from `crypto.getRandomValues`, one per page view) instead of `saveLessonProgress`, never send a learner id from a Child protection screen; no progress chips, "N of M done" or "continue" there; navigate with `location.replace` so Back history does not keep those lesson addresses, and give every Child protection screen the neutral page title "Sensebod Offline" so the history list does not show lesson titles (V-014d; the history may still record addresses — documented limit).
4. Specific messages for `429`, `507 storage_full`, `412` (lesson changed), `503 maintenance`; the 503 `message` from nginx can be shown as is (Reviewer B noted it is currently replaced).
5. Send `If-Match` from lesson editing screens.
6. Use `role` to hide hub-manager-only tiles; `mustChangePassword` → change-password screen.
7. Storage and backup screens per DATA-EXPORT-AND-BACKUP §16: export flow (names → USB by default, `422 names_need_usb`, override warning), one-time password and the "already shown" replay, in-page download (≤ 16 MiB) with incremental JS SHA-256, "Received and checked" → save → **Check the saved file** → "Downloaded and checked", new link after `403 ticket_invalid` with an in-place sign-in dialog on `401` that keeps the received chunks (V-022), `409 checking`, USB states incl. format, rotation hint, "not removed safely".
10. Upload chunks of 2 MiB (D-6.2b).
8. Extend the mock with every new endpoint and error.
9. Never print `sensebod.local` for learners; the site address is `http://materials.sensebod.com`.

## 13. Revision 4 (owner decisions)

Roles are `hub_manager` and `admin` (OWNER-6, assumption). Both may export; only `hub_manager` cleans learner data and manages accounts. `PATCH /admin/accounts/{id}` no longer resets passwords: resets are online or by override code (OWNER-3/4). `POST /admin/session/password` accepts a missing `currentPassword` only in the restricted override session. `GET /admin/learner-data/summary` gains `lastExportAt`, `lastExportKind`, `unexportedLearners`, `retentionDays`, `nextAutomaticRemoval` and `retentionHeldBack`. The UI's default export is `backup-records`, labelled "Export for EasySTEM" (OWNER-5). The frontend contract change goes to `docs/team/REQUESTS.md` through the frontend's normal process. I do not edit it from here.
