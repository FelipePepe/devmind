import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { hashPassword, verifyPassword } from './password.js';
import { generateTotpSetup, verifyTotpCode } from './totp.js';
import { sign, verifyRefresh } from './jwt.js';
import { authMiddleware } from './middleware.js';
import { rateLimitMiddleware } from './rate-limit.js';
import type { UsersRepo } from '../db/repos/users.js';
import type { ChallengesRepo } from '../db/repos/challenges.js';
import type { WsManager } from '../realtime/ws-manager.js';
import type { HonoEnv } from '../types.js';
import type { User } from '../db/repos/users.js';

const REFRESH_COOKIE = 'refresh_token';
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes for ephemeral challenge tokens

interface AuthUserResponse {
  id: string;
  display_name: string;
  username: string;
  is_admin: number;
}

function toAuthUser(user: User): AuthUserResponse {
  return {
    id: user.id,
    display_name: user.display_name,
    username: user.username,
    is_admin: user.is_admin,
  };
}

function makeToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
}

function issueRefreshCookie(c: Parameters<typeof setCookie>[0], refreshToken: string): void {
  setCookie(c, REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
    secure: false, // set true when behind HTTPS
  });
}

export function createAuthRouter(
  users: UsersRepo,
  challenges: ChallengesRepo,
  wsManager: WsManager
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Register ─────────────────────────────────────────────────────────────
  // Step 1: create user + return TOTP setup info
  router.post('/register', rateLimitMiddleware, async (c) => {
    const body = await c.req.json<{ username?: string; password?: string; displayName?: string }>();
    const { username, password, displayName } = body;

    if (!username || !password) {
      return c.json({ error: 'username and password are required' }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: 'password must be at least 8 characters' }, 400);
    }
    if (users.findByUsername(username)) {
      return c.json({ error: 'Username already taken', code: 'DUPLICATE_USERNAME' }, 409);
    }

    const passwordHash = await hashPassword(password);
    const { secret: totpSecret, uri: totpUri } = generateTotpSetup(username);

    const user = users.create({
      displayName: displayName ?? username,
      username,
      passwordHash,
      totpSecret,
    });

    const confirmToken = makeToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    challenges.create(confirmToken, 'register_confirm', expiresAt, user.id);

    return c.json({ totpUri, totpSecret, confirmToken });
  });

  // Step 2: verify first TOTP code to confirm setup
  router.post('/register/confirm', async (c) => {
    const body = await c.req.json<{ confirmToken?: string; code?: string }>();
    const { confirmToken, code } = body;

    if (!confirmToken || !code) {
      return c.json({ error: 'confirmToken and code are required' }, 400);
    }

    const row = challenges.findByChallenge(confirmToken);
    if (row) challenges.deleteByChallenge(confirmToken);

    if (!row || row.type !== 'register_confirm' || new Date(row.expires_at) < new Date()) {
      return c.json({ error: 'Invalid or expired confirmation token' }, 400);
    }

    const user = users.findById(row.user_id!);
    if (!user) return c.json({ error: 'User not found' }, 404);

    if (!verifyTotpCode(user.totp_secret!, code)) {
      return c.json({ error: 'Invalid TOTP code' }, 401);
    }

    users.confirmTotp(user.id);
    const { accessToken, refreshToken } = await sign(user.id, user.is_admin === 1);
    issueRefreshCookie(c, refreshToken);
    return c.json({ accessToken, user: toAuthUser(user) });
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  // Step 1: validate credentials → returns mfaToken
  router.post('/login', rateLimitMiddleware, async (c) => {
    const body = await c.req.json<{ username?: string; password?: string }>();
    const { username, password } = body;

    if (!username || !password) {
      return c.json({ error: 'username and password are required' }, 400);
    }

    const user = users.findByUsername(username);
    if (!user) return c.json({ error: 'Invalid credentials' }, 401);

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return c.json({ error: 'Invalid credentials' }, 401);

    if (!user.totp_confirmed) {
      return c.json({ error: 'MFA setup not completed. Please complete registration.' }, 403);
    }

    const mfaToken = makeToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    challenges.create(mfaToken, 'mfa_login', expiresAt, user.id);

    return c.json({ mfaRequired: true, mfaToken });
  });

  // Step 2: verify TOTP code → issues JWT
  router.post('/login/mfa', async (c) => {
    const body = await c.req.json<{ mfaToken?: string; code?: string }>();
    const { mfaToken, code } = body;

    if (!mfaToken || !code) {
      return c.json({ error: 'mfaToken and code are required' }, 400);
    }

    const row = challenges.findByChallenge(mfaToken);
    if (row) challenges.deleteByChallenge(mfaToken);

    if (!row || row.type !== 'mfa_login' || new Date(row.expires_at) < new Date()) {
      return c.json({ error: 'Invalid or expired MFA token' }, 401);
    }

    const user = users.findById(row.user_id!);
    if (!user) return c.json({ error: 'User not found' }, 404);

    if (!verifyTotpCode(user.totp_secret!, code)) {
      return c.json({ error: 'Invalid TOTP code' }, 401);
    }

    const { accessToken, refreshToken } = await sign(user.id, user.is_admin === 1);
    issueRefreshCookie(c, refreshToken);
    return c.json({ accessToken, user: toAuthUser(user) });
  });

  // ── Session management ────────────────────────────────────────────────────
  router.post('/refresh', async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    if (!refreshToken) return c.json({ error: 'No refresh token' }, 401);
    try {
      const { userId } = await verifyRefresh(refreshToken);
      const user = users.findById(userId);
      if (!user) return c.json({ error: 'User not found' }, 401);
      const { accessToken, refreshToken: newRefresh } = await sign(userId, user.is_admin === 1);
      issueRefreshCookie(c, newRefresh);
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
    const ticket = makeToken();
    wsManager.addTicket(ticket, userId);
    return c.json({ ticket });
  });


  return router;
}
