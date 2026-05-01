import { Hono } from 'hono';
import { authMiddleware } from '../auth/middleware.js';
import { verifyToken } from './signed-url.js';
import type { StorageService } from './storage.js';
import type { HonoEnv } from '../types.js';

export function createStorageRouter(storage: StorageService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/upload', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return c.json({ error: 'No file provided' }, 400);

    const sessionId = (formData.get('sessionId') as string | null) ?? null;
    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      const result = await storage.upload(
        userId,
        sessionId,
        file.name,
        file.type,
        buffer
      );
      return c.json(result);
    } catch (err) {
      const e = err as { message: string; status?: number };
      return c.json({ error: e.message }, (e.status ?? 500) as 400 | 500);
    }
  });

  router.get('/:id/download', async (c) => {
    const artifactId = c.req.param('id');
    const token = c.req.query('token');
    if (!token) return c.json({ error: 'Missing token' }, 400);

    // We need userId — for signed URL downloads, we extract it from the artifact
    // Ownership is enforced at repo level via verifyToken (which binds to userId)
    // We use a generic lookup approach: try to find artifact by id, then verify token
    // Note: the full security model is HMAC(artifactId + userId + expiresAt)
    // Without userId in query, we need to trust the token binding
    // The token encodes userId implicitly via HMAC — a valid token for the right userId
    // Since we don't have userId here, this route uses a different pattern:
    // The client requests via the signed URL that includes the full token

    // For this route we need userId. The signed URL should include it or
    // we do the lookup differently. Per design: GET /api/artifacts/:id/download?token=...
    // We'll encode userId in the URL path to keep the signed URL approach self-contained.
    // Deviation: we require userId as a query param for the signed URL pattern.
    const queryUserId = c.req.query('userId');
    if (!queryUserId) return c.json({ error: 'Missing userId' }, 400);

    if (!verifyToken(token, artifactId, queryUserId)) {
      return c.json({ error: 'Invalid or expired token' }, 403);
    }

    try {
      const stream = storage.download(queryUserId, artifactId, token);
      c.header('Content-Disposition', `attachment`);
      c.header('X-Content-Type-Options', 'nosniff');
      return new Response(stream as unknown as ReadableStream, {
        headers: {
          'Content-Disposition': 'attachment',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (err) {
      const e = err as { message: string; status?: number };
      return c.json({ error: e.message }, (e.status ?? 500) as 400 | 403 | 404 | 500);
    }
  });

  return router;
}
