import { test, expect } from '@playwright/test';
import { STRONG_PASSWORD, totpCode, uniqueUsername, apiRegister } from './helpers';

test.describe('/auth/me', () => {
  test('returns the authenticated user payload', async ({ request }) => {
    const { username, client } = await apiRegister(request);
    const res = await request.get('/auth/me', {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { user: { username: string; is_admin: number } };
    expect(body.user.username).toBe(username);
    expect(body.user.is_admin).toBe(0);
  });

  test('returns 401 without a token', async ({ request }) => {
    const res = await request.get('/auth/me');
    expect(res.status()).toBe(401);
  });
});

test.describe('/auth/logout', () => {
  test('revokes the refresh cookie server-side', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      baseURL: process.env['DEVMIND_E2E_BASE_URL'] ?? 'http://localhost:5001',
      extraHTTPHeaders: { 'X-Forwarded-For': `e2e-${Math.random().toString(36).slice(2, 10)}` },
    });

    const username = uniqueUsername('logout');
    const reg = await ctx.post('/auth/register', {
      data: { username, displayName: username, password: STRONG_PASSWORD },
    });
    expect(reg.ok()).toBeTruthy();
    const { totpSecret, confirmToken } = (await reg.json()) as { totpSecret: string; confirmToken: string };
    const confirm = await ctx.post('/auth/register/confirm', {
      data: { confirmToken, code: totpCode(totpSecret) },
    });
    const { accessToken } = (await confirm.json()) as { accessToken: string };

    // Logout. The route is DELETE /auth/logout per backend routes.
    const logoutRes = await ctx.delete('/auth/logout', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(logoutRes.ok()).toBeTruthy();

    // The previously valid refresh cookie should now fail.
    const refreshRes = await ctx.post('/auth/refresh');
    expect(refreshRes.status()).toBe(401);

    await ctx.dispose();
  });
});

test.describe('/api/sessions', () => {
  test('create → list → archive (delete)', async ({ request }) => {
    const { client } = await apiRegister(request);
    const auth = { Authorization: `Bearer ${client.accessToken}` };

    const createRes = await request.post('/api/sessions', {
      headers: auth,
      data: { title: 'E2E session' },
    });
    expect(createRes.status()).toBe(201);
    const session = (await createRes.json()) as { id: string; title: string };
    expect(session.id).toMatch(/[0-9a-f-]{8,}/i);

    const listRes = await request.get('/api/sessions', { headers: auth });
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list.some((s) => s.id === session.id)).toBeTruthy();

    const delRes = await request.delete(`/api/sessions/${session.id}`, { headers: auth });
    expect(delRes.status()).toBe(204);
  });

  test('GET /api/sessions/:id/messages on a foreign session returns 404', async ({ request }) => {
    const { client: alice } = await apiRegister(request);
    const aliceRes = await request.post('/api/sessions', {
      headers: { Authorization: `Bearer ${alice.accessToken}` },
      data: { title: 'private' },
    });
    const aliceSession = (await aliceRes.json()) as { id: string };

    const { client: bob } = await apiRegister(request);
    const bobView = await request.get(`/api/sessions/${aliceSession.id}/messages`, {
      headers: { Authorization: `Bearer ${bob.accessToken}` },
    });
    expect(bobView.status()).toBe(404);
  });
});
