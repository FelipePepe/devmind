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
import type { StorageService } from '../storage/storage.js';
import type { HonoEnv } from '../types.js';
import type { OllamaMessage } from '../ollama/types.js';

const SYSTEM_PROMPT =
  'You are DevMind, a local AI coding assistant. ' +
  'You help the user write, review, and understand code. ' +
  'Use your tools to read files, search the codebase, and run commands when needed. ' +
  'Be concise and precise. Prefer code over prose when answering coding questions.';

const HISTORY_LIMIT = 40;

const ChatBodySchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1).max(10_000),
});

export interface ChatRouterDeps {
  sessions: SessionsRepo;
  messages: MessagesRepo;
  tasks: TasksRepo;
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
      { role: 'system', content: SYSTEM_PROMPT },
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
            await stream.writeSSE({
              event: 'tool_result',
              data: JSON.stringify({ name: result.name, content: result.content, error: result.error }),
            });
          },
          async onDone() {
            const assistantMsg = deps.messages.create(
              sessionId,
              'assistant',
              assistantContent || '(empty response)'
            );
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({ messageId: assistantMsg.id }),
            });
          },
          async onError(err) {
            logger.error({ err, sessionId, userId }, 'Chat agent error');
            await stream
              .writeSSE({ event: 'error', data: JSON.stringify({ message: err.message }) })
              .catch(() => null);
          },
        },
      });
    });
  });

  return router;
}
