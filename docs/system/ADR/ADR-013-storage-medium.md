# ADR-013 — microSD (high-endurance) + off-bag backups now; SSD as an upgrade path

**Status:** Proposed · 12 Nov 2026

**Decision.** Keep the kit's microSD (256 GB) for now; production bags should use a high-endurance card from a known brand, carry a cloned spare card, and rely on off-bag backups (USB) for card failure. A Pi 5 NVMe SSD (PCIe HAT) is the upgrade path when media exceeds ~70 % of the card, or field tests (PL-1) show the card losing acknowledged writes or wearing out. Paths do not change (`/var/lib/sensebod-offline` can move to the SSD by mount).

**Context.** INS §7.4; kit hardware; unknown card endurance and flush behaviour; bag form factor and power budget.

**Alternatives.** SSD now (more cost and power, another part in a bag; consumer SSDs also usually lack power-loss protection); industrial SD (expensive, availability).

**Rationale.** Writes are low (DATABASE §4, SYSTEM-ARCHITECTURE §11.4); the main risk is sudden death, which only off-device copies solve. PL-1 measures whether the card honours flushes.

**Trade-offs.** If PL-1 fails (acknowledged writes lost), the durability promise depends on a hardware change.

**Consequences.** Spare card procedure in the technician guide; "card may be failing" banner on I/O errors.

**Revisit when.** PL-1 results, or the first field card failure.
