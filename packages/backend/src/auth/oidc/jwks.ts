import { createRemoteJWKSet } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { config } from '../../config.js';

let cached: JWTVerifyGetKey | null = null;
let cachedIssuer: string | null = null;

export function buildJwksUri(issuer: string): URL {
  // Keycloak: ${issuer}/protocol/openid-connect/certs
  const base = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
  return new URL(`${base}/protocol/openid-connect/certs`);
}

export function getJwks(issuer: string = config.OIDC_ISSUER): JWTVerifyGetKey {
  if (!issuer) {
    throw new Error('OIDC_ISSUER is not configured');
  }
  if (cached && cachedIssuer === issuer) {
    return cached;
  }
  const uri = buildJwksUri(issuer);
  cached = createRemoteJWKSet(uri, {
    cacheMaxAge: config.OIDC_JWKS_CACHE_TTL_MS,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  });
  cachedIssuer = issuer;
  return cached;
}

// Visible for tests + key rotation recovery: force re-fetch on next call.
export function resetJwksCache(): void {
  cached = null;
  cachedIssuer = null;
}

// Tests inject a fake resolver.
export function setJwksForTests(resolver: JWTVerifyGetKey, issuer: string): void {
  cached = resolver;
  cachedIssuer = issuer;
}
