import type Database from 'better-sqlite3';

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface Job {
  id: string;
  type: string;
  payload: string;
  status: JobStatus;
  processing_at: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface JobQueueStats {
  pending: number;
  processing: number;
  failed: number;
  oldestPendingAgeMs: number;
}

const MAX_RETRIES = 3;

export class JobsRepo {
  constructor(private db: Database.Database) {}

  enqueue(type: string, payload: unknown = {}): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO job_queue (id, type, payload, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      )
      .run(id, type, JSON.stringify(payload), now, now);
    return id;
  }

  dequeueNext(): Job | undefined {
    const now = new Date().toISOString();
    // Atomic claim: pick the oldest pending job and mark it processing
    const result = this.db
      .prepare(
        `UPDATE job_queue
         SET status = 'processing', processing_at = ?, updated_at = ?,
             retry_count = retry_count + 1
         WHERE id = (
           SELECT id FROM job_queue
           WHERE status = 'pending'
           ORDER BY created_at ASC
           LIMIT 1
         )
         RETURNING *`
      )
      .get(now, now) as Job | undefined;

    if (result && result.retry_count > MAX_RETRIES) {
      this.markFailed(result.id, `Max retries (${MAX_RETRIES}) exceeded`);
      return undefined;
    }
    return result;
  }

  updateStatus(id: string, status: JobStatus, error?: string): void {
    this.db
      .prepare(
        'UPDATE job_queue SET status = ?, error = ?, updated_at = ? WHERE id = ?'
      )
      .run(status, error ?? null, new Date().toISOString(), id);
  }

  resetStuck(timeoutMs = 300_000): void {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    this.db
      .prepare(
        `UPDATE job_queue SET status = 'pending', processing_at = NULL, updated_at = ?
         WHERE status = 'processing' AND processing_at < ?`
      )
      .run(new Date().toISOString(), cutoff);
  }

  incrementRetry(id: string): void {
    this.db
      .prepare(
        'UPDATE job_queue SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?'
      )
      .run(new Date().toISOString(), id);
  }

  markFailed(id: string, error: string): void {
    const job = this.getJob(id);
    this.db
      .prepare(
        `UPDATE job_queue SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
      )
      .run(error, new Date().toISOString(), id);
    if (job) this.insertDeadLetter(job, error);
  }

  getJob(id: string): Job | undefined {
    return this.db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as Job | undefined;
  }

  list(): Job[] {
    return this.db
      .prepare('SELECT * FROM job_queue ORDER BY created_at DESC')
      .all() as Job[];
  }

  stats(): JobQueueStats {
    const counts = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM job_queue`
      )
      .get() as { pending: number | null; processing: number | null; failed: number | null };

    const lag = this.db
      .prepare(
        `SELECT CAST(COALESCE((julianday('now') - julianday(MIN(created_at))) * 86400000, 0) AS INTEGER) AS lag_ms
         FROM job_queue
         WHERE status = 'pending'`
      )
      .get() as { lag_ms: number | null };

    return {
      pending: counts.pending ?? 0,
      processing: counts.processing ?? 0,
      failed: counts.failed ?? 0,
      oldestPendingAgeMs: lag.lag_ms ?? 0,
    };
  }

  private insertDeadLetter(job: Job, error: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO dead_letter_jobs (job_id, type, payload, retry_count, error)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(job.id, job.type, job.payload, job.retry_count, error);
  }
}
