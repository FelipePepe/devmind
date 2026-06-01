import { test, expect } from '@playwright/test';

const KC_USER = process.env['KC_ADMIN_USER'] ?? 'felipe';
const KC_PASS = process.env['KC_ADMIN_PASS'] ?? (() => { throw new Error('KC_ADMIN_PASS env var is required'); })();

test('KC admin console login', async ({ page }) => {
  await page.goto('https://auth.casa/admin/master/console/');

  await page.fill('#username', KC_USER);
  await page.fill('#password', KC_PASS);
  await page.click('#kc-login');

  await expect(page.locator('nav, [role="banner"]').first()).toBeVisible({ timeout: 30000 });
  await expect(page).not.toHaveURL(/\/login/);
  console.log('✓ KC admin console OK — usuario', KC_USER);
});

test('DevMind OIDC login via devmind.casa', async ({ page }) => {
  await page.goto('https://devmind.casa/login');
  await page.waitForLoadState('domcontentloaded');

  const kcButton = page.getByRole('button', { name: /keycloak/i });
  await expect(kcButton).toBeVisible({ timeout: 10000 });
  console.log('✓ Botón KC visible en devmind.casa/login');

  await kcButton.click();

  await expect(page).toHaveURL(/auth\.casa/, { timeout: 15000 });
  console.log('✓ Redirigido a auth.casa');

  await page.fill('#username', KC_USER);
  await page.fill('#password', KC_PASS);
  await page.click('#kc-login');

  await expect(page).toHaveURL(/devmind\.casa/, { timeout: 20000 });
  await expect(page).not.toHaveURL(/login/);
  console.log('✓ Devmind autenticado via OIDC en devmind.casa');
});
