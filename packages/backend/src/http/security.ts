import type { Context, Next } from 'hono';
import { config } from '../config.js';

function configuredOrigins(): string[] {
  return config.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string): boolean {
  if (config.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }
  return configuredOrigins().includes(origin);
}

export async function securityHeadersMiddleware(c: Context, next: Next): Promise<void> {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "connect-src 'self' http: https: ws: wss:",
      "object-src 'none'",
    ].join('; ')
  );
  if (config.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export async function corsMiddleware(c: Context, next: Next): Promise<Response | void> {
  const origin = c.req.header('Origin');
  const allowed = origin ? isAllowedOrigin(origin) : false;

  if (origin && allowed) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    c.header('Access-Control-Max-Age', '600');
  }

  if (c.req.method === 'OPTIONS') {
    if (origin && !allowed) return c.json({ error: 'CORS origin not allowed' }, 403);
    return new Response(null, { status: 204 });
  }

  return next();
}
