"""V2 check: does the global change_seq stamped on sensitive_activity_count (DATABASE §6.4 step 2) link a
Child protection open to a named learner on a stolen card or in a backup?
Model of a quiet afternoon on a small bag: three saved learners use non-CP lessons; one of them (Fatmata)
opens a Child protection lesson between two of her own progress writes. Rules exactly as DATABASE §4.6/§6.3/§6.4:
every write takes next_seq(); the CP count row keeps only the seq of its last increment.
Run: python3 -I verify_cp_seq_link.py"""
import sqlite3, random
c = sqlite3.connect(":memory:")
c.executescript("""
CREATE TABLE bag_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO bag_meta VALUES('change_seq','0');
CREATE TABLE learner(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE lesson_progress(learner_id TEXT, lesson_id TEXT, state TEXT, updated_at TEXT, seq INTEGER, PRIMARY KEY(learner_id, lesson_id));
CREATE TABLE sensitive_activity_count(lesson_id TEXT, day TEXT, opened INTEGER DEFAULT 0, finished INTEGER DEFAULT 0, seq INTEGER, PRIMARY KEY(lesson_id, day));
""")
def seq(): return c.execute("UPDATE bag_meta SET value=value+1 WHERE key='change_seq' RETURNING value").fetchone()[0]
for lid, n in (("lr-a", "Aminata"), ("lr-f", "Fatmata"), ("lr-m", "Mohamed")): c.execute("INSERT INTO learner VALUES(?,?)", (lid, n))
rng = random.Random(3); t = 0
def progress(l, lesson):
    global t; t += rng.randint(20, 90)
    c.execute("INSERT OR REPLACE INTO lesson_progress VALUES(?,?,?,?,?)", (l, lesson, "started", f"14:{t//60:02d}:{t%60:02d}", seq()))
def cp_open(lesson):
    c.execute("INSERT INTO sensitive_activity_count(lesson_id, day, opened, seq) VALUES(?, '2026-11-13', 1, ?) "
              "ON CONFLICT(lesson_id, day) DO UPDATE SET opened=opened+1, seq=excluded.seq", (lesson, seq()))
for i in range(6): progress(rng.choice(["lr-a", "lr-m"]), f"agri-{i}")
progress("lr-f", "agri-quail-1")
cp_open("cp-it-is-not-my-fault")            # Fatmata opens the CP lesson (anonymous request, no learner id)
progress("lr-f", "agri-quail-2")
for i in range(6): progress(rng.choice(["lr-a", "lr-m"]), f"agri-{i+6}")
s = c.execute("SELECT seq FROM sensitive_activity_count").fetchone()[0]
print(f"CP count row: lesson cp-it-is-not-my-fault, seq={s}")
for row in c.execute("SELECT p.seq, l.name, p.lesson_id, p.updated_at FROM lesson_progress p JOIN learner l ON l.id=p.learner_id "
                     "WHERE p.seq BETWEEN ? AND ? ORDER BY p.seq", (s - 1, s + 1)):
    print("  neighbour:", row)
