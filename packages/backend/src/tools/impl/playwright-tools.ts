import { z } from 'zod';
import type { ToolDef } from '../types.js';
import type { ProjectTestsRepo, ProjectTestRunsRepo } from '../../db/repos/project-tests.js';
import type { ProjectFilesRepo } from '../../db/repos/project-files.js';
import type { MessagesRepo } from '../../db/repos/messages.js';
import type { JobQueueClient } from '../../workers/queue.js';
import type { FlagsRepo } from '../../db/repos/flags.js';

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 60_000;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function generateSpec(intent: string, baseUrl: string): string {
  return `import { test, expect } from '@playwright/test';

// Intent: ${intent}
test('${intent}', async ({ page }) => {
  await page.goto('${baseUrl}');
  await page.waitForLoadState('networkidle');

  // TODO: replace with assertions that match the intent above.
  // Use getByRole, getByLabel, getByText — avoid CSS selectors.
  // Example:
  //   await page.getByRole('button', { name: /submit/i }).click();
  //   await expect(page.getByRole('alert')).toContainText('Success');
  await expect(page).toHaveTitle(/.+/);
});
`;
}

export function createPlaywrightTools(
  projectTests: ProjectTestsRepo,
  projectTestRuns: ProjectTestRunsRepo,
  projectFiles: ProjectFilesRepo,
  messages: MessagesRepo,
  jobs: JobQueueClient,
  flags: FlagsRepo
): ToolDef[] {
  const proposeAcceptanceTest: ToolDef = {
    name: 'propose_acceptance_test',
    description:
      'Propose an acceptance test for a user intent before writing application code. ' +
      'Creates a Playwright spec inside the project at e2e/<slug>.spec.ts and returns the test_id.',
    safety: 'write',
    inputSchema: z.object({
      intent: z.string().trim().min(1).max(500),
      project_id: z.string().uuid(),
      preview_base_url: z.string().url().optional(),
    }),
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          description: 'The user intent phrase verbatim (e.g. "user can log in with email and password")',
        },
        project_id: { type: 'string', description: 'Project UUID' },
        preview_base_url: {
          type: 'string',
          description: 'Preview base URL (e.g. http://localhost:5001/preview/PROJECT_ID). Defaults to a placeholder.',
        },
      },
      required: ['intent', 'project_id'],
    },
    execute: async (args, ctx) => {
      if (flags.get('validation.playwright_enabled')?.value !== 'true') {
        return 'Playwright validation is disabled (validation.playwright_enabled=false). Skipping test proposal.';
      }
      const intent = String(args['intent'] ?? '').trim();
      const projectId = String(args['project_id'] ?? '').trim() || ctx.projectId;
      if (!projectId) return 'Error: project_id is required';

      const baseUrl = String(args['preview_base_url'] ?? `http://localhost:5001/preview/${projectId}`);
      const slug = slugify(intent);
      const specPath = `e2e/${slug}.spec.ts`;
      const specContent = generateSpec(intent, baseUrl);

      projectFiles.upsert(projectId, specPath, specContent, 'typescript');

      const test = projectTests.create({
        projectId,
        source: 'acceptance',
        title: intent,
        intent,
        specPath,
        ...(ctx.agentRunId !== undefined ? { createdByRunId: ctx.agentRunId } : {}),
      });

      return JSON.stringify({ test_id: test.id, spec_path: specPath });
    },
  };

  const runProjectTests: ToolDef = {
    name: 'run_project_tests',
    description:
      'Run one or more project tests against the live preview and wait for results. ' +
      'Returns pass/fail status and evidence for each test.',
    safety: 'write',
    inputSchema: z.object({
      test_ids: z.array(z.string().uuid()).min(1).max(10),
      project_id: z.string().uuid(),
    }),
    parameters: {
      type: 'object',
      properties: {
        test_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of test UUIDs to run (from propose_acceptance_test)',
        },
        project_id: { type: 'string', description: 'Project UUID' },
      },
      required: ['test_ids', 'project_id'],
    },
    execute: async (args, ctx) => {
      if (flags.get('validation.playwright_enabled')?.value !== 'true') {
        return 'Playwright validation is disabled (validation.playwright_enabled=false). Skipping test run.';
      }
      const testIds = (args['test_ids'] as string[]) ?? [];
      const projectId = String(args['project_id'] ?? '').trim() || ctx.projectId;
      if (!projectId) return 'Error: project_id is required';

      const runs = testIds.map((testId) => {
        const run = projectTestRuns.create({
          projectId,
          testId,
          ...(ctx.agentRunId !== undefined ? { agentRunId: ctx.agentRunId } : {}),
        });
        jobs.enqueue('validate-with-playwright', { projectId, testId, runId: run.id });
        return { testId, runId: run.id };
      });

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      const results: Array<{ test_id: string; status: string; error_excerpt: string | null; screenshot_blob_hash: string | null }> = [];

      for (const { testId, runId } of runs) {
        while (Date.now() < deadline) {
          if (ctx.signal?.aborted) return 'Aborted';
          const run = projectTestRuns.findById(runId);
          if (run && run.status !== 'pending') {
            results.push({
              test_id: testId,
              status: run.status,
              error_excerpt: run.error_excerpt,
              screenshot_blob_hash: run.evidence_screenshot_hash,
            });
            break;
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
        if (!results.find((r) => r.test_id === testId)) {
          results.push({ test_id: testId, status: 'timed_out', error_excerpt: 'Poll timeout after 60s', screenshot_blob_hash: null });
        }
      }

      return JSON.stringify(results);
    },
  };

  const attachEvidenceToMessage: ToolDef = {
    name: 'attach_evidence_to_message',
    description:
      'Attach test run evidence (screenshot + status) to a closing assistant message. ' +
      'Call this after a test passes to give the user visible proof.',
    safety: 'write',
    inputSchema: z.object({
      message_id: z.string().uuid(),
      test_run_id: z.string().uuid(),
    }),
    parameters: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'ID of the closing assistant message' },
        test_run_id: { type: 'string', description: 'ID of the project_test_run to attach' },
      },
      required: ['message_id', 'test_run_id'],
    },
    execute: async (args) => {
      if (flags.get('validation.attach_evidence_to_messages')?.value !== 'true') {
        return 'Evidence attachment disabled (validation.attach_evidence_to_messages=false).';
      }
      const messageId = String(args['message_id'] ?? '').trim();
      const testRunId = String(args['test_run_id'] ?? '').trim();
      if (!messageId || !testRunId) return 'Error: message_id and test_run_id are required';

      const run = projectTestRuns.findById(testRunId);
      if (!run) return `Error: test run ${testRunId} not found`;

      const test = projectTests.findById(run.test_id);
      if (!test) return `Error: test ${run.test_id} not found`;

      messages.attachEvidence(messageId, {
        test_run_id: run.id,
        status: run.status === 'passed' ? 'passed' : 'failed',
        screenshot_blob_hash: run.evidence_screenshot_hash,
        video_blob_hash: run.evidence_video_hash,
        test_title: test.title,
        ...(run.error_excerpt ? { error_excerpt: run.error_excerpt } : {}),
      });

      return JSON.stringify({ ok: true, status: run.status });
    },
  };

  return [proposeAcceptanceTest, runProjectTests, attachEvidenceToMessage];
}
