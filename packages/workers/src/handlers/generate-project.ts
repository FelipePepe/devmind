import { getDb } from '../db.js';
import type { JobQueueClient } from '../jobs.js';
import { logger } from '../logger.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

export interface GenerateProjectPayload {
  projectId: string;
  userId?: string;
  prompt?: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
}

interface ProjectManifestRow {
  id: string;
  project_id: string;
  version: number;
  app_type: string;
  stack_json: string;
  commands_json: string;
  entrypoints_json: string;
}

interface ProjectServiceRow {
  id: string;
  project_id: string;
  kind: 'frontend' | 'backend' | 'worker';
  name: string;
  root_path: string;
  runtime: string;
  port: number | null;
  status: 'planned' | 'generating' | 'ready' | 'failed' | 'disabled';
  config_json: string;
}

interface ProjectFileRow {
  id: string;
  project_id: string;
  path: string;
  content: string;
  language: string;
}

interface ProjectSnapshotRow {
  id: string;
}

type JsonObject = Record<string, unknown>;

function parseJsonObject(raw: string): JsonObject {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

function stringifyJson(value: JsonObject): string {
  return JSON.stringify(value);
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    css: 'css',
    html: 'html',
    js: 'javascript',
    json: 'json',
    md: 'markdown',
    ts: 'typescript',
    tsx: 'typescript',
  };
  return map[ext] ?? 'plaintext';
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0 && !value.startsWith('/') && !value.split('/').includes('..');
}

function joinPath(rootPath: string, fileName: string): string {
  const root = rootPath === '.' ? '' : rootPath.replace(/^\/+|\/+$/g, '');
  return root ? `${root}/${fileName}` : fileName;
}

function setPreviewStatus(projectId: string, status: 'building' | 'ready' | 'failed', error?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const url = `/api/projects/${projectId}/preview/serve/index.html`;
  const existing = db
    .prepare('SELECT id FROM previews WHERE project_id = ?')
    .get(projectId);
  if (existing) {
    db.prepare(
      'UPDATE previews SET status = ?, url = ?, error = ?, updated_at = ? WHERE project_id = ?'
    ).run(status, url, error ?? null, now, projectId);
  } else {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO previews (id, project_id, status, url, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, status, url, error ?? null, now, now);
  }
}

function updateProjectRun(jobId: string, status: 'running' | 'done' | 'failed', error?: string): void {
  const db = getDb();
  db.prepare('UPDATE project_runs SET status = ?, error = ?, updated_at = ? WHERE job_id = ?')
    .run(status, error ?? null, new Date().toISOString(), jobId);
}

function findRunId(jobId: string): string | null {
  const row = getDb()
    .prepare('SELECT id FROM project_runs WHERE job_id = ?')
    .get(jobId) as { id: string } | undefined;
  return row?.id ?? null;
}

function markPreviewStale(projectId: string): void {
  getDb()
    .prepare('UPDATE project_runtime_instances SET status = ?, updated_at = ? WHERE project_id = ?')
    .run('stale', new Date().toISOString(), projectId);
}

