import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import pino from 'pino';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

const POOL_SIZE = Number(process.env['PLAYWRIGHT_POOL_SIZE'] ?? 2);
const ACQUIRE_TIMEOUT_MS = 60_000;

interface PoolSlot {
  context: BrowserContext;
  busy: boolean;
}

let browser: Browser | null = null;
const slots: PoolSlot[] = [];
let initialized = false;

export async function initPool(): Promise<void> {
  if (initialized) return;
  const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];
  browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  });
  initialized = true;
  logger.info({ size: POOL_SIZE, executablePath: executablePath ?? 'playwright-bundled' }, 'playwright pool ready');
}

export async function acquireContext(): Promise<BrowserContext> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const free = slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return free.context;
    }
    if (slots.length < POOL_SIZE) {
      const context = await browser!.newContext();
      const slot: PoolSlot = { context, busy: true };
      slots.push(slot);
      return context;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`BrowserPool: timed out acquiring a context after ${ACQUIRE_TIMEOUT_MS}ms`);
}

export async function releaseContext(context: BrowserContext): Promise<void> {
  const slot = slots.find((s) => s.context === context);
  if (!slot) return;
  try {
    await context.clearCookies();
  } catch {
    // context may already be closed on error path
  }
  slot.busy = false;
}

export async function killAndReplaceContext(context: BrowserContext): Promise<void> {
  const index = slots.findIndex((s) => s.context === context);
  if (index === -1) return;
  try { await context.close(); } catch { /* ignore */ }
  const fresh = await browser!.newContext();
  slots[index] = { context: fresh, busy: false };
}

export async function closePool(): Promise<void> {
  for (const slot of slots) {
    try { await slot.context.close(); } catch { /* ignore */ }
  }
  slots.length = 0;
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
  }
  initialized = false;
}
