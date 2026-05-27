import { test, expect } from '@playwright/test';
import { apiCreateProject, apiRegister } from './helpers';

/**
 * API-driven smoke of the project + project-file surface. Touches
 * everything that the chat UI relies on for "open builder, see files,
 * edit a file". If any of these endpoints regressed, the builder is
 * effectively broken — and that's what the user is reporting.
 */

test.describe('Project lifecycle (API)', () => {
  test('create → list → get → patch → delete', async ({ request }) => {
    const { client } = await apiRegister(request);

    // create
    const projectId = await apiCreateProject(client, `lifecycle-${Date.now()}`);
    expect(projectId).toMatch(/[0-9a-f-]{8,}/i);

    // list
    const listRes = await request.get('/api/projects', {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list.some((p) => p.id === projectId)).toBeTruthy();

    // get
    const getRes = await request.get(`/api/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(getRes.ok()).toBeTruthy();
    expect(((await getRes.json()) as { id: string }).id).toBe(projectId);

    // patch
    const newName = `lifecycle-renamed-${Date.now()}`;
    const patchRes = await request.patch(`/api/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
      data: { name: newName },
    });
    expect(patchRes.ok()).toBeTruthy();
    expect(((await patchRes.json()) as { name: string }).name).toBe(newName);

    // delete
    const delRes = await request.delete(`/api/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(delRes.status()).toBe(204);

    // confirm gone
    const after = await request.get(`/api/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(after.status()).toBe(404);
  });

  test('non-owner cannot access another user’s project', async ({ request }) => {
    // Both users go through the API so the browser context never has to
    // re-enter the register UI in the same test.
    const { client: aliceClient } = await apiRegister(request);
    const projectId = await apiCreateProject(aliceClient, `alice-only-${Date.now()}`);

    const { client: bobClient } = await apiRegister(request);
    const res = await request.get(`/api/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${bobClient.accessToken}` },
    });
    expect(res.status()).toBe(404);
  });

  test('Zod validation rejects invalid project payloads', async ({ request }) => {
    const { client } = await apiRegister(request);

    const res = await request.post('/api/projects', {
      headers: { Authorization: `Bearer ${client.accessToken}` },
      data: { name: '' }, // empty name should fail the schema
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

test.describe('Project files (API)', () => {
  test('PUT → GET file content → list → DELETE', async ({ request }) => {
    const { client } = await apiRegister(request);
    const projectId = await apiCreateProject(client, `files-${Date.now()}`);

    // PUT a file
    const putRes = await request.put(`/api/projects/${projectId}/files/src/index.ts`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
      data: { content: 'export const x = 1;\n' },
    });
    expect(putRes.ok()).toBeTruthy();
    const stored = (await putRes.json()) as { path: string; content: string; language: string };
    expect(stored.path).toBe('src/index.ts');
    expect(stored.content).toContain('export const x = 1');
    expect(stored.language).toBe('typescript');

    // GET single file
    const getRes = await request.get(`/api/projects/${projectId}/files/src/index.ts`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(getRes.ok()).toBeTruthy();

    // list
    const listRes = await request.get(`/api/projects/${projectId}/files`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as Array<{ path: string; size: number; language: string }>;
    const entry = list.find((f) => f.path === 'src/index.ts');
    expect(entry).toBeTruthy();
    expect(entry!.size).toBeGreaterThan(0);

    // DELETE
    const delRes = await request.delete(`/api/projects/${projectId}/files/src/index.ts`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(delRes.status()).toBe(204);

    const gone = await request.get(`/api/projects/${projectId}/files/src/index.ts`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    });
    expect(gone.status()).toBe(404);
  });

  test('PUT without content body returns 400', async ({ request }) => {
    const { client } = await apiRegister(request);
    const projectId = await apiCreateProject(client, `files-bad-${Date.now()}`);

    const res = await request.put(`/api/projects/${projectId}/files/no.ts`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});
