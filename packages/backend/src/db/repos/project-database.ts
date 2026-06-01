import type Database from 'better-sqlite3';

export type ProjectDbMigrationStatus = 'draft' | 'generated' | 'applied' | 'failed';

export interface ProjectDbSchema {
  id: string;
  project_id: string;
  engine: string;
  name: string;
  schema_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectDbSchemaView {
  id: string;
  project_id: string;
  engine: string;
  name: string;
  schema: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectDbMigration {
  id: string;
  project_id: string;
  schema_id: string | null;
  version: number;
  name: string;
  content: string;
  status: ProjectDbMigrationStatus;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDbSchemaInput {
  engine?: string;
  name: string;
  schema: Record<string, unknown>;
}

export interface ProjectDbMigrationInput {
  schemaId?: string | null;
  version?: number;
  name: string;
  content: string;
  status?: ProjectDbMigrationStatus;
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

function schemaToView(row: ProjectDbSchema): ProjectDbSchemaView {
  return {
    id: row.id,
    project_id: row.project_id,
    engine: row.engine,
    name: row.name,
    schema: parseJsonObject(row.schema_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ProjectDbSchemasRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): ProjectDbSchemaView[] {
    const rows = this.db
      .prepare('SELECT * FROM project_db_schemas WHERE project_id = ? ORDER BY name')
      .all(projectId) as ProjectDbSchema[];
    return rows.map(schemaToView);
  }

  findById(id: string): ProjectDbSchemaView | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_db_schemas WHERE id = ?')
      .get(id) as ProjectDbSchema | undefined;
    return row ? schemaToView(row) : undefined;
  }

  upsert(projectId: string, input: ProjectDbSchemaInput): ProjectDbSchemaView {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT * FROM project_db_schemas WHERE project_id = ? AND name = ?')
      .get(projectId, input.name) as ProjectDbSchema | undefined;
    if (existing) {
      this.db
        .prepare('UPDATE project_db_schemas SET engine = ?, schema_json = ?, updated_at = ? WHERE id = ?')
        .run(input.engine ?? existing.engine, JSON.stringify(input.schema), now, existing.id);
      return this.findById(existing.id) as ProjectDbSchemaView;
    }

    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO project_db_schemas (id, project_id, engine, name, schema_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, input.engine ?? 'sqlite', input.name, JSON.stringify(input.schema), now, now);
    return this.findById(id) as ProjectDbSchemaView;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM project_db_schemas WHERE id = ?').run(id);
  }
}

export class ProjectDbMigrationsRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): ProjectDbMigration[] {
    return this.db
      .prepare('SELECT * FROM project_db_migrations WHERE project_id = ? ORDER BY version DESC')
      .all(projectId) as ProjectDbMigration[];
  }

  nextVersion(projectId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM project_db_migrations WHERE project_id = ?')
      .get(projectId) as { version: number };
    return row.version;
  }

  create(projectId: string, input: ProjectDbMigrationInput): ProjectDbMigration {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const version = input.version ?? this.nextVersion(projectId);
    this.db
      .prepare(
        `INSERT INTO project_db_migrations
         (id, project_id, schema_id, version, name, content, status, applied_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(id, projectId, input.schemaId ?? null, version, input.name, input.content, input.status ?? 'generated', now, now);
    return this.db
      .prepare('SELECT * FROM project_db_migrations WHERE id = ?')
      .get(id) as ProjectDbMigration;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM project_db_migrations WHERE id = ?').run(id);
  }
}
