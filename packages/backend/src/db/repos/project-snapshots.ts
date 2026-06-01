import type Database from 'better-sqlite3';
import type { ProjectSnapshotBlobsRepo } from './project-snapshot-blobs.js';
import type { FlagsRepo } from './flags.js';
import { sha256 } from './hashing.js';

export type SnapshotTrigger = 'manual' | 'auto-pre-agent' | 'auto-post-agent' | 'milestone' | 'branch-root';
export type SnapshotRetention = 'ephemeral' | 'pinned';

export interface ProjectSnapshot {
  id: string;
  project_id: string;
  run_id: string | null;
  label: string | null;
  manifest_json: string;
  file_tree_json: string;
  resource_graph_json: string;
  created_at: string;
  // spec 004 extensions
  parent_snapshot_id: string | null;
  trigger: SnapshotTrigger;
  agent_run_id: string | null;
  message_id: string | null;
  retention: SnapshotRetention;
  file_manifest_json: string | null;
  screenshot_blob_hash: string | null;
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
  // spec 004 extensions
  parent_snapshot_id: string | null;
  trigger: SnapshotTrigger;
  agent_run_id: string | null;
  message_id: string | null;
  retention: SnapshotRetention;
  file_manifest: FileManifestEntry[] | null;
  screenshot_blob_hash: string | null;
}

export interface FileManifestEntry {
  path: string;
  hash: string;
  language?: string;
}

export interface CaptureOptions {
  runId?: string | null;
  label?: string | null;
  trigger?: SnapshotTrigger;
  parentSnapshotId?: string | null;
  agentRunId?: string | null;
  messageId?: string | null;
  retention?: SnapshotRetention;
}

export interface SnapshotDiff {
  files: {
    added: FileManifestEntry[];
    removed: FileManifestEntry[];
    modified: Array<{ path: string; a_hash: string; b_hash: string }>;
  };
  resources: Record<string, { added: unknown[]; removed: unknown[] }>;
}

export interface TimelineNode {
  id: string;
  parent_id: string | null;
  trigger: SnapshotTrigger;
  retention: SnapshotRetention;
  label: string | null;
  created_at: string;
  message_id: string | null;
  agent_run_id: string | null;
}

export interface SnapshotTimeline {
  tip_id: string | null;
  nodes: TimelineNode[];
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

function parseManifest(raw: string | null): FileManifestEntry[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (entry): entry is FileManifestEntry =>
        !!entry && typeof entry === 'object' &&
        typeof (entry as { path?: unknown }).path === 'string' &&
        typeof (entry as { hash?: unknown }).hash === 'string'
    );
  } catch {
    return null;
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
    parent_snapshot_id: row.parent_snapshot_id,
    trigger: row.trigger,
    agent_run_id: row.agent_run_id,
    message_id: row.message_id,
    retention: row.retention,
    file_manifest: parseManifest(row.file_manifest_json),
    screenshot_blob_hash: row.screenshot_blob_hash,
  };
}

export class ProjectSnapshotsRepo {
  constructor(
    private db: Database.Database,
    private blobs?: ProjectSnapshotBlobsRepo,
    private flags?: FlagsRepo
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

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

  findCurrentTip(projectId: string): ProjectSnapshotView | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM project_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get(projectId) as ProjectSnapshot | undefined;
    return row ? toView(row) : undefined;
  }

