import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware.js';
import { rateLimitMiddleware } from '../auth/rate-limit.js';
import { runAgentLoop } from '../agent/loop.js';
import { createToolRegistry } from '../tools/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { SessionsRepo } from '../db/repos/sessions.js';
import type { MessagesRepo } from '../db/repos/messages.js';
import type { TasksRepo } from '../db/repos/tasks.js';
import type { AgentRunsRepo } from '../db/repos/agent-runs.js';
import type { StorageService } from '../storage/storage.js';
import type { ProjectsRepo } from '../db/repos/projects.js';
import type { ScreensRepo } from '../db/repos/screens.js';
import type { ProjectFilesRepo } from '../db/repos/project-files.js';
import type { SettingsRepo } from '../db/repos/settings.js';
import type { ProjectManifestsRepo, ProjectManifestView } from '../db/repos/project-manifests.js';
import type { ProjectServicesRepo, ProjectServiceView } from '../db/repos/project-services.js';
import type { ProjectApiRoutesRepo, ProjectApiRouteView } from '../db/repos/project-api-routes.js';
import type { ProjectDbSchemasRepo, ProjectDbMigrationsRepo, ProjectDbSchemaView, ProjectDbMigration } from '../db/repos/project-database.js';
import type { ProjectEnvVarsRepo, ProjectEnvVarView } from '../db/repos/project-env-vars.js';
import type {
  ProjectValidationReportsRepo,
  ProjectRuntimeInstancesRepo,
  ProjectValidationReportView,
  ProjectRuntimeInstanceView,
} from '../db/repos/project-validation-runtime.js';
import type { JobQueueClient } from '../workers/queue.js';
import type { ProjectSnapshotsRepo, ProjectSnapshotView } from '../db/repos/project-snapshots.js';
import type { ProjectTestsRepo, ProjectTestRunsRepo } from '../db/repos/project-tests.js';
import type { ToolCallAuditRepo } from '../db/repos/tool-call-audit.js';
import type { FlagsRepo } from '../db/repos/flags.js';
import { snapshotStateHash } from '../db/repos/project-snapshots.js';
import type { HonoEnv } from '../types.js';
import type { OllamaMessage } from '../ollama/types.js';

interface ProjectContext {
  id: string;
  name: string;
  description: string | null;
  screens: Array<{ name: string; path: string }>;
  files: Array<{ path: string; language: string }>;
  manifest?: ProjectManifestView;
  services: ProjectServiceView[];
  apiRoutes: ProjectApiRouteView[];
  dbSchemas: ProjectDbSchemaView[];
  dbMigrations: ProjectDbMigration[];
  envVars: ProjectEnvVarView[];
  validationReports: ProjectValidationReportView[];
  runtime?: ProjectRuntimeInstanceView;
  snapshots: ProjectSnapshotView[];
}

