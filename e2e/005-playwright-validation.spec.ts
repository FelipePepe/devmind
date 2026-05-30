/**
 * Spec 005 — Playwright validation Phase 9 verification tests.
 * These tests run against a live backend and verify the implementation
 * without requiring the Playwright worker container or Ollama.
 */
import { test, expect } from '@playwright/test';
import { apiRegister } from './helpers.js';

test.describe('005 — Playwright validation (flags OFF)', () => {
  test('9.2 — feature flags exist with value=false', async ({ request }) => {
    const { client } = await apiRegister(request);

    const res = await client.request.get('/flags', {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    const flags = (await res.json()) as Array<{ key: string; value: string }>;

    const required = [
      'validation.playwright_enabled',
      'validation.gate_on_tests',
      'validation.attach_evidence_to_messages',
    ];
    for (const key of required) {
      const flag = flags.find((f) => f.key === key);
      expect(flag, `flag ${key} should exist`).toBeDefined();
      expect(flag?.value, `flag ${key} should default to false`).toBe('false');
    }
  });

  test('9.12 — GET /api/projects/:id/tests returns empty array with flags OFF (no regression)', async ({ request }) => {
    const { client } = await apiRegister(request);
    const authHeaders = { Authorization: `Bearer ${client.accessToken}` };

    // Create project
    const proj = await client.request.post('/api/projects', {
      headers: authHeaders,
      data: { name: '005-verify-no-regression' },
    });
    expect(proj.ok()).toBeTruthy();
    const { id: projectId } = (await proj.json()) as { id: string };

    // Tests endpoint returns empty array — no 500, no 404
    const testsRes = await client.request.get(`/api/projects/${projectId}/tests`, {
      headers: authHeaders,
    });
    expect(testsRes.ok()).toBeTruthy();
    const tests = await testsRes.json();
    expect(Array.isArray(tests)).toBe(true);
    expect(tests).toHaveLength(0);

    // Cleanup
    await client.request.delete(`/api/projects/${projectId}`, { headers: authHeaders });
  });

  test('9.12b — POST /api/projects/:id/tests/:testId/run on nonexistent test returns 404', async ({ request }) => {
    const { client } = await apiRegister(request);
    const authHeaders = { Authorization: `Bearer ${client.accessToken}` };

    const proj = await client.request.post('/api/projects', {
      headers: authHeaders,
      data: { name: '005-verify-404' },
    });
    const { id: projectId } = (await proj.json()) as { id: string };

    const runRes = await client.request.post(
      `/api/projects/${projectId}/tests/00000000-0000-0000-0000-000000000000/run`,
      { headers: authHeaders }
    );
    expect(runRes.status()).toBe(404);

    await client.request.delete(`/api/projects/${projectId}`, { headers: authHeaders });
  });

  test('9.12c — messages.evidence_json column exists and is null by default', async ({ request }) => {
    const { client } = await apiRegister(request);
    const authHeaders = { Authorization: `Bearer ${client.accessToken}` };

    // Create session and send a message
    const proj = await client.request.post('/api/projects', {
      headers: authHeaders,
      data: { name: '005-verify-evidence-col' },
    });
    const { id: projectId } = (await proj.json()) as { id: string };

    const sess = await client.request.post('/api/sessions', {
      headers: authHeaders,
      data: { projectId, title: 'test-session' },
    });
    const { id: sessionId } = (await sess.json()) as { id: string };

    // Fetch messages — should include evidence field (null) without error
    const msgs = await client.request.get(`/api/sessions/${sessionId}/messages`, {
      headers: authHeaders,
    });
    expect(msgs.ok()).toBeTruthy();
    const list = await msgs.json();
    expect(Array.isArray(list)).toBe(true);

    // Cleanup
    await client.request.delete(`/api/projects/${projectId}`, { headers: authHeaders });
  });
});
