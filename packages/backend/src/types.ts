import type { Env } from 'hono';

/**
 * Shared Hono environment with typed Variables.
 * Use `new Hono<HonoEnv>()` in all authenticated routers.
 */
export interface HonoEnv extends Env {
  Variables: {
    userId: string;
    isAdmin: boolean;
  };
}
