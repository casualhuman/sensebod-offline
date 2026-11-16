"""V2 check of V-008 on the technician-restore path (DATA-EXPORT §12: epoch = max(backup epoch, bag epoch) + 1).
Uses the architect's model (poc/poc_sync_epoch.py: Bag, Office) unchanged, imported by path.
Scenario: card 1 auto-recovers once (epoch 2) and its later backup B2 reaches the office; card 1 dies;
a FRESH card (epoch 1) is restored from the OLDER backup B1 (epoch 1) -> epoch = max(1,1)+1 = 2, the same
epoch the office has already seen from card 1. A learner then removes their name on the new card.
Run: python3 -I verify_epoch_restore.py <path to docs/system/poc>"""
import sys, copy, importlib.util
spec = importlib.util.spec_from_file_location("pse", sys.argv[1] + "/poc_sync_epoch.py")
src = open(sys.argv[1] + "/poc_sync_epoch.py").read().split("def scenario")[0]   # classes only, not the demo
ns = {}; exec(src, ns); Bag, Office = ns["Bag"], ns["Office"]

def run(restore_rule):
    office = Office()
    card1 = Bag()
    card1.put("lr-aminata", "Aminata"); card1.put("lr-mohamed", "Mohamed v0")
    b1 = card1.backup(); b1_state = card1.snapshot()          # B1 (epoch 1), also used later for restore
    office.import_(b1)
    snap = card1.snapshot()
    for i in range(3): card1.put("lr-mohamed", f"Mohamed v{i+1}")
    card1.replace_live_database(snap)                         # auto-recovery on card 1: epoch 2, seq lifted to 2<<40
    for i in range(5): card1.put("lr-mohamed", f"Mohamed after recovery v{i}")   # seq 2<<40 + 1..5
    office.import_(card1.backup())                            # B2 (epoch 2) reaches the office; card 1 then dies
    # technician restores B1 onto a fresh card
    card2 = Bag()                                             # fresh image: epoch 1
    _, card2.seq, card2.rows, card2.tomb = copy.deepcopy(b1_state)
    card2.epoch = restore_rule(b1["epoch"], 1, office.last_epoch)
    card2.seq = max(card2.seq, card2.epoch << 40)
    card2.put("lr-aminata", "Aminata progress on new card")   # a normal update
    card2.delete("lr-mohamed")                                # Mohamed removes his name on the new card
    office.import_(card2.backup())
    return card2.epoch, "lr-mohamed" in office.rows, office.rows["lr-aminata"][0]

for label, rule in (("documented rule max(backup, bag)+1", lambda b, bag, office: max(b, bag) + 1),
                    ("with office's highest epoch: max(backup, bag, office)+1", lambda b, bag, office: max(b, bag, office) + 1)):
    ep, still, aminata = run(rule)
    print(f"{label}: new epoch={ep}; deleted learner still at office={still}; office copy of Aminata='{aminata}'")
