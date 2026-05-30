import { Hono } from 'hono';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authMiddleware } from '../auth/middleware.js';
import { config } from '../config.js';
import type { ProjectsRepo } from '../db/repos/projects.js';
import type { ScreensRepo } from '../db/repos/screens.js';
import type { SessionsRepo } from '../db/repos/sessions.js';
import type { PreviewsRepo } from '../db/repos/previews.js';
import type { AppResourcesRepo, AppResourceType } from '../db/repos/app-resources.js';
import type { ProjectFilesRepo } from '../db/repos/project-files.js';
import { getMimeType } from '../db/repos/project-files.js';
import type { ProjectRunsRepo } from '../db/repos/project-runs.js';
import type { ComponentsRepo } from '../db/repos/components.js';
import type { ProjectManifestsRepo } from '../db/repos/project-manifests.js';
import type {
  ProjectServicesRepo,
  ProjectServiceKind,
  ProjectServiceStatus,
} from '../db/repos/project-services.js';
import type {
  ProjectApiRoutesRepo,
  ProjectApiRouteMethod,
} from '../db/repos/project-api-routes.js';
import type {
  ProjectDbSchemasRepo,
  ProjectDbMigrationsRepo,
  ProjectDbMigrationStatus,
} from '../db/repos/project-database.js';
import type { ProjectEnvVarsRepo } from '../db/repos/project-env-vars.js';
import type {
  ProjectValidationReportsRepo,
  ProjectRuntimeInstancesRepo,
} from '../db/repos/project-validation-runtime.js';
import type { ProjectSnapshotsRepo, SnapshotRetention } from '../db/repos/project-snapshots.js';
import type { ProjectSnapshotBlobsRepo } from '../db/repos/project-snapshot-blobs.js';
import type { ProjectTestsRepo, ProjectTestRunsRepo } from '../db/repos/project-tests.js';
import type { JobQueueClient } from '../workers/queue.js';
import type { HonoEnv } from '../types.js';

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

const UpdateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

const APP_RESOURCE_TYPES = ['collection', 'storage', 'realtime_channel', 'background_job', 'auth_config'] as const;

const CreateAppResourceSchema = z.object({
  type: z.enum(APP_RESOURCE_TYPES),
  name: z.string().trim().min(1).max(120),
  config: z.record(z.unknown()).optional(),
});

const UpdateAppResourceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: z.record(z.unknown()).optional(),
});

const CreateScreenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  path: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .regex(/^\/[a-z0-9\-/_]*$/i, 'path must start with "/" and contain URL-safe characters'),
});

const CreateComponentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().default(''),
});

const UpdateComponentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  content: z.string().optional(),
});

const ManifestSchema = z.object({
  version: z.number().int().positive().optional(),
  appType: z.string().trim().min(1).max(80).optional(),
  stack: z.record(z.unknown()).optional(),
  commands: z.record(z.unknown()).optional(),
  entrypoints: z.record(z.unknown()).optional(),
});

const SERVICE_KINDS = ['frontend', 'backend', 'worker'] as const;
const SERVICE_STATUSES = ['planned', 'generating', 'ready', 'failed', 'disabled'] as const;
const API_ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const DB_MIGRATION_STATUSES = ['draft', 'generated', 'applied', 'failed'] as const;

const rootPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
    message: 'rootPath must be relative and stay inside the project',
  });

const CreateServiceSchema = z.object({
  kind: z.enum(SERVICE_KINDS),
  name: z.string().trim().min(1).max(120),
  rootPath: rootPathSchema,
  runtime: z.string().trim().min(1).max(120),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  status: z.enum(SERVICE_STATUSES).optional(),
  config: z.record(z.unknown()).optional(),
});

const UpdateServiceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  rootPath: rootPathSchema.optional(),
  runtime: z.string().trim().min(1).max(120).optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  status: z.enum(SERVICE_STATUSES).optional(),
  config: z.record(z.unknown()).optional(),
});

const apiPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^\/[a-z0-9\-/_:]*$/i, 'path must start with "/" and contain URL-safe characters');

const handlerPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
    message: 'handlerPath must be relative and stay inside the project',
  });

