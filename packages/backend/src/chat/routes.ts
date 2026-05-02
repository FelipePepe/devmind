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
import type { HonoEnv } from '../types.js';
import type { OllamaMessage } from '../ollama/types.js';

function buildSystemPrompt(workspaceRoot: string): string {
  const date = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
  return `You are DevMind, a local AI coding assistant embedded in a developer workspace.

Workspace: ${workspaceRoot}
Date: ${date}

Your capabilities:
- file_read: Read files from the workspace
- file_list: List files and directories  
- search_code: Search code with regex/pattern
- run_command: Execute shell commands in the workspace
- vector_search: Semantic search over indexed code

Guidelines:
- When asked to write code, produce complete, working files
- Wrap code in markdown code blocks with the language: \`\`\`typescript\\n...\`\`\`
- For file paths, add a comment on the first line: // path/to/file.ts
- Use your tools to read existing code before modifying it
- Be concise. Prefer code over prose.`;
}

const HISTORY_LIMIT = 40;

const ChatBodySchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1).max(10_000),
});

export interface ChatRouterDeps {
  sessions: SessionsRepo;
  messages: MessagesRepo;
  tasks: TasksRepo;
  agentRuns: AgentRunsRepo;
  storage: StorageService;
}

export function createChatRouter(deps: ChatRouterDeps): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/', authMiddleware, async (c) => {
    const userId = c.get('userId');

    const bodyRaw = await c.req.json<unknown>().catch(() => null);
    const parsed = ChatBodySchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const { sessionId, content } = parsed.data;

    const session = deps.sessions.findById(userId, sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    // Persist user message before starting stream
    const userMsg = deps.messages.create(sessionId, 'user', content);

    // Build message history for Ollama
    const history = deps.messages.findBySession(sessionId, HISTORY_LIMIT);
    const ollamaMessages: OllamaMessage[] = [
      { role: 'system', content: buildSystemPrompt(config.WORKSPACE_ROOT) },
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

      // Create agent run record
      const agentRun = deps.agentRuns.create(sessionId, userId, config.OLLAMA_CODING_MODEL);

      const registry = createToolRegistry(
        { sessions: deps.sessions, messages: deps.messages, tasks: deps.tasks, storage: deps.storage },
        userId
      );

      await runAgentLoop({
        model: config.OLLAMA_CODING_MODEL,
        messages: ollamaMessages,
        registry,
        ctx: {
          userId,
          sessionId,
          workspaceRoot: config.WORKSPACE_ROOT,
          signal: abort.signal,
        },
        callbacks: {
          async onToken(chunk) {
            assistantContent += chunk;
            await stream.writeSSE({ event: 'token', data: JSON.stringify({ content: chunk }) });
          },
          async onToolCall(name, args) {
            await stream.writeSSE({ event: 'tool_call', data: JSON.stringify({ name, args }) });
          },
          async onToolResult(result) {
            // Persist tool message for traceability
            deps.messages.create(sessionId, 'tool', result.content, agentRun.id);
            await stream.writeSSE({
              event: 'tool_result',
              data: JSON.stringify({ name: result.name, content: result.content, error: result.error }),
            });
          },
          async onDone(iterations) {
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

      // Handle client disconnect — mark run as cancelled if still running
      if (abort.signal.aborted) {
        const run = deps.agentRuns.findById(agentRun.id);
        if (run?.status === 'running') deps.agentRuns.cancel(agentRun.id);
      }
    });
  });

  return router;
}
