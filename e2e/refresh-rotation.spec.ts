import { test, expect } from '@playwright/test';
import { STRONG_PASSWORD, totpCode, uniqueUsername } from './helpers';

/**
 * Refresh token rotation contract (spec 007 baseline):
 *
 * 1. /auth/register/confirm sets the refresh cookie.
 * 2. /auth/refresh returns a fresh access token AND rotates the cookie.
 * 3. The previous refresh cookie value is revoked — replaying it must 401.
 *
 * Tests use a *fresh* APIRequestContext per test so cookie state is isolated
 * from the suite-wide context. This also doubles as a regression for the
 * jti uniqueness fix: register + 2 refreshes in quick succession all issue
 * distinct tokens.
 */
test.describe('Refresh token rotation', () => {
  test('refresh rotates the cookie and the old cookie becomes invalid', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      baseURL: process.env['DEVMIND_E2E_BASE_URL'] ?? 'http://localhost:5001',
      extraHTTPHeaders: { 'X-Forwarded-For': `e2e-${Math.random().toString(36).slice(2, 10)}` },
    });

    // Register a user (cookie lands on ctx).
    const username = uniqueUsername('refresh');
    const reg = await ctx.post('/auth/register', {
      data: { username, displayName: username, password: STRONG_PASSWORD },
    });
    expect(reg.ok()).toBeTruthy();
    const { totpSecret, confirmToken } = (await reg.json()) as {
      totpSecret: string;
      confirmToken: string;
    };
    const confirm = await ctx.post('/auth/register/confirm', {
      data: { confirmToken, code: totpCode(totpSecret) },
    });
    expect(confirm.ok()).toBeTruthy();

    // Capture the initial refresh cookie value out of the context.
    const cookiesBeforeRefresh = await ctx.storageState();
    const refreshCookieBefore = cookiesBeforeRefresh.cookies.find(
      (c) => c.name === 'refresh_token'
    );
    expect(refreshCookieBefore?.value).toBeTruthy();

    // Rotate.
    const refreshA = await ctx.post('/auth/refresh');
    expect(refreshA.ok()).toBeTruthy();
    const bodyA = (await refreshA.json()) as { accessToken: string };
    expect(bodyA.accessToken).toBeTruthy();

    const cookiesAfterRefresh = await ctx.storageState();
    const refreshCookieAfter = cookiesAfterRefresh.cookies.find(
      (c) => c.name === 'refresh_token'
    );
    expect(refreshCookieAfter?.value).toBeTruthy();
    expect(refreshCookieAfter!.value).not.toBe(refreshCookieBefore!.value);

    // Now try to refresh again with the OLD cookie via a fresh context. It
    // should fail because the old refresh was revoked on rotation.
    const replayCtx = await playwright.request.newContext({
      baseURL: process.env['DEVMIND_E2E_BASE_URL'] ?? 'http://localhost:5001',
      extraHTTPHeaders: { 'X-Forwarded-For': `e2e-${Math.random().toString(36).slice(2, 10)}` },
      storageState: {
        cookies: [refreshCookieBefore!],
        origins: [],
      },
    });
    const replay = await replayCtx.post('/auth/refresh');
    expect(replay.status()).toBe(401);

    // Meanwhile the new cookie still works.
    const refreshB = await ctx.post('/auth/refresh');
    expect(refreshB.ok()).toBeTruthy();

    await ctx.dispose();
    await replayCtx.dispose();
  });

  test('refresh without cookie returns 401', async ({ request }) => {
    const res = await request.post('/auth/refresh');
    expect(res.status()).toBe(401);
  });
});
