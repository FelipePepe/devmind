import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { hashPassword, verifyPassword } from './password.js';
import { validatePasswordPolicy } from './password-policy.js';
import { generateTotpSetup, verifyTotpCode } from './totp.js';
import { sign, verifyRefresh } from './jwt.js';
import { authMiddleware } from './middleware.js';
import { rateLimitMiddleware } from './rate-limit.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import type { UsersRepo } from '../db/repos/users.js';
import type { ChallengesRepo } from '../db/repos/challenges.js';
import type { RefreshTokensRepo } from '../db/repos/refresh-tokens.js';
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
  kc_subject: string | null;
  email: string | null;
}

function toAuthUser(user: User): AuthUserResponse {
  return {
    id: user.id,
    display_name: user.display_name,
    username: user.username,
    is_admin: user.is_admin,
    kc_subject: user.kc_subject,
    email: user.email,
  };
}

async function enforceLocalAuthEnabled(
  c: Parameters<Parameters<Hono<HonoEnv>['use']>[1]>[0],
  next: () => Promise<void>
): Promise<Response | void> {
  if (!config.AUTH_LOCAL_ENABLED) {
    return c.json(
      { error: 'Local authentication is disabled; use OIDC.', code: 'LOCAL_AUTH_DISABLED' },
      410
    );
  }
  await next();
}

function makeToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
}

function issueRefreshCookie(c: Parameters<typeof setCookie>[0], refreshToken: string): void {
  setCookie(c, REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.floor(config.JWT_REFRESH_TTL_MS / 1000),
    secure: config.COOKIE_SECURE ?? (config.NODE_ENV === 'production'),
  });
}

async function issueTokenPair(
  c: Parameters<typeof setCookie>[0],
  refreshTokens: RefreshTokensRepo,
  userId: string,
  isAdmin: boolean
): Promise<string> {
  const { accessToken, refreshToken } = await sign(userId, isAdmin);
  refreshTokens.create(
    userId,
    refreshToken,
    new Date(Date.now() + config.JWT_REFRESH_TTL_MS).toISOString()
  );
  issueRefreshCookie(c, refreshToken);
  return accessToken;
}

export function createAuthRouter(
  users: UsersRepo,
  challenges: ChallengesRepo,
  wsManager: WsManager,
  refreshTokens: RefreshTokensRepo
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Gate every local auth endpoint behind AUTH_LOCAL_ENABLED.
  router.use('/login', enforceLocalAuthEnabled);
  router.use('/login/*', enforceLocalAuthEnabled);
  router.use('/register', enforceLocalAuthEnabled);
  router.use('/register/*', enforceLocalAuthEnabled);
  router.use('/refresh', enforceLocalAuthEnabled);

  // ── Register ─────────────────────────────────────────────────────────────
  // Step 1: create user + return TOTP setup info
  router.post('/register', rateLimitMiddleware, async (c) => {
    const body = await c.req.json<{ username?: string; password?: string; displayName?: string }>();
    const { username, password, displayName } = body;

    if (!username || !password) {
      return c.json({ error: 'username and password are required' }, 400);
    }
    const passwordPolicy = validatePasswordPolicy(password);
    if (!passwordPolicy.ok) {
      return c.json({ error: 'Password policy failed', details: passwordPolicy.errors }, 400);
    }
    if (users.findByUsername(username)) {
      logger.warn({ username }, 'Auth: register failed - username taken');
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

    logger.info({ userId: user.id, username }, 'Auth: user registered');
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

    if (!row || row.type !== 'register_confirm' || new Date(row.expires_at) < new Date()) {
      if (row) challenges.deleteByChallenge(confirmToken);
      return c.json({ error: 'Invalid or expired confirmation token' }, 400);
    }

    const user = users.findById(row.user_id!);
    if (!user) {
      challenges.deleteByChallenge(confirmToken);
      return c.json({ error: 'User not found' }, 404);
    }

    if (!verifyTotpCode(user.totp_secret!, code)) {
      return c.json({ error: 'Invalid TOTP code' }, 401);
    }

    challenges.deleteByChallenge(confirmToken);
    users.confirmTotp(user.id);
    const accessToken = await issueTokenPair(c, refreshTokens, user.id, user.is_admin === 1);
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
    if (!user) {
      logger.warn({ username }, 'Auth: login failed - user not found');
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      logger.warn({ userId: user.id, username }, 'Auth: login failed - invalid password');
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    if (!user.totp_confirmed) {
      return c.json({ error: 'MFA setup not completed. Please complete registration.' }, 403);
    }

    const mfaToken = makeToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    challenges.create(mfaToken, 'mfa_login', expiresAt, user.id);

    logger.info({ userId: user.id, username }, 'Auth: login step 1 OK (MFA requested)');
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

    if (!row || row.type !== 'mfa_login' || new Date(row.expires_at) < new Date()) {
      if (row) challenges.deleteByChallenge(mfaToken);
      return c.json({ error: 'Invalid or expired MFA token' }, 401);
    }

    const user = users.findById(row.user_id!);
    if (!user) {
      challenges.deleteByChallenge(mfaToken);
      return c.json({ error: 'User not found' }, 404);
    }

    if (!verifyTotpCode(user.totp_secret!, code)) {
      logger.warn({ userId: user.id }, 'Auth: MFA code invalid');
      return c.json({ error: 'Invalid TOTP code' }, 401);
    }

    challenges.deleteByChallenge(mfaToken);

    const accessToken = await issueTokenPair(c, refreshTokens, user.id, user.is_admin === 1);
    logger.info({ userId: user.id }, 'Auth: login complete (MFA verified)');
    return c.json({ accessToken, user: toAuthUser(user) });
  });

  // ── Session management ────────────────────────────────────────────────────
  router.post('/refresh', async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    if (!refreshToken) {
      logger.warn('Auth: refresh failed - no refresh token');
      return c.json({ error: 'No refresh token' }, 401);
    }
    try {
      const { userId } = await verifyRefresh(refreshToken);
      const activeRefresh = refreshTokens.findActiveByToken(refreshToken);
      if (!activeRefresh || activeRefresh.user_id !== userId) {
        logger.warn({ userId }, 'Auth: refresh failed - token revoked or reused');
        return c.json({ error: 'Invalid refresh token' }, 401);
      }
      const user = users.findById(userId);
      if (!user) return c.json({ error: 'User not found' }, 401);
      refreshTokens.revokeToken(refreshToken, 'rotated');
      const accessToken = await issueTokenPair(c, refreshTokens, userId, user.is_admin === 1);
      logger.info({ userId }, 'Auth: token refreshed');
      return c.json({ accessToken, user: toAuthUser(user) });
    } catch {
      logger.warn({ userId: 'unknown' }, 'Auth: refresh failed - invalid token');
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
    const userId = c.get('userId');
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    if (refreshToken) refreshTokens.revokeToken(refreshToken, 'logout');
    deleteCookie(c, REFRESH_COOKIE, { path: '/' });
    logger.info({ userId }, 'Auth: logout');
    return c.json({ ok: true });
  });

  router.delete('/me', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const body = await c.req.json().catch(() => ({})) as { confirm?: string };
    if (body.confirm !== 'delete my account') {
      return c.json({ error: 'Send { "confirm": "delete my account" } to confirm deletion' }, 400);
    }
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    if (refreshToken) refreshTokens.revokeToken(refreshToken, 'logout');
    deleteCookie(c, REFRESH_COOKIE, { path: '/' });
    users.delete(userId);
    logger.info({ userId }, 'Auth: account deleted (GDPR)');
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