function createGenerationSnapshot(projectId: string, runId: string | null, label: string): ProjectSnapshotRow {
  const db = getDb();
  const manifest = db
    .prepare('SELECT version, app_type, stack_json, commands_json, entrypoints_json FROM project_manifests WHERE project_id = ?')
    .get(projectId) as { version: number; app_type: string; stack_json: string; commands_json: string; entrypoints_json: string } | undefined;
  const files = db
    .prepare('SELECT path, language, content, updated_at FROM project_files WHERE project_id = ? ORDER BY path')
    .all(projectId);
  const services = db
    .prepare('SELECT kind, name, root_path, runtime, port, status, config_json FROM project_services WHERE project_id = ? ORDER BY kind, name')
    .all(projectId);
  const apiRoutes = db
    .prepare('SELECT method, path, handler_path, request_schema_json, response_schema_json FROM project_api_routes WHERE project_id = ? ORDER BY path, method')
    .all(projectId);
  const dbSchemas = db
    .prepare('SELECT engine, name, schema_json FROM project_db_schemas WHERE project_id = ? ORDER BY name')
    .all(projectId);
  const dbMigrations = db
    .prepare('SELECT version, name, content, status FROM project_db_migrations WHERE project_id = ? ORDER BY version')
    .all(projectId);
  const appResources = db
    .prepare('SELECT type, name, config FROM app_resources WHERE project_id = ? ORDER BY type, name')
    .all(projectId);
  const envVars = db
    .prepare('SELECT service_id, name, required, secret_ref, default_value, description FROM project_env_vars WHERE project_id = ? ORDER BY service_id, name')
    .all(projectId);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO project_snapshots
     (id, project_id, run_id, label, manifest_json, file_tree_json, resource_graph_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    runId,
    label,
    JSON.stringify(manifest ? {
      version: manifest.version,
      appType: manifest.app_type,
      stack: parseJsonObject(manifest.stack_json),
      commands: parseJsonObject(manifest.commands_json),
      entrypoints: parseJsonObject(manifest.entrypoints_json),
    } : {}),
    JSON.stringify(files),
    JSON.stringify({ services, apiRoutes, dbSchemas, dbMigrations, appResources, envVars }),
    new Date().toISOString()
  );
  return { id };
}

function upsertStaticRuntime(projectId: string, status: 'ready' | 'failed' | 'building', error?: string): void {
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
    ).run(preview?.id ?? null, status, status === 'failed' ? null : url, error ?? null, now, projectId);
  } else {
    db.prepare(
      `INSERT INTO project_runtime_instances
       (id, project_id, preview_id, status, frontend_url, backend_url, ports_json, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, '{}', ?, ?, ?)`
    ).run(crypto.randomUUID(), projectId, preview?.id ?? null, status, status === 'failed' ? null : url, error ?? null, now, now);
  }
}

function upsertManifest(projectId: string): ProjectManifestRow {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM project_manifests WHERE project_id = ?')
    .get(projectId) as ProjectManifestRow | undefined;
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_manifests
     (id, project_id, version, app_type, stack_json, commands_json, entrypoints_json, created_at, updated_at)
     VALUES (?, ?, 1, 'static-web', ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    stringifyJson({ frontend: 'static', backend: 'none', database: 'none', auth: 'none' }),
    stringifyJson({ dev: 'static-preview', build: 'none', start: 'static-preview' }),
    stringifyJson({ frontend: 'index.html' }),
    now,
    now
  );
  return db
    .prepare('SELECT * FROM project_manifests WHERE project_id = ?')
    .get(projectId) as ProjectManifestRow;
}

function ensureFrontendService(projectId: string): ProjectServiceRow[] {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM project_services WHERE project_id = ? ORDER BY kind, name')
    .all(projectId) as ProjectServiceRow[];
  if (existing.some((service) => service.kind === 'frontend')) return existing;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_services
     (id, project_id, kind, name, root_path, runtime, port, status, config_json, created_at, updated_at)
     VALUES (?, ?, 'frontend', 'web', '.', 'static', NULL, 'planned', '{}', ?, ?)`
  ).run(id, projectId, now, now);
  return db
    .prepare('SELECT * FROM project_services WHERE project_id = ? ORDER BY kind, name')
    .all(projectId) as ProjectServiceRow[];
}

function updateServiceStatus(serviceId: string, status: ProjectServiceRow['status']): void {
  getDb()
    .prepare('UPDATE project_services SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), serviceId);
}

function upsertProjectFile(projectId: string, path: string, content: string): ProjectFileRow {
  const db = getDb();
  const now = new Date().toISOString();
  const language = detectLanguage(path);
  const existing = db
    .prepare('SELECT * FROM project_files WHERE project_id = ? AND path = ?')
    .get(projectId, path) as ProjectFileRow | undefined;

  if (existing) {
    db.prepare('UPDATE project_files SET content = ?, language = ?, updated_at = ? WHERE project_id = ? AND path = ?')
      .run(content, language, now, projectId, path);
  } else {
    db.prepare(
      `INSERT INTO project_files (id, project_id, path, content, language, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), projectId, path, content, language, now, now);
  }

  return db
    .prepare('SELECT * FROM project_files WHERE project_id = ? AND path = ?')
    .get(projectId, path) as ProjectFileRow;
}

