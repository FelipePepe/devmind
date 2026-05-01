-- DevMind initial schema — 001_initial
-- Applied via db.ts migration runner; guarded by schema_migrations table.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  display_name  TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  credential    TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'Untitled',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK(status IN ('pending','in_progress','done','blocked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id            TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  filename              TEXT NOT NULL,
  mime_type             TEXT NOT NULL,
  size_bytes            INTEGER NOT NULL,
  storage_path          TEXT NOT NULL,
  signed_url_token      TEXT,
  signed_url_expires_at TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_queue (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','processing','done','failed')),
  processing_at TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  error         TEXT
);

CREATE TABLE IF NOT EXISTS webpush_subscriptions (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT,
  challenge  TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL CHECK(type IN ('registration','authentication')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for hot queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session  ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_session     ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_user    ON artifacts(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status       ON job_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_processing   ON job_queue(processing_at);
CREATE INDEX IF NOT EXISTS idx_push_user         ON webpush_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON webauthn_challenges(expires_at);
