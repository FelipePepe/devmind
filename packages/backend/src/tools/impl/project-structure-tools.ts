import type { ToolDef } from '../types.js';
import type { ProjectManifestsRepo } from '../../db/repos/project-manifests.js';
import type {
  ProjectServicesRepo,
  ProjectServiceKind,
  ProjectServiceStatus,
} from '../../db/repos/project-services.js';
import type {
  ProjectApiRoutesRepo,
  ProjectApiRouteMethod,
} from '../../db/repos/project-api-routes.js';
import type {
  ProjectDbSchemasRepo,
  ProjectDbMigrationsRepo,
  ProjectDbMigrationStatus,
} from '../../db/repos/project-database.js';
import type { ProjectEnvVarsRepo } from '../../db/repos/project-env-vars.js';
import type { JobQueueClient } from '../../workers/queue.js';
import type { ProjectSnapshotsRepo } from '../../db/repos/project-snapshots.js';

const SERVICE_KINDS = new Set(['frontend', 'backend', 'worker']);
const SERVICE_STATUSES = new Set(['planned', 'generating', 'ready', 'failed', 'disabled']);
const API_ROUTE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const DB_MIGRATION_STATUSES = new Set(['draft', 'generated', 'applied', 'failed']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0 && !value.startsWith('/') && !value.split('/').includes('..');
}

