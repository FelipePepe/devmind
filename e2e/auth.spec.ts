import { test, expect } from '@playwright/test';
import {
  registerUser,
  loginUser,
  STRONG_PASSWORD,
  uniqueUsername,
} from './helpers';

test.describe('Auth — register flow', () => {
  test('Create Account button disabled until password policy is satisfied', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /create.*account|registr/i }).first().click();

    const inputs = page.locator('input');
    await inputs.nth(0).fill(uniqueUsername('policy'));
    await inputs.nth(1).fill('Display');
    const submit = page.getByRole('button', { name: /create account/i });

    // Too short
    await inputs.nth(2).fill('short');
    await expect(submit).toBeDisabled();

    // 12 chars but missing uppercase + symbol
    await inputs.nth(2).fill('abcdefghijkl');
    await expect(submit).toBeDisabled();

    // Full policy met
    await inputs.nth(2).fill(STRONG_PASSWORD);
    await expect(submit).toBeEnabled();
  });

  test('Register → QR + secret visible → TOTP confirms and logs in', async ({ page }) => {
    const { username } = await registerUser(page);
    // After register, we end up on /projects or /. Just assert we left /login.
    await expect(page).not.toHaveURL(/\/login/);
    // Username should now show somewhere on the topbar.
    await expect(page.getByText(username, { exact: false }).first()).toBeVisible();
  });
});

test.describe('Auth — login flow', () => {
  test('Login with TOTP completes for an existing user', async ({ page, context }) => {
    // First, register so we have a user with TOTP confirmed.
    const creds = await registerUser(page);

    // Clear auth state and log in from scratch.
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());

    await loginUser(page, creds.username, creds.password, creds.secret);
    await expect(page).not.toHaveURL(/\/login/);
  });
});

test.describe('Login page — version', () => {
  test('Version badge is rendered on the login page', async ({ page }) => {
    await page.goto('/login');
    // We inject __APP_VERSION__ at build time. The footer is `v<version>`.
    await expect(page.getByText(/^v\d+\.\d+\.\d+/)).toBeVisible();
  });
});
