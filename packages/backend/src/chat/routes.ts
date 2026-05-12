import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware.js';
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
import type { HonoEnv } from '../types.js';
import type { OllamaMessage } from '../ollama/types.js';

interface ProjectContext {
  id: string;
  name: string;
  description: string | null;
  screens: Array<{ name: string; path: string }>;
  files: Array<{ path: string; language: string }>;
}

function buildSystemPrompt(workspaceRoot: string, project?: ProjectContext): string {
  const date = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
  let prompt = `You are DevMind, a local AI full-stack development assistant. You help users build web applications by generating code, writing files, and managing project structure.

Workspace: ${workspaceRoot}
Date: ${date}`;

  if (project) {
    prompt += `\n\n## Active Project: ${project.name}`;
    if (project.description) prompt += `\n${project.description}`;
    if (project.screens.length > 0) {
      prompt += `\n\nScreens:\n${project.screens.map((s) => `- ${s.name} (${s.path})`).join('\n')}`;
    }
    if (project.files.length > 0) {
      prompt += `\n\nExisting project files:\n${project.files.map((f) => `- ${f.path} (${f.language})`).join('\n')}`;
    } else {
      prompt += `\n\nNo files in project yet.`;
    }
  }

  prompt += `

## Your Role
You are a full-stack app builder. When asked to build or modify an app, you MUST use write_project_file to generate actual code files.

## App Generation Rules
- Generate self-contained HTML apps (index.html with inline CSS and JS) unless the user asks for a specific framework
- The generated app is served directly in the browser preview — it must work as static HTML/CSS/JS
- Always create at least index.html as the entry point
- Use modern, clean design with inline styles — avoid external CDN dependencies when possible
- When asked to "build" or "generate" or "create" an app, always call write_project_file immediately

## Available Tools
- write_project_file: Write/update a file in the project (MAIN tool for code generation)
- read_project_file: Read an existing project file
- list_project_files: List all project files
- file_read: Read workspace files
- file_list: List workspace directories
- search_code: Search code with regex
- run_command: Execute shell commands
- vector_search: Semantic search over codebase

## Guidelines
- After writing files, tell the user what was created and that the preview is ready
- Be concise. Generate code immediately without asking for confirmation
- For multi-page apps, generate all HTML files and link them together`;

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
}

export function createChatRouter(deps: ChatRouterDeps): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/', authMiddleware, async (c) => {
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
      projectCtx = {
        id: projectId,
        name: project.name,
        description: project.description,
        screens: projectScreens.map((s) => ({ name: s.name, path: s.path })),
        files: projectFiles.map((f) => ({ path: f.path, language: f.language })),
      };
    }

    const userMsg = deps.messages.create(sessionId, 'user', content);

    const history = deps.messages.findBySession(sessionId, HISTORY_LIMIT);
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

      const registry = createToolRegistry(
        {
          sessions: deps.sessions,
          messages: deps.messages,
          tasks: deps.tasks,
          storage: deps.storage,
          projectFiles: deps.projectFiles,
        },
        userId
      );

      await runAgentLoop({
        model,
        messages: ollamaMessages,
        registry,
        ctx: {
          userId,
          sessionId,
          workspaceRoot: config.WORKSPACE_ROOT,
          ...(projectId !== undefined ? { projectId } : {}),
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
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({ messageId: assistantMsg.id, agentRunId: agentRun.id }),
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
