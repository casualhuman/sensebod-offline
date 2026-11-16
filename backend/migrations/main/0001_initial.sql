-- 0001_initial: exactly the DDL of docs/system/DATABASE.md §6 (copied verbatim by scripts; do not edit).
-- ---------------------------------------------------------------- bag
CREATE TABLE bag_meta (
  key   TEXT PRIMARY KEY,        -- 'bag_id','bag_name','provisioned_at','change_seq','epoch' (+1 at every replacement of the live database, SYNC §3.2),'epoch_nonce' (random, new with every epoch),'uptime_total_s' (accumulated bag uptime across boots, written at least every 5 min and at clean shutdown — binding, V-034; used for override expiry, ADR-017),'boot_seq' (monotonic, incremented and committed by boot-recover before the API starts, V-034),'epoch_base_seq' (the counter right after the last replacement; rows with a higher seq were changed in the current lineage, used by `new-epoch` re-stamping, SYNC §3.2),'content_rev','restored_from'
  value TEXT NOT NULL
);

CREATE TABLE setting (           -- values admins can change; defaults live in code
  key        TEXT PRIMARY KEY,   -- e.g. 'export.learner_ttl_hours','storage.reserve_bytes'. The Child protection mode is NOT a setting (V-014): it is release/technician configuration in /etc/sensebod-offline/sensebod-offline.toml
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at TEXT NOT NULL,
  updated_by TEXT                -- admin_account.id or 'system'
);

CREATE TABLE boot (              -- one row per start of the backend after a boot
  boot_id            TEXT PRIMARY KEY,           -- /proc/sys/kernel/random/boot_id
  started_at         TEXT NOT NULL,
  previous_clean     INTEGER NOT NULL CHECK (previous_clean IN (0,1)),  -- 0 = previous run ended without clean shutdown (power loss or crash)
  clock_trust        TEXT NOT NULL CHECK (clock_trust IN ('synced','rtc','restored','unsure')),
  recovery_note      TEXT                         -- what boot recovery did, plain words
);

-- ---------------------------------------------------------------- files
CREATE TABLE blob (              -- one immutable file in the content-addressed store
  sha256      TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  size_bytes  INTEGER NOT NULL CHECK (size_bytes >= 0),
  ext         TEXT NOT NULL CHECK (ext IN ('mp4','m4a','mp3','ogg','opus','webm','jpg','png','webp','vtt','pdf','json','txt')),
  mime_type   TEXT NOT NULL,
  rel_path    TEXT NOT NULL UNIQUE,  -- 'c/ab/ab12…ef.mp4' under /var/lib/sensebod-offline/media/
  origin      TEXT NOT NULL CHECK (origin IN ('upload','derived','content-pack','builtin')),
  created_at  TEXT NOT NULL,
  unreferenced_since TEXT          -- set by GC scan; file deleted 24 h later if still unreferenced
);

-- ---------------------------------------------------------------- content tree
CREATE TABLE picture (           -- gallery pictures
  id          TEXT PRIMARY KEY,
  grp         TEXT NOT NULL CHECK (grp IN ('child-protection','agriculture','climate','school','people-places','own')),
  url_path    TEXT,              -- builtin pictures shipped with the web release ('/illustrations/…')
  blob_sha256 TEXT REFERENCES blob(sha256),  -- own pictures
  alt         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  CHECK ((url_path IS NOT NULL) <> (blob_sha256 IS NOT NULL))
);

CREATE TABLE portal (
  id          TEXT PRIMARY KEY CHECK (id IN ('primary','jss','child-protection','agriculture','climate')),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  theme       TEXT NOT NULL CHECK (theme IN ('blue','agriculture')),
  group_kind  TEXT NOT NULL CHECK (group_kind IN ('class','audience','topic')),
  picture_id  TEXT REFERENCES picture(id) ON DELETE SET NULL,
  listen_blob TEXT REFERENCES blob(sha256),
  sort_order  INTEGER NOT NULL,
  sensitive   INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),  -- 1 = Child protection rules apply (ADR-009)
  updated_at  TEXT NOT NULL,
  seq         INTEGER NOT NULL
);

