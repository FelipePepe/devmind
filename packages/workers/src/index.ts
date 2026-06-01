import pino from 'pino';
import { getDb } from './db.js';
import { JobQueueClient } from './jobs.js';
import { indexCodebase, type IndexCodebasePayload } from './handlers/index-codebase.js';
import { archiveSessions } from './handlers/archive-sessions.js';
import { generateProject, type GenerateProjectPayload } from './handlers/generate-project.js';
import { rebuildPreview, type RebuildPreviewPayload } from './handlers/rebuild-preview.js';
import { validateProject, type ValidateProjectPayload } from './handlers/validate-project.js';
import { validateWithPlaywright, type ValidateWithPlaywrightPayload } from './handlers/validate-with-playwright.js';
import { initPool, closePool } from './playwright/browser-pool.js';
import type { Job } from './jobs.js';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const POLL_INTERVAL_MS = 5_000;

let isRunning = false;
let stopping = false;
let tickCount = 0;

const jobs = new JobQueueClient();
const db = getDb();

async function dispatch(job: Job): Promise<void> {
  logger.info({ jobId: job.id, type: job.type }, 'Processing job');
  try {
    switch (job.type) {
      case 'indexCodebase':
        logger.info({ jobId: job.id }, 'Job: indexCodebase starting');
        await indexCodebase(
          JSON.parse(job.payload) as IndexCodebasePayload,
          jobs,
          job.id
        );
        logger.info({ jobId: job.id }, 'Job: indexCodebase completed');
        break;
      case 'archiveSessions':
        logger.info({ jobId: job.id }, 'Job: archiveSessions starting');
        await archiveSessions(jobs, job.id);
        logger.info({ jobId: job.id }, 'Job: archiveSessions completed');
        break;
      case 'generateProject':
        logger.info({ jobId: job.id }, 'Job: generateProject starting');
        await generateProject(JSON.parse(job.payload) as GenerateProjectPayload, jobs, job.id);
        logger.info({ jobId: job.id }, 'Job: generateProject completed');
        break;
      case 'rebuildPreview':
        logger.info({ jobId: job.id }, 'Job: rebuildPreview starting');
        await rebuildPreview(JSON.parse(job.payload) as RebuildPreviewPayload, jobs, job.id);
        logger.info({ jobId: job.id }, 'Job: rebuildPreview completed');
        break;
      case 'validateProject':
        logger.info({ jobId: job.id }, 'Job: validateProject starting');
        await validateProject(JSON.parse(job.payload) as ValidateProjectPayload, jobs, job.id);
        logger.info({ jobId: job.id }, 'Job: validateProject completed');
        break;
      case 'validate-with-playwright':
        logger.info({ jobId: job.id }, 'Job: validate-with-playwright starting');
        await validateWithPlaywright(JSON.parse(job.payload) as ValidateWithPlaywrightPayload, jobs, job.id);
        logger.info({ jobId: job.id }, 'Job: validate-with-playwright completed');
        break;
      default:
        logger.warn({ type: job.type }, 'Unknown job type');
        jobs.updateStatus(job.id, 'failed', `Unknown job type: ${job.type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId: job.id, err }, 'Job failed');
    jobs.markFailed(job.id, message);
  }
}

async function tick(): Promise<void> {
  if (stopping) return;

  if (isRunning) {
    setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return;
  }

  isRunning = true;
  try {
    jobs.resetStuckJobs();
    const job = jobs.dequeueNext();
    if (job) {
      logger.info({ jobId: job.id, type: job.type }, 'Workers: job dequeued');
      await dispatch(job);
    }
    tickCount++;
    if (tickCount % 100 === 0) {
      logger.info({ tickCount }, 'Workers: checkpoint');
      db.pragma('wal_checkpoint(PASSIVE)');
    }
  } finally {
    isRunning = false;
    if (!stopping) setTimeout(() => void tick(), POLL_INTERVAL_MS);
  }
}

// On startup: init Playwright browser pool, then start job loop
void initPool().catch((err) => {
  logger.warn({ err }, 'Playwright pool init failed — validate-with-playwright jobs will error');
});

// On startup: reset stuck jobs and check for today's archive job
jobs.resetStuckJobs();
if (!jobs.hasTodayArchiveJob()) {
  const id = jobs.enqueue('archiveSessions', {});
  logger.info({ jobId: id }, 'Enqueued daily archiveSessions job');
}

// Start poll loop
setTimeout(() => void tick(), POLL_INTERVAL_MS);
logger.info('Workers sidecar started');

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — stopping worker after current job');
  stopping = true;

  const waitForIdle = (): void => {
    if (!isRunning) {
      void closePool().finally(() => {
        logger.info('Worker stopped cleanly');
        process.exit(0);
      });
      return;
    }
    setTimeout(waitForIdle, 500);
  };
  waitForIdle();
});
