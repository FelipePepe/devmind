import { Hono } from 'hono';
import { authMiddleware } from '../auth/middleware.js';
import type { WsManager } from './ws-manager.js';
import type { PushService } from './web-push.js';
import type { HonoEnv } from '../types.js';

export function createRealtimeRouter(wsManager: WsManager, push: PushService): Hono<HonoEnv> {
  // wsManager is used in index.ts for the WS upgrade handler
  void wsManager;
  const router = new Hono<HonoEnv>();

  router.post('/api/push/subscribe', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const body = await c.req.json<{ endpoint: string; p256dh: string; auth: string }>();
    push.subscribe(userId, body.endpoint, body.p256dh, body.auth);
    return c.json({ ok: true });
  });

  return router;
}