CREATE TABLE content_group (
  id           TEXT PRIMARY KEY,
  portal_id    TEXT NOT NULL REFERENCES portal(id),
  kind         TEXT NOT NULL CHECK (kind IN ('class','audience','topic')),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  picture_id   TEXT REFERENCES picture(id) ON DELETE SET NULL,
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','not-in-bag')),
  icon         TEXT,             -- ContentIconKey or NULL; unknown keys tolerated by the app
  audience     TEXT CHECK (audience IN ('child','parent','elder')),
  sort_order   INTEGER NOT NULL,
  updated_at   TEXT NOT NULL,
  seq          INTEGER NOT NULL
);
CREATE INDEX content_group_portal ON content_group(portal_id, sort_order);

CREATE TABLE series (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES content_group(id),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  picture_id   TEXT REFERENCES picture(id) ON DELETE SET NULL,
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','not-in-bag')),
  icon         TEXT,
  listen_blob  TEXT REFERENCES blob(sha256),
  sort_order   INTEGER NOT NULL,
  created_by   TEXT,             -- admin_account.id, NULL for shipped content
  updated_at   TEXT NOT NULL,
  seq          INTEGER NOT NULL
);
CREATE INDEX series_group ON series(group_id, sort_order);

CREATE TABLE lesson (
  id            TEXT PRIMARY KEY,
  series_id     TEXT REFERENCES series(id),         -- NULL = waiting to be placed
  position      INTEGER CHECK (position IS NULL OR position <> 0),  -- negative only inside a renumbering transaction (§6.2)
  type          TEXT NOT NULL CHECK (type IN ('watch','listen','read','try','check')),
  interactive   INTEGER NOT NULL DEFAULT 0 CHECK (interactive IN (0,1)),
  captions      INTEGER NOT NULL DEFAULT 0 CHECK (captions IN (0,1)),
  read_along    INTEGER NOT NULL DEFAULT 0 CHECK (read_along IN (0,1)),
  needs_sound   INTEGER NOT NULL DEFAULT 0 CHECK (needs_sound IN (0,1)),
  length_seconds INTEGER CHECK (length_seconds IS NULL OR length_seconds >= 0),
  pages         INTEGER CHECK (pages IS NULL OR pages >= 1),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  summary       TEXT NOT NULL DEFAULT '',
  language      TEXT NOT NULL DEFAULT 'en',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  source        TEXT NOT NULL CHECK (source IN ('upload','notes-photos','typed','animation','questions','content-pack')),
  picture_id    TEXT REFERENCES picture(id) ON DELETE SET NULL,
  listen_blob   TEXT REFERENCES blob(sha256),
  file_names_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(file_names_json)),
  body_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(body_json)),
                -- type-specific: read {blocks}, listen {transcript}, watch {learningPoints}, try {mode,…hotspots},
                -- check/watch {questions:[{id,prompt,listenBlob,answers:[{id,text,correct,feedback}],allowRetry,atSeconds?,pauseUntilAnswered?}]}
  version       INTEGER NOT NULL DEFAULT 1,          -- optimistic concurrency (If-Match)
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  CHECK (series_id IS NOT NULL OR position IS NULL),
  CHECK (type <> 'check' OR position IS NULL),               -- the quiz has no number; it is always last
  CHECK (type = 'check' OR series_id IS NULL OR position IS NOT NULL),
  CHECK (status = 'draft' OR series_id IS NOT NULL)          -- published implies placed
);
CREATE UNIQUE INDEX lesson_series_position ON lesson(series_id, position) WHERE position IS NOT NULL;
CREATE UNIQUE INDEX lesson_one_quiz_per_series ON lesson(series_id) WHERE type = 'check' AND series_id IS NOT NULL;
CREATE INDEX lesson_unplaced ON lesson(updated_at) WHERE series_id IS NULL;
CREATE INDEX lesson_status ON lesson(status, series_id);

CREATE TABLE lesson_asset (      -- files a lesson uses, in order
  lesson_id   TEXT NOT NULL REFERENCES lesson(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('source','smaller','poster','caption','audio','page_image','cover','question_audio','spot_audio','scene')),
  ordinal     INTEGER NOT NULL DEFAULT 0,
  blob_sha256 TEXT NOT NULL REFERENCES blob(sha256),
  language    TEXT,
  label       TEXT,
  PRIMARY KEY (lesson_id, role, ordinal)
);
CREATE INDEX lesson_asset_blob ON lesson_asset(blob_sha256);

