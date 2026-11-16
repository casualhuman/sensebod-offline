# ADR-019 — Two admin roles: hub manager and admin (assumption)

**Status:** Proposed · 13 Nov 2026 (revision 4, OWNER-6). **This is an unconfirmed assumption (O-15).**

**Decision.** The design keeps two roles.
- `hub_manager` may do everything.
- `admin` may manage content and export or back up data, but cannot clean learner data, manage accounts, format USB sticks, set the clock, install updates or read the audit log.

These replace v0.1–v0.3's `lead` and `facilitator`, and in the new split exporting moves to `admin` too. If the owner says the two are the same person, every account is created as `hub_manager` and nothing else changes.

**Context.** The owner mentions both "admin" and "hub manager" (DESIGN-DECISIONS §7.6) without saying whether they differ.

**Alternatives.**
- *One role.* It loses the ability to stop a content editor from deleting all learner data.
- *Fine-grained permissions.* More than the product needs.

**Rationale.** It takes little extra effort, the default is reasonable, and it is reversible by configuration of accounts.

**Consequences.** `admin_account.role` is `hub_manager | admin`; `x-auth` values in `openapi.yaml` are `admin` / `hub-manager`. Tests: SEC-1, SEC-12.