  findByMessageId(messageId: string): ProjectSnapshotView | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_snapshots WHERE message_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(messageId) as ProjectSnapshot | undefined;
    return row ? toView(row) : undefined;
  }

  getTimeline(projectId: string): SnapshotTimeline {
    const rows = this.db
      .prepare(
        `SELECT id, parent_snapshot_id, trigger, retention, label, created_at, message_id, agent_run_id
         FROM project_snapshots WHERE project_id = ? ORDER BY created_at ASC`
      )
      .all(projectId) as Array<{
        id: string;
        parent_snapshot_id: string | null;
        trigger: SnapshotTrigger;
        retention: SnapshotRetention;
        label: string | null;
        created_at: string;
        message_id: string | null;
        agent_run_id: string | null;
      }>;

    const tip = this.db
      .prepare('SELECT id FROM project_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(projectId) as { id: string } | undefined;

    return {
      tip_id: tip?.id ?? null,
      nodes: rows.map((r) => ({
        id: r.id,
        parent_id: r.parent_snapshot_id,
        trigger: r.trigger,
        retention: r.retention,
        label: r.label,
        created_at: r.created_at,
        message_id: r.message_id,
        agent_run_id: r.agent_run_id,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * Low-level insert. All spec-004 fields are optional and default to safe values.
   */
  create(projectId: string, input: {
    runId?: string | null;
    label?: string | null;
    manifest: Record<string, unknown>;
    fileTree: unknown[];
    resourceGraph: Record<string, unknown>;
    trigger?: SnapshotTrigger;
    parentSnapshotId?: string | null;
    agentRunId?: string | null;
    messageId?: string | null;
    retention?: SnapshotRetention;
    fileManifest?: FileManifestEntry[] | null;
    screenshotBlobHash?: string | null;
  }): ProjectSnapshotView {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO project_snapshots
         (id, project_id, run_id, label, manifest_json, file_tree_json, resource_graph_json, created_at,
          parent_snapshot_id, trigger, agent_run_id, message_id, retention,
          file_manifest_json, screenshot_blob_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        input.runId ?? null,
        input.label ?? null,
        JSON.stringify(input.manifest),
        JSON.stringify(input.fileTree),
        JSON.stringify(input.resourceGraph),
        new Date().toISOString(),
        input.parentSnapshotId ?? null,
        input.trigger ?? 'manual',
        input.agentRunId ?? null,
        input.messageId ?? null,
        input.retention ?? 'ephemeral',
        input.fileManifest ? JSON.stringify(input.fileManifest) : null,
        input.screenshotBlobHash ?? null
      );
    const row = this.db
      .prepare('SELECT * FROM project_snapshots WHERE id = ?')
      .get(id) as ProjectSnapshot;
    return toView(row);
  }

  /**
   * Capture current project state into a snapshot.
   *
   * Back-compat note: callers from spec 003 invoke `capture(projectId, runId?, label?)`.
   * The new optional fourth argument adds spec-004 metadata (trigger, parent,
   * agentRunId, messageId, retention) without breaking those callers.
   */
  capture(
    projectId: string,
    runId?: string | null,
    label?: string | null,
    options: CaptureOptions = {}
  ): ProjectSnapshotView {
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

    // Parent defaults to current tip when caller did not supply one.
    const parentSnapshotId =
      options.parentSnapshotId !== undefined
        ? options.parentSnapshotId
        : this.findCurrentTip(projectId)?.id ?? null;

    // Blob-dedup path: if enabled, hash file contents and persist them in blob
    // storage; the snapshot row stores only the manifest (path -> hash).
    let fileManifest: FileManifestEntry[] | null = null;
    if (this.isDedupEnabled() && this.blobs) {
      fileManifest = [];
      const hashes: string[] = [];
      for (const file of files) {
        const buf = Buffer.from(file.content, 'utf8');
        const hash = sha256(buf);
        this.blobs.writeIfMissing(hash, buf);
        const entry: FileManifestEntry = { path: file.path, hash };
        if (file.language) entry.language = file.language;
        fileManifest.push(entry);
        hashes.push(hash);
      }
      this.blobs.incrementRef(hashes);
    }

    const baseInput = {
      runId: runId ?? options.runId ?? null,
      label: label ?? options.label ?? null,
      trigger: options.trigger ?? 'manual',
      parentSnapshotId,
      agentRunId: options.agentRunId ?? null,
      messageId: options.messageId ?? null,
      retention: options.retention ?? 'ephemeral',
      fileManifest,
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
    return this.create(projectId, baseInput);
  }

  /**
   * Restore project state from `snapshotId`. Rehydrates project_files,
   * project_services, project_api_routes, project_db_schemas, project_db_migrations,
   * app_resources, project_env_vars and project_manifests in a single transaction.
   * After successful rehydrate, inserts a `branch-root` snapshot that points to
   * `snapshotId` as its parent, so the timeline visibly forks.
   */
  restore(
    projectId: string,
    snapshotId: string,
    opts: { confirm?: boolean } = {}
  ): ProjectSnapshotView | undefined {
    if (opts.confirm === false) {
      throw new Error('restore requires confirm=true');
    }
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

    // Branch-root snapshot: marks the fork point on the timeline so the UI can
    // visually distinguish a restore from a normal forward edit.
    this.create(projectId, {
      runId: snapshot.run_id,
      label: snapshot.label,
      trigger: 'branch-root',
      parentSnapshotId: snapshotId,
      retention: 'ephemeral',
      manifest: snapshot.manifest,
      fileTree: snapshot.file_tree,
      resourceGraph: snapshot.resource_graph,
    });

    return snapshot;
  }

  // ---------------------------------------------------------------------------
  // Spec 004 — metadata mutations
  // ---------------------------------------------------------------------------

  updateMetadata(
    id: string,
    patch: { label?: string | null; retention?: SnapshotRetention; screenshotBlobHash?: string | null }
  ): ProjectSnapshotView | undefined {
    const sets: string[] = [];
    const values: Array<string | null> = [];
    if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
      sets.push('label = ?');
      values.push(patch.label ?? null);
    }
    if (patch.retention) {
      sets.push('retention = ?');
      values.push(patch.retention);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'screenshotBlobHash')) {
      sets.push('screenshot_blob_hash = ?');
      values.push(patch.screenshotBlobHash ?? null);
    }
    if (sets.length === 0) return this.findById(id);
    this.db
      .prepare(`UPDATE project_snapshots SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values, id);
    return this.findById(id);
  }

  // ---------------------------------------------------------------------------
  // Spec 004 — diff
  // ---------------------------------------------------------------------------

  getDiff(projectId: string, snapshotIdA: string, snapshotIdB: string): SnapshotDiff | undefined {
    const a = this.findById(snapshotIdA);
    const b = this.findById(snapshotIdB);
    if (!a || !b) return undefined;
    if (a.project_id !== projectId || b.project_id !== projectId) return undefined;

    const manifestA = this.manifestFromSnapshot(a);
    const manifestB = this.manifestFromSnapshot(b);

    const mapA = new Map(manifestA.map((e) => [e.path, e.hash]));
    const mapB = new Map(manifestB.map((e) => [e.path, e.hash]));

    const added: FileManifestEntry[] = [];
    const removed: FileManifestEntry[] = [];
    const modified: Array<{ path: string; a_hash: string; b_hash: string }> = [];

    for (const entry of manifestB) {
      const prior = mapA.get(entry.path);
      if (prior === undefined) added.push(entry);
      else if (prior !== entry.hash) modified.push({ path: entry.path, a_hash: prior, b_hash: entry.hash });
    }
    for (const entry of manifestA) {
      if (!mapB.has(entry.path)) removed.push(entry);
    }

    const resources = this.diffResourceGraph(a.resource_graph, b.resource_graph);
    return { files: { added, removed, modified }, resources };
  }

  private manifestFromSnapshot(snapshot: ProjectSnapshotView): FileManifestEntry[] {
    if (snapshot.file_manifest) return snapshot.file_manifest;
    // Legacy fallback: hash file_tree contents on the fly so diff still works for
    // snapshots captured before dedup was enabled.
    const out: FileManifestEntry[] = [];
    for (const raw of snapshot.file_tree) {
      const item = parseSnapshotObject(raw);
      const path = typeof item['path'] === 'string' ? item['path'] : '';
      const content = typeof item['content'] === 'string' ? item['content'] : '';
      if (!path) continue;
      const entry: FileManifestEntry = { path, hash: sha256(content) };
      if (typeof item['language'] === 'string') entry.language = item['language'];
      out.push(entry);
    }
    return out;
  }

  private diffResourceGraph(
    a: Record<string, unknown>,
    b: Record<string, unknown>
  ): Record<string, { added: unknown[]; removed: unknown[] }> {
    const types = ['services', 'apiRoutes', 'dbSchemas', 'dbMigrations', 'appResources', 'envVars'];
    const result: Record<string, { added: unknown[]; removed: unknown[] }> = {};
    for (const type of types) {
      const arrA = Array.isArray(a[type]) ? (a[type] as unknown[]) : [];
      const arrB = Array.isArray(b[type]) ? (b[type] as unknown[]) : [];
      const setA = new Set(arrA.map((item) => JSON.stringify(item)));
      const setB = new Set(arrB.map((item) => JSON.stringify(item)));
      result[type] = {
        added: arrB.filter((item) => !setA.has(JSON.stringify(item))),
        removed: arrA.filter((item) => !setB.has(JSON.stringify(item))),
      };
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Spec 004 — retention pruning
  // ---------------------------------------------------------------------------

  prune(projectId: string): number {
    const project = this.db
      .prepare('SELECT snapshot_retention_keep FROM projects WHERE id = ?')
      .get(projectId) as { snapshot_retention_keep: number } | undefined;
    if (!project) return 0;
    const keep = project.snapshot_retention_keep ?? 20;

    const ephemerals = this.db
      .prepare(
        `SELECT id, file_manifest_json, file_tree_json
         FROM project_snapshots
         WHERE project_id = ? AND retention = 'ephemeral'
         ORDER BY created_at DESC`
      )
      .all(projectId) as Array<{
        id: string;
        file_manifest_json: string | null;
        file_tree_json: string;
      }>;

    if (ephemerals.length <= keep) return 0;

    const victims = ephemerals.slice(keep);
    const tx = this.db.transaction(() => {
      const decrementHashes: string[] = [];
      for (const victim of victims) {
        const manifest = parseManifest(victim.file_manifest_json);
        if (manifest) decrementHashes.push(...manifest.map((m) => m.hash));
        this.db.prepare('DELETE FROM project_snapshots WHERE id = ?').run(victim.id);
      }
      if (this.blobs && decrementHashes.length > 0) {
        this.blobs.decrementRef(decrementHashes);
        this.blobs.deleteOrphans();
      }
    });
    tx();
    return victims.length;
  }

  // ---------------------------------------------------------------------------
  // Spec 004 — helpers
  // ---------------------------------------------------------------------------

  private isDedupEnabled(): boolean {
    if (!this.flags) return false;
    const flag = this.flags.get('versioning.dedup_blobs');
    return flag?.value === 'true';
  }

  isAutoCaptureEnabled(): boolean {
    if (!this.flags) return false;
    const flag = this.flags.get('versioning.auto_capture');
    return flag?.value === 'true';
  }

  /**
   * Discard a snapshot — used by auto-capture when the post-snapshot turned out
   * identical to the pre-snapshot, so the timeline stays clean. Decrements blob
   * ref counts and reclaims orphans in the same transaction.
   */
  discard(snapshotId: string): void {
    const snapshot = this.findById(snapshotId);
    if (!snapshot) return;
    const tx = this.db.transaction(() => {
      if (this.blobs && snapshot.file_manifest) {
        this.blobs.decrementRef(snapshot.file_manifest.map((e) => e.hash));
        this.blobs.deleteOrphans();
      }
      this.db.prepare('DELETE FROM project_snapshots WHERE id = ?').run(snapshotId);
    });
    tx();
  }

  /**
   * Recount blob ref_count across all live snapshots and delete orphans.
   * Used by the admin compact endpoint to recover storage if ref counts drift.
   */
  compactBlobs(): { recounted: number; orphans_deleted: number } {
    if (!this.blobs) return { recounted: 0, orphans_deleted: 0 };
    const tx = this.db.transaction(() => {
      // Reset all ref counts to 0, then increment from the live manifests.
      this.db.prepare('UPDATE project_snapshot_blobs SET ref_count = 0').run();
      const rows = this.db
        .prepare(`SELECT file_manifest_json FROM project_snapshots WHERE file_manifest_json IS NOT NULL`)
        .all() as Array<{ file_manifest_json: string }>;
      const hashes: string[] = [];
      for (const row of rows) {
        const manifest = parseManifest(row.file_manifest_json);
        if (manifest) hashes.push(...manifest.map((m) => m.hash));
      }
      if (this.blobs && hashes.length > 0) this.blobs.incrementRef(hashes);
      return {
        recounted: hashes.length,
        orphans_deleted: this.blobs ? this.blobs.deleteOrphans() : 0,
      };
    });
    return tx();
  }
}

/**
 * Deterministic hash of a snapshot's mutable state. Used by auto-capture to
 * detect whether the agent loop actually changed anything between the pre and
 * post snapshots without re-reading the project tables a second time.
 */
export function snapshotStateHash(snapshot: ProjectSnapshotView): string {
  return sha256(
    JSON.stringify({
      manifest: snapshot.manifest,
      files: snapshot.file_manifest ?? snapshot.file_tree,
      resources: snapshot.resource_graph,
    })
  );
}

function parseSnapshotObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