CREATE TABLE tryit_package (     -- an unpacked animation package under media/tryit/<id>/
  id          TEXT PRIMARY KEY,
  lesson_id   TEXT REFERENCES lesson(id) ON DELETE SET NULL,
  zip_sha256  TEXT NOT NULL,
  dir_name    TEXT NOT NULL UNIQUE,
  index_path  TEXT NOT NULL DEFAULT 'index.html',
  total_bytes INTEGER NOT NULL,
  checks_json TEXT NOT NULL CHECK (json_valid(checks_json)),
  created_at  TEXT NOT NULL
);

CREATE TABLE upload (
  id              TEXT PRIMARY KEY,
  file_name       TEXT NOT NULL,           -- as sent, for display and search only; never used as a path
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL CHECK (size_bytes >= 0),  -- declared total
  received_bytes  INTEGER NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= size_bytes),
  state           TEXT NOT NULL CHECK (state IN ('receiving','processing','ready','failed','abandoned')),
  kind            TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('video','audio','voice-note','pdf','word','photo','animation','h5p','unknown')),
  becomes         TEXT CHECK (becomes IN ('watch','listen','read','try','check')),
  duration_seconds INTEGER,
  pages           INTEGER,
  smaller_copy    INTEGER NOT NULL DEFAULT 0 CHECK (smaller_copy IN (0,1)),
  blob_sha256     TEXT REFERENCES blob(sha256),
  processing_note TEXT,
  checks_json     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checks_json)),
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX upload_state ON upload(state, updated_at);

-- ---------------------------------------------------------------- learners (personal data; ADR-009)
CREATE TABLE learner (
  id              TEXT PRIMARY KEY CHECK (id LIKE 'lr-%' AND length(id) = 29),
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  role            TEXT NOT NULL CHECK (role IN ('learner','teacher','other')),
  created_at      TEXT NOT NULL,
  last_active_day TEXT,                    -- 'YYYY-MM-DD' only; coarse on purpose
  seq             INTEGER NOT NULL,
  pin_hash        TEXT                     -- scrypt string of the learner's 4-digit secret number; NULL = none set. Never exported.
);

CREATE TABLE lesson_progress (
  learner_id       TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
  lesson_id        TEXT NOT NULL REFERENCES lesson(id) ON DELETE CASCADE,
  state            TEXT NOT NULL CHECK (state IN ('started','finished')),  -- 'not-started' is the absence of a row
  position_seconds INTEGER CHECK (position_seconds IS NULL OR position_seconds >= 0),
  correct          INTEGER CHECK (correct IS NULL OR correct >= 0),
  total            INTEGER CHECK (total IS NULL OR total >= 0),
  updated_at       TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  PRIMARY KEY (learner_id, lesson_id),
  CHECK (correct IS NULL OR total IS NULL OR correct <= total)
);
CREATE INDEX lesson_progress_seq ON lesson_progress(seq);
CREATE INDEX lesson_progress_lesson ON lesson_progress(lesson_id);

-- (The anonymous Child protection tables are NOT in this file: see the counts.sqlite3 DDL below, V-019.)

-- ---------------------------------------------------------------- admin and security
CREATE TABLE admin_account (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 32),
  display_name        TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('hub_manager','admin')),   -- OWNER-6 (assumption): hub_manager everything; admin content + export
  password_hash       TEXT NOT NULL,       -- memory-hard KDF (Argon2id or scrypt) in a self-describing string with parameters and salt; never plaintext
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  failed_count        INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  created_at          TEXT NOT NULL,
  password_changed_at TEXT NOT NULL,
  seq                 INTEGER NOT NULL
);

