import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware.js';
import type { ProjectsRepo } from '../db/repos/projects.js';
import type { ScreensRepo } from '../db/repos/screens.js';
import type { SessionsRepo } from '../db/repos/sessions.js';
import type { PreviewsRepo } from '../db/repos/previews.js';
import type { AppResourcesRepo, AppResourceType } from '../db/repos/app-resources.js';
import type { ProjectFilesRepo } from '../db/repos/project-files.js';
import { getMimeType } from '../db/repos/project-files.js';
import type { ProjectRunsRepo } from '../db/repos/project-runs.js';
import type { ComponentsRepo } from '../db/repos/components.js';
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

export function createBuilderRouter(
  projects: ProjectsRepo,
  screens: ScreensRepo,
  sessions: SessionsRepo,
  previews: PreviewsRepo,
  appResources: AppResourcesRepo,
  projectFiles: ProjectFilesRepo,
  projectRuns: ProjectRunsRepo,
  components: ComponentsRepo,
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

  router.get('/projects/:id/files/*', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const filePath = c.req.param('*');
    if (!projectId || !filePath) return c.json({ error: 'Missing id or path' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const file = projectFiles.findByPath(projectId, filePath);
    if (!file) return c.json({ error: 'File not found' }, 404);
    return c.json(file);
  });

  router.put('/projects/:id/files/*', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const filePath = c.req.param('*');
    if (!projectId || !filePath) return c.json({ error: 'Missing id or path' }, 400);
    const project = projects.findById(userId, projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const body = await c.req.json<{ content: string }>().catch(() => null);
    if (typeof body?.content !== 'string') return c.json({ error: 'content required' }, 400);
    const file = projectFiles.upsert(projectId, filePath, body.content);
    return c.json(file);
  });

  router.delete('/projects/:id/files/*', authMiddleware, (c) => {
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const filePath = c.req.param('*');
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

  // Preview serve — serves generated files as static assets (no auth: iframe-friendly)
  router.get('/projects/:id/preview/serve/*', (c) => {
    const projectId = c.req.param('id');
    const filePath = c.req.param('*') || 'index.html';
    if (!projectId) return c.text('Missing id', 400);
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
