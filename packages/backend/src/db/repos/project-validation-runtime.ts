import type Database from 'better-sqlite3';

export type ProjectValidationStatus = 'pending' | 'pass' | 'fail';
export type ProjectRuntimeStatus = 'pending' | 'building' | 'ready' | 'failed' | 'stale' | 'stopped';

export interface ProjectValidationReport {
  id: string;
  project_id: string;
  run_id: string | null;
  status: ProjectValidationStatus;
  checks_json: string;
  log_excerpt: string | null;
  created_at: string;
}

export interface ProjectValidationReportView {
  id: string;
  project_id: string;
  run_id: string | null;
  status: ProjectValidationStatus;
  checks: unknown[];
  log_excerpt: string | null;
  created_at: string;
}

export interface ProjectRuntimeInstance {
  id: string;
  project_id: string;
  preview_id: string | null;
  status: ProjectRuntimeStatus;
  frontend_url: string | null;
  backend_url: string | null;
  ports_json: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectRuntimeInstanceView {
  id: string;
  project_id: string;
  preview_id: string | null;
  status: ProjectRuntimeStatus;
  frontend_url: string | null;
  backend_url: string | null;
  ports: Record<string, unknown>;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

function reportToView(row: ProjectValidationReport): ProjectValidationReportView {
  return {
    id: row.id,
    project_id: row.project_id,
    run_id: row.run_id,
    status: row.status,
    checks: parseJsonArray(row.checks_json),
    log_excerpt: row.log_excerpt,
    created_at: row.created_at,
  };
}

function runtimeToView(row: ProjectRuntimeInstance): ProjectRuntimeInstanceView {
  return {
    id: row.id,
    project_id: row.project_id,
    preview_id: row.preview_id,
    status: row.status,
    frontend_url: row.frontend_url,
    backend_url: row.backend_url,
    ports: parseJsonObject(row.ports_json),
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ProjectValidationReportsRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string, limit = 20): ProjectValidationReportView[] {
    const rows = this.db
      .prepare('SELECT * FROM project_validation_reports WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, limit) as ProjectValidationReport[];
    return rows.map(reportToView);
  }

  create(projectId: string, input: {
    runId?: string | null;
    status: ProjectValidationStatus;
    checks?: unknown[];
    logExcerpt?: string | null;
  }): ProjectValidationReportView {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO project_validation_reports (id, project_id, run_id, status, checks_json, log_excerpt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        input.runId ?? null,
        input.status,
        JSON.stringify(input.checks ?? []),
        input.logExcerpt ?? null,
        new Date().toISOString()
      );
    const row = this.db
      .prepare('SELECT * FROM project_validation_reports WHERE id = ?')
      .get(id) as ProjectValidationReport;
    return reportToView(row);
  }
}

export class ProjectRuntimeInstancesRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): ProjectRuntimeInstanceView | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_runtime_instances WHERE project_id = ?')
      .get(projectId) as ProjectRuntimeInstance | undefined;
    return row ? runtimeToView(row) : undefined;
  }

  upsert(projectId: string, input: {
    previewId?: string | null;
    status: ProjectRuntimeStatus;
    frontendUrl?: string | null;
    backendUrl?: string | null;
    ports?: Record<string, unknown>;
    error?: string | null;
  }): ProjectRuntimeInstanceView {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT * FROM project_runtime_instances WHERE project_id = ?')
      .get(projectId) as ProjectRuntimeInstance | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE project_runtime_instances
           SET preview_id = ?, status = ?, frontend_url = ?, backend_url = ?, ports_json = ?, error = ?, updated_at = ?
           WHERE project_id = ?`
        )
        .run(
          input.previewId !== undefined ? input.previewId : existing.preview_id,
          input.status,
          input.frontendUrl !== undefined ? input.frontendUrl : existing.frontend_url,
          input.backendUrl !== undefined ? input.backendUrl : existing.backend_url,
          input.ports !== undefined ? JSON.stringify(input.ports) : existing.ports_json,
          input.error ?? null,
          now,
          projectId
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO project_runtime_instances
           (id, project_id, preview_id, status, frontend_url, backend_url, ports_json, error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          projectId,
          input.previewId ?? null,
          input.status,
          input.frontendUrl ?? null,
          input.backendUrl ?? null,
          JSON.stringify(input.ports ?? {}),
          input.error ?? null,
          now,
          now
        );
    }

    return this.findByProject(projectId) as ProjectRuntimeInstanceView;
  }
}
