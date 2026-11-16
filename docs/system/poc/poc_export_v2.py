"""Throwaway PoC, revision 1: the export protocol after findings V-002, V-004, V-017.
Run: python3 -I poc_export_v2.py    (Mac numbers; not a Pi; SIGKILL is not a power cut)

What changed from poc_export.py:
  - The one-time password never enters SQLite. The API writes it to a 0600 file in a "tmpfs" folder
    (simulated: RUN/, which is deleted to simulate a power cut). The idempotency record stores the
    response with password=null, passwordShown=true.
  - Each export job runs in its own child process (one per job, supervised by the lane), so a crash of
    the job or of the worker is a process death.
  - Worker-start recovery (no reboot): every 'running' job -> data: interrupted/worker_restart; its tmp
    folder and secret removed.
  - Boot recovery additionally: 'queued' data jobs -> interrupted/power_or_crash (secret gone with tmpfs);
    after an unclean boot every 'ready' export becomes 'checking' until its SHA-256 is re-checked.
  - The job refuses to build an encrypted export without its password (failed/password_missing).
  - One export 'preparing' per destination (unique index on destination).

Scenarios, chosen at random per trial:
  A  kill the job process at a random moment, then worker-start recovery only (Pi stays up)       [V-002]
  B  kill the job process at a random moment, lose RUN/ (power cut), boot recovery (unclean)     [V-004, V-017]
  C  power cut after the request was accepted but before any worker claimed it (job 'queued')     [V-004]
  D  revision 2: the API wrote the password file, then its commit failed or the API died before committing;
     the maintenance sweep (secret files whose export is not 'preparing', or with no row and older than
     10 min; the PoC uses 0 min) must remove it                                                    [V-021]
Invariants checked after every trial:
  I1 every 'ready' export has a final file with matching size and SHA-256, and says encrypted=true
  I2 no file in exports/ without a 'ready'/'checking' row
  I3 no 'preparing' export and no 'running' job remain; tmp empty
  I4 live DB integrity_check ok
  I5 no generated password appears in the DB, its WAL, or any file under the bag's data folder
  I6 a new export can be created immediately (the unique index is not blocked)
  I7 no secret file remains for an export that is not 'preparing'
"""
import os, sys, sqlite3, hashlib, zipfile, json, random, subprocess, time, shutil, io, csv, signal, uuid, secrets

D = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(D, "work_export_v2")
LIVE = os.path.join(W, "data", "sensebod-offline.db")
EXP = os.path.join(W, "data", "exports")
TMP = os.path.join(EXP, ".tmp")
RUN = os.path.join(W, "run", "export-secrets")   # stands for /run/sensebod-offline/export-secrets (tmpfs)


def db():
    c = sqlite3.connect(LIVE, isolation_level=None, timeout=5)
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
    os.makedirs(TMP); os.makedirs(RUN, mode=0o700)
    c = db()
    c.executescript("""
    CREATE TABLE learner(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE job(id TEXT PRIMARY KEY, lane TEXT, state TEXT, boot_id TEXT, error_code TEXT);
    CREATE TABLE export(id TEXT PRIMARY KEY, destination TEXT NOT NULL, state TEXT NOT NULL, job_id TEXT,
      encrypted INTEGER NOT NULL, file_name TEXT, size_bytes INTEGER, sha256 TEXT, error_code TEXT);
    CREATE UNIQUE INDEX export_one_preparing ON export(destination) WHERE state='preparing';
    CREATE TABLE idempotency_record(key TEXT PRIMARY KEY, response_json TEXT);
    """)
    c.execute("BEGIN IMMEDIATE")
    for i in range(20000):
        c.execute("INSERT INTO learner VALUES(?,?,?)", (uuid.uuid4().hex, f"Name {i}", "learner"))
    c.execute("COMMIT"); c.close()


PASSWORDS = []


