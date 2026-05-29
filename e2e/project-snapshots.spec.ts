import { test, expect } from '@playwright/test';
import { apiCreateProject, apiRegister } from './helpers';

/**
 * Exercises spec-004 versioning end-to-end via API: capture a snapshot,
 * mutate the project, capture again, then assert timeline + diff and
 * metadata patching. This is the smoke verify for "spec 004 Phase 12"
 * we owe in PRODUCTION_READINESS.
 */
test.describe('Project snapshots (API)', () => {
  test('capture two snapshots and diff shows the change', async ({ request }) => {
    const { client } = await apiRegister(request);
    const projectId = await apiCreateProject(client, `snap-${Date.now()}`);

    const auth = { Authorization: `Bearer ${client.accessToken}` };

    // Seed v1
    await request.put(`/api/projects/${projectId}/files/index.html`, {
      headers: auth,
      data: { content: '<h1>v1</h1>' },
    });
    const snapA = await request.post(`/api/projects/${projectId}/snapshots`, {
      headers: auth,
      data: { label: 'v1' },
    });
    expect(snapA.ok()).toBeTruthy();
    const a = (await snapA.json()) as { id: string; label: string };
    expect(a.label).toBe('v1');

    // Mutate to v2
    await request.put(`/api/projects/${projectId}/files/index.html`, {
      headers: auth,
      data: { content: '<h1>v2</h1>' },
    });
    await request.put(`/api/projects/${projectId}/files/styles.css`, {
      headers: auth,
      data: { content: 'body { color: red; }' },
    });
    const snapB = await request.post(`/api/projects/${projectId}/snapshots`, {
      headers: auth,
      data: { label: 'v2' },
    });
    expect(snapB.ok()).toBeTruthy();
    const b = (await snapB.json()) as { id: string; label: string };

    // Timeline shows both, oldest first
    const tlRes = await request.get(`/api/projects/${projectId}/snapshots/timeline`, {
      headers: auth,
    });
    expect(tlRes.ok()).toBeTruthy();
    const timeline = (await tlRes.json()) as { tip_id: string; nodes: Array<{ id: string }> };
    expect(timeline.tip_id).toBe(b.id);
    const ids = timeline.nodes.map((n) => n.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);

    // Diff classifies the change correctly
    const diffRes = await request.get(`/api/projects/${projectId}/snapshots/${a.id}/diff/${b.id}`, {
      headers: auth,
    });
    expect(diffRes.ok()).toBeTruthy();
    const diff = (await diffRes.json()) as {
      files: {
        added: Array<{ path: string }>;
        removed: Array<{ path: string }>;
        modified: Array<{ path: string }>;
      };
    };
    const addedPaths = diff.files.added.map((f) => f.path);
    const modifiedPaths = diff.files.modified.map((f) => f.path);
    expect(addedPaths).toContain('styles.css');
    expect(modifiedPaths).toContain('index.html');
    expect(diff.files.removed).toEqual([]);
  });

  test('PATCH snapshot can pin retention', async ({ request }) => {
    const { client } = await apiRegister(request);
    const projectId = await apiCreateProject(client, `snap-pin-${Date.now()}`);
    const auth = { Authorization: `Bearer ${client.accessToken}` };

    const snapRes = await request.post(`/api/projects/${projectId}/snapshots`, {
      headers: auth,
      data: { label: 'pin me' },
    });
    expect(snapRes.ok()).toBeTruthy();
    const snap = (await snapRes.json()) as { id: string; retention: string };
    expect(snap.retention).toBe('ephemeral');

    const patchRes = await request.patch(`/api/projects/${projectId}/snapshots/${snap.id}`, {
      headers: auth,
      data: { retention: 'pinned', label: 'kept' },
    });
    expect(patchRes.ok()).toBeTruthy();
    const updated = (await patchRes.json()) as { retention: string; label: string };
    expect(updated.retention).toBe('pinned');
    expect(updated.label).toBe('kept');
  });

  test('Snapshot belonging to another project returns 404 on diff', async ({ request }) => {
    const { client } = await apiRegister(request);
    const auth = { Authorization: `Bearer ${client.accessToken}` };

    const p1 = await apiCreateProject(client, `snap-cross-1-${Date.now()}`);
    const p2 = await apiCreateProject(client, `snap-cross-2-${Date.now()}`);

    const aRes = await request.post(`/api/projects/${p1}/snapshots`, { headers: auth, data: {} });
    const bRes = await request.post(`/api/projects/${p2}/snapshots`, { headers: auth, data: {} });
    const a = (await aRes.json()) as { id: string };
    const b = (await bRes.json()) as { id: string };

    const cross = await request.get(`/api/projects/${p1}/snapshots/${a.id}/diff/${b.id}`, {
      headers: auth,
    });
    expect(cross.status()).toBe(404);
  });

  test('Restore without confirm returns 400', async ({ request }) => {
    const { client } = await apiRegister(request);
    const projectId = await apiCreateProject(client, `snap-restore-bad-${Date.now()}`);
    const auth = { Authorization: `Bearer ${client.accessToken}` };

    const snapRes = await request.post(`/api/projects/${projectId}/snapshots`, {
      headers: auth,
      data: {},
    });
    const snap = (await snapRes.json()) as { id: string };

    const res = await request.post(`/api/projects/${projectId}/snapshots/${snap.id}/restore`, {
      headers: auth,
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Admin tool-audit gate', () => {
  test('Non-admin user cannot read /admin/tool-audit', async ({ request }) => {
    const { client } = await apiRegister(request);
    const res = await request.get('/admin/tool-audit', {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(res.status()).toBe(403);
  });
});
