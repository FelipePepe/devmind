import type { Context, Next } from 'hono';
import type { HonoEnv } from '../types.js';
import { verifyAccess } from './jwt.js';
import { logger } from '../logger.js';

export async function authMiddleware(c: Context<HonoEnv>, next: Next): Promise<Response | void> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    logger.warn({ method: c.req.method, path: c.req.url, ip: c.req.header('x-forwarded-for') }, 'Auth missing - no Bearer token');
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = header.slice(7);
  try {
    const { userId, isAdmin } = await verifyAccess(token);
    c.set('userId', userId);
    c.set('isAdmin', isAdmin);
    logger.info({ userId, isAdmin, method: c.req.method, path: c.req.url }, 'Auth OK');
    await next();
  } catch {
    logger.warn({ method: c.req.method, path: c.req.url, ip: c.req.header('x-forwarded-for') }, 'Auth failed - invalid token');
    return c.json({ error: 'Unauthorized' }, 401);
  }
}

export async function adminMiddleware(c: Context<HonoEnv>, next: Next): Promise<Response | void> {
  const isAdmin = c.get('isAdmin');
  if (!isAdmin) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
}
