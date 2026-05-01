import type { Context, Next } from 'hono';
import type { HonoEnv } from '../types.js';
import { verifyAccess } from './jwt.js';

export async function authMiddleware(c: Context<HonoEnv>, next: Next): Promise<Response | void> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = header.slice(7);
  try {
    const { userId, isAdmin } = await verifyAccess(token);
    c.set('userId', userId);
    c.set('isAdmin', isAdmin);
    await next();
  } catch {
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
