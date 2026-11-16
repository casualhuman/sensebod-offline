"""Throwaway PoC for OWNER-4 (revision 4): the offline override code (challenge-response, ADR-017).
Pure Python stdlib (hmac, hashlib, secrets); no files. Run: python3 -I poc_override.py
Mac only; this checks the protocol and the expiry/limit logic, not the bag's real clocks or storage.

Scheme (SYSTEM-ARCHITECTURE §9.9):
  office master key  M_v (32 bytes, version v; only on EasySTEM's offline office machine)
  per-bag secret     K_bag = HMAC-SHA256(M_v, "sensebod-offline-override-bag/1|" + bag_id)       (provisioned onto the bag)
  request code       version(1) + bag tag(4) + nonce(8) in Crockford base32 = 13 chars, 40-bit random nonce
  override code      first 10 Crockford base32 chars (50 bits) of
                     HMAC-SHA256(K_bag, "sensebod-offline-override/1|" + bag_id + "|" + v + "|" + nonce + "|" + lower(username))
  expiry (no trusted clock): the challenge dies at the FIRST of: 72 h of accumulated bag uptime (persisted
                     counter, survives reboots), 20 boots, 72 h of wall clock when the clock was trusted at both ends,
                     used once, 5 wrong attempts, epoch change (restore/new-epoch)
  limits:            ≤ 3 new challenges per 24 h of bag uptime; ≤ 3 open at once; 15 failures → override paused 24 h uptime
"""
import hmac, hashlib, secrets

B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"          # Crockford base32 (no I, L, O, U)


def b32(data: bytes, n: int) -> str:
    bits = int.from_bytes(data, "big"); total = len(data) * 8
    return "".join(B32[(bits >> (total - 5 * (i + 1))) & 31] for i in range(n))


def norm(code: str) -> str:                      # tolerant reading: case, dashes, I/L→1, O→0
    return code.upper().replace("-", "").replace(" ", "").replace("I", "1").replace("L", "1").replace("O", "0")


class Office:
    def __init__(self):
        self.masters = {1: secrets.token_bytes(32)}
        self.revoked = set(); self.log = []

    def k_bag(self, bag_id, v=1):
        return hmac.new(self.masters[v], f"sensebod-offline-override-bag/1|{bag_id}".encode(), hashlib.sha256).digest()

    def mint(self, bag_id, request_code, username):
        """`sensebod-offline-office override --bag <id> --request <code> --user <name>`"""
        rc = norm(request_code); v = B32.index(rc[0]); nonce = rc[5:13]
        if bag_id in self.revoked:
            raise PermissionError("bag revoked (reported stolen)")
        if rc[1:5] != Bag.tag_of(bag_id):
            raise ValueError("request code does not belong to this bag")
        self.log.append((bag_id, request_code, username))
        return code_for(self.k_bag(bag_id, v), bag_id, v, nonce, username)


def code_for(k_bag, bag_id, v, nonce, username):
    mac = hmac.new(k_bag, f"sensebod-offline-override/1|{bag_id}|{v}|{nonce}|{username.lower()}".encode(), hashlib.sha256).digest()
    return b32(mac, 10)


class Bag:
    LIFE_UPTIME_S, MAX_BOOTS, LIFE_WALL_S, MAX_ATTEMPTS = 72 * 3600, 20, 72 * 3600, 5

    @staticmethod
    def tag_of(bag_id):
        return b32(hashlib.sha256(bag_id.encode()).digest(), 4)

    def __init__(self, bag_id, k_bag, v=1):
        self.bag_id, self.k, self.v = bag_id, k_bag, v
        self.uptime_total = 0; self.boots = 1; self.wall = 1_000_000; self.clock_trusted = False
        self.epoch = 1; self.challenges = {}; self.failures = 0

    # time passing on the bag
    def run(self, hours):
        self.uptime_total += hours * 3600; self.wall += hours * 3600

    def power_off(self, hours):                  # off: wall clock moves (if any), uptime does not
        self.wall += hours * 3600

    def reboot(self, clock_reset=False):
        self.boots += 1
        if clock_reset:
            self.wall -= 30 * 24 * 3600; self.clock_trusted = False

    def request(self, username):
        nonce = b32(secrets.token_bytes(5), 8)
        rid = secrets.token_hex(4)
        self.challenges[rid] = dict(nonce=nonce, user=username.lower(), up=self.uptime_total, boots=self.boots,
                                    wall=self.wall, trusted=self.clock_trusted, attempts=0, state="open", epoch=self.epoch)
        return rid, B32[self.v] + self.tag_of(self.bag_id) + nonce

    def _expired(self, c):
        if self.uptime_total - c["up"] >= self.LIFE_UPTIME_S: return "expired (72 h of bag uptime)"
        if self.boots - c["boots"] >= self.MAX_BOOTS: return "expired (20 boots)"
        if c["trusted"] and self.clock_trusted and self.wall - c["wall"] >= self.LIFE_WALL_S: return "expired (72 h wall clock, trusted)"
        if c["epoch"] != self.epoch: return "void (database replaced)"
        return None

    def redeem(self, rid, username, code):
        c = self.challenges.get(rid)
        if c is None: return "unknown request"
        if c["state"] != "open": return f"refused: {c['state']}"
        why = self._expired(c)
        if why: c["state"] = why; return f"refused: {why}"
        good = code_for(self.k, self.bag_id, self.v, c["nonce"], username)
        if c["user"] != username.lower() or not hmac.compare_digest(norm(code), good):
            c["attempts"] += 1; self.failures += 1
            if c["attempts"] >= self.MAX_ATTEMPTS: c["state"] = "void (5 wrong attempts)"
            return f"refused: wrong code ({self.MAX_ATTEMPTS - c['attempts']} attempts left)"
        c["state"] = "used"                       # single use, in the same transaction as the forced password change
        return "ACCEPTED -> restricted session, new password required, other sessions ended, audited"