function buildSystemPrompt(workspaceRoot: string, project?: ProjectContext): string {
  const date = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
  const isEmptyProject = project ? project.files.length === 0 && project.screens.length === 0 : false;
  let prompt = `You are DevMind, a local AI full-stack development assistant. You help users build web applications by generating code, writing files, and managing project structure.

Workspace: ${workspaceRoot}
Date: ${date}`;

  if (project) {
    prompt += `\n\n## Active Project: ${project.name}`;
    if (project.description && !isEmptyProject) prompt += `\n${project.description}`;
    if (project.screens.length > 0) {
      prompt += `\n\nScreens:\n${project.screens.map((s) => `- ${s.name} (${s.path})`).join('\n')}`;
    }
    if (project.files.length > 0) {
      prompt += `\n\nExisting project files:\n${project.files.map((f) => `- ${f.path} (${f.language})`).join('\n')}`;
    } else {
      prompt += `\n\nNo files in project yet.`;
    }
    if (project.manifest) {
      prompt += `\n\nProject manifest:\n${JSON.stringify({
        appType: project.manifest.app_type,
        stack: project.manifest.stack,
        commands: project.manifest.commands,
        entrypoints: project.manifest.entrypoints,
      }, null, 2)}`;
    } else {
      prompt += `\n\nNo project manifest yet.`;
    }
    if (project.services.length > 0) {
      prompt += `\n\nProject services:\n${project.services.map((s) => `- ${s.kind}: ${s.name} (${s.runtime}, ${s.root_path}, status ${s.status})`).join('\n')}`;
    } else {
      prompt += `\n\nNo project services yet.`;
    }
    if (project.apiRoutes.length > 0) {
      prompt += `\n\nProject API routes:\n${project.apiRoutes.map((route) => `- ${route.method} ${route.path} -> ${route.handler_path}`).join('\n')}`;
    } else {
      prompt += `\n\nNo project API routes yet.`;
    }
    if (project.dbSchemas.length > 0) {
      prompt += `\n\nProject database schemas:\n${project.dbSchemas.map((schema) => `- ${schema.name} (${schema.engine})`).join('\n')}`;
    } else {
      prompt += `\n\nNo project database schema yet.`;
    }
    if (project.envVars.length > 0) {
      prompt += `\n\nProject env vars:\n${project.envVars.map((envVar) => `- ${envVar.name}${envVar.required ? ' (required)' : ''}${envVar.secret_ref ? ' secret_ref' : ''}`).join('\n')}`;
    } else {
      prompt += `\n\nNo project env vars yet.`;
    }
    if (project.validationReports.length > 0) {
      const latest = project.validationReports[0];
      if (latest) prompt += `\n\nLatest validation report: ${latest.status}`;
    } else {
      prompt += `\n\nNo validation reports yet.`;
    }
    if (project.runtime) {
      prompt += `\n\nRuntime status: ${project.runtime.status} frontend=${project.runtime.frontend_url ?? 'none'} backend=${project.runtime.backend_url ?? 'none'}`;
    } else {
      prompt += `\n\nNo runtime instance yet.`;
    }
    prompt += `\n\nProject snapshots: ${project.snapshots.length}`;
    if (isEmptyProject) {
      prompt += `\n\nThis project is currently empty. Ignore any stale prior intent associated with this project and treat the current user prompt as the sole source of truth for what to build next.`;
    }
  }

  prompt += `

## Your Role
You are a full-stack app builder. When asked to build or modify an app, you MUST use write_project_file to generate actual code files.

## App Generation Rules
- Generate modular apps by default, not a single monolithic file
- Unless the user asks for a specific framework, generate a static modular web app using multiple files
- The default minimum structure is:
  - index.html
  - styles.css
  - app.js
- For non-trivial apps, split code into additional files such as:
  - components/*.js
  - pages/*.js
  - utils/*.js
  - data/*.js
- The generated app is served directly in the browser preview — it must work as static HTML/CSS/JS
- Always create at least index.html as the entry point and link the other generated files correctly
- Prefer separate CSS and JS files over inline <style> and <script> blocks unless the user explicitly asks for a single-file artifact
- Use modern, clean design — avoid external CDN dependencies when possible
- When asked to "build" or "generate" or "create" an app, always call write_project_file immediately
- If the request is generic (for example: "build the app", "create the app", "make the app"), you must still build immediately and choose a sensible default product direction instead of asking follow-up questions
- Do NOT answer with a plan first when the user is asking to build the app
- Do NOT explore the workspace or ask for more context first unless the user explicitly requests exploration
- Do NOT ask the user what they want to build if they have already asked you to build the app
- Do NOT reply with readiness/help text; your response must be implementation work via write_project_file
- For a new project, your first actions should create the modular file structure immediately, starting with index.html and then the linked CSS/JS files

## Available Tools
- write_project_file: Write/update a file in the project (MAIN tool for code generation)
- read_project_file: Read an existing project file
- list_project_files: List all project files
- propose_acceptance_test: (when validation enabled) Propose a Playwright spec for a user intent before writing code. Always call this first when validation.playwright_enabled is on.
- run_project_tests: (when validation enabled) Run proposed tests against the live preview and get pass/fail + screenshot evidence.
- attach_evidence_to_message: (when validation enabled) Attach test run evidence to the closing assistant message.
- read_project_manifest: Read the structured full-stack project manifest
- update_project_manifest: Create or update the structured full-stack project manifest
- create_project_service: Create a frontend, backend, or worker service owned by the project
- upsert_api_route: Create/update a structured API route and handler path
- upsert_database_schema: Create/update a generated database schema
- create_database_migration: Create a generated database migration
- upsert_env_var: Create/update generated app environment variable requirements without storing raw secrets
- request_project_validation: Queue validation for the active project
- create_project_snapshot: Capture current manifest, file tree, and resource graph metadata
- file_read: Read workspace files
- file_list: List workspace directories
- search_code: Search code with regex
- run_command: Execute shell commands
- vector_search: Semantic search over codebase

## Guidelines
- After writing files, tell the user what was created and that the preview is ready
- Be concise. Generate code immediately without asking for confirmation
- For multi-page apps, generate all HTML files and link them together
- If the project has no files yet and the user asks to build something, create the first working version immediately
- If the current prompt is generic, choose a polished starter app and implement it immediately
- Default to maintainable modular code organization even for small apps

## Playwright Validation (when validation.playwright_enabled is on)
When the feature flag validation.playwright_enabled is active, follow this order for every code generation task:
1. Call propose_acceptance_test with the user's intent verbatim.
2. Write or edit code using write_project_file.
3. Call run_project_tests with the test_id from step 1.
4. If tests pass: call attach_evidence_to_message with the closing message_id and the test_run_id.
5. If tests fail and you have attempts remaining (max 3 total): read the error_excerpt and fix the code, then go back to step 3.
6. If all 3 attempts fail: report honest failure to the user with the error_excerpt and screenshot evidence.

Well-formed acceptance tests use only role/label/text locators:
- await page.getByRole('button', { name: /submit/i }).click();
- await expect(page.getByRole('heading')).toContainText('Dashboard');
- await page.getByLabel('Email').fill('user@example.com');
- await expect(page.getByText('Login successful')).toBeVisible();

## Language
- Always reply in the same language the user is writing in. If the user writes in Spanish, reply in Spanish; if in English, reply in English; and so on for any other language.
- This applies only to your conversational reply text. Code, file names, identifiers, and tool arguments must stay in their natural language (typically English) regardless of the conversation language.`;

  return prompt;
}

