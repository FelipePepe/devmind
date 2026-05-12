import type Database from 'better-sqlite3';

export type AppResourceType = 'collection' | 'storage' | 'realtime_channel' | 'background_job' | 'auth_config';

export interface AppResource {
  id: string;
  project_id: string;
  type: AppResourceType;
  name: string;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface AppResourceInput {
  type: AppResourceType;
  name: string;
  config?: Record<string, unknown>;
}

export class AppResourcesRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string, type?: AppResourceType): AppResource[] {
    if (type) {
      return this.db
        .prepare('SELECT * FROM app_resources WHERE project_id = ? AND type = ? ORDER BY name')
        .all(projectId, type) as AppResource[];
    }
    return this.db
      .prepare('SELECT * FROM app_resources WHERE project_id = ? ORDER BY type, name')
      .all(projectId) as AppResource[];
  }

  findById(id: string): AppResource | undefined {
    return this.db
      .prepare('SELECT * FROM app_resources WHERE id = ?')
      .get(id) as AppResource | undefined;
  }

  create(projectId: string, input: AppResourceInput): AppResource {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const config = JSON.stringify(input.config ?? {});
    this.db
      .prepare(
        `INSERT INTO app_resources (id, project_id, type, name, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, input.type, input.name, config, now, now);
    return this.findById(id) as AppResource;
  }

  update(id: string, patch: { name?: string; config?: Record<string, unknown> }): AppResource | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    const name = patch.name ?? existing.name;
    const config = patch.config !== undefined ? JSON.stringify(patch.config) : existing.config;
    this.db
      .prepare('UPDATE app_resources SET name = ?, config = ?, updated_at = ? WHERE id = ?')
      .run(name, config, now, id);
    return this.findById(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM app_resources WHERE id = ?').run(id);
  }
}