def show(label, result, expect_ok):
    ok = result.startswith("ACCEPTED")
    verdict = "as intended" if ok == expect_ok else "UNEXPECTED"
    print(f"  {label:<74} {result}  [{verdict}]")


office = Office()
bag_a = Bag("b-a1", office.k_bag("b-a1")); bag_b = Bag("b-b2", office.k_bag("b-b2"))

print("1 normal use")
rid, rc = bag_a.request("Mariama")
code = office.mint("b-a1", rc, "mariama")
print(f"  request code shown on the bag: {rc[0]}-{rc[1:5]}-{rc[5:9]}-{rc[9:]}  override code from EasySTEM: {code[:5]}-{code[5:]}")
bag_a.run(5); bag_a.reboot(); bag_a.run(10)
show("valid code after 15 h uptime and a reboot (typed in lower case with dashes)", bag_a.redeem(rid, "Mariama", f"{code[:5]}-{code[5:]}".lower()), True)
print("2 CONTROL: reuse")
show("same code entered again", bag_a.redeem(rid, "Mariama", code), False)
print("3 CONTROL: expiry without a trusted clock")
rid, rc = bag_a.request("mariama"); code = office.mint("b-a1", rc, "mariama")
bag_a.run(40); bag_a.power_off(24 * 20); bag_a.reboot(clock_reset=True); bag_a.run(33)
show("after 73 h of uptime spread over 20 days off and a clock jump back", bag_a.redeem(rid, "mariama", code), False)
rid, rc = bag_a.request("mariama"); code = office.mint("b-a1", rc, "mariama")
for _ in range(20): bag_a.reboot(clock_reset=True); bag_a.run(0.1)
show("after 20 short boots (2 h uptime) with the clock reset each time", bag_a.redeem(rid, "mariama", code), False)
print("4 binding")
rid_b, rc_b = bag_b.request("mariama"); code_for_a = office.mint("b-a1", bag_a.request("mariama")[1], "mariama")
show("bag A's code entered on bag B", bag_b.redeem(rid_b, "mariama", code_for_a), False)
rid, rc = bag_a.request("mariama"); code = office.mint("b-a1", rc, "mariama")
show("code for user 'mariama' entered for user 'abu'", bag_a.redeem(rid, "abu", code), False)
try:
    office.mint("b-b2", rc, "mariama"); print("  UNEXPECTED: office minted bag A's request for bag B")
except ValueError as e:
    print(f"  office tool, bag A's request code presented as bag B: refused ({e})  [as intended]")
print("5 attempt limit")
rid, rc = bag_a.request("mariama"); code = office.mint("b-a1", rc, "mariama")
for i in range(5):
    r = bag_a.redeem(rid, "mariama", b32(secrets.token_bytes(7), 10))
show("6th try with the RIGHT code after 5 wrong ones", bag_a.redeem(rid, "mariama", code), False)
print("6 stolen card")
stolen_k = bag_a.k                                        # attacker reads /var/lib/sensebod-offline/keys/override.key
rid, rc = bag_a.request("mariama")
forged = code_for(stolen_k, "b-a1", 1, rc[5:], "mariama")
show("attacker mints a code for the SAME bag from the stolen secret", bag_a.redeem(rid, "mariama", forged), True)
rid_b, rc_b = bag_b.request("mariama")
forged_b = code_for(stolen_k, "b-b2", 1, rc_b[5:], "mariama")
show("attacker tries the stolen secret against ANOTHER bag", bag_b.redeem(rid_b, "mariama", forged_b), False)
office.revoked.add("b-a1")
try:
    office.mint("b-a1", bag_a.request("mariama")[1], "mariama"); print("  UNEXPECTED: minted for a revoked bag")
except PermissionError as e:
    print(f"  office tool after the theft is reported: refused ({e})  [as intended]")
print("7 online guessing bound (arithmetic)")
guesses_per_day = 3 * 5
print(f"  50-bit code, ≤ {guesses_per_day} guesses per 24 h of uptime: success ≈ {guesses_per_day / 2**50:.1e} per day, "
      f"≈ {guesses_per_day * 365 / 2**50:.1e} per year of continuous uptime")
