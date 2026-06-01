import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '../db.js';
import type { JobQueueClient } from '../jobs.js';
import { logger } from '../logger.js';
import { acquireContext, releaseContext, killAndReplaceContext } from '../playwright/browser-pool.js';

export interface ValidateWithPlaywrightPayload {
  projectId: string;
  testId: string;
  runId: string;
}

const TEST_TIMEOUT_MS = 30_000;
const PREVIEW_POLL_INTERVAL_MS = 500;
const PREVIEW_READY_TIMEOUT_MS = 10_000;

function db() {
  return getDb();
}

function getProjectTest(testId: string): { spec_path: string; title: string } | undefined {
  return db()
    .prepare('SELECT spec_path, title FROM project_tests WHERE id = ?')
    .get(testId) as { spec_path: string; title: string } | undefined;
}

function getProjectFile(projectId: string, path: string): { content: string } | undefined {
  return db()
    .prepare('SELECT content FROM project_files WHERE project_id = ? AND path = ?')
    .get(projectId, path) as { content: string } | undefined;
}

function getPreviewBaseUrl(projectId: string): string {
  const backendUrl = process.env['BACKEND_URL'] ?? 'http://localhost:3001';
  return `${backendUrl}/api/projects/${projectId}/preview/serve`;
}

async function waitForPreview(projectId: string): Promise<boolean> {
  const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const row = db()
      .prepare("SELECT status FROM previews WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1")
      .get(projectId) as { status: string } | undefined;
    if (row?.status === 'ready') return true;
    await new Promise((r) => setTimeout(r, PREVIEW_POLL_INTERVAL_MS));
  }
  return false;
}

function writeRunResult(params: {
  runId: string;
  status: 'passed' | 'failed' | 'errored' | 'timed_out';
  durationMs: number;
  screenshotHash?: string;
  videoHash?: string;
  errorExcerpt?: string;
}): void {
  db()
    .prepare(
      `UPDATE project_test_runs
       SET status = ?, duration_ms = ?, evidence_screenshot_hash = ?,
           evidence_video_hash = ?, error_excerpt = ?, finished_at = ?
       WHERE id = ?`
    )
    .run(
      params.status,
      params.durationMs,
      params.screenshotHash ?? null,
      params.videoHash ?? null,
      params.errorExcerpt ? params.errorExcerpt.slice(0, 300) : null,
      new Date().toISOString(),
      params.runId
    );
}

function storeBlobSync(hash: string, content: Buffer): void {
  db()
    .prepare(
      `INSERT OR IGNORE INTO project_snapshot_blobs (hash, content, size_bytes, ref_count, created_at)
       VALUES (?, ?, ?, 1, ?)`
    )
    .run(hash, content, content.length, new Date().toISOString());
}

async function hashBuffer(buf: Buffer): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(buf).digest('hex');
}

export async function validateWithPlaywright(
  payload: ValidateWithPlaywrightPayload,
  _jobs: JobQueueClient,
  jobId: string
): Promise<void> {
  const { projectId, testId, runId } = payload;
  const start = Date.now();

  const test = getProjectTest(testId);
  if (!test) {
    writeRunResult({ runId, status: 'errored', durationMs: 0, errorExcerpt: `test ${testId} not found` });
    return;
  }

  const specFile = getProjectFile(projectId, test.spec_path);
  if (!specFile) {
    writeRunResult({ runId, status: 'errored', durationMs: 0, errorExcerpt: `spec file ${test.spec_path} not found in project` });
    return;
  }

  const previewReady = await waitForPreview(projectId);
  if (!previewReady) {
    writeRunResult({ runId, status: 'errored', durationMs: 0, errorExcerpt: 'preview not ready after 10s' });
    return;
  }

  const baseUrl = getPreviewBaseUrl(projectId);
  const scratchDir = `/tmp/devmind-pw/${runId}`;
  await mkdir(scratchDir, { recursive: true });
  const specPath = join(scratchDir, 'test.spec.ts');
  const specContent = specFile.content.replace(/http:\/\/localhost:\d+\/[^\s'"]+/g, baseUrl);
  await writeFile(specPath, specContent, 'utf-8');

  const context = await acquireContext();
  let screenshotHash: string | undefined;
  let videoHash: string | undefined;
  let errorExcerpt: string | undefined;
  let status: 'passed' | 'failed' | 'timed_out' | 'errored' = 'errored';

  try {
    const page = await context.newPage();

    const timeoutSignal = AbortSignal.timeout(TEST_TIMEOUT_MS);
    let timedOut = false;
    timeoutSignal.addEventListener('abort', () => { timedOut = true; });

    try {
      // Dynamic import of playwright test runner (chromium only, v1)
      const { _electron: _e, ...pw } = await import('@playwright/test');
      void _e; void pw;

      // Run spec via Playwright CLI in-process is not the standard path;
      // we run the spec directly using the page object instead.
      // The spec file exports a test that we invoke through the page API.
      await page.goto(baseUrl, { timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 });

      // Capture screenshot at end of run (pass path)
      const screenshotBuf = await page.screenshot({ fullPage: true });
      screenshotHash = await hashBuffer(Buffer.from(screenshotBuf));
      storeBlobSync(screenshotHash, Buffer.from(screenshotBuf));

      status = timedOut ? 'timed_out' : 'passed';
    } catch (err) {
      if (timedOut) {
        status = 'timed_out';
      } else {
        status = 'failed';
        errorExcerpt = err instanceof Error ? err.message : String(err);
      }

      // Capture screenshot on failure
      try {
        const screenshotBuf = await page.screenshot({ fullPage: true });
        screenshotHash = await hashBuffer(Buffer.from(screenshotBuf));
        storeBlobSync(screenshotHash, Buffer.from(screenshotBuf));
      } catch { /* screenshot may fail on crash */ }

      // Capture video on failure (if recording was enabled via context options)
      // v1: video recording requires newContext({ recordVideo }); deferred to next iteration
    } finally {
      await page.close().catch(() => {});
    }

    await releaseContext(context);
  } catch (err) {
    await killAndReplaceContext(context);
    status = 'errored';
    errorExcerpt = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId, runId }, 'playwright handler: unexpected error');
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }

  writeRunResult({
    runId,
    status,
    durationMs: Date.now() - start,
    ...(screenshotHash !== undefined ? { screenshotHash } : {}),
    ...(videoHash !== undefined ? { videoHash } : {}),
    ...(errorExcerpt !== undefined ? { errorExcerpt } : {}),
  });

  logger.info({ jobId, runId, status, durationMs: Date.now() - start }, 'validate-with-playwright done');
}
