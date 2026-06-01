CREATE TABLE IF NOT EXISTS project_env_vars (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_id    TEXT REFERENCES project_services(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  required      INTEGER NOT NULL DEFAULT 1,
  secret_ref    TEXT,
  default_value TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_env_vars_project_id ON project_env_vars(project_id, service_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_env_vars_project_service_name ON project_env_vars(project_id, service_id, name);

CREATE TABLE IF NOT EXISTS project_validation_reports (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id      TEXT REFERENCES project_runs(id) ON DELETE SET NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'pass', 'fail')),
  checks_json TEXT NOT NULL DEFAULT '[]',
  log_excerpt TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_validation_reports_project_id ON project_validation_reports(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_validation_reports_run_id ON project_validation_reports(run_id);

CREATE TABLE IF NOT EXISTS project_runtime_instances (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  preview_id   TEXT REFERENCES previews(id) ON DELETE SET NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'building', 'ready', 'failed', 'stale', 'stopped')),
  frontend_url TEXT,
  backend_url  TEXT,
  ports_json   TEXT NOT NULL DEFAULT '{}',
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_runtime_instances_project_id ON project_runtime_instances(project_id, status);