CREATE TABLE override_request (     -- offline override challenges (OWNER-4, ADR-017)
  id               TEXT PRIMARY KEY CHECK (length(id) = 26),  -- 128 random bits, base32 (V-036)
  username         TEXT NOT NULL COLLATE NOCASE, -- as typed; may not exist (no enumeration); never redeemable then
  nonce            TEXT NOT NULL UNIQUE CHECK (length(nonce) = 8),  -- 40-bit random, Crockford base32
  key_version      INTEGER NOT NULL,
  epoch            INTEGER NOT NULL,             -- a replacement of the database voids it
  created_boot_seq INTEGER NOT NULL,             -- bag_meta.boot_seq at creation (expires after 20 more boots; never a row count, V-034)
  secret_sha256    TEXT NOT NULL,                -- SHA-256 of the 256-bit secret in the creating browser's sb_ovr cookie (V-032)
  presence         INTEGER NOT NULL DEFAULT 0 CHECK (presence IN (0,1)),  -- created via the USB-presence path (V-030)
  created_uptime_s INTEGER NOT NULL,             -- bag_meta.uptime_total_s at creation (expires after 72 h more)
  created_wall_at  TEXT NOT NULL,
  created_clock_trust TEXT NOT NULL,             -- wall-clock expiry only applies if trusted (synced/rtc) now and then; never 'manual'
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  state            TEXT NOT NULL CHECK (state IN ('open','waiting-for-easystem','code-received','declined','send-failed','used','expired','void')),
  received_code    TEXT,                          -- online path: the code fetched from the reset service, until completed (V-032)
  used_at          TEXT,
  client_ip        TEXT
);
CREATE INDEX override_request_open ON override_request(state, created_uptime_s);

CREATE TABLE override_presence (    -- "I am at the bag" tokens (V-030, V-038); rows older than 2 minutes deleted
  token_sha256     TEXT PRIMARY KEY,
  created_uptime_s INTEGER NOT NULL,
  client_ip        TEXT NOT NULL,             -- 3 tokens per hour per IP
  insertion_at_uptime_s INTEGER              -- set when a USB block-device add event happens while the token is live
);

CREATE TABLE override_notice (      -- banner to every admin until a hub manager acknowledges (V-031)
  id              TEXT PRIMARY KEY,
  request_id      TEXT NOT NULL REFERENCES override_request(id),
  username        TEXT NOT NULL,
  used_at         TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TEXT
);

CREATE TABLE clock_jump (           -- forward wall-clock steps > 7 days (V-033)
  id          TEXT PRIMARY KEY,
  at_uptime_s INTEGER NOT NULL,      -- bag_meta.uptime_total_s when detected
  from_time   TEXT NOT NULL,
  to_time     TEXT NOT NULL,
  days        INTEGER NOT NULL CHECK (days > 7),
  source      TEXT NOT NULL CHECK (source IN ('manual','unexplained')),  -- trusted RTC/NTP steps are real time and are not recorded here (revision 5a)
  by_admin    TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT
);

CREATE TABLE admin_session (
  token_sha256        TEXT PRIMARY KEY,    -- the cookie holds the random token; only its hash is stored
  admin_id            TEXT NOT NULL REFERENCES admin_account(id) ON DELETE CASCADE,
  created_at          TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,       -- written at most every 5 minutes per session
  idle_expires_at     TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  client_ip           TEXT NOT NULL,
  boot_id             TEXT NOT NULL
);
CREATE INDEX admin_session_admin ON admin_session(admin_id);

CREATE TABLE idempotency_record (
  scope          TEXT NOT NULL,            -- 'admin:<id>' or 'anon'
  key            TEXT NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  method         TEXT NOT NULL,
  path           TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('in_progress','done')),
  status_code    INTEGER,
  response_json  TEXT,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_created ON idempotency_record(created_at);

CREATE TABLE audit_event (       -- append-only from the application; local integer id is fine (never synced as a key)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  boot_id     TEXT NOT NULL,
  clock_trust TEXT NOT NULL,
  actor_id    TEXT,                -- admin_account.id, 'system', 'technician-cli'
  actor_name  TEXT,                -- copied, so the record survives account deletion
  action      TEXT NOT NULL,       -- e.g. 'export.create','export.download','export.delete','backup.usb','restore','admin.signin.fail'
  target_type TEXT,
  target_id   TEXT,
  outcome     TEXT NOT NULL CHECK (outcome IN ('ok','refused','failed','interrupted')),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),  -- never names of learners
  client_ip   TEXT
);
CREATE INDEX audit_event_action ON audit_event(action, id);

