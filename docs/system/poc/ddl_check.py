"""Extract the normative DDL from docs/system/DATABASE.md and execute it in SQLite; exercise renumbering and change_seq."""
import re, sqlite3, sys
md = open(sys.argv[1]).read()
ddl = re.search(r"<!-- DDL-BEGIN -->\s*```sql\n(.*?)```\s*<!-- DDL-END -->", md, re.S).group(1)
c = sqlite3.connect(":memory:", isolation_level=None)
c.execute("PRAGMA foreign_keys=ON")
c.executescript(ddl)
counts_ddl = re.search(r"<!-- COUNTS-DDL-BEGIN -->\s*```sql\n(.*?)```\s*<!-- COUNTS-DDL-END -->", md, re.S)
cc = sqlite3.connect(":memory:", isolation_level=None)
if counts_ddl:
    cc.executescript(counts_ddl.group(1))
    print("counts.sqlite3 tables:", [r[0] for r in cc.execute("select name from sqlite_master where type='table'")])
tables = [r[0] for r in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")]
idx = [r[0] for r in c.execute("select name from sqlite_master where type='index' and sql is not null")]
print("sqlite", sqlite3.sqlite_version, "| tables", len(tables), "| explicit indexes", len(idx))
print("tables:", ", ".join(tables))
now = "2026-11-12T10:00:00.000Z"
c.execute("insert into bag_meta values('change_seq','0')")
def seq(): return c.execute("update bag_meta set value = value + 1 where key='change_seq' returning value").fetchone()[0]
c.execute("insert into portal values('agriculture','Agriculture','','agriculture','topic',null,null,4,0,?,?)", (now, seq()))
c.execute("insert into content_group(id,portal_id,kind,title,sort_order,updated_at,seq) values('g','agriculture','topic','G',1,?,?)", (now, seq()))
c.execute("insert into series(id,group_id,title,sort_order,updated_at,seq) values('s','g','S',1,?,?)", (now, seq()))
for p in range(1, 6):
    c.execute("insert into lesson(id,series_id,position,type,title,source,created_at,updated_at,seq,status) values(?,?,?,?,?,?,?,?,?,'published')", (f"l{p}", "s", p, "watch", f"L{p}", "upload", now, now, seq()))
c.execute("insert into lesson(id,series_id,position,type,title,source,created_at,updated_at,seq,status) values('q','s',null,'check','Quiz','questions',?,?,?,'published')", (now, now, seq()))
# insert new lesson at position 2 with negative pass
c.execute("BEGIN IMMEDIATE")
c.execute("update lesson set position = -position where series_id='s' and position >= 2")
c.execute("insert into lesson(id,series_id,position,type,title,source,created_at,updated_at,seq) values('new','s',2,'read','New','typed',?,?,?)", (now, now, seq()))
c.execute("update lesson set position = -position + 1 where series_id='s' and position < 0")
mn, mx, n = c.execute("select min(position), max(position), count(*) from lesson where series_id='s' and position is not null").fetchone()
assert (mn, mx, n) == (1, 6, 6), (mn, mx, n)
c.execute("COMMIT")
print("renumbering:", [r for r in c.execute("select id, position from lesson where series_id='s' order by position is null, position")])
# constraint probes
probes = {
 "second quiz in a series": "insert into lesson(id,series_id,type,title,source,created_at,updated_at,seq) values('q2','s','check','Q2','questions','x','x',1)",
 "published but unplaced": "insert into lesson(id,type,title,source,created_at,updated_at,seq,status) values('u','read','U','typed','x','x',1,'published')",
 "duplicate position": "insert into lesson(id,series_id,position,type,title,source,created_at,updated_at,seq) values('d','s',3,'read','D','typed','x','x',1)",
 "learner id format": "insert into learner values('bad','A','learner','x',null,1)",
 "two preparing exports": None,
}
for name, sql in probes.items():
    if sql is None: continue
    try:
        c.execute(sql); print("NOT refused:", name)
    except sqlite3.IntegrityError as e:
        print("refused as intended:", name, "->", e)
c.execute("insert into export(id,kind,destination,state,created_by,created_at) values('e1','learner-data','download','preparing','a','x')")
try:
    c.execute("insert into export(id,kind,destination,state,created_by,created_at) values('e2','backup-records','download','preparing','a','x')"); print("NOT refused: two preparing exports")
except sqlite3.IntegrityError as e:
    print("refused as intended: two preparing exports ->", e)
try:
    c.execute("update export set state='ready' where id='e1'"); print("NOT refused: ready without checksum")
except sqlite3.IntegrityError as e:
    print("refused as intended: ready without size/sha256 ->", e)
c.execute("insert into export(id,kind,destination,state,created_by,created_at) values('e3','backup-full','usb','preparing','a','x')")
print("allowed as intended: a USB export preparing while a download export is preparing (one per destination)")
cc.execute("insert into sensitive_activity_seen values(?, 'l1', 'opened', '2026-11-13')", ("v"*32,))
n = cc.execute("insert or ignore into sensitive_activity_seen values(?, 'l1', 'opened', '2026-11-13')", ("v"*32,)).rowcount
cols = [r[1] for r in cc.execute("pragma table_info(sensitive_activity_count)")]
print("count table columns (no seq, no time):", cols)
assert not any(x in cols for x in ("seq", "updated_at"))
assert c.execute("select count(*) from sqlite_master where name like 'sensitive_activity%'").fetchone()[0] == 0
print("repeat of the same anonymous view/event ignored as intended:", n == 0)
print("change_seq now", c.execute("select value from bag_meta where key='change_seq'").fetchone()[0])
