import type Database from 'better-sqlite3';

export type ProjectApiRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ProjectApiRoute {
  id: string;
  project_id: string;
  service_id: string | null;
  method: ProjectApiRouteMethod;
  path: string;
  handler_path: string;
  request_schema_json: string;
  response_schema_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectApiRouteView {
  id: string;
  project_id: string;
  service_id: string | null;
  method: ProjectApiRouteMethod;
  path: string;
  handler_path: string;
  request_schema: Record<string, unknown>;
  response_schema: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectApiRouteInput {
  serviceId?: string | null;
  method: ProjectApiRouteMethod;
  path: string;
  handlerPath: string;
  requestSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
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

function toView(row: ProjectApiRoute): ProjectApiRouteView {
  return {
    id: row.id,
    project_id: row.project_id,
    service_id: row.service_id,
    method: row.method,
    path: row.path,
    handler_path: row.handler_path,
    request_schema: parseJsonObject(row.request_schema_json),
    response_schema: parseJsonObject(row.response_schema_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ProjectApiRoutesRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): ProjectApiRouteView[] {
    const rows = this.db
      .prepare('SELECT * FROM project_api_routes WHERE project_id = ? ORDER BY path, method')
      .all(projectId) as ProjectApiRoute[];
    return rows.map(toView);
  }

  findById(id: string): ProjectApiRouteView | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_api_routes WHERE id = ?')
      .get(id) as ProjectApiRoute | undefined;
    return row ? toView(row) : undefined;
  }

  upsert(projectId: string, input: ProjectApiRouteInput): ProjectApiRouteView {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT * FROM project_api_routes WHERE project_id = ? AND method = ? AND path = ?')
      .get(projectId, input.method, input.path) as ProjectApiRoute | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE project_api_routes
           SET service_id = ?, handler_path = ?, request_schema_json = ?, response_schema_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.serviceId !== undefined ? input.serviceId : existing.service_id,
          input.handlerPath,
          input.requestSchema !== undefined ? JSON.stringify(input.requestSchema) : existing.request_schema_json,
          input.responseSchema !== undefined ? JSON.stringify(input.responseSchema) : existing.response_schema_json,
          now,
          existing.id
        );
      return this.findById(existing.id) as ProjectApiRouteView;
    }

    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO project_api_routes
         (id, project_id, service_id, method, path, handler_path, request_schema_json, response_schema_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        input.serviceId ?? null,
        input.method,
        input.path,
        input.handlerPath,
        JSON.stringify(input.requestSchema ?? {}),
        JSON.stringify(input.responseSchema ?? {}),
        now,
        now
      );
    return this.findById(id) as ProjectApiRouteView;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM project_api_routes WHERE id = ?').run(id);
  }
}