const UpsertApiRouteSchema = z.object({
  serviceId: z.string().trim().min(1).nullable().optional(),
  method: z.enum(API_ROUTE_METHODS),
  path: apiPathSchema,
  handlerPath: handlerPathSchema,
  requestSchema: z.record(z.unknown()).optional(),
  responseSchema: z.record(z.unknown()).optional(),
});

const UpsertDbSchemaSchema = z.object({
  engine: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120),
  schema: z.record(z.unknown()),
});

const CreateDbMigrationSchema = z.object({
  schemaId: z.string().trim().min(1).nullable().optional(),
  version: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(160),
  content: z.string().min(1),
  status: z.enum(DB_MIGRATION_STATUSES).optional(),
});

const UpsertEnvVarSchema = z.object({
  serviceId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(120).regex(/^[A-Z][A-Z0-9_]*$/, 'name must be SCREAMING_SNAKE_CASE'),
  required: z.boolean().optional(),
  secretRef: z.string().trim().min(1).max(240).nullable().optional(),
  defaultValue: z.string().max(2000).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

const CreateSnapshotSchema = z.object({
  runId: z.string().trim().min(1).nullable().optional(),
  label: z.string().trim().min(1).max(160).nullable().optional(),
});

const RestoreSnapshotSchema = z.object({
  confirm: z.literal(true),
});

const UpdateSnapshotMetadataSchema = z.object({
  label: z.string().trim().min(1).max(160).nullable().optional(),
  retention: z.enum(['ephemeral', 'pinned']).optional(),
});

const UpdateSnapshotRetentionSchema = z.object({
  snapshot_retention_keep: z.number().int().min(1).max(500),
});

function signPreviewTicket(projectId: string, exp: number): string {
  return createHmac('sha256', config.JWT_SECRET)
    .update(`${projectId}.${exp}`)
    .digest('base64url');
}

function verifyPreviewTicket(projectId: string, expRaw?: string, sig?: string): boolean {
  const exp = Number(expRaw ?? 0);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (!sig) return false;
  const expected = signPreviewTicket(projectId, exp);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createBuilderRouter(
  projects: ProjectsRepo,
  screens: ScreensRepo,
  sessions: SessionsRepo,
  previews: PreviewsRepo,
  appResources: AppResourcesRepo,
  projectFiles: ProjectFilesRepo,
  projectRuns: ProjectRunsRepo,
  components: ComponentsRepo,
  projectManifests: ProjectManifestsRepo,
  projectServices: ProjectServicesRepo,
  projectApiRoutes: ProjectApiRoutesRepo,
  projectDbSchemas: ProjectDbSchemasRepo,
  projectDbMigrations: ProjectDbMigrationsRepo,
  projectEnvVars: ProjectEnvVarsRepo,
  projectValidationReports: ProjectValidationReportsRepo,
  projectRuntimeInstances: ProjectRuntimeInstancesRepo,
  projectSnapshots: ProjectSnapshotsRepo,
  projectSnapshotBlobs: ProjectSnapshotBlobsRepo,
  projectTests: ProjectTestsRepo,
  projectTestRuns: ProjectTestRunsRepo,
  jobs: JobQueueClient
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/projects', authMiddleware, (c) => {
    const userId = c.get('userId');
    return c.json(projects.findByUser(userId));
  });

  router.post('/projects', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = CreateProjectSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const project = projects.create(userId, parsed.data.name, parsed.data.description);
    return c.json(project, 201);
  });

  router.get('/projects/:id', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(project);
  });

  router.patch('/projects/:id', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = UpdateProjectSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const patch: { name?: string; description?: string | null } = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;

    projects.update(userId, projectId, patch);
    return c.json(projects.findById(userId, projectId));
  });

  router.delete('/projects/:id', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    projects.delete(userId, projectId);
    return c.body(null, 204);
  });

  router.get('/projects/:id/screens', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(screens.findByProject(projectId));
  });

  router.post('/projects/:id/screens', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = CreateScreenSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const screen = screens.create(projectId, parsed.data.name, parsed.data.path);
    projects.update(userId, projectId, {});
    return c.json(screen, 201);
  });

  router.get('/projects/:id/sessions', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(sessions.findByProject(projectId));
  });

  router.get('/projects/:id/manifest', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectManifests.findByProject(projectId) ?? null);
  });

  router.put('/projects/:id/manifest', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = ManifestSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const manifestInput: {
      version?: number;
      appType?: string;
      stack?: Record<string, unknown>;
      commands?: Record<string, unknown>;
      entrypoints?: Record<string, unknown>;
    } = {};
    if (parsed.data.version !== undefined) manifestInput.version = parsed.data.version;
    if (parsed.data.appType !== undefined) manifestInput.appType = parsed.data.appType;
    if (parsed.data.stack !== undefined) manifestInput.stack = parsed.data.stack;
    if (parsed.data.commands !== undefined) manifestInput.commands = parsed.data.commands;
    if (parsed.data.entrypoints !== undefined) manifestInput.entrypoints = parsed.data.entrypoints;

    const manifest = projectManifests.upsert(projectId, manifestInput);
    projects.update(userId, projectId, {});
    return c.json(manifest);
  });

  router.delete('/projects/:id/manifest', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    projectManifests.delete(projectId);
    projects.update(userId, projectId, {});
    return c.body(null, 204);
  });

  router.get('/projects/:id/services', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectServices.findByProject(projectId));
  });

  router.post('/projects/:id/services', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = CreateServiceSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const serviceInput: {
      kind: ProjectServiceKind;
      name: string;
      rootPath: string;
      runtime: string;
      port?: number | null;
      status?: ProjectServiceStatus;
      config?: Record<string, unknown>;
    } = {
      kind: parsed.data.kind as ProjectServiceKind,
      name: parsed.data.name,
      rootPath: parsed.data.rootPath,
      runtime: parsed.data.runtime,
    };
    if (parsed.data.port !== undefined) serviceInput.port = parsed.data.port;
    if (parsed.data.status !== undefined) serviceInput.status = parsed.data.status as ProjectServiceStatus;
    if (parsed.data.config !== undefined) serviceInput.config = parsed.data.config;

    const service = projectServices.create(projectId, serviceInput);
    projects.update(userId, projectId, {});
    return c.json(service, 201);
  });

  router.patch('/projects/:id/services/:serviceId', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const serviceId = c.req.param('serviceId');
    if (!projectId || !serviceId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const existing = projectServices.findById(serviceId);
    if (!existing || existing.project_id !== projectId) return c.json({ error: 'Service not found' }, 404);

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = UpdateServiceSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const patch: {
      name?: string;
      rootPath?: string;
      runtime?: string;
      port?: number | null;
      status?: ProjectServiceStatus;
      config?: Record<string, unknown>;
    } = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.rootPath !== undefined) patch.rootPath = parsed.data.rootPath;
    if (parsed.data.runtime !== undefined) patch.runtime = parsed.data.runtime;
    if (parsed.data.port !== undefined) patch.port = parsed.data.port;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status as ProjectServiceStatus;
    if (parsed.data.config !== undefined) patch.config = parsed.data.config;

    const service = projectServices.update(serviceId, patch);
    projects.update(userId, projectId, {});
    return c.json(service);
  });

  router.delete('/projects/:id/services/:serviceId', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const serviceId = c.req.param('serviceId');
    if (!projectId || !serviceId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const existing = projectServices.findById(serviceId);
    if (!existing || existing.project_id !== projectId) return c.json({ error: 'Service not found' }, 404);
    projectServices.delete(serviceId);
    projects.update(userId, projectId, {});
    return c.body(null, 204);
  });

  router.get('/projects/:id/api-routes', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectApiRoutes.findByProject(projectId));
  });

  router.put('/projects/:id/api-routes', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = UpsertApiRouteSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    if (parsed.data.serviceId) {
      const service = projectServices.findById(parsed.data.serviceId);
      if (!service || service.project_id !== projectId) {
        return c.json({ error: 'Service not found' }, 404);
      }
    }

    const routeInput: {
      serviceId?: string | null;
      method: ProjectApiRouteMethod;
      path: string;
      handlerPath: string;
      requestSchema?: Record<string, unknown>;
      responseSchema?: Record<string, unknown>;
    } = {
      method: parsed.data.method as ProjectApiRouteMethod,
      path: parsed.data.path,
      handlerPath: parsed.data.handlerPath,
    };
    if (parsed.data.serviceId !== undefined) routeInput.serviceId = parsed.data.serviceId;
    if (parsed.data.requestSchema !== undefined) routeInput.requestSchema = parsed.data.requestSchema;
    if (parsed.data.responseSchema !== undefined) routeInput.responseSchema = parsed.data.responseSchema;

    const route = projectApiRoutes.upsert(projectId, routeInput);
    projects.update(userId, projectId, {});
    return c.json(route);
  });

  router.delete('/projects/:id/api-routes/:routeId', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const routeId = c.req.param('routeId');
    if (!projectId || !routeId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const existing = projectApiRoutes.findById(routeId);
    if (!existing || existing.project_id !== projectId) return c.json({ error: 'API route not found' }, 404);
    projectApiRoutes.delete(routeId);
    projects.update(userId, projectId, {});
    return c.body(null, 204);
  });

  router.get('/projects/:id/database', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json({
      schemas: projectDbSchemas.findByProject(projectId),
      migrations: projectDbMigrations.findByProject(projectId),
    });
  });

  router.put('/projects/:id/database/schemas', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = UpsertDbSchemaSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const schemaInput: { engine?: string; name: string; schema: Record<string, unknown> } = {
      name: parsed.data.name,
      schema: parsed.data.schema,
    };
    if (parsed.data.engine !== undefined) schemaInput.engine = parsed.data.engine;
    const schema = projectDbSchemas.upsert(projectId, schemaInput);
    projects.update(userId, projectId, {});
    return c.json(schema);
  });

  router.post('/projects/:id/database/migrations', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = CreateDbMigrationSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    if (parsed.data.schemaId) {
      const schema = projectDbSchemas.findById(parsed.data.schemaId);
      if (!schema || schema.project_id !== projectId) return c.json({ error: 'Schema not found' }, 404);
    }

    const migrationInput: {
      schemaId?: string | null;
      version?: number;
      name: string;
      content: string;
      status?: ProjectDbMigrationStatus;
    } = {
      name: parsed.data.name,
      content: parsed.data.content,
    };
    if (parsed.data.schemaId !== undefined) migrationInput.schemaId = parsed.data.schemaId;
    if (parsed.data.version !== undefined) migrationInput.version = parsed.data.version;
    if (parsed.data.status !== undefined) migrationInput.status = parsed.data.status as ProjectDbMigrationStatus;

    const migration = projectDbMigrations.create(projectId, migrationInput);
    projects.update(userId, projectId, {});
    return c.json(migration, 201);
  });

  router.get('/projects/:id/env', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectEnvVars.findByProject(projectId));
  });

  router.put('/projects/:id/env', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = UpsertEnvVarSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    if (parsed.data.serviceId) {
      const service = projectServices.findById(parsed.data.serviceId);
      if (!service || service.project_id !== projectId) return c.json({ error: 'Service not found' }, 404);
    }

    const envInput: {
      serviceId?: string | null;
      name: string;
      required?: boolean;
      secretRef?: string | null;
      defaultValue?: string | null;
      description?: string | null;
    } = {
      name: parsed.data.name,
    };
    if (parsed.data.serviceId !== undefined) envInput.serviceId = parsed.data.serviceId;
    if (parsed.data.required !== undefined) envInput.required = parsed.data.required;
    if (parsed.data.secretRef !== undefined) envInput.secretRef = parsed.data.secretRef;
    if (parsed.data.defaultValue !== undefined) envInput.defaultValue = parsed.data.defaultValue;
    if (parsed.data.description !== undefined) envInput.description = parsed.data.description;

    const envVar = projectEnvVars.upsert(projectId, envInput);
    projects.update(userId, projectId, {});
    return c.json(envVar);
  });

  router.delete('/projects/:id/env/:envId', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const envId = c.req.param('envId');
    if (!projectId || !envId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const existing = projectEnvVars.findById(envId);
    if (!existing || existing.project_id !== projectId) return c.json({ error: 'Env var not found' }, 404);
    projectEnvVars.delete(envId);
    projects.update(userId, projectId, {});
    return c.body(null, 204);
  });

  router.get('/projects/:id/validation', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectValidationReports.findByProject(projectId));
  });

  router.post('/projects/:id/validate', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const jobId = jobs.enqueue('validateProject', { projectId });
    const run = projectRuns.create(projectId, jobId);
    projectValidationReports.create(projectId, {
      runId: run.id,
      status: 'pending',
      checks: [{ name: 'queued', status: 'pending', message: 'Validation job queued' }],
      logExcerpt: `Validation queued with job ${jobId}`,
    });
    return c.json({ status: 'queued', runId: run.id, jobId }, 202);
  });

  router.get('/projects/:id/runtime', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectRuntimeInstances.findByProject(projectId) ?? null);
  });

  router.get('/projects/:id/snapshots', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectSnapshots.findByProject(projectId));
  });

  router.post('/projects/:id/snapshots', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const bodyRaw = await c.req.json<unknown>().catch(() => ({}));
    const parsed = CreateSnapshotSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }
    const snapshot = projectSnapshots.capture(projectId, parsed.data.runId ?? null, parsed.data.label ?? null);
    return c.json(snapshot, 201);
  });

  router.post('/projects/:id/snapshots/:snapshotId/restore', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const snapshotId = c.req.param('snapshotId');
    if (!projectId || !snapshotId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const bodyRaw = await c.req.json<unknown>().catch(() => ({}));
    const parsed = RestoreSnapshotSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Restore requires { confirm: true }' }, 400);
    }
    projectSnapshots.capture(projectId, null, 'Before restore');
    const snapshot = projectSnapshots.restore(projectId, snapshotId, { confirm: true });
    if (!snapshot) return c.json({ error: 'Snapshot not found' }, 404);
    const branchRoot = projectSnapshots.findCurrentTip(projectId);
    jobs.enqueue('rebuildPreview', { projectId });
    return c.json({
      status: 'restored',
      snapshot,
      branch_root_id: branchRoot?.id ?? null,
    });
  });

  router.get('/projects/:id/snapshots/timeline', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectSnapshots.getTimeline(projectId));
  });

  router.get('/projects/:id/snapshots/:a/diff/:b', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const a = c.req.param('a');
    const b = c.req.param('b');
    if (!projectId || !a || !b) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const diff = projectSnapshots.getDiff(projectId, a, b);
    if (!diff) return c.json({ error: 'Snapshot not found or belongs to another project' }, 404);
    return c.json(diff);
  });

  router.patch('/projects/:id/snapshots/:snapshotId', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const snapshotId = c.req.param('snapshotId');
    if (!projectId || !snapshotId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const existing = projectSnapshots.findById(snapshotId);
    if (!existing || existing.project_id !== projectId) {
      return c.json({ error: 'Snapshot not found' }, 404);
    }
    const bodyRaw = await c.req.json<unknown>().catch(() => ({}));
    const parsed = UpdateSnapshotMetadataSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }
    const patch: { label?: string | null; retention?: SnapshotRetention } = {};
    if (Object.prototype.hasOwnProperty.call(parsed.data, 'label')) {
      patch.label = parsed.data.label ?? null;
    }
    if (parsed.data.retention) patch.retention = parsed.data.retention;
    const updated = projectSnapshots.updateMetadata(snapshotId, patch);
    return c.json(updated);
  });

  router.patch('/projects/:id/snapshot-retention', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const bodyRaw = await c.req.json<unknown>().catch(() => ({}));
    const parsed = UpdateSnapshotRetentionSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }
    projects.updateSnapshotRetention(userId, projectId, parsed.data.snapshot_retention_keep);
    return c.json({ snapshot_retention_keep: parsed.data.snapshot_retention_keep });
  });

  router.get('/projects/:id/snapshot-blobs/:hash', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const hash = c.req.param('hash');
    if (!projectId || !hash) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const blob = projectSnapshotBlobs.getByHash(hash);
    if (!blob) return c.json({ error: 'Blob not found' }, 404);
    if (blob.size_bytes > 10 * 1024 * 1024) {
      return c.json({ error: 'Blob too large for inline fetch' }, 413);
    }
    return new Response(new Uint8Array(blob.content), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  });

  router.get('/projects/:id/preview', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const preview = previews.findByProject(projectId);
    return c.json(preview ?? null);
  });

  router.post('/projects/:id/preview/rebuild', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const preview = previews.upsert(projectId, 'building');
    jobs.enqueue('rebuildPreview', { projectId });
    return c.json(preview, 202);
  });

  router.post('/projects/:id/preview/ticket', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const exp = Date.now() + 10 * 60_000;
    const sig = signPreviewTicket(projectId, exp);
    return c.json({
      url: `/api/projects/${projectId}/preview/serve/index.html?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp).toISOString(),
    });
  });

  router.post('/projects/:id/generate', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const jobId = jobs.enqueue('generateProject', { projectId });
    const run = projectRuns.create(projectId, jobId);
    return c.json({ status: 'queued', runId: run.id }, 202);
  });

  // App resources — backend constructs owned by the generated app (not DevMind platform resources)
  router.get('/projects/:id/app-resources', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const type = c.req.query('type') as AppResourceType | undefined;
    return c.json(appResources.findByProject(projectId, type));
  });

  router.post('/projects/:id/app-resources', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = CreateAppResourceSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }
    const resourceInput: { type: AppResourceType; name: string; config?: Record<string, unknown> } = {
      type: parsed.data.type,
      name: parsed.data.name,
    };
    if (parsed.data.config !== undefined) resourceInput.config = parsed.data.config;

    const resource = appResources.create(projectId, resourceInput);
    return c.json(resource, 201);
  });

  router.patch('/projects/:id/app-resources/:rid', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const rid = c.req.param('rid');
    if (!projectId || !rid) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const existing = appResources.findById(rid);
    if (!existing || existing.project_id !== projectId) return c.json({ error: 'Resource not found' }, 404);
    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = UpdateAppResourceSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }
    const patch: { name?: string; config?: Record<string, unknown> } = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.config !== undefined) patch.config = parsed.data.config;
    return c.json(appResources.update(rid, patch));
  });

  router.delete('/projects/:id/app-resources/:rid', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const rid = c.req.param('rid');
    if (!projectId || !rid) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const existing = appResources.findById(rid);
    if (!existing || existing.project_id !== projectId) return c.json({ error: 'Resource not found' }, 404);
    appResources.delete(rid);
    return c.body(null, 204);
  });

  // Project files — generated code stored per project
  router.get('/projects/:id/files', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectFiles.findByProject(projectId).map((f) => ({
      path: f.path,
      language: f.language,
      size: f.content.length,
      updated_at: f.updated_at,
    })));
  });

  router.get('/projects/:id/files/:path{.+}', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const filePath = c.req.param('path');
    if (!projectId || !filePath) return c.json({ error: 'Missing id or path' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const file = projectFiles.findByPath(projectId, filePath);
    if (!file) return c.json({ error: 'File not found' }, 404);
    return c.json(file);
  });

  router.put('/projects/:id/files/:path{.+}', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const filePath = c.req.param('path');
    if (!projectId || !filePath) return c.json({ error: 'Missing id or path' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const body = await c.req.json<{ content: string }>().catch(() => null);
    if (typeof body?.content !== 'string') return c.json({ error: 'content required' }, 400);
    const file = projectFiles.upsert(projectId, filePath, body.content);
    return c.json(file);
  });

  router.delete('/projects/:id/files/:path{.+}', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const filePath = c.req.param('path');
    if (!projectId || !filePath) return c.json({ error: 'Missing id or path' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    projectFiles.delete(projectId, filePath);
    return c.body(null, 204);
  });

  // Components — reusable UI building blocks owned by a project
  router.get('/projects/:id/components', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(components.findByProject(projectId));
  });

  router.post('/projects/:id/components', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = CreateComponentSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }
    const component = components.create(projectId, parsed.data.name, parsed.data.content);
    return c.json(component, 201);
  });

  router.put('/projects/:id/components/:componentId', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const componentId = c.req.param('componentId');
    if (!projectId || !componentId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const existing = components.findById(componentId);
    if (!existing || existing.project_id !== projectId) return c.json({ error: 'Component not found' }, 404);
    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = UpdateComponentSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }
    const patch: { name?: string; content?: string } = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.content !== undefined) patch.content = parsed.data.content;
    const updated = components.update(componentId, patch);
    return c.json(updated);
  });

  router.delete('/projects/:id/components/:componentId', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const componentId = c.req.param('componentId');
    if (!projectId || !componentId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const existing = components.findById(componentId);
    if (!existing || existing.project_id !== projectId) return c.json({ error: 'Component not found' }, 404);
    components.delete(componentId);
    return c.body(null, 204);
  });

  // Project export — full data dump as a downloadable JSON file
  router.get('/projects/:id/export', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const payload = {
      format: 'devmind-export',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      project,
      files: projectFiles.findByProject(projectId).map((f) => ({
        path: f.path,
        content: f.content,
        language: f.language,
      })),
      manifest: projectManifests.findByProject(projectId) ?? null,
      services: projectServices.findByProject(projectId),
      apiRoutes: projectApiRoutes.findByProject(projectId),
      database: {
        schemas: projectDbSchemas.findByProject(projectId),
        migrations: projectDbMigrations.findByProject(projectId),
      },
      envVars: projectEnvVars.findByProject(projectId),
    };

    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    const date = new Date().toISOString().slice(0, 10);
    const filename = `devmind-${slug}-${date}.json`;

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });

  // ── Playwright validation routes ────────────────────────────────────────────

  router.get('/projects/:id/tests', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ error: 'Missing id' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(projectTests.findByProject(projectId));
  });

  router.get('/projects/:id/tests/:testId/runs', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const testId = c.req.param('testId');
    if (!projectId || !testId) return c.json({ error: 'Missing params' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const test = projectTests.findById(testId);
    if (!test || test.project_id !== projectId) return c.json({ error: 'Test not found' }, 404);
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Math.min(Number(limitRaw) || 20, 100) : 20;
    return c.json(projectTestRuns.findByTest(testId, limit));
  });

  const RunTestSchema = z.object({}).optional();

  router.post('/projects/:id/tests/:testId/run', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const testId = c.req.param('testId');
    if (!projectId || !testId) return c.json({ error: 'Missing params' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const test = projectTests.findById(testId);
    if (!test || test.project_id !== projectId) return c.json({ error: 'Test not found' }, 404);
    if (test.status === 'disabled') return c.json({ error: 'Test is disabled' }, 422);
    const run = projectTestRuns.create({ projectId, testId });
    jobs.enqueue('validate-with-playwright', { projectId, testId, runId: run.id });
    return c.json({ run_id: run.id }, 202);
  });

  router.get('/projects/:id/tests/:testId/runs/:runId/evidence', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const testId = c.req.param('testId');
    const runId = c.req.param('runId');
    if (!projectId || !testId || !runId) return c.json({ error: 'Missing params' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const run = projectTestRuns.findById(runId);
    if (!run || run.test_id !== testId || run.project_id !== projectId) {
      return c.json({ error: 'Run not found' }, 404);
    }
    if (!run.evidence_screenshot_hash) return c.json({ error: 'No evidence screenshot' }, 404);
    return c.redirect(`/api/projects/${projectId}/snapshot-blobs/${run.evidence_screenshot_hash}`);
  });

  // Preview serve — serves generated files as static assets (no auth: iframe-friendly)
  router.get('/projects/:id/preview/serve/:path{.*}', (c) => {
    const projectId = c.req.param('id');
    const filePath = c.req.param('path') || 'index.html';
    if (!projectId) return c.text('Missing id', 400);
    if (!verifyPreviewTicket(projectId, c.req.query('exp'), c.req.query('sig'))) {
      return c.text('Invalid or expired preview ticket', 401);
    }
    const file = projectFiles.findByPath(projectId, filePath);
    if (!file) {
      if (filePath !== 'index.html') return c.text('File not found', 404);
      return c.html('<html><body style="font-family:sans-serif;padding:2rem;color:#999">No preview yet. Ask the agent to build your app.</body></html>');
    }
    const contentType = getMimeType(filePath);
    return new Response(file.content, { headers: { 'Content-Type': contentType } });
  });

  return router;
}
