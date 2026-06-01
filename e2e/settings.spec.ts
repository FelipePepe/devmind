import { test, expect } from '@playwright/test';
import { registerUser } from './helpers';

test.describe('Ollama settings — model picker', () => {
  test('Any authenticated user can open Ollama settings and see a populated model combo', async ({ page }) => {
    await registerUser(page);

    // The TopBar exposes the "Ollama" link to every signed-in user.
    await page.getByRole('link', { name: 'Ollama' }).click();
    await expect(page).toHaveURL(/\/admin\/ollama/);

    // Find the Coding model row by its label and click Edit.
    const codingRow = page.locator('div').filter({ hasText: /^Coding model/ }).first();
    await codingRow.getByRole('button', { name: /edit/i }).click();

    // A <select> should appear and have at least 2 options (real Ollama has many).
    const select = page.locator('select');
    await expect(select).toBeVisible();
    const optionCount = await select.locator('option').count();
    expect(optionCount).toBeGreaterThanOrEqual(2);

    // Cancel — we don't want to actually mutate the running stack from this smoke test.
    await page.getByRole('button', { name: /cancel/i }).click();
  });
});
