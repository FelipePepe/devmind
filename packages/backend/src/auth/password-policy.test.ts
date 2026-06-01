import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordPolicy } from './password-policy.js';

test('password policy rejects weak passwords', () => {
  const result = validatePasswordPolicy('password');
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /at least 12/);
  assert.match(result.errors.join('\n'), /uppercase/);
  assert.match(result.errors.join('\n'), /number/);
  assert.match(result.errors.join('\n'), /symbol/);
});

test('password policy accepts strong passwords', () => {
  const result = validatePasswordPolicy('Correct-Horse-7');
  assert.deepEqual(result, { ok: true, errors: [] });
});
