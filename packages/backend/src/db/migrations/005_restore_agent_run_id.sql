-- Restore agent_run_id on messages (dropped by migration 003 which recreated the table)
ALTER TABLE messages ADD COLUMN agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_agent_run ON messages(agent_run_id);
