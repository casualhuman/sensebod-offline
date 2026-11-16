-- 0001_initial: counts.sqlite3, DATABASE.md §6 (verbatim).
CREATE TABLE counts_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;   -- 'schema_version', 'bag_id'

CREATE TABLE sensitive_activity_count (  -- Child protection: counts only, never linked to a learner (ADR-009)
  lesson_id TEXT NOT NULL,
  day       TEXT NOT NULL CHECK (length(day) = 10),   -- 'YYYY-MM-DD' server date; nothing finer
  opened    INTEGER NOT NULL DEFAULT 0 CHECK (opened >= 0),
  finished  INTEGER NOT NULL DEFAULT 0 CHECK (finished >= 0),
  PRIMARY KEY (lesson_id, day)
) WITHOUT ROWID;

CREATE TABLE sensitive_activity_seen (   -- de-duplication of anonymous events (V-009); only the current day is kept
  view_id   TEXT NOT NULL CHECK (length(view_id) = 32),   -- random per page view, made by the phone
  lesson_id TEXT NOT NULL,
  event     TEXT NOT NULL CHECK (event IN ('opened','finished')),
  day       TEXT NOT NULL CHECK (length(day) = 10),
  PRIMARY KEY (view_id, lesson_id, event)
) WITHOUT ROWID;
