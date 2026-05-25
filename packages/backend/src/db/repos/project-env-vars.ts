import type Database from 'better-sqlite3';

export interface ProjectEnvVar {
  id: string;
  project_id: string;
  service_id: string | null;
  name: string;
  required: 0 | 1;
  secret_ref: string | null;
  default_value: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectEnvVarView {
  id: string;
  project_id: string;
  service_id: string | null;
  name: string;
  required: boolean;
  secret_ref: string | null;
  default_value: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectEnvVarInput {
  serviceId?: string | null;
  name: string;
  required?: boolean;
  secretRef?: string | null;
  defaultValue?: string | null;
  description?: string | null;
}

function toView(row: ProjectEnvVar): ProjectEnvVarView {
  return {
    id: row.id,
    project_id: row.project_id,
    service_id: row.service_id,
    name: row.name,
    required: row.required === 1,
    secret_ref: row.secret_ref,
    default_value: row.default_value,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ProjectEnvVarsRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): ProjectEnvVarView[] {
    const rows = this.db
      .prepare('SELECT * FROM project_env_vars WHERE project_id = ? ORDER BY service_id, name')
      .all(projectId) as ProjectEnvVar[];
    return rows.map(toView);
  }

  findById(id: string): ProjectEnvVarView | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_env_vars WHERE id = ?')
      .get(id) as ProjectEnvVar | undefined;
    return row ? toView(row) : undefined;
  }

  upsert(projectId: string, input: ProjectEnvVarInput): ProjectEnvVarView {
    const now = new Date().toISOString();
    const serviceId = input.serviceId ?? null;
    const existing = this.db
      .prepare(
        `SELECT * FROM project_env_vars
         WHERE project_id = ? AND COALESCE(service_id, '') = COALESCE(?, '') AND name = ?`
      )
      .get(projectId, serviceId, input.name) as ProjectEnvVar | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE project_env_vars
           SET required = ?, secret_ref = ?, default_value = ?, description = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.required !== undefined ? (input.required ? 1 : 0) : existing.required,
          input.secretRef !== undefined ? input.secretRef : existing.secret_ref,
          input.defaultValue !== undefined ? input.defaultValue : existing.default_value,
          input.description !== undefined ? input.description : existing.description,
          now,
          existing.id
        );
      return this.findById(existing.id) as ProjectEnvVarView;
    }

    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO project_env_vars
         (id, project_id, service_id, name, required, secret_ref, default_value, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        serviceId,
        input.name,
        input.required === false ? 0 : 1,
        input.secretRef ?? null,
        input.defaultValue ?? null,
        input.description ?? null,
        now,
        now
      );
    return this.findById(id) as ProjectEnvVarView;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM project_env_vars WHERE id = ?').run(id);
  }
}
