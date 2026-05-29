import { test, expect } from '@playwright/test';
import { apiCreateProject, apiRegister } from './helpers';

/**
 * Snapshot restore happy path (spec 004 Phase 12 verify).
 *
 * Flow:
 * 1. Project gets file A with content "v1".
 * 2. Capture snapshot S1 ("baseline").
 * 3. Mutate file A to "v2" and add file B.
 * 4. Capture snapshot S2 ("after work").
 * 5. POST /snapshots/{S1}/restore { confirm: true }.
 *
 * Expected after restore:
 *  - file A content == "v1".
 *  - file B no longer exists.
 *  - Timeline has the original two snapshots + a "Before restore" pre-snapshot
 *    + a `branch-root` snapshot whose `parent_id` references S1.
 *  - `branch_root_id` from the response equals the tip id.
 */
test.describe('Snapshot restore', () => {
  test('restore reverts file content and creates a branch-root', async ({ request }) => {
    const { client } = await apiRegister(request);
    const auth = { Authorization: `Bearer ${client.accessToken}` };
    const projectId = await apiCreateProject(client, `restore-${Date.now()}`);

    // v1: just index.html
    await request.put(`/api/projects/${projectId}/files/index.html`, {
      headers: auth,
      data: { content: '<h1>v1</h1>' },
    });
    const s1Res = await request.post(`/api/projects/${projectId}/snapshots`, {
      headers: auth,
      data: { label: 'baseline' },
    });
    const s1 = (await s1Res.json()) as { id: string };

    // v2: mutate index.html and add styles.css
    await request.put(`/api/projects/${projectId}/files/index.html`, {
      headers: auth,
      data: { content: '<h1>v2</h1>' },
    });
    await request.put(`/api/projects/${projectId}/files/styles.css`, {
      headers: auth,
      data: { content: 'body { color: red; }' },
    });
    await request.post(`/api/projects/${projectId}/snapshots`, {
      headers: auth,
      data: { label: 'after work' },
    });

    // Restore s1.
    const restoreRes = await request.post(
      `/api/projects/${projectId}/snapshots/${s1.id}/restore`,
      { headers: auth, data: { confirm: true } }
    );
    expect(restoreRes.ok()).toBeTruthy();
    const restoreBody = (await restoreRes.json()) as {
      status: string;
      snapshot: { id: string };
      branch_root_id: string | null;
    };
    expect(restoreBody.status).toBe('restored');
    expect(restoreBody.snapshot.id).toBe(s1.id);
    expect(restoreBody.branch_root_id).toBeTruthy();

    // File state should now match s1.
    const indexRes = await request.get(
      `/api/projects/${projectId}/files/index.html`,
      { headers: auth }
    );
    expect(indexRes.ok()).toBeTruthy();
    const indexFile = (await indexRes.json()) as { content: string };
    expect(indexFile.content).toContain('v1');

    const stylesRes = await request.get(
      `/api/projects/${projectId}/files/styles.css`,
      { headers: auth }
    );
    expect(stylesRes.status()).toBe(404);

    // Timeline should contain the branch-root pointing at s1.
    const tlRes = await request.get(
      `/api/projects/${projectId}/snapshots/timeline`,
      { headers: auth }
    );
    expect(tlRes.ok()).toBeTruthy();
    const timeline = (await tlRes.json()) as {
      tip_id: string;
      nodes: Array<{ id: string; parent_id: string | null; trigger: string }>;
    };
    expect(timeline.tip_id).toBe(restoreBody.branch_root_id);
    const branchRoot = timeline.nodes.find((n) => n.id === restoreBody.branch_root_id);
    expect(branchRoot).toBeTruthy();
    expect(branchRoot!.trigger).toBe('branch-root');
    expect(branchRoot!.parent_id).toBe(s1.id);
  });
});
