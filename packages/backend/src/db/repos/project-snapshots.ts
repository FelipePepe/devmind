import type Database from 'better-sqlite3';

export interface ProjectSnapshot {
  id: string;
  project_id: string;
  run_id: string | null;
  label: string | null;
  manifest_json: string;
  file_tree_json: string;
  resource_graph_json: string;
  created_at: string;
}

export interface ProjectSnapshotView {
  id: string;
  project_id: string;
  run_id: string | null;
  label: string | null;
  manifest: Record<string, unknown>;
  file_tree: unknown[];
  resource_graph: Record<string, unknown>;
  created_at: string;
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

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toView(row: ProjectSnapshot): ProjectSnapshotView {
  return {
    id: row.id,
    project_id: row.project_id,
    run_id: row.run_id,
    label: row.label,
    manifest: parseJsonObject(row.manifest_json),
    file_tree: parseJsonArray(row.file_tree_json),
    resource_graph: parseJsonObject(row.resource_graph_json),
    created_at: row.created_at,
  };
}

export class ProjectSnapshotsRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string, limit = 20): ProjectSnapshotView[] {
    const rows = this.db
      .prepare('SELECT * FROM project_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, limit) as ProjectSnapshot[];
    return rows.map(toView);
  }

  findById(id: string): ProjectSnapshotView | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_snapshots WHERE id = ?')
      .get(id) as ProjectSnapshot | undefined;
    return row ? toView(row) : undefined;
  }

  create(projectId: string, input: {
    runId?: string | null;
    label?: string | null;
    manifest: Record<string, unknown>;
    fileTree: unknown[];
    resourceGraph: Record<string, unknown>;
  }): ProjectSnapshotView {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO project_snapshots
         (id, project_id, run_id, label, manifest_json, file_tree_json, resource_graph_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        input.runId ?? null,
        input.label ?? null,
        JSON.stringify(input.manifest),
        JSON.stringify(input.fileTree),
        JSON.stringify(input.resourceGraph),
        new Date().toISOString()
      );
    const row = this.db
      .prepare('SELECT * FROM project_snapshots WHERE id = ?')
      .get(id) as ProjectSnapshot;
    return toView(row);
  }

  capture(projectId: string, runId?: string | null, label?: string | null): ProjectSnapshotView {
    const manifest = this.db
      .prepare('SELECT version, app_type, stack_json, commands_json, entrypoints_json FROM project_manifests WHERE project_id = ?')
      .get(projectId) as {
        version: number;
        app_type: string;
        stack_json: string;
        commands_json: string;
        entrypoints_json: string;
      } | undefined;
    const files = this.db
      .prepare('SELECT path, language, content, updated_at FROM project_files WHERE project_id = ? ORDER BY path')
      .all(projectId) as Array<{ path: string; language: string; content: string; updated_at: string }>;
    const services = this.db
      .prepare('SELECT kind, name, root_path, runtime, port, status, config_json FROM project_services WHERE project_id = ? ORDER BY kind, name')
      .all(projectId);
    const apiRoutes = this.db
      .prepare('SELECT method, path, handler_path, request_schema_json, response_schema_json FROM project_api_routes WHERE project_id = ? ORDER BY path, method')
      .all(projectId);
    const dbSchemas = this.db
      .prepare('SELECT engine, name, schema_json FROM project_db_schemas WHERE project_id = ? ORDER BY name')
      .all(projectId);
    const dbMigrations = this.db
      .prepare('SELECT version, name, content, status FROM project_db_migrations WHERE project_id = ? ORDER BY version')
      .all(projectId);
    const appResources = this.db
      .prepare('SELECT type, name, config FROM app_resources WHERE project_id = ? ORDER BY type, name')
      .all(projectId);
    const envVars = this.db
      .prepare('SELECT service_id, name, required, secret_ref, default_value, description FROM project_env_vars WHERE project_id = ? ORDER BY service_id, name')
      .all(projectId);

    const input: {
      runId?: string | null;
      label?: string | null;
      manifest: Record<string, unknown>;
      fileTree: unknown[];
      resourceGraph: Record<string, unknown>;
    } = {
      manifest: manifest ? {
        version: manifest.version,
        appType: manifest.app_type,
        stack: parseJsonObject(manifest.stack_json),
        commands: parseJsonObject(manifest.commands_json),
        entrypoints: parseJsonObject(manifest.entrypoints_json),
      } : {},
      fileTree: files,
      resourceGraph: {
        services,
        apiRoutes,
        dbSchemas,
        dbMigrations,
        appResources,
        envVars,
      },
    };
    if (runId !== undefined) input.runId = runId;
    if (label !== undefined) input.label = label;
    return this.create(projectId, input);
  }

  restore(projectId: string, snapshotId: string): ProjectSnapshotView | undefined {
    const snapshot = this.findById(snapshotId);
    if (!snapshot || snapshot.project_id !== projectId) return undefined;

    const now = new Date().toISOString();
    const manifest = snapshot.manifest;
    const resourceGraph = snapshot.resource_graph as {
      services?: unknown[];
      apiRoutes?: unknown[];
      dbSchemas?: unknown[];
      dbMigrations?: unknown[];
      appResources?: unknown[];
      envVars?: unknown[];
    };

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM project_files WHERE project_id = ?').run(projectId);
      this.db.prepare('DELETE FROM project_services WHERE project_id = ?').run(projectId);
      this.db.prepare('DELETE FROM project_api_routes WHERE project_id = ?').run(projectId);
      this.db.prepare('DELETE FROM project_db_migrations WHERE project_id = ?').run(projectId);
      this.db.prepare('DELETE FROM project_db_schemas WHERE project_id = ?').run(projectId);
      this.db.prepare('DELETE FROM project_env_vars WHERE project_id = ?').run(projectId);
      this.db.prepare('DELETE FROM app_resources WHERE project_id = ?').run(projectId);

      this.db.prepare('DELETE FROM project_manifests WHERE project_id = ?').run(projectId);
      this.db.prepare(
        `INSERT INTO project_manifests
         (id, project_id, version, app_type, stack_json, commands_json, entrypoints_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        projectId,
        typeof manifest['version'] === 'number' ? manifest['version'] : 1,
        typeof manifest['appType'] === 'string' ? manifest['appType'] : 'static-web',
        JSON.stringify(parseSnapshotObject(manifest['stack'])),
        JSON.stringify(parseSnapshotObject(manifest['commands'])),
        JSON.stringify(parseSnapshotObject(manifest['entrypoints'])),
        now,
        now
      );

      for (const file of snapshot.file_tree) {
        const item = parseSnapshotObject(file);
        const path = typeof item['path'] === 'string' ? item['path'] : '';
        const content = typeof item['content'] === 'string' ? item['content'] : '';
        if (!path) continue;
        this.db.prepare(
          `INSERT INTO project_files (id, project_id, path, content, language, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), projectId, path, content, typeof item['language'] === 'string' ? item['language'] : 'plaintext', now, now);
      }

      const serviceIdByName = new Map<string, string>();
      for (const service of resourceGraph.services ?? []) {
        const item = parseSnapshotObject(service);
        const name = typeof item['name'] === 'string' ? item['name'] : '';
        const kind = typeof item['kind'] === 'string' ? item['kind'] : 'frontend';
        const rootPath = typeof item['root_path'] === 'string' ? item['root_path'] : '.';
        const runtime = typeof item['runtime'] === 'string' ? item['runtime'] : 'static';
        if (!name) continue;
        const id = crypto.randomUUID();
        serviceIdByName.set(name, id);
        this.db.prepare(
          `INSERT INTO project_services
           (id, project_id, kind, name, root_path, runtime, port, status, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          projectId,
          kind,
          name,
          rootPath,
          runtime,
          typeof item['port'] === 'number' ? item['port'] : null,
          typeof item['status'] === 'string' ? item['status'] : 'planned',
          typeof item['config_json'] === 'string' ? item['config_json'] : '{}',
          now,
          now
        );
      }

      for (const route of resourceGraph.apiRoutes ?? []) {
        const item = parseSnapshotObject(route);
        const method = typeof item['method'] === 'string' ? item['method'] : 'GET';
        const path = typeof item['path'] === 'string' ? item['path'] : '';
        const handlerPath = typeof item['handler_path'] === 'string' ? item['handler_path'] : '';
        if (!path || !handlerPath) continue;
        this.db.prepare(
          `INSERT INTO project_api_routes
           (id, project_id, service_id, method, path, handler_path, request_schema_json, response_schema_json, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          projectId,
          method,
          path,
          handlerPath,
          typeof item['request_schema_json'] === 'string' ? item['request_schema_json'] : '{}',
          typeof item['response_schema_json'] === 'string' ? item['response_schema_json'] : '{}',
          now,
          now
        );
      }

      for (const schema of resourceGraph.dbSchemas ?? []) {
        const item = parseSnapshotObject(schema);
        const name = typeof item['name'] === 'string' ? item['name'] : '';
        if (!name) continue;
        this.db.prepare(
          `INSERT INTO project_db_schemas (id, project_id, engine, name, schema_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          projectId,
          typeof item['engine'] === 'string' ? item['engine'] : 'sqlite',
          name,
          typeof item['schema_json'] === 'string' ? item['schema_json'] : '{}',
          now,
          now
        );
      }

      for (const migration of resourceGraph.dbMigrations ?? []) {
        const item = parseSnapshotObject(migration);
        const name = typeof item['name'] === 'string' ? item['name'] : '';
        const content = typeof item['content'] === 'string' ? item['content'] : '';
        if (!name || !content) continue;
        this.db.prepare(
          `INSERT INTO project_db_migrations
           (id, project_id, schema_id, version, name, content, status, applied_at, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)`
        ).run(
          crypto.randomUUID(),
          projectId,
          typeof item['version'] === 'number' ? item['version'] : 1,
          name,
          content,
          typeof item['status'] === 'string' ? item['status'] : 'generated',
          now,
          now
        );
      }

      for (const resource of resourceGraph.appResources ?? []) {
        const item = parseSnapshotObject(resource);
        const type = typeof item['type'] === 'string' ? item['type'] : '';
        const name = typeof item['name'] === 'string' ? item['name'] : '';
        if (!type || !name) continue;
        this.db.prepare(
          `INSERT INTO app_resources (id, project_id, type, name, config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), projectId, type, name, typeof item['config'] === 'string' ? item['config'] : '{}', now, now);
      }

      for (const envVar of resourceGraph.envVars ?? []) {
        const item = parseSnapshotObject(envVar);
        const name = typeof item['name'] === 'string' ? item['name'] : '';
        if (!name) continue;
        this.db.prepare(
          `INSERT INTO project_env_vars
           (id, project_id, service_id, name, required, secret_ref, default_value, description, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          projectId,
          name,
          item['required'] === 0 ? 0 : 1,
          typeof item['secret_ref'] === 'string' ? item['secret_ref'] : null,
          typeof item['default_value'] === 'string' ? item['default_value'] : null,
          typeof item['description'] === 'string' ? item['description'] : null,
          now,
          now
        );
      }

      this.db.prepare('UPDATE previews SET status = ?, error = ?, updated_at = ? WHERE project_id = ?')
        .run('building', null, now, projectId);
      this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId);
    });

    tx();
    return snapshot;
  }
}

function parseSnapshotObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