export function createProjectStructureTools(
  manifests: ProjectManifestsRepo,
  services: ProjectServicesRepo,
  apiRoutes: ProjectApiRoutesRepo,
  dbSchemas: ProjectDbSchemasRepo,
  dbMigrations: ProjectDbMigrationsRepo,
  envVars: ProjectEnvVarsRepo,
  snapshots: ProjectSnapshotsRepo,
  jobs: JobQueueClient
): ToolDef[] {
  const readProjectManifest: ToolDef = {
    name: 'read_project_manifest',
    description: 'Read the current structured full-stack manifest for the active project.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (_args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';
      const manifest = manifests.findByProject(ctx.projectId);
      if (!manifest) return 'No project manifest yet.';
      return JSON.stringify(manifest, null, 2);
    },
  };

  const updateProjectManifest: ToolDef = {
    name: 'update_project_manifest',
    description:
      'Create or update the active project manifest. Use this before or alongside full-stack app generation.',
    parameters: {
      type: 'object',
      properties: {
        version: { type: 'number', description: 'Manifest version, usually 1' },
        appType: { type: 'string', description: 'App type, e.g. static-web or fullstack-web' },
        stack: { type: 'object', description: 'Selected stack, e.g. frontend/backend/database/auth' },
        commands: { type: 'object', description: 'Project commands such as dev, build, test, start' },
        entrypoints: { type: 'object', description: 'Service entrypoints such as frontend and backend files' },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';

      const input: {
        version?: number;
        appType?: string;
        stack?: Record<string, unknown>;
        commands?: Record<string, unknown>;
        entrypoints?: Record<string, unknown>;
      } = {};

      if (typeof args['version'] === 'number' && Number.isInteger(args['version']) && args['version'] > 0) {
        input.version = args['version'];
      }
      if (typeof args['appType'] === 'string' && args['appType'].trim()) {
        input.appType = args['appType'].trim();
      }
      const stack = asRecord(args['stack']);
      if (stack) input.stack = stack;
      const commands = asRecord(args['commands']);
      if (commands) input.commands = commands;
      const entrypoints = asRecord(args['entrypoints']);
      if (entrypoints) input.entrypoints = entrypoints;

      const manifest = manifests.upsert(ctx.projectId, input);
      return `Project manifest updated:\n${JSON.stringify(manifest, null, 2)}`;
    },
  };

  const createProjectService: ToolDef = {
    name: 'create_project_service',
    description:
      'Create a frontend, backend, or worker service in the active project. Use this for full-stack project structure.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['frontend', 'backend', 'worker'] },
        name: { type: 'string' },
        rootPath: { type: 'string', description: 'Relative root path such as frontend or backend' },
        runtime: { type: 'string', description: 'Runtime such as static, react-vite, hono-node, node-worker' },
        port: { type: ['number', 'null'], description: 'Optional preferred port' },
        status: { type: 'string', enum: ['planned', 'generating', 'ready', 'failed', 'disabled'] },
        config: { type: 'object' },
      },
      required: ['kind', 'name', 'rootPath', 'runtime'],
    },
    execute: async (args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';

      const kindRaw = String(args['kind'] ?? '').trim();
      if (!SERVICE_KINDS.has(kindRaw)) return `Error: invalid service kind "${kindRaw}"`;
      const name = String(args['name'] ?? '').trim();
      if (!name) return 'Error: service name is required';
      const rootPath = String(args['rootPath'] ?? '').trim();
      if (!isSafeRelativePath(rootPath)) return 'Error: rootPath must be relative and stay inside the project';
      const runtime = String(args['runtime'] ?? '').trim();
      if (!runtime) return 'Error: runtime is required';

      const input: {
        kind: ProjectServiceKind;
        name: string;
        rootPath: string;
        runtime: string;
        port?: number | null;
        status?: ProjectServiceStatus;
        config?: Record<string, unknown>;
      } = {
        kind: kindRaw as ProjectServiceKind,
        name,
        rootPath,
        runtime,
      };

      if (args['port'] === null) {
        input.port = null;
      } else if (typeof args['port'] === 'number' && Number.isInteger(args['port'])) {
        if (args['port'] < 1 || args['port'] > 65535) return 'Error: port must be between 1 and 65535';
        input.port = args['port'];
      }

      const statusRaw = typeof args['status'] === 'string' ? args['status'].trim() : '';
      if (statusRaw) {
        if (!SERVICE_STATUSES.has(statusRaw)) return `Error: invalid service status "${statusRaw}"`;
        input.status = statusRaw as ProjectServiceStatus;
      }

      const config = asRecord(args['config']);
      if (config) input.config = config;

      const service = services.create(ctx.projectId, input);
      return `Project service created:\n${JSON.stringify(service, null, 2)}`;
    },
  };

  const upsertApiRoute: ToolDef = {
    name: 'upsert_api_route',
    description:
      'Create or update a structured API route for the active project. Use this when adding backend/API behavior.',
    parameters: {
      type: 'object',
      properties: {
        serviceId: { type: ['string', 'null'], description: 'Optional backend service id that owns this route' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        path: { type: 'string', description: 'HTTP path such as /api/customers or /api/customers/:id' },
        handlerPath: { type: 'string', description: 'Relative generated handler path such as backend/src/routes/customers.ts' },
        requestSchema: { type: 'object', description: 'Optional JSON schema or structured request shape' },
        responseSchema: { type: 'object', description: 'Optional JSON schema or structured response shape' },
      },
      required: ['method', 'path', 'handlerPath'],
    },
    execute: async (args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';

      const methodRaw = String(args['method'] ?? '').trim().toUpperCase();
      if (!API_ROUTE_METHODS.has(methodRaw)) return `Error: invalid API route method "${methodRaw}"`;

      const path = String(args['path'] ?? '').trim();
      if (!path.startsWith('/') || path.includes('..')) {
        return 'Error: API route path must start with "/" and stay URL-safe';
      }

      const handlerPath = String(args['handlerPath'] ?? '').trim();
      if (!isSafeRelativePath(handlerPath)) {
        return 'Error: handlerPath must be relative and stay inside the project';
      }

      const serviceIdRaw = args['serviceId'];
      let serviceId: string | null | undefined;
      if (serviceIdRaw === null) {
        serviceId = null;
      } else if (typeof serviceIdRaw === 'string' && serviceIdRaw.trim()) {
        const service = services.findById(serviceIdRaw.trim());
        if (!service || service.project_id !== ctx.projectId) return 'Error: service not found';
        serviceId = serviceIdRaw.trim();
      }

      const requestSchema = asRecord(args['requestSchema']);
      const responseSchema = asRecord(args['responseSchema']);
      const input: {
        serviceId?: string | null;
        method: ProjectApiRouteMethod;
        path: string;
        handlerPath: string;
        requestSchema?: Record<string, unknown>;
        responseSchema?: Record<string, unknown>;
      } = {
        method: methodRaw as ProjectApiRouteMethod,
        path,
        handlerPath,
      };
      if (serviceId !== undefined) input.serviceId = serviceId;
      if (requestSchema) input.requestSchema = requestSchema;
      if (responseSchema) input.responseSchema = responseSchema;

      const route = apiRoutes.upsert(ctx.projectId, input);
      return `Project API route upserted:\n${JSON.stringify(route, null, 2)}`;
    },
  };

  const upsertDatabaseSchema: ToolDef = {
    name: 'upsert_database_schema',
    description:
      'Create or update a structured database schema for the active generated project.',
    parameters: {
      type: 'object',
      properties: {
        engine: { type: 'string', description: 'Database engine, usually sqlite for v1' },
        name: { type: 'string', description: 'Schema name such as app or main' },
        schema: { type: 'object', description: 'Structured schema definition, tables, columns, indexes, relations' },
      },
      required: ['name', 'schema'],
    },
    execute: async (args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';
      const name = String(args['name'] ?? '').trim();
      if (!name) return 'Error: schema name is required';
      const schema = asRecord(args['schema']);
      if (!schema) return 'Error: schema must be an object';
      const input: { engine?: string; name: string; schema: Record<string, unknown> } = { name, schema };
      if (typeof args['engine'] === 'string' && args['engine'].trim()) {
        input.engine = args['engine'].trim();
      }
      const saved = dbSchemas.upsert(ctx.projectId, input);
      return `Project database schema upserted:\n${JSON.stringify(saved, null, 2)}`;
    },
  };

  const createDatabaseMigration: ToolDef = {
    name: 'create_database_migration',
    description:
      'Create a generated database migration for the active project. Use this alongside schema changes.',
    parameters: {
      type: 'object',
      properties: {
        schemaId: { type: ['string', 'null'], description: 'Optional project database schema id' },
        version: { type: 'number', description: 'Optional positive integer migration version; omitted means next version' },
        name: { type: 'string' },
        content: { type: 'string', description: 'Migration SQL or migration file content' },
        status: { type: 'string', enum: ['draft', 'generated', 'applied', 'failed'] },
      },
      required: ['name', 'content'],
    },
    execute: async (args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';
      const name = String(args['name'] ?? '').trim();
      if (!name) return 'Error: migration name is required';
      const content = String(args['content'] ?? '').trim();
      if (!content) return 'Error: migration content is required';

      let schemaId: string | null | undefined;
      if (args['schemaId'] === null) {
        schemaId = null;
      } else if (typeof args['schemaId'] === 'string' && args['schemaId'].trim()) {
        const schema = dbSchemas.findById(args['schemaId'].trim());
        if (!schema || schema.project_id !== ctx.projectId) return 'Error: schema not found';
        schemaId = args['schemaId'].trim();
      }

      const input: {
        schemaId?: string | null;
        version?: number;
        name: string;
        content: string;
        status?: ProjectDbMigrationStatus;
      } = { name, content };

      if (schemaId !== undefined) input.schemaId = schemaId;
      if (typeof args['version'] === 'number' && Number.isInteger(args['version']) && args['version'] > 0) {
        input.version = args['version'];
      }

      const statusRaw = typeof args['status'] === 'string' ? args['status'].trim() : '';
      if (statusRaw) {
        if (!DB_MIGRATION_STATUSES.has(statusRaw)) return `Error: invalid migration status "${statusRaw}"`;
        input.status = statusRaw as ProjectDbMigrationStatus;
      }

      const migration = dbMigrations.create(ctx.projectId, input);
      return `Project database migration created:\n${JSON.stringify(migration, null, 2)}`;
    },
  };

  const upsertEnvVar: ToolDef = {
    name: 'upsert_env_var',
    description:
      'Create or update an environment variable requirement for the active generated project. Never store raw secrets; use secretRef instead.',
    parameters: {
      type: 'object',
      properties: {
        serviceId: { type: ['string', 'null'], description: 'Optional service id that needs this env var' },
        name: { type: 'string', description: 'SCREAMING_SNAKE_CASE env var name' },
        required: { type: 'boolean' },
        secretRef: { type: ['string', 'null'], description: 'Reference to secret storage, not the raw secret value' },
        defaultValue: { type: ['string', 'null'], description: 'Non-secret default value' },
        description: { type: ['string', 'null'] },
      },
      required: ['name'],
    },
    execute: async (args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';
      const name = String(args['name'] ?? '').trim();
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return 'Error: env var name must be SCREAMING_SNAKE_CASE';

      let serviceId: string | null | undefined;
      if (args['serviceId'] === null) {
        serviceId = null;
      } else if (typeof args['serviceId'] === 'string' && args['serviceId'].trim()) {
        const service = services.findById(args['serviceId'].trim());
        if (!service || service.project_id !== ctx.projectId) return 'Error: service not found';
        serviceId = args['serviceId'].trim();
      }

      const input: {
        serviceId?: string | null;
        name: string;
        required?: boolean;
        secretRef?: string | null;
        defaultValue?: string | null;
        description?: string | null;
      } = { name };
      if (serviceId !== undefined) input.serviceId = serviceId;
      if (typeof args['required'] === 'boolean') input.required = args['required'];
      if (args['secretRef'] === null || typeof args['secretRef'] === 'string') {
        input.secretRef = args['secretRef'] ? args['secretRef'].trim() : null;
      }
      if (args['defaultValue'] === null || typeof args['defaultValue'] === 'string') {
        input.defaultValue = args['defaultValue'];
      }
      if (args['description'] === null || typeof args['description'] === 'string') {
        input.description = args['description'];
      }

      const envVar = envVars.upsert(ctx.projectId, input);
      return `Project env var upserted:\n${JSON.stringify(envVar, null, 2)}`;
    },
  };

  const requestProjectValidation: ToolDef = {
    name: 'request_project_validation',
    description: 'Queue validation for the active project after structured state or files change.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (_args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';
      const jobId = jobs.enqueue('validateProject', { projectId: ctx.projectId });
      return `Project validation queued: ${jobId}`;
    },
  };

  const createProjectSnapshot: ToolDef = {
    name: 'create_project_snapshot',
    description: 'Capture a restorable metadata snapshot of the active project manifest, files, and structured resources.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Optional human label for the snapshot' },
        runId: { type: ['string', 'null'], description: 'Optional project run id associated with this snapshot' },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';
      const label = typeof args['label'] === 'string' && args['label'].trim() ? args['label'].trim() : null;
      const runId = typeof args['runId'] === 'string' && args['runId'].trim() ? args['runId'].trim() : null;
      const snapshot = snapshots.capture(ctx.projectId, runId, label);
      return `Project snapshot created:\n${JSON.stringify(snapshot, null, 2)}`;
    },
  };

  return [
    readProjectManifest,
    updateProjectManifest,
    createProjectService,
    upsertApiRoute,
    upsertDatabaseSchema,
    createDatabaseMigration,
    upsertEnvVar,
    requestProjectValidation,
    createProjectSnapshot,
  ];
}
