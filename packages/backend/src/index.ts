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
import { ProjectManifestsRepo } from './db/repos/project-manifests.js';
import { ProjectServicesRepo } from './db/repos/project-services.js';
import { ProjectApiRoutesRepo } from './db/repos/project-api-routes.js';
import { ProjectDbSchemasRepo, ProjectDbMigrationsRepo } from './db/repos/project-database.js';
import { ProjectEnvVarsRepo } from './db/repos/project-env-vars.js';
import { ProjectValidationReportsRepo, ProjectRuntimeInstancesRepo } from './db/repos/project-validation-runtime.js';
import { ProjectSnapshotsRepo } from './db/repos/project-snapshots.js';
import { ProjectSnapshotBlobsRepo } from './db/repos/project-snapshot-blobs.js';
import { ToolCallAuditRepo } from './db/repos/tool-call-audit.js';
import { RefreshTokensRepo } from './db/repos/refresh-tokens.js';

import { StorageService } from './storage/storage.js';
import { FlagsService } from './flags/flags.js';
import { WsManager } from './realtime/ws-manager.js';
import { PushService } from './realtime/web-push.js';
import { JobQueueClient } from './workers/queue.js';

import { createAuthRouter } from './auth/routes.js';
import { createOidcRouter } from './auth/oidc/routes.js';
import { createStorageRouter } from './storage/routes.js';
import { createFlagsRouter } from './flags/routes.js';
import { createRealtimeRouter } from './realtime/routes.js';
import { createSessionsRouter } from './sessions/routes.js';
import { createAdminRouter } from './admin/routes.js';
import { createChatRouter } from './chat/routes.js';
import { createWorkspaceRouter } from './workspace/routes.js';
import { createBuilderRouter } from './builder/routes.js';
import { authMiddleware, configureAuthMiddleware } from './auth/middleware.js';
import { OllamaClient } from './ollama/client.js';
import { corsMiddleware, securityHeadersMiddleware } from './http/security.js';
import { MetricsRegistry } from './telemetry/metrics.js';

function normalizeRoute(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/[0-9]+(?=\/|$)/g, '/:id');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

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
  const projectManifests = new ProjectManifestsRepo(db);
  const projectServices = new ProjectServicesRepo(db);
  const projectApiRoutes = new ProjectApiRoutesRepo(db);
  const projectDbSchemas = new ProjectDbSchemasRepo(db);
  const projectDbMigrations = new ProjectDbMigrationsRepo(db);
  const projectEnvVars = new ProjectEnvVarsRepo(db);
  const projectValidationReports = new ProjectValidationReportsRepo(db);
  const projectRuntimeInstances = new ProjectRuntimeInstancesRepo(db);
  const projectSnapshotBlobs = new ProjectSnapshotBlobsRepo(db);
  const projectSnapshots = new ProjectSnapshotsRepo(db, projectSnapshotBlobs, flags);
  const toolAudit = new ToolCallAuditRepo(db);
  const refreshTokens = new RefreshTokensRepo(db);
  const metrics = new MetricsRegistry();

  configureAuthMiddleware(users);

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

  app.use('*', securityHeadersMiddleware);
  app.use('*', corsMiddleware);

  // Global request logging
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const route = normalizeRoute(new URL(c.req.url).pathname);
    metrics.recordHttp(c.req.method, route, c.res.status, duration);
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

  app.route('/auth', createAuthRouter(users, challenges, wsManager, refreshTokens));
  app.route('/auth/oidc', createOidcRouter(users));
  app.route('/api/artifacts', createStorageRouter(storage));
  app.route('/', createFlagsRouter(flagsService));
  app.route('/admin', createAdminRouter(users, jobs, settingsRepo, projectSnapshots, toolAudit));
  app.route('/api/sessions', createSessionsRouter(sessions, messages));
  app.route('/api/chat', createChatRouter({
    sessions,
    messages,
    tasks,
    agentRuns,
    storage,
    projects,
    screens,
    projectFiles,
    settings: settingsRepo,
    projectManifests,
    projectServices,
    projectApiRoutes,
    projectDbSchemas,
    projectDbMigrations,
    projectEnvVars,
    projectValidationReports,
    projectRuntimeInstances,
    projectSnapshots,
    jobs: queue,
    toolAudit,
    flags,
  }));
  app.route('/api/workspace', createWorkspaceRouter());

  app.get('/api/ollama/health', authMiddleware, async (c) => {
    const baseUrl = settingsRepo.get('ollama.base_url') ?? config.OLLAMA_BASE_URL;
    const client = new OllamaClient(baseUrl);
    const ok = await client.health();
    const model = settingsRepo.get('ollama.coding_model') ?? null;
    return c.json({ ok, model: model ?? null, baseUrl });
  });

  app.get('/api/health', async (c) => {
    let dbOk = false;
    try {
      db.prepare('SELECT 1 AS ok').get();
      dbOk = true;
    } catch (err) {
      logger.error({ err }, 'Healthcheck DB probe failed');
    }

    const baseUrl = settingsRepo.get('ollama.base_url') ?? config.OLLAMA_BASE_URL;
    const client = new OllamaClient(baseUrl);
    const ollamaOk = await withTimeout(
      client.health(),
      config.HEALTHCHECK_OLLAMA_TIMEOUT_MS,
      false
    );
    const queueStats = jobs.stats();

    return c.json(
      {
        ok: dbOk,
        db: dbOk ? 'ok' : 'error',
        ollama: ollamaOk ? 'ok' : 'error',
        workers: {
          pending: queueStats.pending,
          processing: queueStats.processing,
          failed: queueStats.failed,
          lag_ms: queueStats.oldestPendingAgeMs,
        },
        timestamp: new Date().toISOString(),
      },
      dbOk ? 200 : 503
    );
  });

  app.get('/api/metrics', (c) => {
    return c.text(metrics.render(), 200, { 'Content-Type': 'text/plain; version=0.0.4' });
  });

  app.route(
    '/api',
    createBuilderRouter(
      projects,
      screens,
      sessions,
      previews,
      appResources,
      projectFiles,
      projectRuns,
      components,
      projectManifests,
      projectServices,
      projectApiRoutes,
      projectDbSchemas,
      projectDbMigrations,
      projectEnvVars,
      projectValidationReports,
      projectRuntimeInstances,
      projectSnapshots,
      projectSnapshotBlobs,
      queue
    )
  );
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

  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down...');
    wsManager.closeAll();
    wss.close(() => {
      server.close((err) => {
        if (err) {
          logger.error({ err }, 'HTTP server failed to close cleanly');
          process.exit(1);
        }
        closeDb();
        process.exit(0);
      });
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start DevMind backend');
  process.exit(1);
});
