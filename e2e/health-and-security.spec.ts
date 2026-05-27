import { test, expect } from '@playwright/test';

/**
 * Smoke tests of unauthenticated surface — health endpoint shape, metrics
 * format, and security middleware. These should never need credentials.
 */

test.describe('Health & security smoke', () => {
  test('GET /api/health returns ok with db/ollama/workers components', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({
      ok: expect.any(Boolean),
      db: expect.any(String),
      ollama: expect.any(String),
      workers: expect.objectContaining({
        pending: expect.any(Number),
        processing: expect.any(Number),
        failed: expect.any(Number),
        lag_ms: expect.any(Number),
      }),
      timestamp: expect.any(String),
    });
  });

  test('GET /api/metrics exposes uptime + HTTP counters in Prometheus format', async ({ request }) => {
    const res = await request.get('/api/metrics');
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toMatch(/^# HELP devmind_uptime_seconds/m);
    expect(text).toMatch(/^# TYPE devmind_uptime_seconds gauge/m);
    expect(text).toMatch(/^devmind_uptime_seconds \d+/m);
    expect(text).toMatch(/^devmind_http_requests_total\{[^}]+\} \d+/m);
  });

  test('Security headers are present on API responses', async ({ request }) => {
    const res = await request.get('/api/health');
    const headers = res.headers();
    expect(headers['content-security-policy']).toBeTruthy();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toMatch(/SAMEORIGIN|DENY/i);
    expect(headers['referrer-policy']).toBeTruthy();
    expect(headers['strict-transport-security']).toBeTruthy();
    expect(headers['permissions-policy']).toBeTruthy();
  });

  test('Unauthenticated /admin/* returns 401', async ({ request }) => {
    const res = await request.get('/admin/tool-audit');
    expect(res.status()).toBe(401);
  });

  test('POST /auth/register rejects passwords that fail the policy', async ({ request }) => {
    const res = await request.post('/auth/register', {
      data: { username: `weakpw_${Date.now()}`, displayName: 'x', password: 'short' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/password policy/i);
    expect(Array.isArray(body.details)).toBeTruthy();
  });
});
