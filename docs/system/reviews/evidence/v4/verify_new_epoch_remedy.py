"""V4 check of the V-029 clash remedy (SYNC §3.2: `sensebod-admin new-epoch` moves the live bag to a new epoch
and nonce with the counter lift, "without restoring anything", and "the next backup then imports cleanly").
Uses the architect's Bag/Office classes from poc/poc_sync_epoch.py unchanged (imported by path).
Scenario: a fresh-card restore done with a too-low --min-epoch (stale registry) reuses epoch 2, which the office
already imported from the dead card. While the clash is undetected, the new card records changes: Mohamed removes
his name, Aminata makes progress. The office refuses the clashing backup (nonce check). The technician runs new-epoch
(as documented: no re-stamping of existing rows). The next backup is imported.
Variant: new-epoch also re-stamps every row and tombstone written since the restore with a fresh seq.
Run: python3 -I verify_new_epoch_remedy.py <path to docs/system/poc>"""
import sys
src = open(sys.argv[1] + "/poc_sync_epoch.py").read().split("def scenario")[0]
ns = {}; exec(src, ns); Bag, Office = ns["Bag"], ns["Office"]

def run(restamp):
    office = Office(clash_check=True)
    card1 = Bag()
    card1.put("lr-aminata", "Aminata v0"); card1.put("lr-mohamed", "Mohamed v0")
    b1 = card1.backup(); b1_state = card1.snapshot(); office.import_(b1)
    snap = card1.snapshot()
    card1.replace_live_database(snap)                          # auto-recovery on card 1 -> epoch 2
    for i in range(50): card1.put("lr-mohamed", f"Mohamed card1 v{i}")
    for i in range(50): card1.put("lr-aminata", f"Aminata card1 v{i}")
    office.import_(card1.backup())                             # office now holds epoch 2 rows up to 2<<40 + 100
    card2 = Bag()
    card2.replace_live_database(b1_state, True, 2)             # stale registry said min-epoch 1 -> epoch 2 (clash)
    base = card2.seq
    card2.put("lr-aminata", "Aminata NEW progress on card 2")  # seq 2<<40 + 1
    card2.delete("lr-mohamed")                                 # seq 2<<40 + 2 (Mohamed removes his name)
    office.import_(card2.backup())                             # refused: epoch_clash
    # remedy: new-epoch, as documented (epoch + lift + nonce, rows untouched)
    card2.replace_live_database(card2.snapshot(), True, max(card2.epoch, office.last_epoch) + 1)
    if restamp:                                                # variant: re-stamp what was written since the restore
        for k, (v, s) in list(card2.rows.items()):
            if s > base: card2.rows[k] = (v, card2.next_seq())
        for k, s in list(card2.tomb.items()):
            if s > base: card2.tomb[k] = card2.next_seq()
    office.import_(card2.backup())
    return office.refused, "lr-mohamed" in office.rows, office.rows["lr-aminata"][0]

for label, r in (("new-epoch as documented (no re-stamp)", False), ("new-epoch + re-stamp rows/tombstones since restore", True)):
    refused, mohamed, aminata = run(r)
    print(f"{label}: refused={refused}; Mohamed (deleted on card 2) still at office={mohamed}; office Aminata='{aminata}'")
