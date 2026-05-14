import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { config, parseConfig } from './config.js';
import { logger } from './logger.js';
import { loadSecrets } from './secrets.js';
import { getDb, closeDb } from './db/db.js';

import { UsersRepo } from './db/repos/users.js';
import { SessionsRepo } from './db/repos/sessions.js';
import { MessagesRepo } from './db/repos/messages.js';
import { TasksRepo } from './db/repos/tasks.js';
import { ArtifactsRepo } from './db/repos/artifacts.js';
import { FlagsRepo } from './db/repos/flags.js';
import { JobsRepo } from './db/repos/jobs.js';
import { SubscriptionsRepo } from './db/repos/subscriptions.js';
import { ChallengesRepo } from './db/repos/challenges.js';
import { AgentRunsRepo } from './db/repos/agent-runs.js';
import { SettingsRepo } from './db/repos/settings.js';
import { ProjectsRepo } from './db/repos/projects.js';
import { ScreensRepo } from './db/repos/screens.js';
import { PreviewsRepo } from './db/repos/previews.js';
import { ProjectRunsRepo } from './db/repos/project-runs.js';
import { AppResourcesRepo } from './db/repos/app-resources.js';
import { ProjectFilesRepo } from './db/repos/project-files.js';
import { ComponentsRepo } from './db/repos/components.js';

import { StorageService } from './storage/storage.js';
import { FlagsService } from './flags/flags.js';
import { WsManager } from './realtime/ws-manager.js';
import { PushService } from './realtime/web-push.js';
import { JobQueueClient } from './workers/queue.js';

import { createAuthRouter } from './auth/routes.js';
import { createStorageRouter } from './storage/routes.js';
import { createFlagsRouter } from './flags/routes.js';
import { createRealtimeRouter } from './realtime/routes.js';
import { createSessionsRouter } from './sessions/routes.js';
import { createAdminRouter } from './admin/routes.js';
import { createChatRouter } from './chat/routes.js';
import { createWorkspaceRouter } from './workspace/routes.js';
import { createBuilderRouter } from './builder/routes.js';
import { authMiddleware } from './auth/middleware.js';
import { OllamaClient } from './ollama/client.js';

async function start(): Promise<void> {
  await loadSecrets();
  parseConfig();

  const db = getDb();

  const users = new UsersRepo(db);
  const sessions = new SessionsRepo(db);
  const messages = new MessagesRepo(db);
  const tasks = new TasksRepo(db);
  const artifacts = new ArtifactsRepo(db);
  const flags = new FlagsRepo(db);
  const jobs = new JobsRepo(db);
  const subscriptions = new SubscriptionsRepo(db);
  const challenges = new ChallengesRepo(db);
  const agentRuns = new AgentRunsRepo(db);
  const settingsRepo = new SettingsRepo(db);
  const projects = new ProjectsRepo(db);
  const screens = new ScreensRepo(db);
  const previews = new PreviewsRepo(db);
  const projectRuns = new ProjectRunsRepo(db);
  const appResources = new AppResourcesRepo(db);
  const projectFiles = new ProjectFilesRepo(db);
  const components = new ComponentsRepo(db);

  settingsRepo.seed('ollama.base_url', config.OLLAMA_BASE_URL, 'Ollama server base URL');
  settingsRepo.seed('ollama.coding_model', config.OLLAMA_CODING_MODEL, 'Model for code generation tasks');
  settingsRepo.seed('ollama.reasoning_model', config.OLLAMA_REASONING_MODEL, 'Model for reasoning/planning tasks');
  settingsRepo.seed('ollama.vision_model', config.OLLAMA_VISION_MODEL, 'Model for vision/image tasks');
  settingsRepo.seed('ollama.embed_model', config.OLLAMA_EMBED_MODEL, 'Model for text embeddings');

  const storage = new StorageService(artifacts);
  const flagsService = new FlagsService(flags);
  const wsManager = new WsManager();
  const push = new PushService(subscriptions);
  wsManager.setPushService(push);
  const queue = new JobQueueClient(jobs);

  void artifacts;

  const app = new Hono();

  // Global request logging
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    logger.info(
      { method: c.req.method, path: c.req.url, status: c.res.status, duration_ms: duration },
      'HTTP'
    );
  });

  app.onError((err, c) => {
    logger.error({ err, method: c.req.method, path: c.req.url }, 'Unhandled error');
    return c.json(
      {
        error: config.NODE_ENV === 'development' ? err.message : 'Internal server error',
      },
      500
    );
  });

  app.route('/auth', createAuthRouter(users, challenges, wsManager));
  app.route('/api/artifacts', createStorageRouter(storage));
  app.route('/', createFlagsRouter(flagsService));
  app.route('/admin', createAdminRouter(users, jobs, settingsRepo));
  app.route('/api/sessions', createSessionsRouter(sessions, messages));
  app.route('/api/chat', createChatRouter({ sessions, messages, tasks, agentRuns, storage, projects, screens, projectFiles, settings: settingsRepo }));
  app.route('/api/workspace', createWorkspaceRouter());

  app.get('/api/ollama/health', authMiddleware, async (c) => {
    const baseUrl = settingsRepo.get('ollama.base_url') ?? config.OLLAMA_BASE_URL;
    const client = new OllamaClient(baseUrl);
    const ok = await client.health();
    const model = settingsRepo.get('ollama.coding_model') ?? null;
    return c.json({ ok, model: model ?? null, baseUrl });
  });

  app.route('/api', createBuilderRouter(projects, screens, sessions, previews, appResources, projectFiles, projectRuns, components, queue));
  app.route('/', createRealtimeRouter(wsManager, push));

  const server = serve(
    { fetch: app.fetch, port: config.PORT, hostname: '0.0.0.0' },
    (info) => {
      logger.info({ port: info.port }, 'DevMind backend started');
    }
  );

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', `http://localhost`);
    const ticket = url.searchParams.get('ticket');
    const userId = ticket ? wsManager.consumeTicket(ticket) : null;

    if (!userId) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    wsManager.register(userId, ws);
    ws.on('close', () => wsManager.unregister(userId, ws));
    ws.on('error', () => wsManager.unregister(userId, ws));
  });

  (server as unknown as {
    on(event: 'upgrade', handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): void;
  }).on(
    'upgrade',
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      if (url.pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    }
  );

  function shutdown(): void {
    logger.info('Shutting down...');
    wsManager.closeAll();
    wss.close();
    closeDb();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start DevMind backend');
  process.exit(1);
});
