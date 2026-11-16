"""Throwaway PoC: SQLite WAL behaviour for the Sensebod Offline design.
Measured on a Mac, NOT a Pi. Prints JSON-ish lines.

1. commit rate with synchronous FULL vs NORMAL (WAL)
2. online snapshot (backup API one step, and VACUUM INTO) while a writer keeps committing:
   writer latency during the snapshot, snapshot consistency, integrity_check
3. WAL growth while a long read transaction is open
4. kill -9 of a writer process mid-transaction: database still opens and passes integrity_check
"""
import os, sqlite3, threading, time, statistics, subprocess, sys, shutil, uuid, random

D = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(D, "work")
shutil.rmtree(W, ignore_errors=True)
os.makedirs(W)


def connect(path, sync="FULL"):
    c = sqlite3.connect(path, timeout=5.0, isolation_level=None, check_same_thread=False)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(f"PRAGMA synchronous={sync}")
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA busy_timeout=5000")
    return c


def schema(c):
    c.executescript("""
    CREATE TABLE IF NOT EXISTS learner(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lesson_progress(
      learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL, state TEXT NOT NULL, position_seconds INTEGER,
      correct INTEGER, total INTEGER, updated_at TEXT NOT NULL, seq INTEGER NOT NULL,
      PRIMARY KEY(learner_id, lesson_id)) WITHOUT ROWID;
    """)


def seed(c, learners=2000, lessons=200, per=40):
    c.execute("BEGIN IMMEDIATE")
    ids = []
    for i in range(learners):
        lid = uuid.uuid4().hex
        ids.append(lid)
        c.execute("INSERT INTO learner VALUES(?,?,?)", (lid, f"Name{i}", "learner"))
        for j in random.sample(range(lessons), per):
            c.execute("INSERT INTO lesson_progress VALUES(?,?,?,?,?,?,?,?)",
                      (lid, f"lesson-{j}", "started", 10, None, None, "2026-11-12T00:00:00Z", 0))
    c.execute("COMMIT")
    return ids


def commit_rate(sync, n=500):
    p = os.path.join(W, f"rate_{sync}.db")
    c = connect(p, sync)
    schema(c)
    ids = seed(c, 50, 200, 5)
    t = time.perf_counter()
    for k in range(n):
        c.execute("BEGIN IMMEDIATE")
        c.execute("INSERT OR REPLACE INTO lesson_progress VALUES(?,?,?,?,?,?,?,?)",
                  (ids[k % 50], f"lesson-{k % 200}", "started", k, None, None, "x", k))
        c.execute("COMMIT")
    dt = time.perf_counter() - t
    c.close()
    return n / dt


print("== 1. commit rate, one row per transaction (Mac, fsync is not a full flush on macOS unless PRAGMA fullfsync)")
for s in ("FULL", "NORMAL"):
    print(f"synchronous={s}: {commit_rate(s):.0f} commits/s")
# fullfsync variant (closer to a real flush on macOS)
p = os.path.join(W, "rate_fullfsync.db")
c = connect(p, "FULL"); c.execute("PRAGMA fullfsync=ON"); c.execute("PRAGMA checkpoint_fullfsync=ON"); schema(c)
ids = seed(c, 50, 200, 5)
t = time.perf_counter()
for k in range(200):
    c.execute("BEGIN IMMEDIATE")
    c.execute("INSERT OR REPLACE INTO lesson_progress VALUES(?,?,?,?,?,?,?,?)", (ids[k % 50], f"lesson-{k % 200}", "started", k, None, None, "x", k))
    c.execute("COMMIT")
print(f"synchronous=FULL + fullfsync=ON: {200 / (time.perf_counter() - t):.0f} commits/s")
c.close()

print("== 2. snapshot while writing")
live = os.path.join(W, "live.db")
c = connect(live)
schema(c)
ids = seed(c, 2000, 200, 40)
c.close()
print("live db bytes", os.path.getsize(live), "rows 80000 progress + 2000 learners")

stop = threading.Event()
lat = []
written = [0]


