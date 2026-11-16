"""V7 check of V-033 (DATA-EXPORT §8.1 guard 2-4) on a bag that is used intermittently with a TRUSTED clock
(RTC battery or NTP): on 7 days, then off 23 days, every month. Each boot after an off period is a forward step
> 7 days, recorded as a clock_jump (§8.1 guard 2: "from any source"; the text says a bag switched off for weeks
with an RTC battery "also shows a boot jump"). Guard 3 subtracts those days from unexported learners' ages,
guard 4 from exported ones until a hub manager confirms each jump.
Uses run_day() from poc/poc_retention_clock.py unchanged (imported by path). One learner of each kind, last active
on day 0, never active again. Question: on which REAL day is each removed?
Variants: (a) as specified, nobody confirms; (b) as specified, the hub manager confirms every jump;
(c) suggested: jumps whose clock is trusted (rtc/synced, consistent with the RTC) are not subtracted.
Run: python3 -I verify_retention_intermittent.py <path to docs/system/poc>"""
import sys
src = open(sys.argv[1] + "/poc_retention_clock.py").read().split("def make_learners")[0]
src2 = open(sys.argv[1] + "/poc_retention_clock.py").read()
ns = {}; exec(src2.split("def c1(")[0], ns); run_day = ns["run_day"]

def simulate(variant, days=500):
    learners = [dict(id=0, last=0, exported=True), dict(id=1, last=0, exported=False)] + \
               [dict(id=100 + i, last=10**6, exported=True) for i in range(8)]   # 8 active learners so the 10 % cap allows 1/day
    jumps, confirmed, removed_on = [], set(), {}
    for real in range(1, days):
        on = (real % 30) < 7
        if not on: continue
        if real % 30 == 0 and real > 0:            # first day on after 23 days off -> boot jump of 23 days
            jumps.append((real, 23))
            if variant == "b": confirmed.add(len(jumps) - 1)
        use_jumps = [] if variant == "c" else jumps
        for l in learners:
            if l["id"] >= 100: l["last"] = real   # active learners keep using it
        before = {l["id"] for l in learners}
        run_day(learners, real, "NEW", use_jumps, confirmed)
        for i in before - {l["id"] for l in learners}: removed_on[i] = real
    return removed_on.get(0), removed_on.get(1)

for v, label in (("a", "as specified, no confirmations"), ("b", "as specified, every jump confirmed"),
                 ("c", "trusted-clock jumps not subtracted")):
    e, u = simulate(v)
    print(f"{label:38}: exported learner removed on real day {e}, unexported (option B) on real day {u}  (target 61 / 91)")