const HISTORY_LIMIT = 40;

const ChatBodySchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1).max(10_000),
  projectId: z.string().min(1).optional(),
});

export interface ChatRouterDeps {
  sessions: SessionsRepo;
  messages: MessagesRepo;
  tasks: TasksRepo;
  agentRuns: AgentRunsRepo;
  storage: StorageService;
  projects: ProjectsRepo;
  screens: ScreensRepo;
  projectFiles: ProjectFilesRepo;
  settings: SettingsRepo;
  projectManifests: ProjectManifestsRepo;
  projectServices: ProjectServicesRepo;
  projectApiRoutes: ProjectApiRoutesRepo;
  projectDbSchemas: ProjectDbSchemasRepo;
  projectDbMigrations: ProjectDbMigrationsRepo;
  projectEnvVars: ProjectEnvVarsRepo;
  projectValidationReports: ProjectValidationReportsRepo;
  projectRuntimeInstances: ProjectRuntimeInstancesRepo;
  projectSnapshots: ProjectSnapshotsRepo;
  projectTests: ProjectTestsRepo;
  projectTestRuns: ProjectTestRunsRepo;
  jobs: JobQueueClient;
  // Spec 006 — for the audit log + autonomy gate.
  toolAudit: ToolCallAuditRepo;
  flags: FlagsRepo;
}

