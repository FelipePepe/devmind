import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import {
  generateRegistrationOptions,
  verifyRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
} from './webauthn.js';
import { sign, verifyRefresh } from './jwt.js';
import { authMiddleware } from './middleware.js';
import { rateLimitMiddleware } from './rate-limit.js';
import type { UsersRepo } from '../db/repos/users.js';
import type { ChallengesRepo } from '../db/repos/challenges.js';
import type { WsManager } from '../realtime/ws-manager.js';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { HonoEnv } from '../types.js';
import type { User } from '../db/repos/users.js';

const REFRESH_COOKIE = 'refresh_token';

interface AuthUserResponse {
  id: string;
  display_name: string;
  is_admin: number;
}

function toAuthUser(user: User): AuthUserResponse {
  return {
    id: user.id,
    display_name: user.display_name,
    is_admin: user.is_admin,
  };
}

export function createAuthRouter(
  users: UsersRepo,
  challenges: ChallengesRepo,
  wsManager: WsManager
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/register/challenge', rateLimitMiddleware, async (c) => {
    const body = await c.req.json<{ displayName?: string }>();
    const displayName = body.displayName ?? 'User';
    const userId = crypto.randomUUID();
    const opts = await generateRegistrationOptions(userId, displayName, challenges);
    return c.json({ ...opts, _userId: userId });
  });

  router.post('/register/verify', async (c) => {
    const body = await c.req.json<{ userId: string; displayName?: string; response: RegistrationResponseJSON }>();
    try {
      const credential = await verifyRegistration(body.response, challenges);
      const existingUser = users.findByCredentialId(credential.credentialId);
      if (existingUser) {
        return c.json({ error: 'Credential already registered', code: 'DUPLICATE_CREDENTIAL' }, 409);
      }
      const user = users.create({
        displayName: body.displayName ?? 'User',
        credentialId: credential.credentialId,
        credential: JSON.stringify(credential),
      });
      const { accessToken, refreshToken } = await sign(user.id, user.is_admin === 1);
      setCookie(c, REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        sameSite: 'Strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
        secure: true,
      });
      return c.json({ accessToken, user: toAuthUser(user) });
    } catch (err) {
      const e = err as { message: string; status?: number };
      return c.json({ error: e.message }, (e.status ?? 400) as 400 | 401 | 409);
    }
  });

  router.post('/login/challenge', rateLimitMiddleware, async (c) => {
    const body = await c.req.json<{ credentialId?: string }>().catch(() => ({}));
    const opts = await generateAuthenticationOptions(
      challenges,
      users,
      (body as { credentialId?: string }).credentialId
    );
    return c.json(opts);
  });

  router.post('/login/verify', async (c) => {
    const body = await c.req.json<{ response: AuthenticationResponseJSON }>();
    try {
      const userId = await verifyAuthentication(body.response, challenges, users);
      const user = users.findById(userId);
      if (!user) return c.json({ error: 'User not found' }, 404);
      const { accessToken, refreshToken } = await sign(userId, user.is_admin === 1);
      setCookie(c, REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        sameSite: 'Strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
        secure: true,
      });
      return c.json({ accessToken, user: toAuthUser(user) });
    } catch (err) {
      const e = err as { message: string; status?: number };
      return c.json({ error: e.message }, (e.status ?? 401) as 400 | 401);
    }
  });

  router.post('/refresh', async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    if (!refreshToken) return c.json({ error: 'No refresh token' }, 401);
    try {
      const { userId } = await verifyRefresh(refreshToken);
      const user = users.findById(userId);
      if (!user) return c.json({ error: 'User not found' }, 401);
      const { accessToken, refreshToken: newRefresh } = await sign(userId, user.is_admin === 1);
      setCookie(c, REFRESH_COOKIE, newRefresh, {
        httpOnly: true,
        sameSite: 'Strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
        secure: true,
      });
      return c.json({ accessToken, user: toAuthUser(user) });
    } catch {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }
  });

  router.get('/me', authMiddleware, (c) => {
    const userId = c.get('userId');
    const user = users.findById(userId);
    if (!user) return c.json({ error: 'User not found' }, 404);
    return c.json({ user: toAuthUser(user) });
  });

  router.delete('/logout', authMiddleware, (c) => {
    deleteCookie(c, REFRESH_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  router.post('/ws-ticket', authMiddleware, (c) => {
    const userId = c.get('userId');
    const ticket = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    wsManager.addTicket(ticket, userId);
    return c.json({ ticket });
  });

  return router;
}
