"""Throwaway PoC for V-033 (revision 5): automatic learner removal must not be triggered by a wrong clock.
Pure logic, no files. Run: python3 -I poc_retention_clock.py   (Mac; models the rule, not the bag's clocks)

OLD rule (revision 4, control): daily run removes learners inactive >= 61 days (unexported: >= 91, option B)
                                 whenever clock_trust is not 'unsure'.
NEW rule (revision 5, DATA-EXPORT §8.1, ADR-018):
  - every forward step of the wall clock > 7 days (a manual set from a phone, or a jump detected at boot) is recorded
    as a clock event (clock_trust 'manual' for phone-set time; audit; banner) with the size of the jump
  - a learner is removable only if it would be inactive >= 61 days EVEN WITHOUT the unconfirmed jumps, i.e. the
    rule subtracts every unconfirmed forward jump that happened after the learner's last activity; the hub manager
    sees "[n] learners would be removed because the date moved forward by [d] days. Is the date right?" and only
    "Yes, remove" confirms the jump (then it counts)
  - unexported data never counts a clock jump at all (confirmed or not): it needs 91 days of ordinary time
  - each daily run removes at most 10 % of learners without a confirmation
Scenarios (100 learners, half exported; last activity spread over the past 50 days):
  C1 hub manager sets a phone's wrong date, one year ahead
  C2 real time passes: 70 days of normal use with daily runs (some learners go quiet)
  C3 bag without RTC: clock 'restored' lags real time by 20 days -> removal later, never earlier
"""
import random

R = random.Random(7)


def make_learners():
    return [dict(id=i, last=-R.randint(0, 50), exported=(i % 2 == 0)) for i in range(100)]


def run_day(learners, today, rule, jumps, confirmed):
    """jumps: list of (day_of_jump, size_days[, source]); source 'manual' (phone-set), 'unexplained' (no RTC/NTP
    backing; the default for 2-tuples) or 'rtc'/'synced' (a step read from a battery-backed RTC at boot, or an NTP
    step). confirmed: set of jump indexes the hub manager confirmed.
    rule 'NEW'   = revision 5 (every jump > 7 days is guarded, whatever its source)
    rule 'NEW5A' = revision 5a (only manual/unexplained jumps are guarded; trusted-clock steps are real time)"""
    removable = []
    for l in learners:
        age = today - l["last"]
        if rule in ("NEW", "NEW5A"):
            for i, j in enumerate(jumps):
                d, size = j[0], j[1]
                source = j[2] if len(j) > 2 else "unexplained"
                if d < l["last"]:
                    continue
                if rule == "NEW5A" and source in ("rtc", "synced"):
                    continue                          # trusted clock: real elapsed time, counts
                # exported: subtract unconfirmed guarded jumps; unexported: subtract every guarded jump
                if i not in confirmed or not l["exported"]:
                    age -= size
        limit = 61 if l["exported"] else 91
        if age >= limit:
            removable.append(l)
    if rule in ("NEW", "NEW5A"):
        removable = removable[: max(1, len(learners) // 10)] if len(removable) > len(learners) // 10 else removable
    for l in removable:
        learners.remove(l)
    return len(removable)


def c1(rule):
    learners = make_learners(); today = 0; jumps = []
    today += 365; jumps.append((today, 365))      # phone date one year ahead, set by a hub manager
    removed = sum(run_day(learners, today + d, rule, jumps, set()) for d in range(3))
    unexported_lost = 50 - sum(1 for l in learners if not l["exported"])
    return removed, unexported_lost


def c2(rule):
    learners = make_learners(); removed = 0
    for day in range(1, 71):
        for l in learners:                        # 70 % of learners keep using the bag
            if l["id"] % 10 < 7:
                l["last"] = day
        removed += run_day(learners, day, rule, [], set())
    return removed


def c3(rule):
    learners = make_learners(); removed_real_day = None
    for real_day in range(1, 160):
        bag_day = real_day - 20                   # restored clock lags 20 days
        n = run_day(learners, bag_day, rule, [], set())
        if n and removed_real_day is None:
            removed_real_day = real_day
    return removed_real_day


for rule in ("OLD", "NEW"):
    tag = "CONTROL OLD" if rule == "OLD" else "NEW"
    r, lost = c1(rule)
    print(f"C1 {tag:<11} phone date +1 year: removed {r} learners in 3 days, of which unexported (EasySTEM never got them): {lost}")
for rule in ("OLD", "NEW"):
    tag = "CONTROL OLD" if rule == "OLD" else "NEW"
    print(f"C2 {tag:<11} 70 real days, no clock change: removed {c2(rule)} learners (the quiet ones, after 61/91 days)")
first_old, first_new = c3("OLD"), c3("NEW")
print(f"C3 clock lagging 20 days (no RTC): first removal on real day {first_old} (OLD) / {first_new} (NEW); "
      f"the same rule without the lag would start on day 11 (oldest learner, last active 50 days ago) -> later, never earlier")
# confirmation path: the hub manager confirms the jump is right -> it counts, still capped at 10 % per day
learners = make_learners(); jumps = [(365, 365)]
n = run_day(learners, 365, "NEW", jumps, {0})
unexported_left = sum(1 for l in learners if not l["exported"])
print(f"C1 NEW after the hub manager confirms the date: removed {n} learners that day (exported only; cap 10 %/day); unexported learners kept: {unexported_left}/50")


# ---- revision 5a (V-033 remainder): intermittent use with a TRUSTED clock, and the manual control again
def c4(rule, source):
    """One week on, 23 days off, every month; every first boot of a month is a 23-day forward step from `source`.
    One exported and one unexported learner last active on day 0; 8 active learners keep the 10 % cap at 1/day."""
    learners = [dict(id=0, last=0, exported=True), dict(id=1, last=0, exported=False)] + \
               [dict(id=100 + i, last=10**6, exported=True) for i in range(8)]
    jumps, removed_on = [], {}
    for real in range(1, 500):
        if (real % 30) >= 7:
            continue
        if real % 30 == 0:
            jumps.append((real, 23, source))
        for l in learners:
            if l["id"] >= 100:
                l["last"] = real
        before = {l["id"] for l in learners}
        run_day(learners, real, rule, jumps, set())
        for i in before - {l["id"] for l in learners}:
            removed_on[i] = real
    return removed_on.get(0), removed_on.get(1)


print("Revision 5a (V-033): a bag used one week a month")
for rule, label in (("NEW", "CONTROL revision 5, RTC-backed boot steps guarded"), ("NEW5A", "revision 5a, RTC-backed boot steps count")):
    e, u = c4(rule, "rtc")
    print(f"C4 {label:<52}: exported removed on real day {e}, unexported on day {u} (target 61 / 91)")
e, u = c4("NEW5A", "manual")
print(f"C4 revision 5a, the same monthly steps but set by hand from a phone   : exported removed on day {e}, unexported on day {u} (guarded: kept until confirmed / ordinary time)")
for rule in ("NEW5A",):
    r, lost = c1(rule)
    print(f"C1 revision 5a, phone date +1 year (manual): removed {r} learners in 3 days, unexported lost {lost}")
