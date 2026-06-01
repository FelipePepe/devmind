CREATE TABLE IF NOT EXISTS project_db_schemas (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  engine      TEXT NOT NULL DEFAULT 'sqlite',
  name        TEXT NOT NULL,
  schema_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_db_schemas_project_id ON project_db_schemas(project_id, engine);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_db_schemas_project_name ON project_db_schemas(project_id, name);

CREATE TABLE IF NOT EXISTS project_db_migrations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  schema_id   TEXT REFERENCES project_db_schemas(id) ON DELETE SET NULL,
  version     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'applied', 'failed')),
  applied_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_db_migrations_project_id ON project_db_migrations(project_id, version);
CREATE INDEX IF NOT EXISTS idx_project_db_migrations_schema_id ON project_db_migrations(schema_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_db_migrations_project_version ON project_db_migrations(project_id, version);
