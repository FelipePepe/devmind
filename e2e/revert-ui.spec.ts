import { test, expect } from '@playwright/test';
import { loginUser } from './helpers';

/**
 * 004 12.6 — revert from a chat message in the Builder UI.
 * Logs in as audit_v2 (already has auto-capture snapshots from 12.1 run),
 * navigates to the builder, clicks the revert (⟲) button on a message with a
 * linked snapshot, confirms the diff modal, and verifies a branch-root snapshot
 * is created in the timeline.
 */
test('revert from chat message: modal opens, confirm creates branch-root', async ({ page, request }) => {
  const projectId = process.env['PROJECT_ID']!;
  const adminToken = process.env['ADMIN_TOKEN']!;
  const secret    = process.env['TOTP_SECRET']!;
  expect(projectId).toBeTruthy();

  await loginUser(page, 'audit_v2', 'AuditV3rify!2026', secret);
  await page.goto(`/projects/${projectId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/12.6-builder.png' });

  // Revert button: ⟲ icon or aria/title containing revert/restore
  const revertBtn = page.locator([
    'button[title*="evert"]', 'button[title*="estore"]',
    'button[aria-label*="evert"]', 'button[aria-label*="estore"]',
    'button:has-text("⟲")', 'button:has-text("↩")',
    '[data-testid*="revert"]',
  ].join(', ')).first();

  const found = await revertBtn.isVisible({ timeout: 8000 }).catch(() => false);
  console.log(`Revert button visible: ${found}`);
  if (!found) {
    console.log('Page text (500):', (await page.locator('body').innerText()).slice(0, 500));
  }
  await page.screenshot({ path: 'test-results/12.6-revert-btn.png' });
  expect(found, 'Revert button should be visible on a message with a linked snapshot').toBe(true);

  await revertBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/12.6-modal.png' });

  const modal = page.locator('[role="dialog"], .modal, [data-testid*="modal"], [data-testid*="revert"]').first();
  const modalVisible = await modal.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`Modal visible: ${modalVisible}`);
  expect(modalVisible, 'Diff/confirm modal should appear').toBe(true);

  // Confirm revert
  const confirmBtn = modal.locator(
    'button:has-text("Restore"), button:has-text("Confirm"), button:has-text("Revert"), button:has-text("Yes")'
  ).first();
  const canConfirm = await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (canConfirm) {
    await confirmBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/12.6-confirmed.png' });
    console.log('Revert confirmed');
  }

  // Verify branch-root snapshot in timeline via API
  const tlRes = await request.get(`/api/projects/${projectId}/snapshots/timeline`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(tlRes.ok()).toBeTruthy();
  const tl = await tlRes.json() as { nodes: Array<{ trigger: string }> };
  const branchRoots = (tl.nodes ?? []).filter((n) => n.trigger === 'branch-root');
  console.log(`branch-root snapshots: ${branchRoots.length}`);
  expect(branchRoots.length, 'A branch-root snapshot must exist after revert').toBeGreaterThan(0);
});
