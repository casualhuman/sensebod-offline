"""Throwaway PoC for V-030 (revision 5): can someone on the Wi-Fi stop the real hub manager from recovering?
Pure logic, no files. Run: python3 -I poc_override_dos.py   (Mac; models the policy, not the network)

Policies:
  OLD (revision 4, control): bag-wide quotas: 3 new requests per 24 h uptime, 3 open at once, 15 failures pause 24 h.
  NEW (revision 5):
    - every request is bound to the browser that created it (HttpOnly request-secret cookie, requestId 128 bits):
      only that browser can enter codes for it, so nobody else can spend its 5 tries or void it
    - no bag-wide failure pause; 5 tries per request
    - network request creation: nginx 3/hour per IP; bag-wide ceiling 2,000 new network requests per 24 h uptime
      (then network creation pauses for the rest of that 24 h window)
    - unblockable path: "plug any USB stick into the bag, then tap 'I am at the bag'" -> one PRESENCE request per
      stick insertion, exempt from the ceiling (an attacker on the Wi-Fi cannot insert a stick)
Scenarios over 30 days (each day: attacker runs at full rate first; then the hub manager asks for a code, phones
EasySTEM, and enters it):
  S1 attacker = one phone (one IP)
  S2 attacker rotates MAC/IP across the whole DHCP pool (200 addresses) to hit the ceiling every day
"""
import secrets

DAYS = 30


class Bag:
    def __init__(self, policy):
        self.policy = policy
        self.requests = {}           # rid -> dict(owner, tries, state, presence)
        self.day_created = 0; self.day_failures = 0; self.paused = False; self.stick_inserted = False

    def new_day(self):
        self.day_created = 0; self.day_failures = 0; self.paused = False
        for r in self.requests.values():           # requests older than a day are irrelevant here
            if r["state"] == "open":
                r["state"] = "expired"

    def create(self, client, presence=False):
        if self.policy == "OLD":
            open_n = sum(1 for r in self.requests.values() if r["state"] == "open")
            if self.paused or self.day_created >= 3 or open_n >= 3:
                return None
        else:
            if presence:
                if not self.stick_inserted:
                    return None
                self.stick_inserted = False         # one presence request per insertion
            elif self.day_created >= 2000:
                return None
        if not presence:
            self.day_created += 1
        rid = secrets.token_hex(16)                 # 128 bits
        self.requests[rid] = dict(owner=client, tries=0, state="open", presence=presence)
        return rid

    def redeem(self, client, rid, correct):
        r = self.requests.get(rid)
        if r is None or r["state"] != "open":
            return False
        if self.policy == "OLD" and self.paused:
            return False
        if self.policy == "NEW" and r["owner"] != client:
            return False                            # no request-secret cookie: refused, the request is untouched
        if correct:
            r["state"] = "used"; return True
        r["tries"] += 1; self.day_failures += 1
        if r["tries"] >= 5: r["state"] = "void"
        if self.policy == "OLD" and self.day_failures >= 15: self.paused = True
        return False


def attacker_day(bag, ips):
    guesses = 0
    for ip in range(ips):
        for _ in range(3 * 24):                   # nginx: 3 requests per hour per IP
            rid = bag.create(f"attacker-{ip}")
            if rid is None:
                break
            for _ in range(5):
                bag.redeem(f"attacker-{ip}", rid, correct=False); guesses += 1
        # also try to burn the hub manager's open requests (only possible without cookie binding)
        for rid, r in list(bag.requests.items()):
            if r["owner"] == "hub-manager":
                for _ in range(5):
                    bag.redeem(f"attacker-{ip}", rid, correct=False)
    return guesses


def run(policy, ips, use_stick_if_needed):
    bag = Bag(policy); ok_days = 0; total_guesses = 0; via_stick = 0
    for _ in range(DAYS):
        bag.new_day()
        total_guesses += attacker_day(bag, ips)
        rid = bag.create("hub-manager")
        if rid is None and use_stick_if_needed and policy == "NEW":
            bag.stick_inserted = True; rid = bag.create("hub-manager", presence=True); via_stick += rid is not None
        attacker_day(bag, ips)                     # attacker keeps going while EasySTEM is on the phone
        if rid and bag.redeem("hub-manager", rid, correct=True):
            ok_days += 1
    return ok_days, total_guesses / DAYS, via_stick


for label, policy, ips in (("S1 CONTROL OLD policy, one phone", "OLD", 1),
                           ("S1 NEW policy, one phone", "NEW", 1),
                           ("S2 CONTROL OLD policy, 200 rotating addresses", "OLD", 200),
                           ("S2 NEW policy, 200 rotating addresses (ceiling reached daily)", "NEW", 200)):
    ok, gpd, stick = run(policy, ips, True)
    extra = f"; via USB-presence path on {stick} days" if stick else ""
    bound = f"; attacker guesses/day {gpd:.0f} -> success ≈ {gpd / 2**50:.1e}/day" if policy == "NEW" else ""
    print(f"{label:<64} hub manager recovered on {ok}/{DAYS} days{extra}{bound}")
print(f"NEW policy worst case (ceiling 2,000 requests x 5 tries + presence requests): ≤ 10,005 guesses per 24 h uptime "
      f"-> ≈ {10005 / 2**50:.1e} per day, ≈ {10005 * 365 / 2**50:.1e} per year of continuous uptime")
