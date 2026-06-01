import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { authMiddleware, adminMiddleware } from '../auth/middleware.js';
import type { UsersRepo } from '../db/repos/users.js';
import type { JobsRepo } from '../db/repos/jobs.js';
import type { SettingsRepo } from '../db/repos/settings.js';
import type { ProjectSnapshotsRepo } from '../db/repos/project-snapshots.js';
import type { ToolCallAuditRepo } from '../db/repos/tool-call-audit.js';
import type { FlagsRepo } from '../db/repos/flags.js';
import type { HonoEnv } from '../types.js';
import { OllamaClient } from '../ollama/client.js';

export function createAdminRouter(
  users: UsersRepo,
  jobs: JobsRepo,
  settings: SettingsRepo,
  projectSnapshots: ProjectSnapshotsRepo,
  toolAudit: ToolCallAuditRepo,
  flags: FlagsRepo,
  db: Database.Database
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/users', authMiddleware, adminMiddleware, (c) => {
    return c.json(users.list());
  });

  router.get('/jobs', authMiddleware, adminMiddleware, (c) => {
    return c.json(jobs.list());
  });

  // Settings are intentionally accessible to any authenticated user so anyone
  // can switch the active Ollama model. Other admin endpoints stay gated.
  router.get('/settings', authMiddleware, (c) => {
    return c.json(settings.list());
  });

  router.patch('/settings/:key', authMiddleware, async (c) => {
    const key = c.req.param('key');
    if (!key) return c.json({ error: 'missing key' }, 400);
    const { value } = await c.req.json<{ value: string }>();
    if (typeof value !== 'string') return c.json({ error: 'value must be a string' }, 400);
    settings.set(key, value);
    return c.json({ ok: true });
  });

  router.get('/settings/ollama/health', authMiddleware, async (c) => {
    const baseUrl = settings.get('ollama.base_url') ?? 'http://localhost:11434';
    const client = new OllamaClient(baseUrl);
    const ok = await client.health();
    return c.json({ ok, baseUrl });
  });

  router.get('/settings/ollama/models', authMiddleware, async (c) => {
    const baseUrl = settings.get('ollama.base_url') ?? 'http://localhost:11434';
    const client = new OllamaClient(baseUrl);
    try {
      const models = await client.listModels();
      return c.json({ baseUrl, models });
    } catch (err) {
      return c.json({ baseUrl, models: [], error: err instanceof Error ? err.message : String(err) }, 502);
    }
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

  // Manual linking — resolves cases where an OIDC subject and a local user
  // share an identity but not an email (or first OIDC login created a fresh
  // user before the legacy account was migrated). Admin-only.
  router.post('/auth/link', authMiddleware, adminMiddleware, async (c) => {
    const body = await c.req.json<{ user_id?: string; kc_subject?: string; email?: string }>();
    const { user_id, kc_subject, email } = body;
    if (!user_id || !kc_subject) {
      return c.json({ error: 'user_id and kc_subject are required' }, 400);
    }
    const user = users.findById(user_id);
    if (!user) return c.json({ error: 'User not found' }, 404);
    const existing = users.findByKcSubject(kc_subject);
    if (existing && existing.id !== user_id) {
      return c.json(
        { error: 'kc_subject already linked to another user', linked_user_id: existing.id },
        409
      );
    }
    users.linkKcSubject(user_id, kc_subject, email);
    return c.json({ ok: true, user: users.findById(user_id) });
  });

  // Usage stats — per-user aggregates over all time
  router.get('/stats', authMiddleware, adminMiddleware, (c) => {
    const rows = db.prepare(`
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.is_admin,
        u.created_at,
        (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
        (SELECT COUNT(*) FROM messages m
           JOIN sessions s ON m.session_id = s.id WHERE s.user_id = u.id) AS messages,
        (SELECT COUNT(*) FROM agent_runs ar WHERE ar.user_id = u.id) AS agent_runs,
        (SELECT COUNT(*) FROM tool_call_audit tca
           JOIN agent_runs ar ON tca.agent_run_id = ar.id WHERE ar.user_id = u.id) AS tool_calls,
        (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_active
      FROM users u
      ORDER BY projects DESC, messages DESC
    `).all();
    return c.json(rows);
  });

  // Per-project autonomy override
  router.put('/projects/:id/autonomy', authMiddleware, adminMiddleware, async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ level: string }>().catch(() => ({ level: '' }));
    const level = body.level;
    if (level !== 'auto' && level !== 'block-destructive') {
      return c.json({ error: 'level must be "auto" or "block-destructive"' }, 400);
    }
    const key = `tools.autonomy_level.${projectId}`;
    if (level === 'auto') {
      flags.delete(key);
    } else {
      flags.set(key, JSON.stringify(level), `Autonomy override for project ${projectId}`);
    }
    return c.json({ ok: true, projectId, level });
  });

  router.get('/projects/:id/autonomy', authMiddleware, adminMiddleware, (c) => {
    const projectId = c.req.param('id');
    const flag = flags.get(`tools.autonomy_level.${projectId}`);
    let level = 'auto';
    if (flag) {
      try { level = JSON.parse(flag.value) as string; } catch { level = flag.value; }
    }
    return c.json({ projectId, level });
  });

  return router;
}

