import { getDb } from '../db.js';
import type { JobQueueClient } from '../jobs.js';

export async function archiveSessions(
  jobs: JobQueueClient,
  jobId: string
): Promise<void> {
  const db = getDb();

  // Archive sessions older than 90 days that haven't been archived yet
  const result = db
    .prepare(
      `UPDATE sessions
       SET archived_at = datetime('now')
       WHERE created_at < datetime('now', '-90 days')
         AND archived_at IS NULL`
    )
    .run();

  db.prepare('UPDATE job_queue SET payload = ? WHERE id = ?').run(
    JSON.stringify({ archivedCount: result.changes }),
    jobId
  );

  jobs.updateStatus(jobId, 'done');

  // Self-enqueue: check if tomorrow's job already exists
  if (!jobs.hasTodayArchiveJob()) {
    jobs.enqueue('archiveSessions', {});
  }
}
