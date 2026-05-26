import { jwtVerify, errors as joseErrors } from 'jose';
import type { JWTPayload, JWTVerifyOptions } from 'jose';
import { config } from '../../config.js';
import { getJwks, resetJwksCache } from './jwks.js';

export interface OidcClaims extends JWTPayload {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  email?: string;
  preferred_username?: string;
  name?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

export interface VerifiedOidcUser {
  kcSubject: string;
  email: string | null;
  username: string;
  displayName: string;
  roles: string[];
}

/**
 * Verify an OIDC JWT against the configured Keycloak realm.
 *
 * Throws on signature mismatch, expired token, wrong issuer or wrong audience.
 * If the verification fails because of a key not present in the cache (KC
 * rotated keys), refetch the JWKS once and retry — this is the documented
 * recovery path.
 */
export async function verifyOidcToken(
  token: string,
  options: { audiences?: string[]; issuer?: string } = {}
): Promise<OidcClaims> {
  const issuer = options.issuer ?? config.OIDC_ISSUER;
  if (!issuer) {
    throw new Error('OIDC_ISSUER is not configured');
  }
  const audiences = options.audiences ?? [
    config.OIDC_CLIENT_ID_FRONTEND,
    config.OIDC_CLIENT_ID_BACKEND,
  ].filter((value): value is string => Boolean(value));

  const verifyOptions: JWTVerifyOptions = { issuer };
  if (audiences.length > 0) verifyOptions.audience = audiences;

  try {
    const { payload } = await jwtVerify(token, getJwks(issuer), verifyOptions);
    return assertOidcClaims(payload);
  } catch (err) {
    if (
      err instanceof joseErrors.JWKSNoMatchingKey ||
      err instanceof joseErrors.JWSSignatureVerificationFailed
    ) {
      resetJwksCache();
      const { payload } = await jwtVerify(token, getJwks(issuer), verifyOptions);
      return assertOidcClaims(payload);
    }
    throw err;
  }
}

function assertOidcClaims(payload: JWTPayload): OidcClaims {
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new joseErrors.JWTClaimValidationFailed('Missing sub claim', payload, 'sub');
  }
  if (typeof payload.iss !== 'string' || !payload.iss) {
    throw new joseErrors.JWTClaimValidationFailed('Missing iss claim', payload, 'iss');
  }
  if (typeof payload.exp !== 'number') {
    throw new joseErrors.JWTClaimValidationFailed('Missing exp claim', payload, 'exp');
  }
  return payload as OidcClaims;
}

export function mapOidcClaimsToUser(claims: OidcClaims): VerifiedOidcUser {
  const email = typeof claims.email === 'string' ? claims.email : null;
  const username =
    (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
    email ||
    claims.sub;
  const displayName = (typeof claims.name === 'string' && claims.name) || username;
  const roles = Array.isArray(claims.realm_access?.roles) ? claims.realm_access!.roles : [];
  return {
    kcSubject: claims.sub,
    email,
    username,
    displayName,
    roles,
  };
}
