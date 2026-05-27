CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  job_id         TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL,
  payload        TEXT NOT NULL,
  retry_count    INTEGER NOT NULL,
  error          TEXT NOT NULL,
  failed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_failed_at ON dead_letter_jobs(failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_type ON dead_letter_jobs(type);
