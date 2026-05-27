import { test, expect } from '@playwright/test';
import {
  registerUser,
  apiLogin,
  apiCreateProject,
  apiProjectFiles,
} from './helpers';

/**
 * End-to-end happy path against a real Ollama backend.
 *
 * Exists because the bugs we hit in the 2026-05-26 session would never have
 * surfaced in pure unit tests — they were format mismatches between Ollama,
 * the agent loop, the executor and the audit repo. This test exercises the
 * full chain: send a prompt, let the model emit tool calls, executor runs the
 * tool, file lands in project_files.
 *
 * It hits a real LLM. Slow. Skip on CI unless DEVMIND_E2E_RUN_LLM=1.
 */
const SHOULD_RUN_LLM = process.env['DEVMIND_E2E_RUN_LLM'] === '1' || process.env['CI'] !== 'true';

test.describe('Agent — build the app (real LLM)', () => {
  test.skip(!SHOULD_RUN_LLM, 'Set DEVMIND_E2E_RUN_LLM=1 to run LLM-driven tests');
  // The 36B model takes ~30s/iteration, up to 8 iterations.
  test.setTimeout(6 * 60_000);

  test('Sending "Build the app" results in at least an index.html persisted', async ({ page, request }) => {
    // Register via UI to get TOTP secret out, then drive everything else via API
    // so the test isn't subject to the chat UI's particular markup.
    const creds = await registerUser(page);
    const client = await apiLogin(request, creds.username, creds.password, creds.secret);
    const projectId = await apiCreateProject(client, `e2e-build-${Date.now()}`);

    // Create a session for this project.
    const sessionRes = await request.post('/api/sessions', {
      headers: { Authorization: `Bearer ${client.accessToken}` },
      data: { projectId, title: 'E2E build session' },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const { id: sessionId } = (await sessionRes.json()) as { id: string };

    // Open the builder page so the SSE listener is connected before we fire
    // the chat message (mimics real usage).
    await page.goto(`/projects/${projectId}`);

    // Send the prompt directly via the chat API. We drain the SSE stream and
    // wait for the 'done' event, then poll project files for up to 5 minutes.
    const chatRes = await request.post('/api/chat', {
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        Accept: 'text/event-stream',
      },
      data: { sessionId, projectId, content: 'Build the app' },
      timeout: 6 * 60_000,
    });
    expect(chatRes.ok()).toBeTruthy();

    // Drain the SSE body (we don't strictly need its contents — assertions are
    // on persisted state).
    const body = await chatRes.body();
    expect(body.length).toBeGreaterThan(0);

    // Poll project files. The agent loop may need a few iterations.
    let files: Array<{ path: string }> = [];
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      files = await apiProjectFiles(client, projectId);
      if (files.some((f) => f.path === 'index.html')) break;
      await page.waitForTimeout(2_000);
    }

    expect(files.map((f) => f.path)).toContain('index.html');
  });
});
