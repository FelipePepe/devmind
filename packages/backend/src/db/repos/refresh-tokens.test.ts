import test from 'node:test';
import assert from 'node:assert/strict';
import { hashRefreshToken } from './refresh-tokens.js';

test('refresh token hashing is deterministic and does not expose the token', () => {
  const token = 'refresh-token-example';
  const hash = hashRefreshToken(token);
  assert.equal(hash, hashRefreshToken(token));
  assert.notEqual(hash, token);
  assert.equal(hash.length, 64);
});
