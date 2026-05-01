import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../auth/middleware.js';
import type { UsersRepo } from '../db/repos/users.js';
import type { JobsRepo } from '../db/repos/jobs.js';
import type { HonoEnv } from '../types.js';

export function createAdminRouter(users: UsersRepo, jobs: JobsRepo): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/users', authMiddleware, adminMiddleware, (c) => {
    return c.json(users.list());
  });

  router.get('/jobs', authMiddleware, adminMiddleware, (c) => {
    return c.json(jobs.list());
  });

  return router;
}
