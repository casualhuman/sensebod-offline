"""Verifier's SQLite checks (Mac, SQLite from Python's sqlite3). Run: python3 -I verify_sqlite.py
V-T1  wal_checkpoint(TRUNCATE) while another connection holds a read transaction
V-T2  does the export password survive the documented wipe (secure_delete + TRUNCATE checkpoint)?
      - in the live db / wal files, in a local snapshot taken while the job ran, in idempotency_record
V-T3  restore rule: stale -wal next to a swapped-in database file
"""
import os, sqlite3, shutil, subprocess, sys, json, time

W = os.path.join(os.path.dirname(os.path.abspath(__file__)), "work_sqlite")
shutil.rmtree(W, ignore_errors=True); os.makedirs(W)
P = os.path.join(W, "live.sqlite3")

def conn(path=P):
    c = sqlite3.connect(path, isolation_level=None, timeout=5)
    c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA synchronous=FULL")
    return c

def grep(path, needle):
    if not os.path.exists(path): return "absent"
    return "FOUND" if needle.encode() in open(path, "rb").read() else "not found"

# ---------------------------------------------------------------- V-T1
c = conn(); c.execute("CREATE TABLE t(x)")
for i in range(200): c.execute("INSERT INTO t VALUES (randomblob(1000))")
r = conn(); r.execute("BEGIN"); r.execute("SELECT count(*) FROM t").fetchone()   # reader holds a snapshot
for i in range(200): c.execute("INSERT INTO t VALUES (randomblob(1000))")
res = c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
print(f"V-T1 checkpoint(TRUNCATE) with an open reader: (busy, log, checkpointed) = {res}; wal bytes = {os.path.getsize(P+'-wal')}")
r.execute("COMMIT"); r.close()
res = c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
print(f"V-T1 same after the reader closed:            (busy, log, checkpointed) = {res}; wal bytes = {os.path.getsize(P+'-wal')}")
c.execute("DROP TABLE t")

# ---------------------------------------------------------------- V-T2
PW = "river-mango-seven-chalk-42"
c.executescript("""
CREATE TABLE job(id TEXT PRIMARY KEY, state TEXT, payload_json TEXT);
CREATE TABLE idempotency_record(scope TEXT, key TEXT, response_json TEXT, PRIMARY KEY(scope,key));
""")
# POST /admin/exports: export+job rows and the idempotency record are written in one transaction (SYSTEM-ARCHITECTURE §5.1)
c.execute("BEGIN IMMEDIATE")
c.execute("INSERT INTO job VALUES ('jb-1','queued',?)", (json.dumps({"password": PW}),))
c.execute("INSERT INTO idempotency_record VALUES ('admin:ad-1','k-123',?)", (json.dumps({"id": "ex-1", "state": "preparing", "password": PW}),))
c.execute("COMMIT")
# maint timer takes a local snapshot while the job is running (DATA-EXPORT §9)
snap = os.path.join(W, "auto-snapshot.sqlite3")
c.execute("VACUUM INTO ?", (snap,))
# job ends: wipe the password with secure_delete=ON on that connection, then checkpoint(TRUNCATE) (DATA-EXPORT §6.1)
c.execute("PRAGMA secure_delete=ON")
c.execute("BEGIN IMMEDIATE"); c.execute("UPDATE job SET state='done', payload_json='{}' WHERE id='jb-1'"); c.execute("COMMIT")
print("V-T2 checkpoint after wipe:", c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone())
c.close()
for name in ["live.sqlite3", "live.sqlite3-wal", "auto-snapshot.sqlite3"]:
    print(f"V-T2 password bytes in {name:24s}: {grep(os.path.join(W, name), PW)}")
c = conn()
print("V-T2 idempotency_record.response_json still holds the password:", PW in c.execute("SELECT response_json FROM idempotency_record").fetchone()[0])
c.close()

# ---------------------------------------------------------------- V-T3
A = os.path.join(W, "a.sqlite3")
child = r'''
import sqlite3, os, sys
c = sqlite3.connect(sys.argv[1], isolation_level=None)
c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA wal_autocheckpoint=0")
c.execute("CREATE TABLE IF NOT EXISTS learner(id TEXT PRIMARY KEY, name TEXT)")
for i in range(50): c.execute("INSERT INTO learner VALUES (?,?)", (f"old-{i}", "x"*200))
os._exit(0)   # leave the -wal behind, as a crash would
'''
b = sqlite3.connect(A, isolation_level=None); b.execute("PRAGMA journal_mode=WAL")
b.execute("CREATE TABLE learner(id TEXT PRIMARY KEY, name TEXT)"); b.execute("INSERT INTO learner VALUES ('base','b')")
b.execute("PRAGMA wal_checkpoint(TRUNCATE)"); b.close()
restored = os.path.join(W, "restored.sqlite3")
shutil.copy(A, restored)                          # stands in for the backup's database
subprocess.run([sys.executable, "-I", "-c", child, A], check=True)
print("V-T3 stale wal bytes left by crashed writer:", os.path.getsize(A + "-wal"))
os.replace(restored, A)                           # swap WITHOUT removing the old -wal / -shm
try:
    t = sqlite3.connect(A); n = t.execute("SELECT count(*) FROM learner").fetchone()[0]
    ic = t.execute("PRAGMA integrity_check").fetchone()[0]
    print(f"V-T3 after swap with stale -wal: learners visible = {n} (backup had 1), integrity = {ic}")
except Exception as e:
    print("V-T3 after swap with stale -wal: error", e)
