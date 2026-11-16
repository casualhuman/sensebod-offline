"""Throwaway PoC for V-019 (revision 2): Child protection counts must not share any ordering with personal data.
Run: python3 -I poc_cp_unlink.py   (Mac; real SQLite files in WAL mode, created next to this script in work_cp/)

Replays the verifier's afternoon: three saved learners write progress;
Fatmata opens a Child protection lesson between two of her own progress writes.

  v1 design (revision 1): counts in the main database, stamped with the global change_seq.
  v2 design (revision 2): counts and the de-duplication table in a SEPARATE file counts.sqlite3, with no seq,
                          no timestamp finer than the day, no rowid order exposed in sync (merge by natural key).

Checks (for the v2 design; v1 is the control):
  C1 no column of the count tables is comparable with lesson_progress.seq or updated_at (schema-level)
  C2 the main database's WAL and file contain no byte of the Child protection lesson id
     (so frame order in the main WAL cannot place the open between Fatmata's writes)
  C3 the count file contains no learner id, no learner name, no time of day
  C4 a Child protection event appends nothing to the main database's WAL (in the real bag the main database
     holds Child protection lesson ids in its content tables, so C4, not C2, is the decisive check there)
"""
import os, shutil, sqlite3, random

D = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(D, "work_cp")
CP = "cp-it-is-not-my-fault"
NAMES = {"lr-a": "Aminata", "lr-f": "Fatmata", "lr-m": "Mohamed"}


def open_db(path):
    c = sqlite3.connect(path, isolation_level=None)
    c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA synchronous=FULL")
    c.execute("PRAGMA wal_autocheckpoint=0")          # keep every frame in the WAL so C2 sees all commits
    return c


def run(design):
    d = os.path.join(W, design); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    main = open_db(os.path.join(d, "sensebod-offline.sqlite3"))
    main.executescript("""
    CREATE TABLE bag_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO bag_meta VALUES('change_seq','0');
    CREATE TABLE learner(id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE lesson_progress(learner_id TEXT, lesson_id TEXT, state TEXT, updated_at TEXT, seq INTEGER,
                                 PRIMARY KEY(learner_id, lesson_id));""")
    if design == "v1":
        main.execute("CREATE TABLE sensitive_activity_count(lesson_id TEXT, day TEXT, opened INTEGER DEFAULT 0, "
                     "finished INTEGER DEFAULT 0, seq INTEGER, PRIMARY KEY(lesson_id, day))")
        counts = main
    else:
        counts = open_db(os.path.join(d, "counts.sqlite3"))
        counts.executescript("""
        CREATE TABLE sensitive_activity_count(lesson_id TEXT NOT NULL, day TEXT NOT NULL,
          opened INTEGER NOT NULL DEFAULT 0, finished INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(lesson_id, day)) WITHOUT ROWID;
        CREATE TABLE sensitive_activity_seen(view_id TEXT NOT NULL, lesson_id TEXT NOT NULL, event TEXT NOT NULL,
          day TEXT NOT NULL, PRIMARY KEY(view_id, lesson_id, event)) WITHOUT ROWID;""")
    for lid, n in NAMES.items():
        main.execute("INSERT INTO learner VALUES(?,?)", (lid, n))
    rng = random.Random(3); t = [0]

    def seq():
        return main.execute("UPDATE bag_meta SET value=value+1 WHERE key='change_seq' RETURNING value").fetchone()[0]

    def progress(l, lesson):
        t[0] += rng.randint(20, 90)
        main.execute("BEGIN IMMEDIATE")
        main.execute("INSERT OR REPLACE INTO lesson_progress VALUES(?,?,?,?,?)",
                     (l, lesson, "started", f"14:{t[0]//60:02d}:{t[0]%60:02d}", seq()))
        main.execute("COMMIT")

    def cp_open(view_id):
        counts.execute("BEGIN IMMEDIATE")
        if design == "v1":
            counts.execute("INSERT INTO sensitive_activity_count(lesson_id, day, opened, seq) VALUES(?, '2026-11-13', 1, ?) "
                           "ON CONFLICT(lesson_id, day) DO UPDATE SET opened=opened+1, seq=excluded.seq", (CP, seq()))
        else:
            if counts.execute("INSERT OR IGNORE INTO sensitive_activity_seen VALUES(?, ?, 'opened', '2026-11-13')",
                              (view_id, CP)).rowcount == 1:
                counts.execute("INSERT INTO sensitive_activity_count(lesson_id, day, opened) VALUES(?, '2026-11-13', 1) "
                               "ON CONFLICT(lesson_id, day) DO UPDATE SET opened=opened+1", (CP,))
        counts.execute("COMMIT")

    for i in range(6):
        progress(rng.choice(["lr-a", "lr-m"]), f"agri-{i}")
    progress("lr-f", "agri-quail-1")
    walp = os.path.join(d, "sensebod-offline.sqlite3-wal")
    before = os.path.getsize(walp)
    cp_open(os.urandom(16).hex())
    cp_open(os.urandom(16).hex()) if design == "v2" else None   # a second, unrelated view the same day
    main_frames_added = os.path.getsize(walp) - before
    progress("lr-f", "agri-quail-2")
    for i in range(6):
        progress(rng.choice(["lr-a", "lr-m"]), f"agri-{i+6}")

    cols = [r[1] for r in counts.execute("PRAGMA table_info(sensitive_activity_count)")] + \
           ([r[1] for r in counts.execute("PRAGMA table_info(sensitive_activity_seen)")] if design == "v2" else [])
    c1 = not any(c in ("seq", "updated_at", "created_at", "at") for c in cols)
    main_bytes = b"".join(open(os.path.join(d, f), "rb").read() for f in os.listdir(d) if f.startswith("sensebod-offline.sqlite3"))
    c2 = CP.encode() not in main_bytes
    if design == "v2":
        cnt_bytes = b"".join(open(os.path.join(d, f), "rb").read() for f in os.listdir(d) if f.startswith("counts.sqlite3"))
        c3 = not any(x.encode() in cnt_bytes for x in list(NAMES) + list(NAMES.values()) + ["14:"])
    else:
        c3 = None
    neighbours = []
    if design == "v1":
        s = counts.execute("SELECT seq FROM sensitive_activity_count").fetchone()[0]
        neighbours = [r[0] for r in main.execute("SELECT l.name FROM lesson_progress p JOIN learner l ON l.id=p.learner_id "
                                                  "WHERE p.seq IN (?, ?)", (s - 1, s + 1))]
    print(f"{design}: count columns={cols}; C1 no shared ordering column={c1}; "
          f"C2 CP lesson id absent from main DB+WAL={c2}; C3 count file free of learner ids/names/times={c3}"
          + f"; C4 bytes appended to the MAIN WAL by the Child protection event(s)={main_frames_added}"
          + (f"; seq neighbours of the count row={neighbours}" if neighbours else ""))
    main.close()
    if counts is not main:
        counts.close()


if __name__ == "__main__":
    os.makedirs(W, exist_ok=True)
    run("v1")
    run("v2")
    shutil.rmtree(W, ignore_errors=True)
