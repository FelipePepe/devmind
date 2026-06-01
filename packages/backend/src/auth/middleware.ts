import type { Context, Next } from 'hono';
import { decodeJwt } from 'jose';
import type { HonoEnv } from '../types.js';
import { verifyAccess } from './jwt.js';
import { verifyOidcToken } from './oidc/verify.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import type { UsersRepo } from '../db/repos/users.js';

let usersRepo: UsersRepo | null = null;

/**
 * Inject the users repository so the auth middleware can resolve OIDC
 * subjects to local user rows. Must be called once at boot before any
 * request is served. Local-only JWT auth keeps working without injection,
 * but OIDC tokens will be rejected.
 */
export function configureAuthMiddleware(repo: UsersRepo): void {
  usersRepo = repo;
}

function isOidcIssuer(iss: string | undefined): boolean {
  if (!iss || !config.OIDC_ISSUER) return false;
  // Tolerate trailing slash divergence on either side.
  const a = iss.replace(/\/$/, '');
  const b = config.OIDC_ISSUER.replace(/\/$/, '');
  return a === b;
}

export async function authMiddleware(c: Context<HonoEnv>, next: Next): Promise<Response | void> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    logger.warn(
      { method: c.req.method, path: c.req.url, ip: c.req.header('x-forwarded-for') },
      'Auth missing - no Bearer token'
    );
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = header.slice(7);

  let iss: string | undefined;
  try {
    iss = decodeJwt(token).iss as string | undefined;
  } catch {
    logger.warn({ method: c.req.method, path: c.req.url }, 'Auth failed - malformed token');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (isOidcIssuer(iss)) {
    if (!usersRepo) {
      logger.error('OIDC token received but UsersRepo not injected into auth middleware');
      return c.json({ error: 'Unauthorized' }, 401);
    }
    try {
      const claims = await verifyOidcToken(token);
      const user = usersRepo.findByKcSubject(claims.sub);
      if (!user) {
        logger.warn(
          { kcSubject: claims.sub, method: c.req.method, path: c.req.url },
          'OIDC token valid but no linked local user'
        );
        return c.json({ error: 'Unauthorized', code: 'NO_LINKED_USER' }, 401);
      }
      const roles = Array.isArray(claims.realm_access?.roles) ? claims.realm_access!.roles! : [];
      const isAdmin = user.is_admin === 1 || roles.includes(config.OIDC_ADMIN_ROLE);
      c.set('userId', user.id);
      c.set('isAdmin', isAdmin);
      logger.info(
        { userId: user.id, isAdmin, source: 'oidc', method: c.req.method, path: c.req.url },
        'Auth OK'
      );
      await next();
      return;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), method: c.req.method, path: c.req.url },
        'Auth failed - OIDC verify'
      );
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  if (!config.AUTH_LOCAL_ENABLED) {
    logger.warn(
      { method: c.req.method, path: c.req.url },
      'Auth failed - local auth disabled and token is not OIDC'
    );
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { userId, isAdmin } = await verifyAccess(token);
    c.set('userId', userId);
    c.set('isAdmin', isAdmin);
    logger.info(
      { userId, isAdmin, source: 'local', method: c.req.method, path: c.req.url },
      'Auth OK'
    );
    await next();
  } catch {
    logger.warn(
      { method: c.req.method, path: c.req.url, ip: c.req.header('x-forwarded-for') },
      'Auth failed - invalid token'
    );
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
