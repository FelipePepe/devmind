import type Database from 'better-sqlite3';

export type ProjectServiceKind = 'frontend' | 'backend' | 'worker';
export type ProjectServiceStatus = 'planned' | 'generating' | 'ready' | 'failed' | 'disabled';

export interface ProjectService {
  id: string;
  project_id: string;
  kind: ProjectServiceKind;
  name: string;
  root_path: string;
  runtime: string;
  port: number | null;
  status: ProjectServiceStatus;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectServiceView {
  id: string;
  project_id: string;
  kind: ProjectServiceKind;
  name: string;
  root_path: string;
  runtime: string;
  port: number | null;
  status: ProjectServiceStatus;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectServiceInput {
  kind: ProjectServiceKind;
  name: string;
  rootPath: string;
  runtime: string;
  port?: number | null;
  status?: ProjectServiceStatus;
  config?: Record<string, unknown>;
}

export interface ProjectServicePatch {
  name?: string;
  rootPath?: string;
  runtime?: string;
  port?: number | null;
  status?: ProjectServiceStatus;
  config?: Record<string, unknown>;
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

function toView(row: ProjectService): ProjectServiceView {
  return {
    id: row.id,
    project_id: row.project_id,
    kind: row.kind,
    name: row.name,
    root_path: row.root_path,
    runtime: row.runtime,
    port: row.port,
    status: row.status,
    config: parseJsonObject(row.config_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ProjectServicesRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): ProjectServiceView[] {
    const rows = this.db
      .prepare('SELECT * FROM project_services WHERE project_id = ? ORDER BY kind, name')
      .all(projectId) as ProjectService[];
    return rows.map(toView);
  }

  findById(id: string): ProjectServiceView | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_services WHERE id = ?')
      .get(id) as ProjectService | undefined;
    return row ? toView(row) : undefined;
  }

  create(projectId: string, input: ProjectServiceInput): ProjectServiceView {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO project_services
         (id, project_id, kind, name, root_path, runtime, port, status, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        input.kind,
        input.name,
        input.rootPath,
        input.runtime,
        input.port ?? null,
        input.status ?? 'planned',
        JSON.stringify(input.config ?? {}),
        now,
        now
      );
    return this.findById(id) as ProjectServiceView;
  }

  update(id: string, patch: ProjectServicePatch): ProjectServiceView | undefined {
    const existing = this.findRawById(id);
    if (!existing) return undefined;
    this.db
      .prepare(
        `UPDATE project_services
         SET name = ?, root_path = ?, runtime = ?, port = ?, status = ?, config_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.name ?? existing.name,
        patch.rootPath ?? existing.root_path,
        patch.runtime ?? existing.runtime,
        patch.port !== undefined ? patch.port : existing.port,
        patch.status ?? existing.status,
        patch.config !== undefined ? JSON.stringify(patch.config) : existing.config_json,
        new Date().toISOString(),
        id
      );
    return this.findById(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM project_services WHERE id = ?').run(id);
  }

  private findRawById(id: string): ProjectService | undefined {
    return this.db
      .prepare('SELECT * FROM project_services WHERE id = ?')
      .get(id) as ProjectService | undefined;
  }
}
