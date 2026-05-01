import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../auth/middleware.js';
import type { FlagsService } from './flags.js';
import type { HonoEnv } from '../types.js';

export function createFlagsRouter(flags: FlagsService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Public (auth required) flags list
  router.get('/flags', authMiddleware, (c) => {
    return c.json(flags.listFlags());
  });

  // Admin routes
  router.get('/admin/flags', authMiddleware, adminMiddleware, (c) => {
    return c.json(flags.listFlags());
  });

  router.post('/admin/flags', authMiddleware, adminMiddleware, async (c) => {
    const body = await c.req.json<{ key: string; value: unknown; description?: string }>();
    if (!body.key) return c.json({ error: 'key is required' }, 400);
    flags.setFlag(body.key, body.value, body.description);
    return c.json({ ok: true });
  });

  router.patch('/admin/flags/:key', authMiddleware, adminMiddleware, async (c) => {
    const key = c.req.param('key');
    if (!key) return c.json({ error: 'Missing key' }, 400);
    const body = await c.req.json<{ value: unknown; description?: string }>();
    flags.setFlag(key, body.value, body.description);
    return c.json({ ok: true });
  });

  return router;
}
