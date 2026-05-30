-- DevMind migration 023 — Playwright validation (spec 005)
-- Adds project_tests, project_test_runs tables and evidence column on messages.
-- All behavior gated by three feature flags (default OFF).

CREATE TABLE IF NOT EXISTS project_tests (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK(source IN ('acceptance','smoke','manual')),
  title             TEXT NOT NULL,
  intent            TEXT NOT NULL,
  spec_path         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','active','disabled')),
  created_by_run_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS project_test_runs (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id               TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_id                  TEXT NOT NULL REFERENCES project_tests(id) ON DELETE CASCADE,
  agent_run_id             TEXT,
  status                   TEXT NOT NULL CHECK(status IN ('pending','passed','failed','errored','timed_out')),
  duration_ms              INTEGER,
  evidence_screenshot_hash TEXT,
  evidence_video_hash      TEXT,
  error_excerpt            TEXT,
  trace_json               TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at              TEXT
);

ALTER TABLE messages ADD COLUMN evidence_json TEXT;

CREATE INDEX IF NOT EXISTS idx_project_tests_project
  ON project_tests(project_id);

CREATE INDEX IF NOT EXISTS idx_project_test_runs_test
  ON project_test_runs(test_id, created_at);

CREATE INDEX IF NOT EXISTS idx_project_test_runs_agent_run
  ON project_test_runs(agent_run_id)
  WHERE agent_run_id IS NOT NULL;

INSERT OR IGNORE INTO feature_flags (key, value, description) VALUES
  ('validation.playwright_enabled',       'false', 'Master switch — enables Playwright worker handler and agent tools'),
  ('validation.gate_on_tests',            'false', 'Block agent run completion until acceptance tests pass'),
  ('validation.attach_evidence_to_messages', 'false', 'Extend closing assistant message with test evidence (screenshot + status)');
