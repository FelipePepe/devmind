import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, errors as joseErrors } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

const TEST_ISSUER = 'https://auth.test/realms/casa';

// Configure env BEFORE importing modules that read config at load time.
process.env['OIDC_ISSUER'] = TEST_ISSUER;
process.env['OIDC_CLIENT_ID_FRONTEND'] = 'devmind-frontend';
process.env['OIDC_CLIENT_ID_BACKEND'] = 'devmind-backend';
process.env['JWT_SECRET'] ??= 'x'.repeat(64);
process.env['STORAGE_BASE_PATH'] ??= '/tmp/devmind-test';
process.env['VAPID_PUBLIC_KEY'] ??= 'test';
process.env['VAPID_PRIVATE_KEY'] ??= 'x'.repeat(64);

const { setJwksForTests, resetJwksCache } = await import('./jwks.js');
const { verifyOidcToken } = await import('./verify.js');

async function setupKeys(): Promise<{
  privateKey: CryptoKey;
  signValid: (overrides?: Record<string, unknown>) => Promise<string>;
}> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const resolver: JWTVerifyGetKey = async () => publicKey;
  setJwksForTests(resolver, TEST_ISSUER);

  const signValid = (overrides: Record<string, unknown> = {}): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    const base = {
      iss: TEST_ISSUER,
      aud: 'devmind-frontend',
      sub: 'kc-sub-1',
      email: 'alice@example.com',
      preferred_username: 'alice',
      name: 'Alice',
      realm_access: { roles: ['user'] },
      iat: now,
      exp: now + 300,
    };
    return new SignJWT({ ...base, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .sign(privateKey);
  };

  return { privateKey, signValid };
}

test('verifyOidcToken accepts a valid token', async () => {
  resetJwksCache();
  const { signValid } = await setupKeys();
  const token = await signValid();
  const claims = await verifyOidcToken(token);
  assert.equal(claims.sub, 'kc-sub-1');
  assert.equal(claims.email, 'alice@example.com');
  assert.equal(claims.preferred_username, 'alice');
});

test('verifyOidcToken rejects expired token', async () => {
  resetJwksCache();
  const { signValid } = await setupKeys();
  const now = Math.floor(Date.now() / 1000);
  const token = await signValid({ exp: now - 60, iat: now - 120 });
  await assert.rejects(verifyOidcToken(token), (err: unknown) => err instanceof joseErrors.JWTExpired);
});

test('verifyOidcToken rejects wrong issuer', async () => {
  resetJwksCache();
  const { signValid } = await setupKeys();
  const token = await signValid({ iss: 'https://evil.example/realms/casa' });
  await assert.rejects(
    verifyOidcToken(token),
    (err: unknown) => err instanceof joseErrors.JWTClaimValidationFailed
  );
});

test('verifyOidcToken rejects wrong audience', async () => {
  resetJwksCache();
  const { signValid } = await setupKeys();
  const token = await signValid({ aud: 'some-other-client' });
  await assert.rejects(
    verifyOidcToken(token),
    (err: unknown) => err instanceof joseErrors.JWTClaimValidationFailed
  );
});

test('verifyOidcToken rejects token signed by a different key', async () => {
  resetJwksCache();
  // First setup installs key A in the JWKS cache.
  await setupKeys();
  // Sign with a fresh key B that the (now installed) JWKS will not match.
  const { privateKey: otherKey } = await generateKeyPair('RS256');
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    iss: TEST_ISSUER,
    aud: 'devmind-frontend',
    sub: 'kc-sub-1',
    iat: now,
    exp: now + 300,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .sign(otherKey);

  await assert.rejects(verifyOidcToken(token));
});
