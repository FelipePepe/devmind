import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { logger } from '../../logger.js';
import { config } from '../../config.js';
import { verifyOidcToken, mapOidcClaimsToUser } from './verify.js';
import type { UsersRepo, User } from '../../db/repos/users.js';
import type { HonoEnv } from '../../types.js';

const OIDC_REFRESH_COOKIE = 'oidc_refresh_token';
const DEFAULT_REFRESH_TTL_MS = 30 * 60 * 1000; // 30 min fallback if KC doesn't provide refresh_expires_in

interface KeycloakTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
}

interface KeycloakErrorResponse {
  error: string;
  error_description?: string;
}

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

function tokenEndpoint(): string {
  const base = config.OIDC_ISSUER.endsWith('/') ? config.OIDC_ISSUER.slice(0, -1) : config.OIDC_ISSUER;
  return `${base}/protocol/openid-connect/token`;
}

function logoutEndpoint(): string {
  const base = config.OIDC_ISSUER.endsWith('/') ? config.OIDC_ISSUER.slice(0, -1) : config.OIDC_ISSUER;
  return `${base}/protocol/openid-connect/logout`;
}

async function exchangeAtKeycloak(form: URLSearchParams): Promise<KeycloakTokenResponse> {
  const response = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail: KeycloakErrorResponse | string = text;
    try {
      detail = JSON.parse(text) as KeycloakErrorResponse;
    } catch {
      // keep raw
    }
    const err = new Error(`Keycloak token endpoint returned ${response.status}`);
    (err as Error & { status?: number; detail?: unknown }).status = response.status;
    (err as Error & { status?: number; detail?: unknown }).detail = detail;
    throw err;
  }
  return JSON.parse(text) as KeycloakTokenResponse;
}

function setRefreshCookie(c: Parameters<typeof setCookie>[0], refreshToken: string, ttlMs: number): void {
  setCookie(c, OIDC_REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.max(60, Math.floor(ttlMs / 1000)),
    secure: config.COOKIE_SECURE ?? (config.NODE_ENV === 'production'),
  });
}

async function findOrLinkOrCreateUser(
  users: UsersRepo,
  idToken: string
): Promise<{ user: User; isAdmin: boolean }> {
  const claims = await verifyOidcToken(idToken);
  const mapped = mapOidcClaimsToUser(claims);

  let user = users.findByKcSubject(mapped.kcSubject);
  if (!user && mapped.email) {
    const byEmail = users.findByEmail(mapped.email);
    if (byEmail) {
      users.linkKcSubject(byEmail.id, mapped.kcSubject, mapped.email);
      user = users.findById(byEmail.id);
      logger.info(
        { userId: byEmail.id, kcSubject: mapped.kcSubject, email: mapped.email },
        'OIDC: linked existing local user by email'
      );
    }
  }
  if (!user) {
    user = users.createFromOidc({
      kcSubject: mapped.kcSubject,
      email: mapped.email ?? '',
      username: mapped.username,
      displayName: mapped.displayName,
    });
    logger.info(
      { userId: user.id, kcSubject: mapped.kcSubject, email: mapped.email },
      'OIDC: created new user from claims'
    );
  }

  const isAdmin = user.is_admin === 1 || mapped.roles.includes(config.OIDC_ADMIN_ROLE);
  return { user, isAdmin };
}