function insertProjectFileIfMissing(projectId: string, path: string, content: string): ProjectFileRow {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM project_files WHERE project_id = ? AND path = ?')
    .get(projectId, path) as ProjectFileRow | undefined;
  if (existing) return existing;
  return upsertProjectFile(projectId, path, content);
}

function getExistingFiles(projectId: string): ProjectFileRow[] {
  return getDb()
    .prepare('SELECT * FROM project_files WHERE project_id = ? ORDER BY path')
    .all(projectId) as ProjectFileRow[];
}

function getProjectWorkspacePath(projectId: string): string {
  const workspaceRoot = process.env['WORKSPACE_ROOT'] ?? process.cwd();
  return resolve(workspaceRoot, 'generated-projects', projectId);
}

async function materializeProjectFiles(projectId: string): Promise<string> {
  const projectRoot = getProjectWorkspacePath(projectId);
  const files = getExistingFiles(projectId);
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

function getFrontendEntrypoint(manifest: ProjectManifestRow, services: ProjectServiceRow[]): string {
  const entrypoints = parseJsonObject(manifest.entrypoints_json);
  const frontendEntrypoint = entrypoints['frontend'];
  if (typeof frontendEntrypoint === 'string' && isSafeRelativePath(frontendEntrypoint)) {
    return frontendEntrypoint;
  }

  const frontend = services.find((service) => service.kind === 'frontend');
  if (frontend && isSafeRelativePath(frontend.root_path)) {
    return joinPath(frontend.root_path, 'index.html');
  }

  return 'index.html';
}

function renderIndexHtml(project: ProjectRow, manifest: ProjectManifestRow, services: ProjectServiceRow[]): string {
  const stack = parseJsonObject(manifest.stack_json);
  const servicesMarkup = services.map((service) => `
          <li>
            <strong>${escapeHtml(service.name)}</strong>
            <span>${escapeHtml(service.kind)} · ${escapeHtml(service.runtime)} · ${escapeHtml(service.root_path)}</span>
          </li>`).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(project.name)}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">DevMind generated project</p>
        <h1>${escapeHtml(project.name)}</h1>
        <p>${escapeHtml(project.description ?? 'Static preview generated from the structured project manifest.')}</p>
        <div class="actions">
          <button type="button" id="primary-action">Inspect manifest</button>
          <span>${escapeHtml(manifest.app_type)}</span>
        </div>
      </section>
      <section class="panel">
        <h2>Services</h2>
        <ul class="services">${servicesMarkup || '<li><strong>No services yet</strong><span>Ask the agent to add one.</span></li>'}
        </ul>
      </section>
      <section class="panel">
        <h2>Stack</h2>
        <pre>${escapeHtml(JSON.stringify(stack, null, 2))}</pre>
      </section>
    </main>
    <script src="app.js"></script>
  </body>
</html>`;
}

function renderStyles(): string {
  return `:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #171412;
  color: #f7efe8;
}

* { box-sizing: border-box; }

