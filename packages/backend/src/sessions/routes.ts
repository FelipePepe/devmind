import { Hono } from 'hono';
import { authMiddleware } from '../auth/middleware.js';
import type { SessionsRepo } from '../db/repos/sessions.js';
import type { MessagesRepo } from '../db/repos/messages.js';
import type { HonoEnv } from '../types.js';

export function createSessionsRouter(sessions: SessionsRepo, messages: MessagesRepo): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/', authMiddleware, (c) => {
    const userId = c.get('userId');
    return c.json(sessions.findByUser(userId));
  });

  router.post('/', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const body = await c.req.json<{ title?: string; projectId?: string }>().catch(() => ({}));
    const session = sessions.create(userId, body.title, body.projectId);
    return c.json(session, 201);
  });

  router.get('/:id/messages', authMiddleware, (c) => {
    const userId = c.get('userId');
    const sessionId = c.req.param('id');
    if (!sessionId) return c.json({ error: 'Missing id' }, 400);
    const session = sessions.findById(userId, sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);
    const msgs = messages.findBySession(sessionId);
    return c.json(msgs);
  });

  router.delete('/:id', authMiddleware, (c) => {
    const userId = c.get('userId');
    const sessionId = c.req.param('id');
    if (!sessionId) return c.json({ error: 'Missing id' }, 400);
    const session = sessions.findById(userId, sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);
    sessions.archive(userId, sessionId);
    return c.body(null, 204);
  });

  router.post('/:id/messages', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const sessionId = c.req.param('id');
    if (!sessionId) return c.json({ error: 'Missing id' }, 400);

    const session = sessions.findById(userId, sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const body = (await c.req.json<{ role?: string; content?: string }>().catch(() => ({}))) as { role?: string; content?: string };
    const content = body.content?.trim();
    if (!content) return c.json({ error: 'Message content is required' }, 400);

    const userMessage = messages.create(sessionId, 'user', content);
    const assistantMessage = messages.create(
      sessionId,
      'assistant',
      'DevMind received your message, but the agent loop is not connected yet.'
    );

    return c.json({ userMessage, assistantMessage }, 201);
  });

  return router;
}
