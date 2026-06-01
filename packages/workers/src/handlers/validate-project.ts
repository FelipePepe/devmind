import { getDb } from '../db.js';
import type { JobQueueClient } from '../jobs.js';
import { logger } from '../logger.js';
import { execFile } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOG_LIMIT = 4000;

export interface ValidateProjectPayload {
  projectId: string;
  runId?: string;
}

interface ProjectManifestRow {
  entrypoints_json: string;
  commands_json: string;
}

interface ProjectFileRow {
  path: string;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function updateProjectRun(jobId: string, status: 'running' | 'done' | 'failed', error?: string): void {
  getDb()
    .prepare('UPDATE project_runs SET status = ?, error = ?, updated_at = ? WHERE job_id = ?')
    .run(status, error ?? null, new Date().toISOString(), jobId);
}

function findRunId(jobId: string): string | null {
  const row = getDb()
    .prepare('SELECT id FROM project_runs WHERE job_id = ?')
    .get(jobId) as { id: string } | undefined;
  return row?.id ?? null;
}

function storeValidationReport(projectId: string, runId: string | null, status: 'pass' | 'fail', checks: unknown[], logExcerpt: string): void {
  getDb()
    .prepare(
      `INSERT INTO project_validation_reports (id, project_id, run_id, status, checks_json, log_excerpt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(crypto.randomUUID(), projectId, runId, status, JSON.stringify(checks), truncateLog(logExcerpt), new Date().toISOString());
}

function truncateLog(value: string): string {
  return value.length > LOG_LIMIT ? `${value.slice(0, LOG_LIMIT)}\n… truncated …` : value;
}

function projectWorkspace(projectId: string): string {
  return resolve(process.env['WORKSPACE_ROOT'] ?? process.cwd(), 'generated-projects', projectId);
}

function parseCommand(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim() || value === 'none' || value === 'static-preview') return undefined;
  return value.trim().split(/\s+/);
}

function commandAllowed(argv: string[]): boolean {
  const allowed = new Set((process.env['ALLOWED_GENERATED_COMMANDS'] ?? 'node,npm,pnpm,tsc,vitest').split(',').map((item) => item.trim()).filter(Boolean));
  return argv.length > 0 && allowed.has(argv[0] as string);
}

async function runManifestCommands(projectId: string, manifest: ProjectManifestRow, checks: Array<{ name: string; status: 'pass' | 'fail'; message: string }>): Promise<string[]> {
  const commands = parseJsonObject(manifest.commands_json);
  const logs: string[] = [];
  const cwd = projectWorkspace(projectId);
  const rel = relative(resolve(process.env['WORKSPACE_ROOT'] ?? process.cwd()), cwd);
  if (rel.startsWith('..') || rel === '') {
    checks.push({ name: 'command-workspace', status: 'fail', message: 'Generated workspace path is outside WORKSPACE_ROOT' });
    return logs;
  }

  for (const role of ['build', 'test'] as const) {
    const argv = parseCommand(commands[role]);
    if (!argv) continue;
    if (!commandAllowed(argv)) {
      checks.push({ name: `command:${role}`, status: 'fail', message: `Command not allowlisted: ${argv.join(' ')}` });
      continue;
    }
    try {
      const [bin, ...args] = argv;
      const result = await execFileAsync(bin as string, args, { cwd, timeout: 30_000, maxBuffer: 200_000 });
      checks.push({ name: `command:${role}`, status: 'pass', message: `${argv.join(' ')} exited 0` });
      logs.push(`$ ${argv.join(' ')}\n${result.stdout}${result.stderr}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push({ name: `command:${role}`, status: 'fail', message });
      logs.push(`$ ${argv.join(' ')}\n${message}`);
    }
  }

  return logs;
}

export async function validateProject(
  payload: ValidateProjectPayload,
  jobs: JobQueueClient,
  jobId: string
): Promise<void> {
  logger.info({ projectId: payload.projectId, jobId }, 'validateProject — starting');
  updateProjectRun(jobId, 'running');

  try {
    const db = getDb();
    const manifest = db
      .prepare('SELECT * FROM project_manifests WHERE project_id = ?')
      .get(payload.projectId) as ProjectManifestRow | undefined;
    const services = db
      .prepare('SELECT id, kind, root_path, runtime FROM project_services WHERE project_id = ?')
      .all(payload.projectId) as Array<{ id: string; kind: string; root_path: string; runtime: string }>;
    const files = db
      .prepare('SELECT path FROM project_files WHERE project_id = ? ORDER BY path')
      .all(payload.projectId) as ProjectFileRow[];
    const apiRoutes = db
      .prepare('SELECT method, path, handler_path FROM project_api_routes WHERE project_id = ? ORDER BY path, method')
      .all(payload.projectId) as Array<{ method: string; path: string; handler_path: string }>;
    const filePaths = new Set(files.map((file) => file.path));

    const checks: Array<{ name: string; status: 'pass' | 'fail'; message: string }> = [];
    checks.push({
      name: 'manifest',
      status: manifest ? 'pass' : 'fail',
      message: manifest ? 'Project manifest exists' : 'Project manifest is missing',
    });
    checks.push({
      name: 'services',
      status: services.length > 0 ? 'pass' : 'fail',
      message: services.length > 0 ? `${services.length} service(s) registered` : 'No project services registered',
    });

    if (manifest) {
      const entrypoints = parseJsonObject(manifest.entrypoints_json);
      const frontend = typeof entrypoints['frontend'] === 'string' ? entrypoints['frontend'] : 'index.html';
      checks.push({
        name: 'frontend-entrypoint',
        status: filePaths.has(frontend) ? 'pass' : 'fail',
        message: filePaths.has(frontend) ? `Found ${frontend}` : `Missing frontend entrypoint ${frontend}`,
      });
    }

    checks.push({
      name: 'files',
      status: files.length > 0 ? 'pass' : 'fail',
      message: files.length > 0 ? `${files.length} generated file(s)` : 'No generated project files',
    });

    for (const route of apiRoutes) {
      checks.push({
        name: `api-route:${route.method}:${route.path}`,
        status: filePaths.has(route.handler_path) ? 'pass' : 'fail',
        message: filePaths.has(route.handler_path)
          ? `Found handler ${route.handler_path}`
          : `Missing handler ${route.handler_path}`,
      });
    }

    const commandLogs = manifest ? await runManifestCommands(payload.projectId, manifest, checks) : [];

    const status = checks.every((check) => check.status === 'pass') ? 'pass' : 'fail';
    const logExcerpt = [
      checks.map((check) => `${check.status.toUpperCase()} ${check.name}: ${check.message}`).join('\n'),
      ...commandLogs,
    ].filter(Boolean).join('\n\n');
    const runId = payload.runId ?? findRunId(jobId);
    storeValidationReport(payload.projectId, runId, status, checks, logExcerpt);
    updateProjectRun(jobId, status === 'pass' ? 'done' : 'failed', status === 'pass' ? undefined : logExcerpt);
    jobs.updateStatus(jobId, status === 'pass' ? 'done' : 'failed', status === 'pass' ? undefined : logExcerpt);
    logger.info({ projectId: payload.projectId, jobId, status }, 'validateProject — done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ projectId: payload.projectId, jobId, err }, 'validateProject — failed');
    updateProjectRun(jobId, 'failed', message);
    storeValidationReport(payload.projectId, payload.runId ?? findRunId(jobId), 'fail', [], message);
    throw err;
  }
}
