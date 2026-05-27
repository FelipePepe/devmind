import test from 'node:test';
import assert from 'node:assert/strict';

// config.ts is loaded transitively by jwt.ts and validates required env vars
// (JWT_SECRET, VAPID_*, STORAGE_BASE_PATH) at module init. Provide test
// defaults BEFORE the import is hoisted so the schema parses cleanly.
process.env['JWT_SECRET'] ??= 'test-jwt-secret-32bytes-padding-here-yes';
process.env['STORAGE_BASE_PATH'] ??= '/tmp';
process.env['VAPID_PUBLIC_KEY'] ??=
  'BNu0A0kbyXB7XJMMdTM02Mc3wiC2JFvMEFNnOnLkIaGvqdU2jWNAMtM4vucOtZ5ZA2zHaLOFLRXA4WvPFB49ong';
process.env['VAPID_PRIVATE_KEY'] ??= 'bT4Su9d1bwB0eKri_rsIUqJCb2vmtPwEFPJgRQNtZ9A';

const { sign, verifyAccess, verifyRefresh } = await import('./jwt.js');

test('sign emits a valid access token that round-trips through verifyAccess', async () => {
  const { accessToken } = await sign('user-1', false);
  const payload = await verifyAccess(accessToken);
  assert.equal(payload.userId, 'user-1');
  assert.equal(payload.isAdmin, false);
});

test('sign emits a refresh token that verifyRefresh accepts', async () => {
  const { refreshToken } = await sign('user-1', true);
  const payload = await verifyRefresh(refreshToken);
  assert.equal(payload.userId, 'user-1');
});

test('two consecutive sign() calls produce different refresh tokens (jti uniqueness)', async () => {
  // Regression for "UNIQUE constraint failed: refresh_tokens.token_hash":
  // before jti was added, two sign() calls in the same second for the same
  // user produced identical JWTs because iat/exp are second-resolution.
  const a = await sign('same-user', false);
  const b = await sign('same-user', false);
  assert.notEqual(a.accessToken, b.accessToken);
  assert.notEqual(a.refreshToken, b.refreshToken);
});

test('admin flag is encoded in the access token', async () => {
  const { accessToken } = await sign('admin-user', true);
  const payload = await verifyAccess(accessToken);
  assert.equal(payload.isAdmin, true);
});
