# ADR-015 — Pi provides DHCP/DNS; external AP in bridge mode; site name `materials.sensebod.com`

**Status:** Proposed · 12 Nov 2026 (keeps the kit's decisions)

**Decision.** Keep the kit's network: NetworkManager hotspot "Offline Library" on `wlan0` (`10.10.0.1/24`), dnsmasq for DHCP and DNS (`no-resolv`, only `materials.sensebod.com` answered with the interface's own address), external AP on `eth0` (`10.20.0.1/24`, `dnsmasq-eth`) in bridge mode with its DHCP off; no forwarding; nftables input filter (SYSTEM-ARCHITECTURE §7). Phones use `http://materials.sensebod.com` (or the IP printed on the card); `.local` names are for technicians.

**Context.** Kit facts and scripts; IIAB review warns that IIAB would replace this network; old Android does not resolve `.local` (Android < 12, unverified on target phones).

**Alternatives.** AP as DHCP server (two DHCP servers risk; the Pi would need a static address from the AP); captive-portal style "answer every DNS name" (Android may flag the network as captive and change routing; not tested); IIAB networking (does not support the external AP on Raspberry Pi OS per its wiki).

**Rationale.** Working, tested in trials (hotspot), simple, one DHCP server per segment.

**Trade-offs.** Two dnsmasq instances until merged (kit "Open"); phones with mobile data may misroute (instruction card, test NET-2).

**Consequences.** DevOps writes the "start at boot" final state (kit: not written yet).

**Revisit when.** AP model chosen and tested (kit Step 15), or real-phone tests show DNS problems.
