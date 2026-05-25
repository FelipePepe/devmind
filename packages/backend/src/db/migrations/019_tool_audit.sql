-- DevMind migration 019 — tool call audit (spec 006)
-- Append-only audit table for every tool invocation the executor sees,
-- including ones rejected before reaching the tool body (invalid args,
-- blocked by autonomy policy). Plus the global autonomy flag.

CREATE TABLE IF NOT EXISTS tool_call_audit (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_run_id    TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      TEXT,
  tool_name       TEXT NOT NULL,
  safety          TEXT NOT NULL CHECK(safety IN ('read','write','destructive')),
  args_json       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('ok','error','blocked','invalid-args')),
  output_excerpt  TEXT NOT NULL DEFAULT '',
  error           TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tool_audit_agent_run
  ON tool_call_audit(agent_run_id, started_at);
CREATE INDEX IF NOT EXISTS idx_tool_audit_session
  ON tool_call_audit(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_tool_audit_tool
  ON tool_call_audit(tool_name, status, started_at);

-- Autonomy gate (OFF by default; 'auto' = previous behaviour).
INSERT OR IGNORE INTO feature_flags (key, value, description) VALUES
  ('tools.autonomy_level', 'auto',
   'Tool autonomy policy: auto (run all) | block-destructive (reject safety=destructive)');
