CREATE TABLE IF NOT EXISTS project_snapshots (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id              TEXT REFERENCES project_runs(id) ON DELETE SET NULL,
  label               TEXT,
  manifest_json       TEXT NOT NULL DEFAULT '{}',
  file_tree_json      TEXT NOT NULL DEFAULT '[]',
  resource_graph_json TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_snapshots_project_id ON project_snapshots(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_snapshots_run_id ON project_snapshots(run_id);
