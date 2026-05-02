CREATE TABLE IF NOT EXISTS project_files (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  language    TEXT NOT NULL DEFAULT 'plaintext',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_files_path ON project_files(project_id, path);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);
