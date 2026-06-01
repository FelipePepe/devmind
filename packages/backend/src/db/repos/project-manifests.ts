import type Database from 'better-sqlite3';

export interface ProjectManifest {
  id: string;
  project_id: string;
  version: number;
  app_type: string;
  stack_json: string;
  commands_json: string;
  entrypoints_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectManifestView {
  id: string;
  project_id: string;
  version: number;
  app_type: string;
  stack: Record<string, unknown>;
  commands: Record<string, unknown>;
  entrypoints: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectManifestInput {
  version?: number;
  appType?: string;
  stack?: Record<string, unknown>;
  commands?: Record<string, unknown>;
  entrypoints?: Record<string, unknown>;
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

function toView(row: ProjectManifest): ProjectManifestView {
  return {
    id: row.id,
    project_id: row.project_id,
    version: row.version,
    app_type: row.app_type,
    stack: parseJsonObject(row.stack_json),
    commands: parseJsonObject(row.commands_json),
    entrypoints: parseJsonObject(row.entrypoints_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ProjectManifestsRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): ProjectManifestView | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_manifests WHERE project_id = ?')
      .get(projectId) as ProjectManifest | undefined;
    return row ? toView(row) : undefined;
  }

  upsert(projectId: string, input: ProjectManifestInput): ProjectManifestView {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT * FROM project_manifests WHERE project_id = ?')
      .get(projectId) as ProjectManifest | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE project_manifests
           SET version = ?, app_type = ?, stack_json = ?, commands_json = ?, entrypoints_json = ?, updated_at = ?
           WHERE project_id = ?`
        )
        .run(
          input.version ?? existing.version,
          input.appType ?? existing.app_type,
          input.stack !== undefined ? JSON.stringify(input.stack) : existing.stack_json,
          input.commands !== undefined ? JSON.stringify(input.commands) : existing.commands_json,
          input.entrypoints !== undefined ? JSON.stringify(input.entrypoints) : existing.entrypoints_json,
          now,
          projectId
        );
    } else {
      const id = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO project_manifests
           (id, project_id, version, app_type, stack_json, commands_json, entrypoints_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          projectId,
          input.version ?? 1,
          input.appType ?? 'static-web',
          JSON.stringify(input.stack ?? {}),
          JSON.stringify(input.commands ?? {}),
          JSON.stringify(input.entrypoints ?? {}),
          now,
          now
        );
    }

    return this.findByProject(projectId) as ProjectManifestView;
  }

  delete(projectId: string): void {
    this.db.prepare('DELETE FROM project_manifests WHERE project_id = ?').run(projectId);
  }
}