body {
  min-height: 100vh;
  margin: 0;
  background:
    radial-gradient(circle at top left, rgba(217, 119, 87, 0.24), transparent 34rem),
    linear-gradient(135deg, #171412 0%, #231d19 100%);
}

.shell {
  width: min(1040px, calc(100% - 32px));
  margin: 0 auto;
  padding: 56px 0;
  display: grid;
  gap: 20px;
}

.hero, .panel {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  background: rgba(28, 24, 21, 0.76);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
  padding: 28px;
}

.eyebrow {
  margin: 0 0 12px;
  color: #d97757;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1, h2 { margin: 0; }
h1 { font-size: clamp(36px, 7vw, 76px); line-height: 0.95; }
h2 { font-size: 18px; }
p { color: #cdbfb4; max-width: 64ch; line-height: 1.6; }

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

button {
  border: 0;
  border-radius: 10px;
  padding: 11px 16px;
  background: #d97757;
  color: #171412;
  font-weight: 800;
  cursor: pointer;
}

.services {
  display: grid;
  gap: 10px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.services li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.services span { color: #cdbfb4; }
pre { overflow: auto; color: #f1d7c7; }`;
}

function renderAppJs(manifest: ProjectManifestRow, services: ProjectServiceRow[]): string {
  return `const manifest = ${JSON.stringify({
    version: manifest.version,
    appType: manifest.app_type,
    stack: parseJsonObject(manifest.stack_json),
    commands: parseJsonObject(manifest.commands_json),
    entrypoints: parseJsonObject(manifest.entrypoints_json),
  }, null, 2)};

const services = ${JSON.stringify(services.map((service) => ({
    kind: service.kind,
    name: service.name,
    rootPath: service.root_path,
    runtime: service.runtime,
    status: service.status,
  })), null, 2)};

document.getElementById('primary-action')?.addEventListener('click', () => {
  console.log('DevMind manifest', manifest);
  console.log('DevMind services', services);
  alert('Manifest and services logged to the browser console.');
});`;
}

function renderRootRedirect(entrypoint: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(entrypoint)}" />
    <title>Opening preview</title>
  </head>
  <body>
    <a href="${escapeHtml(entrypoint)}">Open generated preview</a>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function materializeStaticPreview(projectId: string, project: ProjectRow, manifest: ProjectManifestRow, services: ProjectServiceRow[]): void {
  const existingFiles = getExistingFiles(projectId);
  const existingPaths = new Set(existingFiles.map((file) => file.path));
  const entrypoint = getFrontendEntrypoint(manifest, services);
  const entryDir = entrypoint.includes('/') ? entrypoint.slice(0, entrypoint.lastIndexOf('/')) : '.';
  const indexHtml = renderIndexHtml(project, manifest, services);
  const stylesPath = joinPath(entryDir, 'styles.css');
  const appPath = joinPath(entryDir, 'app.js');

  insertProjectFileIfMissing(projectId, entrypoint, indexHtml);
  insertProjectFileIfMissing(projectId, stylesPath, renderStyles());
  insertProjectFileIfMissing(projectId, appPath, renderAppJs(manifest, services));

  if (entrypoint !== 'index.html' && !existingPaths.has('index.html')) {
    insertProjectFileIfMissing(projectId, 'index.html', renderRootRedirect(entrypoint));
  }

  const existingManifestSummary = existingPaths.has('devmind.manifest.json');
  if (!existingManifestSummary) {
    insertProjectFileIfMissing(projectId, 'devmind.manifest.json', `${JSON.stringify({
      version: manifest.version,
      appType: manifest.app_type,
      stack: parseJsonObject(manifest.stack_json),
      commands: parseJsonObject(manifest.commands_json),
      entrypoints: parseJsonObject(manifest.entrypoints_json),
      services: services.map((service) => ({
        kind: service.kind,
        name: service.name,
        rootPath: service.root_path,
        runtime: service.runtime,
        status: service.status,
      })),
    }, null, 2)}\n`);
  }
}

function slugifyFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'migration';
}

function renderHonoBackend(project: ProjectRow): string {
  return `import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, app: ${JSON.stringify(project.name)} }));

app.get('/api/hello', (c) => c.json({
  message: 'Hello from ${project.name.replaceAll("'", "\\'")}',
  generatedBy: 'DevMind',
}));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(\`Generated backend listening on http://localhost:\${port}\`);
`;
}

function ensureBackendServiceFiles(projectId: string, project: ProjectRow, services: ProjectServiceRow[]): void {
  for (const service of services.filter((item) => item.kind === 'backend')) {
    if (service.runtime !== 'hono-node') continue;
    const root = service.root_path;
    insertProjectFileIfMissing(projectId, joinPath(root, 'package.json'), `${JSON.stringify({
      name: `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-backend`,
      type: 'module',
      scripts: {
        dev: 'tsx src/index.ts',
        start: 'node dist/index.js',
        build: 'tsc -p tsconfig.json',
      },
      dependencies: {
        '@hono/node-server': '^1.14.0',
        hono: '^4.7.0',
      },
      devDependencies: {
        '@types/node': '^22.0.0',
        tsx: '^4.19.0',
        typescript: '^5.7.0',
      },
    }, null, 2)}\n`);
    insertProjectFileIfMissing(projectId, joinPath(root, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        outDir: 'dist',
        rootDir: 'src',
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }, null, 2)}\n`);
    insertProjectFileIfMissing(projectId, joinPath(root, 'src/index.ts'), renderHonoBackend(project));
  }
}

function ensureDatabaseMigrationFiles(projectId: string): void {
  const migrations = getDb()
    .prepare('SELECT version, name, content FROM project_db_migrations WHERE project_id = ? ORDER BY version')
    .all(projectId) as Array<{ version: number; name: string; content: string }>;

  for (const migration of migrations) {
    const version = String(migration.version).padStart(3, '0');
    const fileName = `${version}_${slugifyFileName(migration.name)}.sql`;
    insertProjectFileIfMissing(projectId, `database/migrations/${fileName}`, `${migration.content.trim()}\n`);
  }
}

export async function generateProject(
  payload: GenerateProjectPayload,
  jobs: JobQueueClient,
  jobId: string
): Promise<void> {
  logger.info({ projectId: payload.projectId, jobId }, 'generateProject — starting');
  try {
    updateProjectRun(jobId, 'running');
    setPreviewStatus(payload.projectId, 'building');
    markPreviewStale(payload.projectId);
    upsertStaticRuntime(payload.projectId, 'building');

    const db = getDb();
    const project = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(payload.projectId) as ProjectRow | undefined;
    if (!project) throw new Error(`Project not found: ${payload.projectId}`);

    const manifest = upsertManifest(payload.projectId);
    const services = ensureFrontendService(payload.projectId);
    for (const service of services.filter((service) => service.kind === 'frontend')) {
      updateServiceStatus(service.id, 'generating');
    }

    materializeStaticPreview(payload.projectId, project, manifest, services);
    ensureBackendServiceFiles(payload.projectId, project, services);
    ensureDatabaseMigrationFiles(payload.projectId);
    const materializedPath = await materializeProjectFiles(payload.projectId);

    for (const service of services.filter((service) => service.kind === 'frontend')) {
      updateServiceStatus(service.id, 'ready');
    }
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), payload.projectId);

    setPreviewStatus(payload.projectId, 'ready');
    upsertStaticRuntime(payload.projectId, 'ready');
    const snapshot = createGenerationSnapshot(payload.projectId, findRunId(jobId), 'After generation');
    updateProjectRun(jobId, 'done');
    jobs.updateStatus(jobId, 'done');
    logger.info({ projectId: payload.projectId, jobId, materializedPath, snapshotId: snapshot.id }, 'generateProject — done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ projectId: payload.projectId, jobId, err }, 'generateProject — failed');
    setPreviewStatus(payload.projectId, 'failed', message);
    upsertStaticRuntime(payload.projectId, 'failed', message);
    updateProjectRun(jobId, 'failed', message);
    throw err;
  }
}
