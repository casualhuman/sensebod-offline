"""Verifier's deterministic crash-point model of the export protocol (DATA-EXPORT-AND-BACKUP.md §5, §13).
NOT a power-cut test. For every step boundary it applies a *model* of power loss:
  - data written but not yet fsynced may be lost: either truncated, or a zero-filled range with the size
    unchanged (what delayed allocation can leave behind);
  - a rename whose directory was not yet fsynced may be undone;
  - a committed SQLite transaction survives (assumes the card honours flush: that is test PL-1/P-4).
Then it runs the documented boot recovery (cheap size check only, as §13.7 says) and checks the PL-3
invariants (every 'ready' file's SHA-256 matches, no file without a ready row, nothing 'preparing', .tmp empty).
CONTROL: the same with the fsync of the .part omitted (a plausible implementation slip), to show the
harness detects a broken order. Run: python3 -I verify_export_powerloss_model.py"""
import os, sqlite3, hashlib, random, shutil, zipfile, io

D = os.path.dirname(os.path.abspath(__file__)); W = os.path.join(D, "work_plmodel")
LIVE = os.path.join(W, "live.sqlite3"); EXP = os.path.join(W, "exports"); TMP = os.path.join(EXP, ".tmp")

def db():
    c = sqlite3.connect(LIVE, isolation_level=None); c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA synchronous=FULL"); return c

def setup():
    shutil.rmtree(W, ignore_errors=True); os.makedirs(TMP)
    c = db(); c.executescript("CREATE TABLE learner(id TEXT PRIMARY KEY, name TEXT);"
        "CREATE TABLE export(id TEXT PRIMARY KEY, state TEXT, file_name TEXT, size_bytes INT, sha256 TEXT);")
    c.execute("BEGIN")
    for i in range(3000): c.execute("INSERT INTO learner VALUES(?,?)", (f"lr-{i:05d}", f"N{i}"))
    c.execute("COMMIT"); c.close()

class Crash(Exception): pass

def fsync_path(p):
    fd = os.open(p, os.O_RDONLY); os.fsync(fd); os.close(fd)

def export(eid, crash_after, skip_part_fsync):
    unsynced, renames = {}, []          # unsynced: path -> current location
    step = [0]
    def mark():
        step[0] += 1
        if step[0] == crash_after: raise Crash
    c = db(); jt = os.path.join(TMP, eid); os.makedirs(jt); snap = os.path.join(jt, "snapshot.sqlite3")
    try:
        c.execute("VACUUM INTO ?", (snap,)); unsynced[snap] = snap; mark()                 # 1 snapshot written
        fsync_path(snap); del unsynced[snap]; mark()                                       # 2 snapshot durable
        part = os.path.join(jt, "f.zip.part"); s = sqlite3.connect(f"file:{snap}?mode=ro", uri=True)
        csv = "".join(f"{r[0]}\r\n" for r in s.execute("SELECT id FROM learner")); s.close()
        with zipfile.ZipFile(part, "w", zipfile.ZIP_DEFLATED) as z: z.writestr("learners.csv", csv)
        unsynced[part] = part; mark()                                                      # 3 .part written
        data = open(part, "rb").read(); sha = hashlib.sha256(data).hexdigest(); final = os.path.join(EXP, f"{eid}.zip")
        if not skip_part_fsync:
            fsync_path(part); del unsynced[part]
        mark()                                                                             # 4 .part durable
        os.rename(part, final); renames.append((final, part))
        if part in unsynced: unsynced[part] = final
        mark()                                                                             # 5 renamed
        fsync_path(EXP); renames.clear(); mark()                                           # 6 directory durable
        c.execute("UPDATE export SET state='ready', file_name=?, size_bytes=?, sha256=? WHERE id=? AND state='preparing'",
                  (os.path.basename(final), len(data), sha, eid)); mark()                  # 7 row committed
        shutil.rmtree(jt); mark()                                                          # 8 tmp removed
        return None
    except Crash:
        return unsynced, renames
    finally:
        c.close()

def power_loss(vol, rng):
    unsynced, renames = vol
    for dst, src in renames:
        if rng.random() < 0.5 and os.path.exists(dst):
            os.replace(dst, src)
            for k, v in unsynced.items():
                if v == dst: unsynced[k] = src
    for loc in unsynced.values():
        if not os.path.exists(loc): continue
        size = os.path.getsize(loc)
        with open(loc, "rb+") as f:
            if rng.random() < 0.5: f.truncate(rng.randint(0, size))
            else:
                a = rng.randint(0, max(0, size - 1)); f.seek(a); f.write(bytes(min(4096, size - a)))

def recover():
    c = db(); c.execute("UPDATE export SET state='interrupted' WHERE state='preparing'")
    shutil.rmtree(TMP, ignore_errors=True); os.makedirs(TMP)
    ready = {r[0]: r for r in c.execute("SELECT file_name, size_bytes, sha256, id FROM export WHERE state='ready'")}
    for n in os.listdir(EXP):
        if n != ".tmp" and n not in ready: os.remove(os.path.join(EXP, n))
    for fn, (_, size, sha, eid) in ready.items():           # §13.7: cheap size check at boot
        p = os.path.join(EXP, fn)
        if not (os.path.exists(p) and os.path.getsize(p) == size):
            c.execute("UPDATE export SET state='interrupted' WHERE id=?", (eid,))
            if os.path.exists(p): os.remove(p)
    c.close()

def check():
    v = set(); c = db()
    if c.execute("PRAGMA integrity_check").fetchone()[0] != "ok": v.add("live integrity")
    if c.execute("SELECT count(*) FROM export WHERE state='preparing'").fetchone()[0]: v.add("preparing left")
    ready = list(c.execute("SELECT file_name, size_bytes, sha256 FROM export WHERE state='ready'")); c.close()
    if {n for n in os.listdir(EXP) if n != ".tmp"} != {r[0] for r in ready}: v.add("file without ready row")
    for fn, size, sha in ready:
        p = os.path.join(EXP, fn)
        if not os.path.exists(p) or hashlib.sha256(open(p, "rb").read()).hexdigest() != sha:
            v.add("ready file whose SHA-256 does not match (passed the size-only boot check)")
    if os.listdir(TMP): v.add(".tmp not empty")
    return v

for label, skip in (("documented order", False), ("CONTROL: .part not fsynced before rename", True)):
    setup(); rng = random.Random(7); runs = 0; bad = {}
    for crash_after in range(1, 9):
        for rep in range(25):
            eid = f"ex-{crash_after}-{rep}"
            c = db(); c.execute("INSERT INTO export VALUES(?, 'preparing', NULL, NULL, NULL)", (eid,)); c.close()
            vol = export(eid, crash_after, skip)
            if vol: power_loss(vol, rng)
            recover(); runs += 1
            for x in check(): bad.setdefault(crash_after, set()).add(x)
            c = db(); c.execute("DELETE FROM export"); c.close()
            for n in os.listdir(EXP):
                if n != ".tmp": os.remove(os.path.join(EXP, n))
    print(f"{label}: {runs} runs (8 step boundaries x 25); violations by boundary: {bad or 'none'}")