-- ---------------------------------------------------------------- background work, exports
CREATE TABLE job (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,    -- media lane: 'inspect','smaller_copy','voice_convert','pdf_pages','docx_text','package_check'
                                  -- data lane:  'export_learner_data','backup_records','diagnostics' (destination download)
                                  -- usb lane:   the same kinds with destination usb, 'backup_full_usb','usb_check','content_pack_install','release_stage'
                                  -- (snapshots, retention and GC are NOT jobs: sensebod-offline-maint runs them, V-003)
  lane          TEXT NOT NULL CHECK (lane IN ('media','data','usb')),
  state         TEXT NOT NULL CHECK (state IN ('queued','running','done','failed','interrupted','cancelled')),
  payload_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  not_before    TEXT,
  progress      INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  boot_id       TEXT,             -- boot in which it last ran
  heartbeat_at  TEXT,             -- written by the job process at least every 30 s (monotonic stall check is in memory, V-003)
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT,
  error_code    TEXT,
  error_detail  TEXT
);
CREATE INDEX job_queue ON job(lane, state, created_at);

CREATE TABLE export (            -- learner-data downloads, backups, diagnostics (DATA-EXPORT-AND-BACKUP.md)
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('learner-data','backup-records','backup-full','diagnostics')),
  destination      TEXT NOT NULL CHECK (destination IN ('download','usb')),
  state            TEXT NOT NULL CHECK (state IN ('preparing','ready','checking','copied-to-usb','failed','interrupted','expired','deleted')),
  options_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options_json)),  -- includeNames, includeChildProtectionCounts, encrypted, namesOverWifi. NEVER the password (V-004)
  job_id           TEXT REFERENCES job(id),
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  ready_at         TEXT,
  ready_boot_id    TEXT,           -- retention by boots and uptime (V-015)
  ready_boot_seq   INTEGER,        -- bag_meta.boot_seq when it became ready (monotonic, V-034)
  ready_uptime_s   INTEGER,        -- CLOCK_BOOTTIME seconds when it became ready
  expires_at       TEXT,
  file_name        TEXT,
  size_bytes       INTEGER,
  sha256           TEXT,
  snapshot_seq     INTEGER,        -- change_seq of the snapshot it was built from (OWNER-5: "exported" tracking)
  row_counts_json  TEXT CHECK (row_counts_json IS NULL OR json_valid(row_counts_json)),
  error_code       TEXT,           -- 'power_or_crash','worker_restart','stalled','password_missing','no_space','usb_removed','usb_full','file_lost','internal'
  download_count   INTEGER NOT NULL DEFAULT 0,
  last_download_at TEXT,
  received_checked_at TEXT,        -- the admin's page received every byte and the SHA-256 matched (in memory)
  saved_checked_at TEXT,           -- the admin checked the SAVED file and its SHA-256 matched (V-006)
  usb_path         TEXT,
  CHECK (state NOT IN ('ready','checking','copied-to-usb') OR (size_bytes IS NOT NULL AND sha256 IS NOT NULL))
);
CREATE INDEX export_state ON export(state, created_at);
CREATE UNIQUE INDEX export_one_preparing ON export(destination) WHERE state = 'preparing';  -- one per destination: a USB job never blocks a download (V-003)

-- ---------------------------------------------------------------- sync support, diagnostics, content packs
CREATE TABLE tombstone (          -- deletions of syncable rows, for incremental collection (SYNC.md)
  entity     TEXT NOT NULL,       -- 'learner','lesson_progress','lesson','series'
  entity_id  TEXT NOT NULL,       -- for lesson_progress: '<learner_id>|<lesson_id>'
  seq        INTEGER NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (entity, entity_id)
);
CREATE INDEX tombstone_seq ON tombstone(seq);

CREATE TABLE health_sample (      -- hourly, kept 30 days
  at              TEXT PRIMARY KEY,
  boot_id         TEXT NOT NULL,
  cpu_temp_c      REAL,
  throttled_bits  TEXT,           -- raw 'vcgencmd get_throttled' value
  load1           REAL,
  mem_available_mb INTEGER,
  disk_free_bytes INTEGER,
  db_bytes        INTEGER,
  wal_bytes       INTEGER
);

CREATE TABLE content_pack (
  id              TEXT PRIMARY KEY, -- e.g. 'agriculture-livestock'
  version         TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('copying','installed','failed','removed')),
  copied_files    INTEGER NOT NULL DEFAULT 0,
  total_files     INTEGER NOT NULL,
  installed_at    TEXT,
  updated_at      TEXT NOT NULL
);
