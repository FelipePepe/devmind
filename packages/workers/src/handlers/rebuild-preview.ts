import { getDb } from '../db.js';
import type { JobQueueClient } from '../jobs.js';
import { logger } from '../logger.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

export interface RebuildPreviewPayload {
  projectId: string;
  runId?: string;
}

interface ProjectFileRow {
  path: string;
  content: string;
}

interface ProjectManifestRow {
  app_type: string;
  entrypoints_json: string;
}

interface ProjectServiceRow {
  kind: string;
  name: string;
  runtime: string;
  root_path: string;
  port: number | null;
}

function setPreviewStatus(projectId: string, status: 'ready' | 'failed', error?: string): void {
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

function upsertRuntime(projectId: string, status: 'ready' | 'failed', error?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const preview = db.prepare('SELECT id FROM previews WHERE project_id = ?').get(projectId) as { id: string } | undefined;
  const url = `/api/projects/${projectId}/preview/serve/index.html`;
  const existing = db
    .prepare('SELECT id FROM project_runtime_instances WHERE project_id = ?')
    .get(projectId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE project_runtime_instances
       SET preview_id = ?, status = ?, frontend_url = ?, backend_url = NULL, ports_json = '{}', error = ?, updated_at = ?
       WHERE project_id = ?`
    ).run(preview?.id ?? null, status, status === 'ready' ? url : null, error ?? null, now, projectId);
  } else {
    db.prepare(
      `INSERT INTO project_runtime_instances
       (id, project_id, preview_id, status, frontend_url, backend_url, ports_json, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, '{}', ?, ?, ?)`
    ).run(crypto.randomUUID(), projectId, preview?.id ?? null, status, status === 'ready' ? url : null, error ?? null, now, now);
  }
}

async function materializeProjectFiles(projectId: string): Promise<string> {
  const workspaceRoot = process.env['WORKSPACE_ROOT'] ?? process.cwd();
  const projectRoot = resolve(workspaceRoot, 'generated-projects', projectId);
  const files = getDb()
    .prepare('SELECT path, content FROM project_files WHERE project_id = ? ORDER BY path')
    .all(projectId) as ProjectFileRow[];
  await mkdir(projectRoot, { recursive: true });

  for (const file of files) {
    const abs = resolve(projectRoot, file.path);
    const rel = relative(projectRoot, abs);
    if (rel.startsWith('..') || rel === '' || rel.startsWith('/')) {
      throw new Error(`Refusing to materialize path outside project workspace: ${file.path}`);
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, 'utf8');
  }

  return projectRoot;
}

export async function rebuildPreview(
  payload: RebuildPreviewPayload,
  jobs: JobQueueClient,
  jobId: string
): Promise<void> {
  logger.info({ projectId: payload.projectId, jobId }, 'rebuildPreview — starting');
  try {
    const manifest = getDb()
      .prepare('SELECT app_type, entrypoints_json FROM project_manifests WHERE project_id = ?')
      .get(payload.projectId) as ProjectManifestRow | undefined;
    const services = getDb()
      .prepare('SELECT kind, name, runtime, root_path, port FROM project_services WHERE project_id = ? ORDER BY kind, name')
      .all(payload.projectId) as ProjectServiceRow[];
    const materializedPath = await materializeProjectFiles(payload.projectId);
    setPreviewStatus(payload.projectId, 'ready');
    upsertRuntime(payload.projectId, 'ready');
    jobs.updateStatus(jobId, 'done');
    logger.info({
      projectId: payload.projectId,
      jobId,
      materializedPath,
      appType: manifest?.app_type,
      services: services.map((service) => `${service.kind}:${service.name}:${service.runtime}`),
    }, 'rebuildPreview — done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ projectId: payload.projectId, jobId, err }, 'rebuildPreview — failed');
    setPreviewStatus(payload.projectId, 'failed', message);
    upsertRuntime(payload.projectId, 'failed', message);
    throw err;
  }
}
