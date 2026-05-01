import type { Context, Next } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;
const MAX_MAP_SIZE = 1000;

const store = new Map<string, RateLimitEntry>();

function getIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown'
  );
}

export function rateLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
  const ip = getIp(c);
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
  }
  entry.count += 1;
  store.set(ip, entry);

  // Evict oldest entry if map exceeds cap
  if (store.size > MAX_MAP_SIZE) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest !== undefined) store.delete(oldest);
  }

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'Too many requests', code: 'RATE_LIMITED' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
        },
      })
    );
  }

  return next();
}
