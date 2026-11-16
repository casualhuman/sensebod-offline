"""Throwaway PoC: the export job protocol from DATA-EXPORT-AND-BACKUP.md, with crash injection.

Run: python3 -I poc_export.py
It repeatedly starts an export in a child process, kills it with SIGKILL at a random moment,
runs the boot-time recovery, and checks the invariants:
  I1 every job row in state 'ready' has a final file whose size and SHA-256 match the row
  I2 no file exists in the final exports directory without a 'ready' row
  I3 no job is left in 'preparing' after recovery; tmp dir is empty
  I4 the live database passes integrity_check
kill -9 is a process crash, not a power cut: it does not lose the OS page cache. Power loss is
covered by the fsync ordering, which this script exercises but cannot prove on a Mac.
"""
import os, sys, sqlite3, hashlib, zipfile, json, random, subprocess, time, shutil, csv, io, signal, uuid

D = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(D, "work_export")
LIVE = os.path.join(W, "sensebod-offline.db")
EXP = os.path.join(W, "exports")
TMP = os.path.join(EXP, ".tmp")


def db(path=LIVE):
    c = sqlite3.connect(path, isolation_level=None, timeout=5)
    c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA synchronous=FULL"); c.execute("PRAGMA busy_timeout=5000")
    return c


def fsync_dir(p):
    fd = os.open(p, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def setup():
    shutil.rmtree(W, ignore_errors=True)
    os.makedirs(TMP)
    c = db()
    c.executescript("""
    CREATE TABLE learner(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE export_job(id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL,
      file_name TEXT, size_bytes INTEGER, sha256 TEXT, error TEXT);
    """)
    c.execute("BEGIN IMMEDIATE")
    for i in range(20000):
        c.execute("INSERT INTO learner VALUES(?,?,?)", (uuid.uuid4().hex, f"Name {i}", "learner"))
    c.execute("COMMIT"); c.close()


def run_export(job_id, slow=False):
    """The job body (runs in the worker)."""
    c = db()
    jt = os.path.join(TMP, job_id)
    os.makedirs(jt, exist_ok=True)
    snap = os.path.join(jt, "snapshot.sqlite")
    c.execute("VACUUM INTO ?", (snap,))
    with open(snap, "rb+") as f:
        os.fsync(f.fileno())                 # VACUUM INTO output is not assumed durable
    s = sqlite3.connect(f"file:{snap}?mode=ro", uri=True)
    part = os.path.join(jt, "export.zip.part")
    members = {}
    with zipfile.ZipFile(part, "w", compression=zipfile.ZIP_DEFLATED) as z:
        buf = io.StringIO(); wr = csv.writer(buf); wr.writerow(["learner_code", "role"])
        for (lid, role) in s.execute("SELECT id, role FROM learner ORDER BY id"):
            wr.writerow([lid[:8], role])
            if slow: time.sleep(0.00002)
        data = buf.getvalue().encode("utf-8")
        members["learners.csv"] = hashlib.sha256(data).hexdigest()
        z.writestr("learners.csv", data)
        z.writestr("manifest.json", json.dumps({"format": "sensebod-offline-learner-export/1", "files": members}, indent=1))
    s.close()
    h = hashlib.sha256()
    with open(part, "rb+") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
        os.fsync(f.fileno())
    size = os.path.getsize(part)
    final_name = f"sensebod-offline-learners-{job_id}.zip"
    os.rename(part, os.path.join(EXP, final_name))   # atomic within one filesystem
    fsync_dir(EXP)
    c.execute("BEGIN IMMEDIATE")
    c.execute("UPDATE export_job SET state='ready', file_name=?, size_bytes=?, sha256=? WHERE id=? AND state='preparing'",
              (final_name, size, h.hexdigest(), job_id))
    c.execute("COMMIT")
    shutil.rmtree(jt, ignore_errors=True)
    c.close()


def recover():
    """Boot-time recovery (runs before the worker accepts jobs)."""
    c = db()
    c.execute("BEGIN IMMEDIATE")
    c.execute("UPDATE export_job SET state='interrupted', error='power_or_crash' WHERE state='preparing'")
    c.execute("COMMIT")
    shutil.rmtree(TMP, ignore_errors=True); os.makedirs(TMP); fsync_dir(EXP)
    ready = {r[0]: r for r in c.execute("SELECT file_name, size_bytes, sha256, id FROM export_job WHERE state='ready'")}
    for name in os.listdir(EXP):
        if name == ".tmp":
            continue
        if name not in ready:
            os.remove(os.path.join(EXP, name))   # renamed but never committed: not trusted
    for name, (fn, size, sha, jid) in ready.items():
        p = os.path.join(EXP, fn)
        ok = os.path.exists(p) and os.path.getsize(p) == size
        if ok:
            h = hashlib.sha256(open(p, "rb").read()).hexdigest(); ok = h == sha
        if not ok:
            c.execute("BEGIN IMMEDIATE"); c.execute("UPDATE export_job SET state='interrupted', error='file_lost' WHERE id=?", (jid,)); c.execute("COMMIT")
            if os.path.exists(p): os.remove(p)
    fsync_dir(EXP)
    c.close()


def check():
    c = db()
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert c.execute("SELECT count(*) FROM export_job WHERE state='preparing'").fetchone()[0] == 0
    files = set(n for n in os.listdir(EXP) if n != ".tmp")
    ready = list(c.execute("SELECT file_name, size_bytes, sha256 FROM export_job WHERE state='ready'"))
    assert files == {r[0] for r in ready}, (files, ready)
    for fn, size, sha in ready:
        p = os.path.join(EXP, fn)
        assert os.path.getsize(p) == size and hashlib.sha256(open(p, "rb").read()).hexdigest() == sha
        with zipfile.ZipFile(p) as z:
            assert z.testzip() is None
    assert os.listdir(TMP) == []
    c.close()


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "child":
    run_export(sys.argv[2], slow=True)
    sys.exit(0)

if __name__ == "__main__":
    setup()
    t0 = time.perf_counter(); jid = "warmup"
    c = db(); c.execute("INSERT INTO export_job(id, kind, state) VALUES(?, 'learners', 'preparing')", (jid,)); c.close()
    run_export(jid, slow=True); full = time.perf_counter() - t0
    print(f"one uninterrupted export took {full*1000:.0f} ms")
    outcomes = {"ready": 0, "interrupted": 0}
    trials = int(os.environ.get("TRIALS", "60"))
    for i in range(trials):
        jid = f"j{i:03d}"
        c = db(); c.execute("INSERT INTO export_job(id, kind, state) VALUES(?, 'learners', 'preparing')", (jid,)); c.close()
        p = subprocess.Popen([sys.executable, "-I", os.path.abspath(__file__), "child", jid])
        time.sleep(random.uniform(0, full * 1.3))
        if p.poll() is None:
            p.send_signal(signal.SIGKILL)
        p.wait()
        recover()
        check()
        st = db().execute("SELECT state FROM export_job WHERE id=?", (jid,)).fetchone()[0]
        outcomes[st] = outcomes.get(st, 0) + 1
    print(f"{trials} kill -9 trials: invariants held every time; outcomes {outcomes}")
