# ADR-011 — Signed release bundles, A/B release folders, pre-update snapshot, journaled update

**Status:** Proposed · 12 Nov 2026 · revised 13 Nov 2026 (revision 1)

**Decision.** Releases are tar bundles signed with OpenSSH signatures (`ssh-keygen -Y sign -n sensebod-offline-release`), verified on the bag against `/etc/sensebod-offline/allowed_signers`. They unpack to `/opt/sensebod-offline/releases/<version>/`; `/opt/sensebod-offline/current` is switched atomically; `/var/www/sensebod-offline/current` points into it so the frontend's nginx root is unchanged. The updater journals each step (SYSTEM-ARCHITECTURE §10.6), snapshots the DB before migrating, health-checks after switching and rolls back automatically before the bag reopens. Content packs use the same signature mechanism (namespace `sensebod-offline-content`).

**Context.** Field updates by USB, possibly by a hub manager from a phone; power can fail mid-update; schema migrations are not always reversible.

**Alternatives.** Debian packages (`dpkg` is not atomic across power loss for multi-file app trees and needs maintainer scripts); A/B root partitions (RAUC/Mender: robust but large change to the kit's imaging); minisign/GPG (new tools); unsigned bundles (anyone with a stick could install code).

**Rationale.** `ssh-keygen` is already on every Pi; release folders + symlink switch is the pattern the frontend already uses (FA §12); a journal makes every power-cut point resumable.

**Trade-offs.** OS packages are not covered (technician re-image); irreversible migrations need a restore to roll back.

**Consequences.** CI signs releases with an offline key; `release.json` declares migration reversibility; expand/contract migration discipline (DATABASE §10).

**Revisit when.** Fleet size makes full image updates (A/B partitions) worth it.

**Revision 1 (13 Nov 2026).** V-016: step 5 installs each system file as temp + fsync + rename (previous copies remain in the previous release folder); an interrupted step 4 has one rule — re-run `migrate` (transactional, skips applied migrations) and continue, restoring the pre-update snapshot only if it fails (with an epoch increment); field bundles carry no `.deb` files (system packages only by technician or master image; `release.json` declares `requires_packages`).

**Revision 3 (13 Nov 2026).** V-028: step 6 also runs the release self-check, which loads every native module, opens both databases through the driver, and does one write and one `VACUUM INTO`. A failure triggers the automatic rollback. V-029: `allowed_signers` holds namespace-restricted keys for releases, content packs and the bag registry, rotated with `valid-after`/`valid-before`.