def writer():
    w = connect(live)
    k = 0
    while not stop.is_set():
        t0 = time.perf_counter()
        w.execute("BEGIN IMMEDIATE")
        w.execute("UPDATE lesson_progress SET position_seconds=position_seconds+1, seq=seq+1 WHERE learner_id=? AND lesson_id IN (SELECT lesson_id FROM lesson_progress WHERE learner_id=? LIMIT 1)", (ids[k % 2000], ids[k % 2000]))
        w.execute("INSERT INTO learner VALUES(?,?,?)", (uuid.uuid4().hex, "During", "learner"))
        w.execute("COMMIT")
        lat.append(time.perf_counter() - t0)
        written[0] += 1
        k += 1
        time.sleep(0.002)
    w.close()


for method in ("backup_api_one_step", "vacuum_into"):
    lat.clear(); written[0] = 0; stop.clear()
    th = threading.Thread(target=writer); th.start()
    time.sleep(0.3)
    base = len(lat)
    pre = list(lat)
    out = os.path.join(W, f"snap_{method}.db")
    if os.path.exists(out): os.remove(out)
    r = connect(live)
    t0 = time.perf_counter()
    if method == "backup_api_one_step":
        dst = sqlite3.connect(out)
        r.backup(dst, pages=-1)  # one step = one read transaction = consistent
        dst.close()
    else:
        r.execute("VACUUM INTO ?", (out,))
    snap_s = time.perf_counter() - t0
    during = lat[base:]
    time.sleep(0.2)
    stop.set(); th.join(); r.close()
    s = sqlite3.connect(out)
    ic = s.execute("PRAGMA integrity_check").fetchone()[0]
    jm = s.execute("PRAGMA journal_mode").fetchone()[0]
    n = s.execute("SELECT count(*) FROM learner").fetchone()[0]
    s.close()
    print(f"{method}: snapshot {snap_s*1000:.0f} ms, bytes {os.path.getsize(out)}, integrity={ic}, journal_mode_of_copy={jm}, learners_in_copy={n}, "
          f"writer commits during snapshot={len(during)}, writer p50={statistics.median(during)*1000 if during else float('nan'):.1f} ms "
          f"max={max(during)*1000 if during else float('nan'):.1f} ms (before: max {max(pre)*1000:.1f} ms)")

print("== 3. WAL growth while a read transaction is held open")
c = connect(live); c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
reader = connect(live)
reader.execute("BEGIN"); reader.execute("SELECT count(*) FROM learner").fetchone()
w = connect(live)
for k in range(3000):
    w.execute("BEGIN IMMEDIATE"); w.execute("UPDATE lesson_progress SET seq=seq+1 WHERE learner_id=?", (ids[k % 2000],)); w.execute("COMMIT")
print("wal bytes with reader open after 3000 commits:", os.path.getsize(live + "-wal"))
reader.execute("COMMIT"); reader.close()
w.execute("PRAGMA journal_size_limit=4194304")
print("checkpoint(TRUNCATE) result busy,log,ckpt:", w.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone(), "wal bytes after:", os.path.getsize(live + "-wal"))
w.close(); c.close()

print("== 4. kill -9 a writer in the middle of a big transaction")
child = r'''
import sqlite3, sys, time, uuid
c = sqlite3.connect(sys.argv[1], isolation_level=None)
c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA synchronous=FULL")
c.execute("BEGIN IMMEDIATE")
for i in range(10**7):
    c.execute("INSERT INTO learner VALUES(?,?,?)", (uuid.uuid4().hex, "Killed", "learner"))
    if i == 20000: print("ready", flush=True)
'''
pf = os.path.join(W, "child.py"); open(pf, "w").write(child)
before = sqlite3.connect(live).execute("SELECT count(*) FROM learner").fetchone()[0]
pr = subprocess.Popen([sys.executable, "-I", pf, live], stdout=subprocess.PIPE, text=True)
pr.stdout.readline(); time.sleep(0.2); pr.kill(); pr.wait()
c = sqlite3.connect(live)
print("after kill: integrity", c.execute("PRAGMA integrity_check").fetchone()[0], "learners before", before, "after", c.execute("SELECT count(*) FROM learner").fetchone()[0], "killed rows", c.execute("SELECT count(*) FROM learner WHERE name='Killed'").fetchone()[0])
c.close()