export function createOidcRouter(users: UsersRepo): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Exchange authorization_code for tokens ──────────────────────────────
  router.post('/exchange', async (c) => {
    if (!config.OIDC_ISSUER) {
      return c.json({ error: 'OIDC is not configured' }, 503);
    }
    const body = await c.req.json<{ code?: string; code_verifier?: string; redirect_uri?: string }>();
    const { code, code_verifier, redirect_uri } = body;
    if (!code || !code_verifier || !redirect_uri) {
      return c.json({ error: 'code, code_verifier and redirect_uri are required' }, 400);
    }

    const form = new URLSearchParams();
    form.set('grant_type', 'authorization_code');
    form.set('client_id', config.OIDC_CLIENT_ID_FRONTEND);
    form.set('code', code);
    form.set('code_verifier', code_verifier);
    form.set('redirect_uri', redirect_uri);

    let tokens: KeycloakTokenResponse;
    try {
      tokens = await exchangeAtKeycloak(form);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const detail = (err as { detail?: unknown }).detail;
      logger.warn({ status, detail }, 'OIDC exchange rejected by Keycloak');
      return c.json({ error: 'OIDC exchange failed' }, status === 400 ? 400 : 401);
    }

    if (!tokens.id_token) {
      logger.warn('OIDC exchange returned no id_token');
      return c.json({ error: 'OIDC exchange missing id_token' }, 401);
    }

    let user: User;
    let isAdmin: boolean;
    try {
      ({ user, isAdmin } = await findOrLinkOrCreateUser(users, tokens.id_token));
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'OIDC id_token validation failed');
      return c.json({ error: 'Invalid id_token' }, 401);
    }

    if (tokens.refresh_token) {
      const ttlMs = (tokens.refresh_expires_in ?? 0) * 1000 || DEFAULT_REFRESH_TTL_MS;
      setRefreshCookie(c, tokens.refresh_token, ttlMs);
    }

    logger.info({ userId: user.id, isAdmin }, 'OIDC: exchange complete');
    return c.json({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
      user: { ...toAuthUser(user), is_admin: isAdmin ? 1 : 0 },
    });
  });

  // ── Refresh access token ────────────────────────────────────────────────
  router.post('/refresh', async (c) => {
    if (!config.OIDC_ISSUER) {
      return c.json({ error: 'OIDC is not configured' }, 503);
    }
    const refreshToken = getCookie(c, OIDC_REFRESH_COOKIE);
    if (!refreshToken) {
      return c.json({ error: 'No refresh token' }, 401);
    }

    const form = new URLSearchParams();
    form.set('grant_type', 'refresh_token');
    form.set('client_id', config.OIDC_CLIENT_ID_FRONTEND);
    form.set('refresh_token', refreshToken);

    let tokens: KeycloakTokenResponse;
    try {
      tokens = await exchangeAtKeycloak(form);
    } catch (err) {
      const status = (err as { status?: number }).status;
      logger.warn({ status }, 'OIDC refresh rejected by Keycloak');
      deleteCookie(c, OIDC_REFRESH_COOKIE, { path: '/' });
      return c.json({ error: 'Refresh failed' }, 401);
    }

    if (!tokens.id_token) {
      return c.json({ error: 'Refresh missing id_token' }, 401);
    }

    let user: User;
    let isAdmin: boolean;
    try {
      ({ user, isAdmin } = await findOrLinkOrCreateUser(users, tokens.id_token));
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'OIDC refresh id_token invalid');
      return c.json({ error: 'Invalid id_token' }, 401);
    }

    if (tokens.refresh_token) {
      const ttlMs = (tokens.refresh_expires_in ?? 0) * 1000 || DEFAULT_REFRESH_TTL_MS;
      setRefreshCookie(c, tokens.refresh_token, ttlMs);
    }

    return c.json({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
      user: { ...toAuthUser(user), is_admin: isAdmin ? 1 : 0 },
    });
  });

  // ── Logout (revoke at KC + clear cookie) ────────────────────────────────
  router.post('/logout', async (c) => {
    const refreshToken = getCookie(c, OIDC_REFRESH_COOKIE);
    deleteCookie(c, OIDC_REFRESH_COOKIE, { path: '/' });
    if (refreshToken && config.OIDC_ISSUER) {
      const form = new URLSearchParams();
      form.set('client_id', config.OIDC_CLIENT_ID_FRONTEND);
      form.set('refresh_token', refreshToken);
      try {
        const response = await fetch(logoutEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        if (!response.ok && response.status !== 204) {
          logger.warn({ status: response.status }, 'OIDC backchannel logout returned non-2xx');
        }
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'OIDC backchannel logout failed');
      }
    }
    return c.body(null, 204);
  });

  return router;
}
