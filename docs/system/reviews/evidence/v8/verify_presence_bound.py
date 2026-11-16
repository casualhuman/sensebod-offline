"""V8 check of the V-038 guessing bound (SYS §9.9): guesses per 24 h uptime <= (2,000 + insertions x live tokens) x 5.
The architect assumes ~200 addresses (the DHCP pool) and <= 20 insertions/day. On the bag's networks a client can
pick ANY address in the subnet (static assignment; nginx keys limit_req on $binary_remote_addr; nothing ties an
address to a DHCP lease or a MAC). Reachable addresses: 10.10.0.0/24 (hotspot) and 10.20.0.0/24 (AP), minus the
Pi and the AP's management address. Tokens: 3 per hour per address, all of which may be live in the same 2 minutes.
Insertions are physical; the count is an assumption unless the bag caps how many insertions it honours.
Run: python3 -I verify_presence_bound.py"""
P = 2 ** -50
def bound(addresses, insertions, label):
    live = 3 * addresses
    g = (2000 + insertions * live) * 5
    print(f"{label:62} live tokens <= {live:5}, guesses/day <= {g:>9,}, success <= {g * P:.1e}/day")
bound(200, 20, "architect: 200 addresses, 20 insertions/day")
bound(253 + 252, 20, "rotating over both /24s (static addresses), 20 insertions/day")
bound(253 + 252, 96, "both /24s, insertions capped at 4/hour (96/day)")
bound(253 + 252, 1000, "both /24s, 1,000 insertions/day (someone at the bag, no cap)")
