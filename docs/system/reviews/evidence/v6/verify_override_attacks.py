"""V6 verifier attack cases against the offline override (SYSTEM-ARCHITECTURE §9.9, ADR-017).
Reuses the architect's Office/Bag/code_for from poc/poc_override.py (classes only, imported by path) and
adds what the PoC does not model:
  A1 persistence: uptime_total_s is persisted every 5 min, so a power cut loses up to 5 min. Attacker with the
     power switch keeps each boot under 5 min, so the persisted uptime never advances. Does the boot cap hold,
     and what is the real-uptime bound? (boot row committed by boot-recover before the API starts: assumed)
  A2 attempt counter not committed before the answer: a power cut after each wrong guess resets the counter.
  A3 denial of recovery: anyone on the Wi-Fi uses the GLOBAL quotas (3 new requests per 24 h uptime, 3 open,
     15 failures -> pause 24 h uptime) every day; can the real hub manager ever get a code accepted?
  A4 the same with the quotas the 50-bit entropy can afford (no global pause; per-username displacement of
     the oldest open request; 5 tries per request), and the resulting guessing bound.
Run: python3 -I verify_override_attacks.py <path to docs/system/poc>"""
import sys, secrets
src = open(sys.argv[1] + "/poc_override.py").read().split("def show(")[0]
ns = {}; exec(src, ns); Office, Bag, code_for, b32 = ns["Office"], ns["Bag"], ns["code_for"], ns["b32"]
office = Office()

# ---------------------------------------------------------------- A1
class PersistBag(Bag):
    """uptime persisted every 5 min; on a power cut the unpersisted part is lost."""
    def __init__(s, *a): super().__init__(*a); s.persisted = 0; s.since = 0
    def run_minutes(s, m):
        for _ in range(int(m)):
            s.since += 60
            if s.since >= 300: s.persisted += s.since; s.since = 0
        s.uptime_total = s.persisted + s.since
    def power_cut(s): s.since = 0; s.uptime_total = s.persisted; s.reboot()
b = PersistBag("b-p1", office.k_bag("b-p1"))
rid, rc = b.request("hub"); code = office.mint("b-p1", rc, "hub")
real = 0; boots_used = 0
while True:
    b.run_minutes(4); real += 4
    if b._expired(b.challenges[rid]): break
    b.power_cut(); boots_used += 1
    if boots_used > 1000: break
print(f"A1 4-minute boots with power cuts: persisted uptime={b.persisted}s, real uptime={real} min, boots={boots_used}; "
      f"request expired by: {b._expired(b.challenges[rid])}  -> bound = 72 h + 20 x 5 min (boot cap holds if the boot row is committed before the API serves)")

# ---------------------------------------------------------------- A2
b2 = Bag("b-p2", office.k_bag("b-p2")); rid, rc = b2.request("hub")
tries = 0
for i in range(40):
    b2.redeem(rid, "hub", b32(secrets.token_bytes(7), 10)); tries += 1
    b2.challenges[rid]["attempts"] = 0; b2.challenges[rid]["state"] = "open"   # counter lost in the power cut
print(f"A2 attempt counter not committed before answering: {tries} guesses on ONE request, still open -> "
      f"the 5-try limit only holds if each wrong attempt is committed before the 401 is sent (physical attacker only)")

# ---------------------------------------------------------------- A3 / A4
def day_of_attack(policy, days=30):
    """Each day the attacker acts first; then the hub manager (who has called EasySTEM) tries once."""
    q = dict(new_per_day=3, open_max=3, pause_after=15) if policy == "documented" else dict(new_per_day=None, open_max=3, pause_after=None)
    successes = attacker_guesses = 0
    for d in range(days):
        new_today = 0; failures_today = 0; open_reqs = []
        def create(user):
            nonlocal new_today
            if q["new_per_day"] is not None and new_today >= q["new_per_day"]: return None
            if len([r for r in open_reqs if r["user"] == user]) >= q["open_max"]:
                if policy == "documented": return None
                open_reqs.remove(next(r for r in open_reqs if r["user"] == user))   # displace the oldest of that user
            new_today += 1; r = {"user": user, "tries": 0, "id": secrets.token_hex(3)}; open_reqs.append(r); return r
        # attacker: 3 requests for the hub manager's username (3/hour/IP at nginx allows this), 5 wrong guesses each
        for _ in range(3):
            r = create("hub")
            if r is None: break
            for _ in range(5):
                if q["pause_after"] is not None and failures_today >= q["pause_after"]: break
                r["tries"] += 1; failures_today += 1; attacker_guesses += 1
        # the real hub manager asks for a request, gets a code from EasySTEM and enters it
        paused = q["pause_after"] is not None and failures_today >= q["pause_after"]
        mine = create("hub")
        if mine is not None and not paused: successes += 1
    return successes, attacker_guesses
for policy in ("documented", "relaxed"):
    ok, g = day_of_attack(policy)
    extra = "" if policy == "documented" else f"; attacker success bound ≈ {g/30/2**50:.1e}/day at {g//30} guesses/day from one phone"
    print(f"A3/A4 policy={policy:10} 30 days of daily attack by one phone: hub manager recovered on {ok}/30 days{extra}")
