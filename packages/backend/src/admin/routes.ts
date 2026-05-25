import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../auth/middleware.js';
import type { UsersRepo } from '../db/repos/users.js';
import type { JobsRepo } from '../db/repos/jobs.js';
import type { SettingsRepo } from '../db/repos/settings.js';
import type { ProjectSnapshotsRepo } from '../db/repos/project-snapshots.js';
import type { ToolCallAuditRepo } from '../db/repos/tool-call-audit.js';
import type { HonoEnv } from '../types.js';
import { OllamaClient } from '../ollama/client.js';

export function createAdminRouter(
  users: UsersRepo,
  jobs: JobsRepo,
  settings: SettingsRepo,
  projectSnapshots: ProjectSnapshotsRepo,
  toolAudit: ToolCallAuditRepo
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/users', authMiddleware, adminMiddleware, (c) => {
    return c.json(users.list());
  });

  router.get('/jobs', authMiddleware, adminMiddleware, (c) => {
    return c.json(jobs.list());
  });

  router.get('/settings', authMiddleware, adminMiddleware, (c) => {
    return c.json(settings.list());
  });

  router.patch('/settings/:key', authMiddleware, adminMiddleware, async (c) => {
    const key = c.req.param('key');
    if (!key) return c.json({ error: 'missing key' }, 400);
    const { value } = await c.req.json<{ value: string }>();
    if (typeof value !== 'string') return c.json({ error: 'value must be a string' }, 400);
    settings.set(key, value);
    return c.json({ ok: true });
  });

  router.get('/settings/ollama/health', authMiddleware, adminMiddleware, async (c) => {
    const baseUrl = settings.get('ollama.base_url') ?? 'http://localhost:11434';
    const client = new OllamaClient(baseUrl);
    const ok = await client.health();
    return c.json({ ok, baseUrl });
  });

  router.post('/snapshots/compact', authMiddleware, adminMiddleware, (c) => {
    const result = projectSnapshots.compactBlobs();
    return c.json(result);
  });

  router.get('/tool-audit', authMiddleware, adminMiddleware, (c) => {
    const limitRaw = Number.parseInt(c.req.query('limit') ?? '100', 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
    return c.json(toolAudit.findRecent(limit));
  });

  return router;
}

