import { TOTP, Secret } from 'otpauth';
import type { APIRequestContext, Page } from '@playwright/test';

export function uniqueUsername(prefix = 'e2e'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Strong password that satisfies the backend policy: ≥12 chars, lowercase,
 * uppercase, number, symbol.
 */
export const STRONG_PASSWORD = 'E2eTest!2026secure';

export function totpCode(secretBase32: string): string {
  const totp = new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
  return totp.generate();
}

/**
 * Register a user end-to-end via the UI: fill the form, scan the secret from
 * the QR step, enter the TOTP code, and end logged in. Returns credentials.
 */
export async function registerUser(
  page: Page,
  options: { username?: string; password?: string; displayName?: string } = {}
): Promise<{ username: string; password: string; secret: string }> {
  const username = options.username ?? uniqueUsername();
  const password = options.password ?? STRONG_PASSWORD;
  const displayName = options.displayName ?? username;

  await page.goto('/login');
  await page.getByRole('button', { name: /create.*account|registr/i }).first().click();
  // Now on the register form. Field selectors are positional because the form
  // uses bare labels rather than associated <label for=...>.
  const inputs = page.locator('input');
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(displayName);
  await inputs.nth(2).fill(password);
  await page.getByRole('button', { name: /create account/i }).click();

  // QR step: the secret is rendered as <code>{secret}</code>. Read it.
  const secretLocator = page.locator('code').first();
  await secretLocator.waitFor({ state: 'visible' });
  const secret = (await secretLocator.textContent())?.trim() ?? '';
  if (!secret) throw new Error('Could not read TOTP secret from register-totp step');

  // Enter the current TOTP code and confirm.
  const code = totpCode(secret);
  await page.locator('input[inputmode="numeric"]').fill(code);
  await page.getByRole('button', { name: /confirm.*sign in/i }).click();

  // Wait for navigation away from /login.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  return { username, password, secret };
}

/**
 * Login an existing user that already has TOTP confirmed.
 */
export async function loginUser(page: Page, username: string, password: string, secret: string): Promise<void> {
  await page.goto('/login');
  const inputs = page.locator('input');
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(password);
  await page.getByRole('button', { name: /^sign in$|^iniciar sesi/i }).click();

  // MFA step
  const code = totpCode(secret);
  await page.locator('input[inputmode="numeric"]').fill(code);
  await page.getByRole('button', { name: /verify|confirm|continue/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

export interface ApiClient {
  request: APIRequestContext;
  accessToken: string;
}

/**
 * Authenticate via the backend HTTP API directly (no browser). Useful for
 * fixtures that need to seed DB state (create project, etc.).
 */
export async function apiLogin(
  request: APIRequestContext,
  username: string,
  password: string,
  secret: string
): Promise<ApiClient> {
  const step1 = await request.post('/auth/login', { data: { username, password } });
  if (!step1.ok()) throw new Error(`apiLogin step1 failed: ${step1.status()} ${await step1.text()}`);
  const { mfaToken } = (await step1.json()) as { mfaToken: string };

  const code = totpCode(secret);
  const step2 = await request.post('/auth/login/mfa', { data: { mfaToken, code } });
  if (!step2.ok()) throw new Error(`apiLogin step2 failed: ${step2.status()} ${await step2.text()}`);
  const { accessToken } = (await step2.json()) as { accessToken: string };
  return { request, accessToken };
}

export async function apiCreateProject(client: ApiClient, name: string): Promise<string> {
  const res = await client.request.post('/api/projects', {
    headers: { Authorization: `Bearer ${client.accessToken}` },
    data: { name, description: `E2E project ${name}` },
  });
  if (!res.ok()) throw new Error(`createProject failed: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function apiProjectFiles(
  client: ApiClient,
  projectId: string
): Promise<Array<{ path: string; language: string }>> {
  const res = await client.request.get(`/api/projects/${projectId}/files`, {
    headers: { Authorization: `Bearer ${client.accessToken}` },
  });
  if (!res.ok()) throw new Error(`listFiles failed: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { files?: Array<{ path: string; language: string }> } | Array<{ path: string; language: string }>;
  if (Array.isArray(body)) return body;
  return body.files ?? [];
}
