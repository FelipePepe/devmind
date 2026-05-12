import { getDb } from '../db.js';
import type { JobQueueClient } from '../jobs.js';
import { logger } from '../logger.js';

export interface GenerateProjectPayload {
  projectId: string;
  userId?: string;
  prompt?: string;
}

function setPreviewStatus(projectId: string, status: 'building' | 'ready' | 'failed', error?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM previews WHERE project_id = ?')
    .get(projectId);
  if (existing) {
    db.prepare(
      'UPDATE previews SET status = ?, error = ?, updated_at = ? WHERE project_id = ?'
    ).run(status, error ?? null, now, projectId);
  } else {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO previews (id, project_id, status, url, error, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`
    ).run(id, projectId, status, error ?? null, now, now);
  }
}

export async function generateProject(
  payload: GenerateProjectPayload,
  jobs: JobQueueClient,
  jobId: string
): Promise<void> {
  logger.info({ projectId: payload.projectId, jobId }, 'generateProject — starting');
  try {
    setPreviewStatus(payload.projectId, 'building');
    // TODO: actual project generation logic goes here
    setPreviewStatus(payload.projectId, 'ready');
    jobs.updateStatus(jobId, 'done');
    logger.info({ projectId: payload.projectId, jobId }, 'generateProject — done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ projectId: payload.projectId, jobId, err }, 'generateProject — failed');
    setPreviewStatus(payload.projectId, 'failed', message);
    throw err;
  }
}
