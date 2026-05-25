CREATE TABLE IF NOT EXISTS project_manifests (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL DEFAULT 1,
  app_type          TEXT NOT NULL DEFAULT 'static-web',
  stack_json        TEXT NOT NULL DEFAULT '{}',
  commands_json     TEXT NOT NULL DEFAULT '{}',
  entrypoints_json  TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_manifests_project_id ON project_manifests(project_id);
