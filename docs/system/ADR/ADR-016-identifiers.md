# ADR-016 — Prefixed 128-bit random ids for records created on a bag

**Status:** Proposed · 12 Nov 2026

**Decision.** Records created on a bag get `<prefix>-<26 lowercase RFC 4648 base32 characters>` encoding 128 bits from `secrets.token_bytes(16)` (130 bits of space, top 2 bits zero). Prefixes: `lr` learner, `ls` lesson, `se` series, `up` upload, `ex` export, `jb` job, `pi` picture, `ad` admin, `tp` Try it package. Shipped content keeps its slugs. The bag itself has a random `bag_id` (UUID4). Audit events use a local integer id (never a cross-bag key; the office keys them by `(bag_id, epoch, id)`).

**Context.** Learner ids are the only protection of a learner's progress (no password, DD §2.1); records are created independently on many bags (INS §7.6); ids appear in URLs.

**Alternatives.** UUIDv4 (fine, longer, hyphens; same entropy); ULID/UUIDv7 (time-ordered: leaks creation time and relies on clocks); integers (guessable, collide across bags).

**Rationale.** Unguessable, globally unique without coordination, URL-safe, short, type visible to humans debugging.

**Trade-offs.** Random keys scatter B-tree inserts (irrelevant at this size).

**Consequences.** `CHECK (id LIKE 'lr-%' AND length(id) = 29)` on learners; OpenAPI patterns; the learner code in exports is a 6-character prefix of the random part (not reversible to the full id).

**Revisit when.** Never expected.
