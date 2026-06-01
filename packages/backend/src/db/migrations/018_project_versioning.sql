-- DevMind migration 018 — project versioning (spec 004)
-- Extends project_snapshots (introduced by 017) with parent linkage, trigger,
-- agent/message attribution, retention class and content-addressable manifest.
-- Adds project_snapshot_blobs for deduplicated file content storage and a
-- per-project retention setting. Feature flags ship OFF.

-- 1. Extend project_snapshots ----------------------------------------------------
ALTER TABLE project_snapshots
  ADD COLUMN parent_snapshot_id TEXT REFERENCES project_snapshots(id) ON DELETE SET NULL;
ALTER TABLE project_snapshots
  ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE project_snapshots
  ADD COLUMN agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE project_snapshots
  ADD COLUMN message_id TEXT REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE project_snapshots
  ADD COLUMN retention TEXT NOT NULL DEFAULT 'ephemeral';
ALTER TABLE project_snapshots
  ADD COLUMN file_manifest_json TEXT;
ALTER TABLE project_snapshots
  ADD COLUMN screenshot_blob_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_project_snapshots_parent
  ON project_snapshots(parent_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_project_snapshots_message
  ON project_snapshots(message_id);
CREATE INDEX IF NOT EXISTS idx_project_snapshots_agent_run
  ON project_snapshots(agent_run_id);

-- 2. Content-addressable blob storage --------------------------------------------
CREATE TABLE IF NOT EXISTS project_snapshot_blobs (
  hash        TEXT PRIMARY KEY,
  content     BLOB NOT NULL,
  size_bytes  INTEGER NOT NULL,
  ref_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_snapshot_blobs_refcount
  ON project_snapshot_blobs(ref_count);

-- 3. Per-project retention setting -----------------------------------------------
ALTER TABLE projects
  ADD COLUMN snapshot_retention_keep INTEGER NOT NULL DEFAULT 20;

-- 4. Feature flags (OFF by default) ----------------------------------------------
INSERT OR IGNORE INTO feature_flags (key, value, description) VALUES
  ('versioning.auto_capture', 'false',
   'Capture a snapshot before and after each agent run (spec 004)'),
  ('versioning.dedup_blobs', 'false',
   'Store file contents in project_snapshot_blobs and reference them by SHA-256 hash (spec 004)');
