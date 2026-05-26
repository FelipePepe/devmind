import { z } from 'zod';

// NOTE: The following secrets MUST be provisioned in Infisical project devmind-pxgt:
//   VAPID_PUBLIC_KEY    — VAPID public key for Web Push
//   VAPID_PRIVATE_KEY   — VAPID private key (min 32 chars)
//   JWT_SECRET          — HMAC signing secret (min 32 chars)
//   STORAGE_BASE_PATH   — Absolute path to NAS file storage root
//   DB_PATH             — Path to SQLite database file (default below)
// Run: infisical run -- node dist/index.js

const rawConfigSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Ollama
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_CODING_MODEL: z.string().default('qwen2.5-coder:7b'),
  OLLAMA_REASONING_MODEL: z.string().default('qwen3:latest'),
  OLLAMA_VISION_MODEL: z.string().default('qwen2.5-vl:7b'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),

  // General
  DEVMIND_API_KEY: z.string().default(''),
  WORKSPACE_ROOT: z.string().default(process.cwd()),
  VECTOR_DB_PATH: z.string().default('./data/vectors'),
  SQLITE_PATH: z.string().default('./data/checkpoints.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  MAX_TOOL_TIMEOUT_MS: z.coerce.number().default(30_000),
  ALLOWED_SHELL_COMMANDS: z
    .string()
    .default('git,npm,pnpm,node,tsc,eslint,jest,vitest'),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5001'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5001'),
  COOKIE_SECURE: z.coerce.boolean().optional(),
  TRUST_PROXY: z.coerce.boolean().default(false),
  HEALTHCHECK_OLLAMA_TIMEOUT_MS: z.coerce.number().default(1_500),

  // Database
  DB_PATH: z.string().default('./data/devmind.db'),

  // Storage
  STORAGE_BASE_PATH: z.string(),

  // JWT (required — provisioned in Infisical)
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_MS: z.coerce.number().default(900_000),      // 15 min
  JWT_REFRESH_TTL_MS: z.coerce.number().default(604_800_000), // 7 days

  // VAPID / Web Push (required — provisioned in Infisical)
  VAPID_PUBLIC_KEY: z.string(),
  VAPID_PRIVATE_KEY: z.string().min(32),
  VAPID_SUBJECT: z.string().default('mailto:admin@devmind.casa'),

  // Upload limits
  MAX_UPLOAD_BYTES: z.coerce.number().default(104_857_600), // 100 MiB

  // Feature flags
  FLAG_CACHE_TTL_MS: z.coerce.number().default(300_000), // 5 min

  // Signed URLs
  SIGNED_URL_TTL_MS: z.coerce.number().default(3_600_000), // 1 hour

  // WebAuthn (kept for config compatibility but no longer used in auth flow)
  WEBAUTHN_RP_ID: z.string().default('devmind.casa'),
  WEBAUTHN_RP_NAME: z.string().default('DevMind'),
  WEBAUTHN_DISABLED: z.coerce.boolean().default(true),

  // OIDC / Keycloak (008-keycloak-oidc)
  AUTH_LOCAL_ENABLED: z.coerce.boolean().default(true),
  OIDC_ISSUER: z.string().default(''),
  OIDC_CLIENT_ID_FRONTEND: z.string().default('devmind-frontend'),
  OIDC_CLIENT_ID_BACKEND: z.string().default('devmind-backend'),
  OIDC_CLIENT_SECRET_BACKEND: z.string().default(''),
  OIDC_REDIRECT_URI: z.string().default(''),
  OIDC_POST_LOGOUT_REDIRECT: z.string().default(''),
  OIDC_JWKS_CACHE_TTL_MS: z.coerce.number().default(3_600_000),
  OIDC_ADMIN_ROLE: z.string().default('admin'),
});

const PLACEHOLDER_SECRETS = new Set(['changeme', 'change-me', 'dev-secret', 'secret', 'password']);

const ConfigSchema = rawConfigSchema.superRefine((cfg, ctx) => {
  if (cfg.NODE_ENV !== 'production') return;

  if (PLACEHOLDER_SECRETS.has(cfg.JWT_SECRET.toLowerCase())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET must not use a known placeholder in production',
    });
  }

  for (const key of ['DB_PATH', 'STORAGE_BASE_PATH', 'WORKSPACE_ROOT', 'VECTOR_DB_PATH'] as const) {
    if (!cfg[key].startsWith('/')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be an absolute path in production`,
      });
    }
  }

  const origins = cfg.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0 || origins.some((origin) => origin === '*')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ALLOWED_ORIGINS'],
      message: 'CORS_ALLOWED_ORIGINS must list explicit origins in production',
    });
  }

  // When OIDC is configured, redirect URIs must be present too.
  if (cfg.OIDC_ISSUER && !cfg.OIDC_REDIRECT_URI) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OIDC_REDIRECT_URI'],
      message: 'OIDC_REDIRECT_URI is required when OIDC_ISSUER is set',
    });
  }

  // After cleanup, AUTH_LOCAL_ENABLED=false must imply OIDC configured.
  if (!cfg.AUTH_LOCAL_ENABLED && !cfg.OIDC_ISSUER) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OIDC_ISSUER'],
      message: 'OIDC_ISSUER is required when AUTH_LOCAL_ENABLED=false',
    });
  }
});

export type Config = z.infer<typeof ConfigSchema>;

export let config: Config = ConfigSchema.parse(process.env);

export function parseConfig(): Config {
  config = ConfigSchema.parse(process.env);
  return config;
}
