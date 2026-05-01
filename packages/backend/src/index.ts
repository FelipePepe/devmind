import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { config } from './config.js';
import { logger } from './logger.js';
import { getDb, closeDb } from './db/db.js';

// Repos
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

// Services
import { StorageService } from './storage/storage.js';
import { FlagsService } from './flags/flags.js';
import { WsManager } from './realtime/ws-manager.js';
import { PushService } from './realtime/web-push.js';
import { JobQueueClient } from './workers/queue.js';

// Routes
import { createAuthRouter } from './auth/routes.js';
import { createStorageRouter } from './storage/routes.js';
import { createFlagsRouter } from './flags/routes.js';
import { createRealtimeRouter } from './realtime/routes.js';
import { createSessionsRouter } from './sessions/routes.js';
import { createAdminRouter } from './admin/routes.js';
import { createChatRouter } from './chat/routes.js';

// Instantiate DB and all repos/services
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

const storage = new StorageService(artifacts);
const flagsService = new FlagsService(flags);
const wsManager = new WsManager();
const push = new PushService(subscriptions);
wsManager.setPushService(push);
const _queue = new JobQueueClient(jobs);

// Suppress unused warnings for repos used only indirectly
void artifacts;

// Build Hono app
const app = new Hono();

// Global error handler
app.onError((err, c) => {
  logger.error({ err }, 'Unhandled error');
  return c.json({ error: 'Internal server error' }, 500);
});

// Mount routers
app.route('/auth', createAuthRouter(users, challenges, wsManager));
app.route('/api/artifacts', createStorageRouter(storage));
app.route('/', createFlagsRouter(flagsService));
app.route('/admin', createAdminRouter(users, jobs));
app.route('/api/sessions', createSessionsRouter(sessions, messages));
app.route('/api/chat', createChatRouter({ sessions, messages, tasks, agentRuns, storage }));
app.route('/', createRealtimeRouter(wsManager, push));

const server = serve(
  { fetch: app.fetch, port: config.PORT },
  (info) => {
    logger.info({ port: info.port }, 'DevMind backend started');
  }
);

// WebSocket server — handles /ws?ticket=... upgrades via raw ws package
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
    const url = new URL(req.url ?? '', `http://localhost`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  }
);

// Graceful shutdown
function shutdown(): void {
  logger.info('Shutting down...');
  wsManager.closeAll();
  wss.close();
  closeDb();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

