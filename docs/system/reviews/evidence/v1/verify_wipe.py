"""V-T2b: does secure_delete + checkpoint(TRUNCATE) remove the job-payload password when no other copy exists?
Case A: no reader open at wipe time. Case B: a reader (e.g. an API thread mid-request) is open during the checkpoint."""
import os, sqlite3, shutil, json
W = os.path.join(os.path.dirname(os.path.abspath(__file__)), "work_wipe")
PW = "river-mango-seven-chalk-42"
def run(reader_open):
    shutil.rmtree(W, ignore_errors=True); os.makedirs(W); P = os.path.join(W, "live.sqlite3")
    c = sqlite3.connect(P, isolation_level=None); c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA synchronous=FULL")
    c.execute("CREATE TABLE job(id TEXT PRIMARY KEY, state TEXT, payload_json TEXT)")
    c.execute("INSERT INTO job VALUES ('jb-1','queued',?)", (json.dumps({"password": PW}),))
    r = None
    if reader_open:
        r = sqlite3.connect(P, isolation_level=None); r.execute("BEGIN"); r.execute("SELECT * FROM job").fetchall()
    c.execute("PRAGMA secure_delete=ON")
    c.execute("UPDATE job SET state='done', payload_json='{}' WHERE id='jb-1'")
    ck = c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
    hits = {n: (PW.encode() in open(os.path.join(W, n), "rb").read()) for n in os.listdir(W) if n.startswith("live")}
    sizes = {n: os.path.getsize(os.path.join(W, n)) for n in os.listdir(W) if n.startswith("live")}
    print(f"reader_open={reader_open}: checkpoint={ck} password present per file={hits} sizes={sizes}")
    if r: r.execute("COMMIT"); r.close()
    c.close()
run(False); run(True)
