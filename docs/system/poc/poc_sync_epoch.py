"""Throwaway PoC for V-008 (revision 1) and its remainder (revision 2).
Pure logic, no files. Run: python3 -I poc_sync_epoch.py

Rules modelled (SYNC §3.2-3.3, DATA-EXPORT §12):
  - every replacement of the live database: new epoch, counter lifted to max(seq, epoch << 40),
    and a fresh random epoch nonce (identifies this lineage of the epoch number);
  - automatic recovery / update rollback: new epoch = bag epoch + 1;
  - technician restore (revision 2): new epoch = max(backup epoch, bag epoch, office's highest imported epoch
    for this bag) + 1; the office number reaches the CLI as --min-epoch (from the bag registry the office tool
    exports onto the technician's key stick); without it the CLI refuses;
  - office import: upsert / tombstone only if seq is greater; an (epoch, nonce) pair that clashes with an
    already imported pair of the same epoch number is NOT imported automatically (reported as epoch_clash).
Scenarios:
  1 automatic recovery after B1 was imported (revision 1)                       -> learner deleted at office
  2 fresh-card restore from an older backup, revision-1 rule max(backup, bag)+1 -> CONTROL: learner stays
  3 same, revision-2 rule with --min-epoch from the office                      -> learner deleted at office
  4 same as 2 but with the office clash check                                   -> import refused, reported
  5 revision 3a (V-029): clash remedy `sensebod-offline-admin new-epoch` on the clashing card
      5a CONTROL new-epoch without re-stamping (revision-3 text)                   -> name removal LOST at office
      5b new-epoch that re-stamps every row/tombstone changed since the last
         replacement (seq > bag_meta.epoch_base_seq) under the new epoch          -> removal and progress reach office
The Bag/Office class interface is unchanged, so reviews/evidence/v2/verify_epoch_restore.py still runs against it.
"""
import copy, secrets


class Bag:
    def __init__(self):
        self.epoch, self.seq, self.rows, self.tomb = 1, 0, {}, {}
        self.nonce = secrets.token_hex(4)
        self.base = 0                                # bag_meta.epoch_base_seq: counter right after the last replacement

    def next_seq(self):
        self.seq += 1
        return self.seq

    def put(self, k, v):
        self.rows[k] = (v, self.next_seq()); self.tomb.pop(k, None)

    def delete(self, k):
        self.rows.pop(k, None); self.tomb[k] = self.next_seq()

    def snapshot(self):
        return copy.deepcopy((self.epoch, self.seq, self.rows, self.tomb))

    def replace_live_database(self, snap, lift=True, new_epoch=None):
        _, self.seq, self.rows, self.tomb = copy.deepcopy(snap)
        self.epoch = new_epoch if new_epoch is not None else self.epoch + 1
        self.nonce = secrets.token_hex(4)
        if lift:
            self.seq = max(self.seq, self.epoch << 40)
        self.base = self.seq

    def new_epoch(self, min_epoch, restamp=True):
        """V-029 remedy: new epoch + nonce + counter lift WITHOUT restoring; with restamp, every row and tombstone
        changed since the last replacement (seq > base) gets a fresh seq under the new epoch, in seq order."""
        changed_rows = sorted(((s, k) for k, (v, s) in self.rows.items() if s > self.base))
        changed_tomb = sorted(((s, k) for k, s in self.tomb.items() if s > self.base))
        self.epoch = max(self.epoch, min_epoch) + 1
        self.nonce = secrets.token_hex(4)
        self.seq = max(self.seq, self.epoch << 40)
        self.base = self.seq
        if restamp:
            for s, kind, k in sorted([(s, "row", k) for s, k in changed_rows] + [(s, "tomb", k) for s, k in changed_tomb]):
                if kind == "row":
                    self.rows[k] = (self.rows[k][0], self.next_seq())
                else:
                    self.tomb[k] = self.next_seq()

    def backup(self):
        return {"epoch": self.epoch, "nonce": self.nonce, "rows": dict(self.rows), "tomb": dict(self.tomb)}


class Office:
    def __init__(self, clash_check=False):
        self.rows, self.last_epoch, self.lost, self.seen = {}, 0, set(), {}
        self.clash_check, self.refused = clash_check, []

    def import_(self, b):
        n = b.get("nonce")
        if self.clash_check and b["epoch"] in self.seen and self.seen[b["epoch"]] != n:
            self.refused.append(("epoch_clash", b["epoch"]))
            return
        for k, (v, s) in b["rows"].items():
            if k not in self.rows or s > self.rows[k][1]:
                self.rows[k] = (v, s)
        for k, s in b["tomb"].items():
            if k in self.rows and s > self.rows[k][1]:
                del self.rows[k]
        if b["epoch"] > self.last_epoch and self.last_epoch:
            self.lost |= {k for k in self.rows if k not in b["rows"] and k not in b["tomb"]}
        self.last_epoch = max(self.last_epoch, b["epoch"])
        self.seen.setdefault(b["epoch"], n)