export function createChatRouter(deps: ChatRouterDeps): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/', rateLimitMiddleware, authMiddleware, async (c) => {
    const userId = c.get('userId');

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = ChatBodySchema.safeParse(bodyRaw);
    if (!parsed.success) {
      logger.warn({ userId, errors: parsed.error.flatten() }, 'Chat: invalid request body');
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const { sessionId, content, projectId } = parsed.data;
    logger.info({ userId, sessionId, projectId, contentLength: content.length }, 'Chat: message received');

    const model = deps.settings.get('ollama.coding_model') ?? config.OLLAMA_CODING_MODEL;

    const session = deps.sessions.findById(userId, sessionId);
    if (!session) {
      logger.warn({ userId, sessionId }, 'Chat: session not found');
      return c.json({ error: 'Session not found' }, 404);
    }

    let projectCtx: ProjectContext | undefined;
    if (projectId) {
      const project = deps.projects.findById(userId, projectId);
      if (!project) return c.json({ error: 'Project not found' }, 404);
      const projectScreens = deps.screens.findByProject(projectId);
      const projectFiles = deps.projectFiles.findByProject(projectId);
      const manifest = deps.projectManifests.findByProject(projectId);
      const services = deps.projectServices.findByProject(projectId);
      const apiRoutes = deps.projectApiRoutes.findByProject(projectId);
      const dbSchemas = deps.projectDbSchemas.findByProject(projectId);
      const dbMigrations = deps.projectDbMigrations.findByProject(projectId);
      const envVars = deps.projectEnvVars.findByProject(projectId);
      const validationReports = deps.projectValidationReports.findByProject(projectId, 5);
      const runtime = deps.projectRuntimeInstances.findByProject(projectId);
      const snapshots = deps.projectSnapshots.findByProject(projectId, 5);
      projectCtx = {
        id: projectId,
        name: project.name,
        description: project.description,
        screens: projectScreens.map((s) => ({ name: s.name, path: s.path })),
        files: projectFiles.map((f) => ({ path: f.path, language: f.language })),
        ...(manifest ? { manifest } : {}),
        services,
        apiRoutes,
        dbSchemas,
        dbMigrations,
        envVars,
        validationReports,
        ...(runtime ? { runtime } : {}),
        snapshots,
      };
    }

    const userMsg = deps.messages.create(sessionId, 'user', content);

    const history = projectId
      ? []
      : deps.messages.findBySession(sessionId, HISTORY_LIMIT);
    const ollamaMessages: OllamaMessage[] = [
      { role: 'system', content: buildSystemPrompt(config.WORKSPACE_ROOT, projectCtx) },
      ...history.map((m) => ({
        role: m.role as OllamaMessage['role'],
        content: m.content,
      })),
    ];

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      c.req.raw.signal.addEventListener('abort', () => abort.abort());

      let assistantContent = '';

      await stream.writeSSE({
        event: 'user_message',
        data: JSON.stringify({ messageId: userMsg.id }),
      });

      const agentRun = deps.agentRuns.create(sessionId, userId, model);
      logger.info({ agentRunId: agentRun.id, sessionId, model, historyLength: history.length }, 'Chat: agent run started');

      // Spec 004 — Phase 4: auto-capture pre-snapshot.
      // Captures the project state before the agent runs so we have a guaranteed
      // rollback target if the run goes wrong. Failure here must not abort the
      // agent run — the user should still get their response.
      let preSnapshotId: string | null = null;
      let preStateHash: string | null = null;
      if (projectId !== undefined && deps.projectSnapshots.isAutoCaptureEnabled()) {
        try {
          const pre = deps.projectSnapshots.capture(projectId, null, null, {
            trigger: 'auto-pre-agent',
            agentRunId: agentRun.id,
          });
          preSnapshotId = pre.id;
          preStateHash = snapshotStateHash(pre);
        } catch (err) {
          logger.warn({ err, projectId, agentRunId: agentRun.id }, 'auto-pre-agent snapshot failed');
        }
      }

      const registry = createToolRegistry(
        {
          sessions: deps.sessions,
          messages: deps.messages,
          tasks: deps.tasks,
          storage: deps.storage,
          flags: deps.flags,
          projectFiles: deps.projectFiles,
          projectTests: deps.projectTests,
          projectTestRuns: deps.projectTestRuns,
          projectManifests: deps.projectManifests,
          projectServices: deps.projectServices,
          projectApiRoutes: deps.projectApiRoutes,
          projectDbSchemas: deps.projectDbSchemas,
          projectDbMigrations: deps.projectDbMigrations,
          projectEnvVars: deps.projectEnvVars,
          projectSnapshots: deps.projectSnapshots,
          jobs: deps.jobs,
        },
        userId,
        { projectBuilderOnly: projectId !== undefined }
      );

      await runAgentLoop({
        model,
        messages: ollamaMessages,
        registry,
        toolAudit: deps.toolAudit,
        flags: deps.flags,
        ...(projectId !== undefined && { projectId }),
        ctx: {
          userId,
          sessionId,
          workspaceRoot: config.WORKSPACE_ROOT,
          agentRunId: agentRun.id,
          ...(projectId !== undefined ? { projectId } : {}),
          ...((() => { const t = c.get('traceId' as never) as string | undefined; return t ? { traceId: t } : {}; })()),
          signal: abort.signal,
        },
        callbacks: {
          async onIterationStart(iteration, model, messages, toolCount) {
            logger.info({ iteration, model, messagesCount: messages.length, toolCount }, 'Chat: agent iteration started');
            const truncated = messages.map((m) => ({
              ...m,
              content: m.content.length > 2000 ? m.content.slice(0, 2000) + '\n…[truncated]' : m.content,
            }));
            await stream.writeSSE({
              event: 'agent_request',
              data: JSON.stringify({ iteration, model, messages: truncated, toolCount }),
            });
          },
          async onToken(chunk) {
            assistantContent += chunk;
            await stream.writeSSE({ event: 'token', data: JSON.stringify({ content: chunk }) });
          },
          async onToolCall(name, args) {
            logger.info({ tool: name, args }, 'Chat: tool call');
            await stream.writeSSE({ event: 'tool_call', data: JSON.stringify({ name, args }) });
          },
          async onToolResult(result) {
            logger.info({ tool: result.name, error: result.error }, 'Chat: tool result');
            deps.messages.create(sessionId, 'tool', result.content, agentRun.id);
            await stream.writeSSE({
              event: 'tool_result',
              data: JSON.stringify({ name: result.name, content: result.content, error: result.error }),
            });
          },
          async onDone(iterations) {
            logger.info({ agentRunId: agentRun.id, iterations, responseLength: assistantContent.length }, 'Chat: agent run completed');
            deps.agentRuns.finish(agentRun.id, iterations);
            const assistantMsg = deps.messages.create(
              sessionId,
              'assistant',
              assistantContent || '(empty response)',
              agentRun.id
            );

            // Spec 004 — Phase 4: auto-capture post-snapshot.
            // Capture current state, compare against pre to detect mutation, and
            // discard the post snapshot if nothing changed (keeps the timeline
            // clean). On mutation, prune ephemerals to honor retention policy.
            // Errors must not drop the agent run result already sent above.
            let postSnapshotId: string | null = null;
            if (projectId !== undefined && preStateHash !== null && deps.projectSnapshots.isAutoCaptureEnabled()) {
              try {
                const post = deps.projectSnapshots.capture(projectId, null, null, {
                  trigger: 'auto-post-agent',
                  agentRunId: agentRun.id,
                  messageId: assistantMsg.id,
                  parentSnapshotId: preSnapshotId,
                });
                const postHash = snapshotStateHash(post);
                if (postHash === preStateHash) {
                  deps.projectSnapshots.discard(post.id);
                } else {
                  postSnapshotId = post.id;
                  // Spec 005 — attach screenshot from latest passing test run to snapshot thumbnail
                  try {
                    const screenshotHash = deps.projectTestRuns.findLatestPassingScreenshotForRun(projectId, agentRun.id);
                    if (screenshotHash) {
                      deps.projectSnapshots.updateMetadata(post.id, { screenshotBlobHash: screenshotHash });
                    }
                  } catch (err) {
                    logger.warn({ err }, 'snapshot thumbnail patch failed');
                  }
                  try {
                    deps.projectSnapshots.prune(projectId);
                  } catch (err) {
                    logger.warn({ err, projectId }, 'snapshot prune failed');
                  }
                }
              } catch (err) {
                logger.warn({ err, projectId, agentRunId: agentRun.id }, 'auto-post-agent snapshot failed');
              }
            }

            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({
                messageId: assistantMsg.id,
                agentRunId: agentRun.id,
                ...(postSnapshotId ? { snapshotId: postSnapshotId } : {}),
              }),
            });
          },
          async onError(err, iterations) {
            deps.agentRuns.fail(agentRun.id, err.message, iterations);
            logger.error({ err, sessionId, userId, agentRunId: agentRun.id }, 'Chat agent error');
            await stream
              .writeSSE({ event: 'error', data: JSON.stringify({ message: err.message }) })
              .catch(() => null);
          },
        },
      });

      if (abort.signal.aborted) {
        logger.info({ agentRunId: agentRun.id }, 'Chat: client disconnected, aborting');
        const run = deps.agentRuns.findById(agentRun.id);
        if (run?.status === 'running') deps.agentRuns.cancel(agentRun.id);
      }
    });
  });

  return router;
}
