-- App resources are backend constructs owned by a generated project,
-- distinct from DevMind's own platform tables (sessions, artifacts, jobs, etc.)
CREATE TABLE IF NOT EXISTS app_resources (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('collection', 'storage', 'realtime_channel', 'background_job', 'auth_config')),
  name         TEXT NOT NULL,
  config       TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_resources_project_id ON app_resources(project_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_resources_project_name ON app_resources(project_id, name);
