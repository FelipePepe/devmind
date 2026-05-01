import type Database from 'better-sqlite3';
import { getDb } from './db.js';

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

const MAX_RETRIES = 3;

export class JobQueueClient {
  private db: Database.Database;

  constructor() {
    this.db = getDb();
  }

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

  resetStuckJobs(timeoutMs = 300_000): void {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    this.db
      .prepare(
        `UPDATE job_queue SET status = 'pending', processing_at = NULL, updated_at = ?
         WHERE status = 'processing' AND processing_at < ?`
      )
      .run(new Date().toISOString(), cutoff);
  }

  markFailed(id: string, error: string): void {
    this.db
      .prepare(
        `UPDATE job_queue SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
      )
      .run(error, new Date().toISOString(), id);
  }

  hasTodayArchiveJob(): boolean {
    const row = this.db
      .prepare(
        `SELECT id FROM job_queue
         WHERE type = 'archiveSessions'
           AND status IN ('pending', 'done')
           AND created_at >= date('now')
         LIMIT 1`
      )
      .get();
    return row !== undefined;
  }
}