def scenario(lift):
    """Revision 1 scenario: automatic recovery on the same card."""
    bag, office = Bag(), Office()
    bag.put("lr-aminata", "Aminata"); bag.put("lr-mohamed", "Mohamed")
    snap = bag.snapshot()
    for i in range(5):
        bag.put("lr-mohamed", f"Mohamed progress v{i}")
    bag.put("lr-fatmata", "Fatmata")
    office.import_(bag.backup())
    bag.replace_live_database(snap, lift)
    bag.delete("lr-mohamed")
    office.import_(bag.backup())
    return "lr-mohamed" in office.rows, office.lost


def fresh_card_restore(rule, clash_check=False):
    """The verifier's case (reviews/evidence/v2/verify_epoch_restore.py): card 1 recovers once (epoch 2),
    B2 reaches the office, card 1 dies, a fresh card is restored from the older B1."""
    office = Office(clash_check)
    card1 = Bag()
    card1.put("lr-aminata", "Aminata"); card1.put("lr-mohamed", "Mohamed v0")
    b1 = card1.backup(); b1_state = card1.snapshot()
    office.import_(b1)
    snap = card1.snapshot()
    for i in range(3):
        card1.put("lr-mohamed", f"Mohamed v{i+1}")
    card1.replace_live_database(snap)
    for i in range(5):
        card1.put("lr-mohamed", f"Mohamed after recovery v{i}")
    office.import_(card1.backup())
    card2 = Bag()                                   # fresh image, epoch 1
    if rule == "rev1":
        new_epoch = max(b1["epoch"], card2.epoch) + 1
    else:
        min_epoch = office.last_epoch               # `sensebod-offline-office bag-registry` → technician key stick → --min-epoch
        new_epoch = max(b1["epoch"], card2.epoch, min_epoch) + 1
    card2.replace_live_database(b1_state, True, new_epoch)
    card2.put("lr-aminata", "Aminata progress on new card")
    card2.delete("lr-mohamed")
    office.import_(card2.backup())
    return new_epoch, "lr-mohamed" in office.rows, office.refused


def clash_remedy(restamp):
    """The verifier's case (reviews/evidence/v4/verify_new_epoch_remedy.py): a fresh-card restore with a stale
    registry reuses epoch 2; while the clash is undetected the card records changes; the office refuses the
    clashing backup; the technician runs new-epoch; the next backup is imported."""
    office = Office(clash_check=True)
    card1 = Bag()
    card1.put("lr-aminata", "Aminata v0"); card1.put("lr-mohamed", "Mohamed v0")
    b1_state = card1.snapshot(); office.import_(card1.backup())
    card1.replace_live_database(card1.snapshot())                   # auto-recovery on card 1 -> epoch 2
    for i in range(50):
        card1.put("lr-mohamed", f"Mohamed card1 v{i}")
    for i in range(50):
        card1.put("lr-aminata", f"Aminata card1 v{i}")
    office.import_(card1.backup())
    card2 = Bag()
    card2.replace_live_database(b1_state, True, 2)                  # stale --min-epoch -> epoch 2 again (clash)
    card2.put("lr-aminata", "Aminata NEW progress on card 2")
    card2.delete("lr-mohamed")                                      # Mohamed removes his name on card 2
    office.import_(card2.backup())                                  # refused: epoch_clash
    card2.new_epoch(office.last_epoch, restamp=restamp)             # `sensebod-offline-admin new-epoch --registry …`
    office.import_(card2.backup())
    return office.refused, "lr-mohamed" in office.rows, office.rows["lr-aminata"][0]


if __name__ == "__main__":
    for lift in (True, False):
        still_there, lost = scenario(lift)
        print(f"1 automatic recovery, counter lift={lift}: deleted learner still at office={still_there}; reported lost on bag={sorted(lost)}")
    ep, still, _ = fresh_card_restore("rev1")
    print(f"2 CONTROL fresh-card restore, revision-1 rule max(backup, bag)+1: epoch={ep}; deleted learner still at office={still}")
    ep, still, _ = fresh_card_restore("rev2")
    print(f"3 fresh-card restore, revision-2 rule max(backup, bag, office --min-epoch)+1: epoch={ep}; deleted learner still at office={still}")
    ep, still, refused = fresh_card_restore("rev1", clash_check=True)
    print(f"4 revision-1 rule with the office (epoch, nonce) clash check: epoch={ep}; import refused={refused}; "
          f"deleted learner still at office={still} (the bad import is stopped and reported, not silently merged)")
    for label, rs in (("5a CONTROL new-epoch without re-stamp", False), ("5b new-epoch with re-stamp since epoch_base_seq", True)):
        refused, mohamed, aminata = clash_remedy(rs)
        print(f"{label}: first import refused={refused}; Mohamed (removed on card 2) still at office={mohamed}; office Aminata='{aminata}'")
