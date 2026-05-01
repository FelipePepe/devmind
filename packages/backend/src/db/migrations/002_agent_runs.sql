-- DevMind migration 002 — agent_runs + traceability
-- Adds agent_runs table, agent_run_id on messages, source/type on artifacts.

CREATE TABLE IF NOT EXISTS agent_runs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running'
              CHECK(status IN ('running','done','error','cancelled')),
  iterations  INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user    ON agent_runs(user_id, started_at);

-- Link messages to the agent run that produced them (nullable for user messages)
ALTER TABLE messages ADD COLUMN agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_agent_run ON messages(agent_run_id);

-- Artifact provenance
ALTER TABLE artifacts ADD COLUMN source TEXT NOT NULL DEFAULT 'user'
  CHECK(source IN ('user','agent'));
ALTER TABLE artifacts ADD COLUMN artifact_type TEXT NOT NULL DEFAULT 'file'
  CHECK(artifact_type IN ('file','diff','log','test-result','other'));
