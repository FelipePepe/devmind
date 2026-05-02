-- 003_password_auth — Replace WebAuthn with username/password + TOTP MFA
-- Drops and recreates users + dependent tables, replaces webauthn_challenges with auth_challenges.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS webauthn_challenges;
DROP TABLE IF EXISTS webpush_subscriptions;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  display_name   TEXT NOT NULL,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  totp_secret    TEXT,
  totp_confirmed INTEGER NOT NULL DEFAULT 0,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'Untitled',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK(status IN ('pending','in_progress','done','blocked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE artifacts (
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

CREATE TABLE webpush_subscriptions (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generic auth challenge tokens (MFA login steps, register confirm)
CREATE TABLE auth_challenges (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT,
  challenge  TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL CHECK(type IN ('mfa_login','register_confirm')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session   ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_session      ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_user     ON artifacts(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_push_user          ON webpush_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON auth_challenges(expires_at);

PRAGMA foreign_keys = ON;
