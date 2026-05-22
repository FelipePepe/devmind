CREATE TABLE IF NOT EXISTS project_services (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('frontend', 'backend', 'worker')),
  name        TEXT NOT NULL,
  root_path   TEXT NOT NULL,
  runtime     TEXT NOT NULL,
  port        INTEGER,
  status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'generating', 'ready', 'failed', 'disabled')),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_services_project_id ON project_services(project_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_services_project_name ON project_services(project_id, name);