def api_create_export(c):
    """POST /admin/exports: returns the response the admin sees; the password exists only in RUN/ and the response."""
    eid = "ex" + secrets.token_hex(6); jid = "jb" + secrets.token_hex(6)
    pw = "-".join(secrets.token_hex(3) for _ in range(4)) + "-" + str(random.randint(10, 99))
    PASSWORDS.append(pw)
    tmpf = os.path.join(RUN, f".{eid}.tmp")
    fd = os.open(tmpf, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(fd, pw.encode()); os.fsync(fd); os.close(fd)
    os.rename(tmpf, os.path.join(RUN, eid))
    response = {"id": eid, "state": "preparing", "password": pw}
    stored = dict(response, password=None, passwordShown=True)        # never store the password
    c.execute("BEGIN IMMEDIATE")
    c.execute("INSERT INTO job VALUES(?, 'data', 'queued', NULL, NULL)", (jid,))
    c.execute("INSERT INTO export(id, destination, state, job_id, encrypted) VALUES(?, 'download', 'preparing', ?, 1)", (eid, jid))
    c.execute("INSERT INTO idempotency_record VALUES(?, ?)", (secrets.token_hex(8), json.dumps(stored)))
    c.execute("COMMIT")
    return response, jid


def job_child(jid, boot_id):
    """The job process (spawned per job by the data lane)."""
    c = db()
    c.execute("BEGIN IMMEDIATE")
    row = c.execute("SELECT e.id, e.encrypted FROM export e JOIN job j ON j.id=e.job_id WHERE j.id=? AND j.state='queued'", (jid,)).fetchone()
    if not row:
        c.execute("ROLLBACK"); return
    c.execute("UPDATE job SET state='running', boot_id=? WHERE id=?", (boot_id, jid))
    c.execute("COMMIT")
    eid, encrypted = row
    sp = os.path.join(RUN, eid)
    pw = open(sp).read() if os.path.exists(sp) else None
    if encrypted and not pw:
        c.execute("BEGIN IMMEDIATE")
        c.execute("UPDATE export SET state='failed', error_code='password_missing' WHERE id=?", (eid,))
        c.execute("UPDATE job SET state='failed', error_code='password_missing' WHERE id=?", (jid,))
        c.execute("COMMIT"); return
    jt = os.path.join(TMP, eid); os.makedirs(jt, exist_ok=True)
    snap = os.path.join(jt, "snapshot.sqlite")
    c.execute("VACUUM INTO ?", (snap,))
    with open(snap, "rb+") as f:
        os.fsync(f.fileno())
    s = sqlite3.connect(f"file:{snap}?mode=ro", uri=True)
    part = os.path.join(jt, "export.zip.part")
    with zipfile.ZipFile(part, "w", compression=zipfile.ZIP_DEFLATED) as z:
        buf = io.StringIO(); wr = csv.writer(buf); wr.writerow(["learner_code", "role"])
        for (lid, role) in s.execute("SELECT id, role FROM learner ORDER BY id"):
            wr.writerow([lid[:8], role]); time.sleep(0.00002)
        # pyzipper AES would use pw here; the PoC records only that a password was present (never the password)
        z.writestr("learners.csv", buf.getvalue())
        z.writestr("manifest.json", json.dumps({"encrypted": bool(pw)}))
    s.close()
    h = hashlib.sha256()
    with open(part, "rb+") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
        os.fsync(f.fileno())
    name = f"learners-{eid}.zip"
    os.rename(part, os.path.join(EXP, name)); fsync_dir(EXP)
    c.execute("BEGIN IMMEDIATE")
    c.execute("UPDATE export SET state='ready', file_name=?, size_bytes=?, sha256=? WHERE id=? AND state='preparing'",
              (name, os.path.getsize(os.path.join(EXP, name)), h.hexdigest(), eid))
    c.execute("UPDATE job SET state='done' WHERE id=?", (jid,))
    c.execute("COMMIT")
    os.remove(sp)                       # password gone as soon as the file is ready
    shutil.rmtree(jt, ignore_errors=True)
    c.close()


def _interrupt(c, where_sql, code):
    c.execute("BEGIN IMMEDIATE")
    ids = [r[0] for r in c.execute(f"SELECT e.id FROM export e JOIN job j ON j.id=e.job_id WHERE {where_sql}")]
    for eid in ids:
        c.execute("UPDATE export SET state='interrupted', error_code=? WHERE id=?", (code, eid))
    c.execute(f"UPDATE job SET state='interrupted', error_code=? WHERE id IN (SELECT j.id FROM job j JOIN export e ON j.id=e.job_id WHERE {where_sql})", (code,))
    c.execute("COMMIT")
    for eid in ids:
        shutil.rmtree(os.path.join(TMP, eid), ignore_errors=True)
        p = os.path.join(RUN, eid)
        if os.path.exists(p): os.remove(p)


def worker_start_recovery():
    """V-002: the only worker starts; anything 'running' is orphaned. Queued jobs keep their secret and may run."""
    c = db(); _interrupt(c, "j.state='running'", "worker_restart"); c.close()


def boot_recovery():
    """Boot: tmpfs is empty, so queued data jobs cannot be honoured either (V-004). Ready files are re-checked (V-017)."""
    c = db()
    _interrupt(c, "j.state IN ('running','queued')", "power_or_crash")
    shutil.rmtree(TMP, ignore_errors=True); os.makedirs(TMP); fsync_dir(EXP)
    c.execute("BEGIN IMMEDIATE"); c.execute("UPDATE export SET state='checking' WHERE state='ready'"); c.execute("COMMIT")
    known = {r[0] for r in c.execute("SELECT file_name FROM export WHERE state IN ('ready','checking')")}
    for n in os.listdir(EXP):
        if n != ".tmp" and n not in known:
            os.remove(os.path.join(EXP, n))
    for eid, fn, size, sha in list(c.execute("SELECT id, file_name, size_bytes, sha256 FROM export WHERE state='checking'")):
        p = os.path.join(EXP, fn)
        ok = os.path.exists(p) and os.path.getsize(p) == size and hashlib.sha256(open(p, "rb").read()).hexdigest() == sha
        c.execute("BEGIN IMMEDIATE")
        c.execute("UPDATE export SET state=? , error_code=? WHERE id=?", ("ready" if ok else "interrupted", None if ok else "file_lost", eid))
        c.execute("COMMIT")
        if not ok and os.path.exists(p): os.remove(p)
    c.close()


def maint_sweep(min_age_s=0):
    """sensebod-offline-maint, revision 2 (V-021): remove secret files whose export is not 'preparing', or with no row."""
    c = db()
    prep = {r[0] for r in c.execute("SELECT id FROM export WHERE state='preparing'")}
    known = {r[0] for r in c.execute("SELECT id FROM export")}
    c.close()
    for n in os.listdir(RUN):
        p = os.path.join(RUN, n)
        if n.startswith("."):
            continue
        if n in known and n not in prep:
            os.remove(p)
        elif n not in known and time.time() - os.path.getmtime(p) >= min_age_s:
            os.remove(p)


def api_dies_before_commit():
    eid = "ex" + secrets.token_hex(6)
    pw = "orphan-" + secrets.token_hex(6)
    PASSWORDS.append(pw)
    tmpf = os.path.join(RUN, f".{eid}.tmp")
    fd = os.open(tmpf, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, pw.encode()); os.fsync(fd); os.close(fd)
    os.rename(tmpf, os.path.join(RUN, eid))
    return eid                                   # ... and the transaction never commits


def check():
    c = db()
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"                                         # I4
    assert c.execute("SELECT count(*) FROM export WHERE state IN ('preparing','checking')").fetchone()[0] == 0  # I3
    assert c.execute("SELECT count(*) FROM job WHERE state='running'").fetchone()[0] == 0                       # I3
    files = {n for n in os.listdir(EXP) if n != ".tmp"}
    ready = list(c.execute("SELECT file_name, size_bytes, sha256 FROM export WHERE state='ready'"))
    assert files == {r[0] for r in ready}, (files, ready)                                                        # I2
    for fn, size, sha in ready:                                                                                 # I1
        p = os.path.join(EXP, fn)
        assert os.path.getsize(p) == size and hashlib.sha256(open(p, "rb").read()).hexdigest() == sha
        with zipfile.ZipFile(p) as z:
            assert z.testzip() is None and json.loads(z.read("manifest.json"))["encrypted"] is True
    assert os.listdir(TMP) == []                                                                                # I3
    live = {r[0] for r in c.execute("SELECT id FROM export WHERE state='preparing'")}
    assert set(os.listdir(RUN)) <= live                                                                         # I7
    c.close()


def scan_passwords():                                                                                           # I5
    hits = []
    for root, _, fs in os.walk(os.path.join(W, "data")):
        for f in fs:
            b = open(os.path.join(root, f), "rb").read()
            for pw in PASSWORDS:
                if pw.encode() in b:
                    hits.append((f, pw))
    return hits


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "child":
    job_child(sys.argv[2], sys.argv[3]); sys.exit(0)

if __name__ == "__main__":
    setup()
    c = db(); _, jid = api_create_export(c); c.close()
    t0 = time.perf_counter(); job_child(jid, "boot0"); full = time.perf_counter() - t0
    print(f"one uninterrupted export took {full*1000:.0f} ms")
    trials = int(os.environ.get("TRIALS", "90"))
    stats = {}
    boot = 0
    for i in range(trials):
        scenario = random.choice("ABCD")
        if scenario == "D":
            orphan = api_dies_before_commit()
            assert os.path.exists(os.path.join(RUN, orphan))
            maint_sweep(0)
            assert not os.path.exists(os.path.join(RUN, orphan)), "orphan secret survived the sweep"
            check()
            stats.setdefault("D", {}).setdefault("orphan removed", 0); stats["D"]["orphan removed"] += 1
            continue
        c = db()
        try:
            resp, jid = api_create_export(c)                                                                     # I6
        finally:
            c.close()
        assert resp["password"]
        if scenario == "C":
            shutil.rmtree(RUN); os.makedirs(RUN, mode=0o700)        # power cut before the worker claimed it
            boot += 1; boot_recovery()
        else:
            p = subprocess.Popen([sys.executable, "-I", os.path.abspath(__file__), "child", jid, f"boot{boot}"])
            time.sleep(random.uniform(0, full * 1.3))
            if p.poll() is None:
                p.send_signal(signal.SIGKILL)
            p.wait()
            if scenario == "A":
                worker_start_recovery()
                # the restarted worker then runs whatever is still queued (its secret is still in tmpfs)
                for (q,) in list(db().execute("SELECT id FROM job WHERE state='queued'")):
                    job_child(q, f"boot{boot}")
            else:
                shutil.rmtree(RUN); os.makedirs(RUN, mode=0o700)
                boot += 1; boot_recovery()
        check()
        st = db().execute("SELECT e.state FROM export e WHERE e.job_id=?", (jid,)).fetchone()[0]
        stats.setdefault(scenario, {}).setdefault(st, 0); stats[scenario][st] += 1
    c = db(); c.execute("PRAGMA wal_checkpoint(TRUNCATE)"); c.close()
    hits = scan_passwords()
    stored = [json.loads(r[0]) for r in db().execute("SELECT response_json FROM idempotency_record")]
    print(f"{trials} trials, invariants I1-I4, I6, I7 held every time; outcomes by scenario {stats}")
    shutil.rmtree(W, ignore_errors=True)
    print(f"I5 generated passwords: {len(PASSWORDS)}; found in DB/WAL/any data file: {len(hits)}; "
          f"idempotency replays carrying a password: {sum(1 for s in stored if s.get('password'))}")
